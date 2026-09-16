import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { isValidObjectId } from 'mongoose';
import { PDFParse } from 'pdf-parse';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import Opportunity from '../models/Opportunity';
import Cv from '../models/Cv';
import Mentorship from '../models/Mentorship';
import MentorshipComplaint from '../models/MentorshipComplaint';
import { aiReplyCache, embeddingCache } from '../lib/cache';
import {
  OFF_TOPIC_REFUSAL,
  isOffTopic,
  hasMentorshipIntent,
  hasMentorshipComplaint,
  makeTicket,
  buildMentorshipReply,
  buildComplaintReply,
  serializeOpportunities,
  buildSystemPrompt,
} from '../../../shared/chatPolicies';

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const INDEX_NAME = 'prime-opportunity-index';

const nvidiaEmbedClient = new OpenAI({
  apiKey: process.env.NVIDIA_EMBED_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

const nvidiaChatClient = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
  timeout: 90000,
  maxRetries: 1,
});

// ---- Per-user chat burst limiter (Tier 2, Item 6) --------------------------
// The chat endpoint calls the SHARED NVIDIA API layer, so a single user spamming
// messages could burn the shared key's quota for everyone. Burst control is
// keyed on the VERIFIED Firebase uid (req.authUser!.uid), never the raw client
// IP — one home/office/ISP NAT IP can carry dozens of real users, so IP-based
// limits collide with legitimate shared traffic. Exactly what a uid bucket costs:
// one Map look-up + one timestamp compare per request — far below any baseline.
//
// Token bucket per uid: CEILING tokens refilled continuously (CEILING per
// WINDOW_MS), so short bursts are allowed but sustained load is smoothed.
const CHAT_RATE_LIMIT = { CEILING: 3, WINDOW_MS: 60_000 };
const chatBuckets = new Map<string, { tokens: number; last: number }>();

const chatRateLimitCheck = (uid: string): boolean => {
  const now = Date.now();
  const entry = chatBuckets.get(uid);
  if (!entry) {
    chatBuckets.set(uid, { tokens: CHAT_RATE_LIMIT.CEILING - 1, last: now });
    return true;
  }
  const refill =
    ((now - entry.last) / CHAT_RATE_LIMIT.WINDOW_MS) * CHAT_RATE_LIMIT.CEILING;
  entry.tokens = Math.min(CHAT_RATE_LIMIT.CEILING, entry.tokens + refill);
  entry.last = now;
  if (entry.tokens < 1) return false;
  entry.tokens -= 1;
  return true;
};

// Automated sweep: drop any bucket idle for 2+ windows so the map only ever
// holds recently-active users — zero risk of unbounded memory growth. unref'd
// so the interval never keeps the Node process alive on its own.
const CHAT_RATE_SWEEP_MS = 60_000;
const sweepChatBuckets = (): void => {
  const cutoff = Date.now() - 2 * CHAT_RATE_LIMIT.WINDOW_MS;
  for (const [uid, entry] of chatBuckets) {
    if (entry.last < cutoff) chatBuckets.delete(uid);
  }
};
setInterval(sweepChatBuckets, CHAT_RATE_SWEEP_MS).unref();

// Exported for tests so the module-level map can be inspected/reset deterministically.
export const _chatRateLimit = {
  buckets: chatBuckets,
  check: chatRateLimitCheck,
  sweep: sweepChatBuckets,
  config: CHAT_RATE_LIMIT,
  sweepMs: CHAT_RATE_SWEEP_MS,
};

// Each user's CV vectors live in their OWN namespace (cvs-<userId>).
// This guarantees a chat query can never retrieve another user's CV data,
// even if a malicious request is made.
const CV_NAMESPACE_PREFIX = 'cvs-';

// Embed a single text string, serving repeat inputs from the local embedding
// cache instead of the paid NVIDIA endpoint. The key is a SHA-256 hash of the
// raw text so no identifiable/PII text is stored, and identical repeated
// questions (across users) skip the embed API call entirely. Embeddings are
// content-derived and safe to share, so the key carries no user scope.
const embedText = async (text: string): Promise<number[]> => {
  const key = createHash('sha256').update(text).digest('hex');
  const cached = embeddingCache.get(key);
  if (cached) return cached;

  const response = await nvidiaEmbedClient.embeddings.create({
    model: 'nvidia/nemotron-3-embed-1b',
    input: text,
  });
  const vector = response.data[0].embedding;
  embeddingCache.set(key, vector);
  return vector;
};

// Deterministic guardrail + intent detection lives in shared/chatPolicies.ts so
// the Cloudflare Worker and this server always agree. Do not duplicate it here.

// ---- Chat action detection -----------------------------------------------
const handleMentorshipComplaint = async (message: string, userId: string, userEmail: string, userName: string): Promise<string> => {
  const ticket = makeTicket();
  try {
    let payments: Array<{ reference: string; amount: number; currency: string; mentorName: string; createdAt: Date }> = [];
    if (userId) {
      const paidRecords = await Mentorship.find({ userId, status: 'paid' })
        .select('reference amount currency mentorName createdAt')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      payments = paidRecords.map(r => ({
        reference: r.reference,
        amount: r.amount,
        currency: r.currency,
        mentorName: r.mentorName || '',
        createdAt: r.createdAt,
      }));
    }

    await MentorshipComplaint.create({
      ticket,
      userId,
      userEmail,
      userName,
      message: message.slice(0, 2000),
      payments,
    });
    console.log(`AI chat escalated complaint ${ticket} from user "${userName}" (${userEmail || userId || 'guest'}) to admins.`);
  } catch (err) {
    console.error('Failed to persist mentorship complaint:', err);
  }
  return buildComplaintReply(userEmail, ticket);
};

const chunkText = (text: string, chunkSize = 1000, overlap = 150): string[] => {
  const clean = text.trim();
  if (clean.length <= chunkSize) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    chunks.push(clean.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
};

// Per-namespace async mutex for CV vector seeding.
// Keyed by the Pinecone namespace (cvs-<userId>) so concurrent requests from
// the SAME user serialize their deleteAll -> embed -> upsert cycle — only the
// first to arrive performs it; the rest queue, then re-check and reuse the
// seeded vectors. Namespaces of different users never contend with each other.
//
// Implementation: a promise-chain tail per key. `tail` is stored in the map so
// the next caller chains its own acquisition onto the previous holder. The map
// entry is removed once its holder finishes AND no newer waiter has since
// taken its place — so the map stays bounded (no leaks). Every path releases
// the lock in `finally`, so a failed/concurrent seed can never deadlock the
// queue for that user.
const namespaceLocks = new Map<string, Promise<void>>();

async function withNamespaceLock<T>(namespace: string, fn: () => Promise<T>): Promise<T> {
  const previous = namespaceLocks.get(namespace) ?? Promise.resolve();
  let releaseLock!: () => void;
  const current = new Promise<void>(resolve => {
    releaseLock = resolve;
  });
  const tail = previous.then(() => current);
  namespaceLocks.set(namespace, tail);

  await previous;
  try {
    return await fn();
  } finally {
    releaseLock();
    // If a newer waiter replaced our tail while we ran, leave their entry in
    // place; otherwise drop ours so the map never grows unbounded.
    if (namespaceLocks.get(namespace) === tail) {
      namespaceLocks.delete(namespace);
    }
  }
}

// Store a user's CV as chunked vectors in their private Pinecone namespace.
// Any previous CV vectors for this user are removed, so the namespace always
// reflects their most recent CV.
const seedUserCvVectors = async (
  cvText: string,
  userId: string,
  cvId: string,
  fileName: string
): Promise<{ namespace: string; chunks: number }> => {
  const namespace = `${CV_NAMESPACE_PREFIX}${userId}`;
  const index = pinecone.index(INDEX_NAME);

  // Delete this user's previous CV vectors (refreshes their private namespace).
  // The namespace may not exist yet on first upload — that is fine, skip it.
  try {
    await index.namespace(namespace).deleteAll();
  } catch (err: any) {
    if (err?.name !== 'PineconeNotFoundError') {
      throw err;
    }
  }

  const chunks = chunkText(cvText).slice(0, 5);
  const embedResponse = await nvidiaEmbedClient.embeddings.create({
    model: 'nvidia/nemotron-3-embed-1b',
    input: chunks,
  });

  const vectors = embedResponse.data.map((item, i) => ({
    id: `${cvId}-chunk-${i}`,
    values: item.embedding,
    metadata: {
      type: 'cv',
      userId,
      cvId,
      fileName,
      chunkIndex: i,
      text: chunks[i],
    },
  }));

  await index.namespace(namespace).upsert(vectors);
  return { namespace, chunks: vectors.length };
};

// ---------------------------------------------------------------------------
// Shared CV-match pipeline: embed → Pinecone query → LLM analysis → persist
// Used by both the initial analyzeCV (PDF upload) and the new reanalyzeCV
// (stored-text re-analysis) so the two paths stay identical.
// ---------------------------------------------------------------------------

interface RunCvMatchArgs {
  cvText: string;
  userId: string;
  userEmail: string;
  userName: string;
  fileName: string;
  contentType: string;
  fileData: Buffer;
}

async function runCvMatch({ cvText, userId, userEmail, userName, fileName, contentType, fileData }: RunCvMatchArgs) {
  const truncatedCVText = cvText.substring(0, 4000);

  const cvVector = await embedText(truncatedCVText);

  const index = pinecone.index(INDEX_NAME);
  const queryResponse = await index.query({
    vector: cvVector,
    topK: 5,
    includeMetadata: true,
  });

  const matchIds = queryResponse.matches.map(match => match.id);
  const matchedOpportunities = await Opportunity.find({ _id: { $in: matchIds } });
  const sortedOpportunities = matchIds
    .map(id => matchedOpportunities.find(o => o._id.toString() === id))
    .filter(Boolean);

  const oppsContext = sortedOpportunities.map((opp, index) =>
    `[${index + 1}] ${opp?.title} at ${opp?.organization}\nCategory: ${opp?.category}\nType: ${opp?.opportunityType}\nLocation: ${opp?.location}\nDescription: ${opp?.description}\n`
  ).join('\n');

  const prompt = `You are an expert career advisor.
A user has uploaded their CV, and our semantic search engine has found the top matching opportunities from our database.
Analyze the user's CV and explain why these specific opportunities are a great match for them. Highlight their strengths and suggest the best one to apply for.

USER CV:
${truncatedCVText}

TOP MATCHING OPPORTUNITIES:
${oppsContext}

Provide a personalized, encouraging response to the user. Use markdown formatting. Keep it concise but highly valuable. Do not hallucinate opportunities that are not in the list.`;

  const completion = await nvidiaChatClient.chat.completions.create({
    model: 'openai/gpt-oss-20b',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    top_p: 0.95,
    max_tokens: 1024,
    stream: false,
  });

  const analysis = completion.choices[0].message.content;

  const cv = new Cv({
    userId,
    userEmail,
    userName,
    fileName,
    contentType,
    fileData,
    text: cvText,
    analysis,
    matchIds: sortedOpportunities.map(o => o!._id),
  });
  await cv.save();

  // Seed CV vectors into the user's private Pinecone namespace so the chat
  // assistant has personalized context. Failure must NOT block the result.
  try {
    const cvNamespace = `${CV_NAMESPACE_PREFIX}${userId}`;
    await withNamespaceLock(cvNamespace, () =>
      seedUserCvVectors(cvText, userId, cv._id.toString(), fileName)
    );
  } catch (vecErr) {
    console.error('Could not seed CV vectors to Pinecone:', vecErr);
  }

  return { analysis, matches: sortedOpportunities, cvId: cv._id.toString() };
}

// ---- CV Analysis (PDF upload) --------------------------------------------

export const analyzeCV = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No CV file uploaded.' });
      return;
    }

    const PDF_MAGIC = Buffer.from('%PDF-', 'utf8');
    if (!req.file.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      res.status(400).json({ success: false, message: 'Only PDF files are allowed.' });
      return;
    }

    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const cvText = pdfData.text.trim();

    if (!cvText) {
      res.status(400).json({ success: false, message: 'Could not extract text from the provided PDF.' });
      return;
    }

    const userId = req.authUser!.uid;
    const { analysis, matches, cvId } = await runCvMatch({
      cvText,
      userId,
      userEmail: req.authUser!.email || '',
      userName: req.body.userName || '',
      fileName: req.file.originalname,
      contentType: req.file.mimetype,
      fileData: req.file.buffer,
    });

    res.json({ success: true, analysis, matches, cvId });
  } catch (error: any) {
    console.error('Error analyzing CV:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze CV.',
      error: error.message,
    });
  }
};

// ---- CV Re-analysis (reload against latest opportunities) -----------------
// Uses the stored CV text + metadata from the user's most recent upload so no
// file transfer is needed. Produces a fresh analysis against the current
// Pinecone index (which contains newly synced opportunities).

export const reanalyzeCV = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.uid;

    const latestCv = await Cv.findOne({ userId }).sort({ createdAt: -1 });
    if (!latestCv) {
      res.status(400).json({ success: false, message: 'No saved CV found. Upload a CV first.' });
      return;
    }

    const cvText = (latestCv.text || '').trim();
    if (!cvText) {
      res.status(400).json({ success: false, message: 'Saved CV has no extractable text. Upload a fresh PDF.' });
      return;
    }

    const { analysis, matches, cvId } = await runCvMatch({
      cvText,
      userId,
      userEmail: req.authUser!.email || latestCv.userEmail || '',
      userName: req.body.userName || latestCv.userName || '',
      fileName: latestCv.fileName,
      contentType: latestCv.contentType,
      fileData: latestCv.fileData,
    });

    res.json({ success: true, analysis, matches, cvId });
  } catch (error: any) {
    console.error('Error re-analyzing CV:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to re-analyze CV.',
      error: error.message,
    });
  }
};

// ---- Chat ----------------------------------------------------------------

// SSE frames sent to streaming clients:
//   { type: 'delta', text }          -> incremental assistant text
//   { type: 'done',  reply, action? }-> final reply (full text)
//   { type: 'error', message }       -> terminal failure
type SseFrame = Record<string, unknown>;

export const chatWithAI = async (req: Request, res: Response) => {
  try {
    // Strict cap on the incoming message (S14): bound embed + LLM token cost
    // per request and prevent oversized-payload resource exhaustion. Over-limit
    // input is rejected outright rather than silently truncated — fail closed.
    const message = ((req.body?.message as string) || '').trim();
    if (!message) {
      res.status(400).json({ success: false, message: 'Message is required.' });
      return;
    }
    if (message.length > 2000) {
      res.status(400).json({ success: false, message: 'Message exceeds the 2000 character limit.' });
      return;
    }

    // Conversation history (last 10 messages max) - [{role: 'user'|'assistant', content: string}]
    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const history = rawHistory
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10);

    // Identity comes from the verified Firebase token, never the request body.
    // userId scope is enforced by querying ONLY that user's private Pinecone namespace.
    const userId = req.authUser!.uid;
    // S-07: the user's email is taken exclusively from the verified token payload —
    // a client-supplied body field can be spoofed, so it is never used to identify,
    // store, or address the user.
    const userEmail = (req.authUser!.email || '').trim();
    const userName = ((req.body?.userName as string) || '').trim();

    const stream = req.body?.stream === true;

    // Per-user burst gate (Tier 2, Item 6): keyed on the verified uid, never
    // the client IP (a shared NAT/ISP IP hosts many real users). Checked here —
    // before ANY outbound NVIDIA work and before SSE headers are flushed — so
    // the 429 is always a clean HTTP response in both JSON and stream modes.
    if (!chatRateLimitCheck(userId)) {
      res.setHeader('Retry-After', String(Math.ceil(CHAT_RATE_LIMIT.WINDOW_MS / 1000)));
      res.status(429).json({ success: false, message: 'You are sending messages too quickly. Please slow down and try again in a moment.' });
      return;
    }

    // --- helpers for the two output modes (JSON vs SSE) ---
    const startSse = () => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
    };
    const writeSse = (frame: SseFrame) => {
      if (stream && !res.writableEnded) res.write(`data: ${JSON.stringify(frame)}\n\n`);
    };
    const respondDone = (reply: string, action?: { type: 'mentorship' }) => {
      if (stream) {
        writeSse({ type: 'done', reply, action: action || null });
        res.end();
      } else {
        res.json({ success: true, reply, action: action || undefined });
      }
    };

    // Streaming requests send SSE headers immediately so that EVERY reply path
    // (cache hit, guardrails, mentorship, LLM stream) frames the response the
    // same way — otherwise the client can't detect the event-stream and fails.
    if (stream) {
      startSse();
    }

    // --- in-memory cache: replay an identical recent request instantly ---
    // Key is a SHA-256 hash of uid|message so raw conversation text / PII is
    // never held in server memory, and the key stays bounded in length.
    const cacheKey = createHash('sha256').update(`${userId}|${message}`).digest('hex');
    const cached = aiReplyCache.get(cacheKey);
    if (cached) {
      return respondDone(cached.reply);
    }

    // Hard guardrail: refuse clearly out-of-scope questions without an LLM call.
    if (isOffTopic(message)) {
      return respondDone(OFF_TOPIC_REFUSAL);
    }

    // Check complaints BEFORE the mentorship-intent catch-all, so a message like
    // "I paid for mentorship but no mentor yet" escalates to admins instead of
    // being treated as a new purchase request.
    if (hasMentorshipComplaint(message)) {
      const reply = await handleMentorshipComplaint(message, userId, userEmail, userName);
      return respondDone(reply);
    }

    // Mentorship request -> deterministic reply with an in-chat link to the
    // purchase/guidance page (client renders the clickable action button).
    if (hasMentorshipIntent(message)) {
      const fee = parseInt(process.env.MENTORSHIP_FEE || '20000', 10) || 20000;
      const currency = process.env.MENTORSHIP_CURRENCY || 'NGN';
      return respondDone(
        buildMentorshipReply(String(fee), currency),
        { type: 'mentorship' }
      );
    }

    // 1. Generate Embedding for the user's message (cache-backed).
    const messageVector = await embedText(message);

    // 2+4. Query Pinecone for opportunities AND the user's own CV in parallel —
    //     both are independent lookups keyed on the same message vector, so
    //     doing them concurrently cuts ~one full Pinecone RTT off every request.
    const index = pinecone.index(INDEX_NAME);
    const cvNamespace = userId ? `${CV_NAMESPACE_PREFIX}${userId}` : null;

    const [queryResponse, cvQuery] = await Promise.all([
      index.query({ vector: messageVector, topK: 5, includeMetadata: true }),
      cvNamespace
        ? index
            .namespace(cvNamespace)
            .query({ vector: messageVector, topK: 4, includeMetadata: true })
            .catch((err: any) => {
              // A missing/empty CV namespace must never fail the pipeline.
              console.error('Could not query user CV namespace:', err?.message || err);
              return null;
            })
        : Promise.resolve(null),
    ]);

    const matchIds = queryResponse.matches.map(match => match.id);

    // 3. Fetch full opportunity data so the AI has rich context
    let retrievedContext = 'No specific opportunities were retrieved for this question. Answer generally using your knowledge.';
    if (matchIds.length > 0) {
      const matchedOpportunities = await Opportunity.find({ _id: { $in: matchIds } });
      const sortedOpportunities = matchIds
        .map(id => matchedOpportunities.find(o => o._id.toString() === id))
        .filter(Boolean);

      if (sortedOpportunities.length > 0) {
        retrievedContext = serializeOpportunities(sortedOpportunities);
      }
    }

    // 4. Build CV context from the user's private namespace (never another
    //    user's). Only the self-heal re-query stays sequential.
    let userCvContext = '';
    if (userId && cvNamespace) {
      try {
        let cvChunks = (cvQuery?.matches || [])
          .filter(match => match.metadata && typeof match.metadata.text === 'string')
          .map(match => match.metadata!.text as string);

        // Self-heal: the user has a CV stored but it was never vectorized
        // (e.g. uploaded before namespace seeding existed, or a transient seed
        // failure). The WHOLE find+seed+requery runs under a per-namespace
        // mutex so that when several messages arrive concurrently, only the
        // first performs the deleteAll -> embed -> upsert sequence and the
        // others queue, then reuse the freshly seeded vectors instead of
        // triggering a storm of racing writes on the shared index.
        if (cvChunks.length === 0) {
          await withNamespaceLock(cvNamespace, async () => {
            // Re-check while holding the lock: an earlier concurrent request
            // may have completed the seed while we were queued — in that case
            // the vectors already exist and there is nothing to rebuild.
            const recheck = await index.namespace(cvNamespace).query({
              vector: messageVector,
              topK: 4,
              includeMetadata: true,
            });
            const recheckChunks = recheck.matches
              .filter(match => match.metadata && typeof match.metadata.text === 'string')
              .map(match => match.metadata!.text as string);
            if (recheckChunks.length > 0) {
              cvChunks = recheckChunks;
              return;
            }

            const existingCv = await Cv.findOne({ userId })
              .sort({ createdAt: -1 })
              .select('text fileName _id');
            if (existingCv) {
              console.log(`Self-healing CV vectors for userId=${userId}...`);
              await seedUserCvVectors(
                existingCv.text,
                userId,
                existingCv._id.toString(),
                existingCv.fileName
              );
              const healedQuery = await index.namespace(cvNamespace).query({
                vector: messageVector,
                topK: 4,
                includeMetadata: true,
              });
              cvChunks = healedQuery.matches
                .filter(match => match.metadata && typeof match.metadata.text === 'string')
                .map(match => match.metadata!.text as string);
            }
          });
        }

        if (cvChunks.length > 0) {
          userCvContext = cvChunks.join('\n\n');
        }
      } catch (cvErr) {
        console.error('Could not retrieve user CV context:', cvErr);
      }
    }

    // 5. Build system prompt (RAG instructions)
    const systemPrompt = buildSystemPrompt({ userCvContext, retrievedContext });

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message },
    ];

    // Abort the LLM stream if the client disconnects mid-response.
    const abort = new AbortController();
    req.on('close', () => abort.abort());

    if (stream) {
      const completion = await nvidiaChatClient.chat.completions.create({
        model: 'openai/gpt-oss-20b',
        messages,
        temperature: 0.6,
        top_p: 0.95,
        max_tokens: 700,
        stream: true,
        signal: abort.signal,
      });

      let reply = '';
      for await (const chunk of completion) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          reply += delta;
          writeSse({ type: 'delta', text: delta });
        }
      }
      if (!reply.trim()) {
        reply = 'Sorry, I could not generate a response. Please try again.';
      }
      aiReplyCache.set(cacheKey, { reply });
      writeSse({ type: 'done', reply });
      res.end();
      return;
    }

    const completion = await nvidiaChatClient.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages,
      temperature: 0.6,
      top_p: 0.95,
      max_tokens: 700,
      stream: false,
    });

    const reply =
      completion.choices[0].message.content?.trim() ||
      'Sorry, I could not generate a response. Please try again.';

    aiReplyCache.set(cacheKey, { reply });
    res.json({ success: true, reply });
  } catch (error: any) {
    console.error('Error in AI chat:', error);
    // If we already started an SSE stream, send a terminal error frame instead
    // of a JSON 500 (the client would choke trying to parse it).
    if (res.headersSent && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to process chat message.' })}\n\n`);
      return res.end();
    }
    res.status(500).json({
      success: false,
      message: 'Failed to process chat message.',
      error: error.message,
    });
  }
};

// Deterministically extract key roles, skills and education from CV text
// so the Profile page can show relevant chips without an extra AI call.
const ROLE_KEYWORDS = [
  'Software Engineer', 'Software Developer', 'Frontend Developer', 'Backend Developer',
  'Full Stack Developer', 'Data Scientist', 'Data Analyst', 'Machine Learning Engineer',
  'Product Manager', 'Project Manager', 'UI/UX Designer', 'Graphic Designer',
  'Web Developer', 'Mobile Developer', 'DevOps Engineer', 'Cloud Engineer',
  'Systems Engineer', 'Electrical Engineer', 'Mechanical Engineer', 'Civil Engineer',
  'Researcher', 'Intern', 'Consultant', 'Accountant', 'Marketing Analyst',
  'Graduate Trainee', 'Tutor', 'Team Lead',
];

const SKILL_KEYWORDS = [
  'Python', 'JavaScript', 'TypeScript', 'React', 'React.js', 'Node.js', 'NodeJS',
  'Express', 'Express.js', 'MongoDB', 'SQL', 'MySQL', 'PostgreSQL', 'HTML', 'CSS',
  'Tailwind', 'Java', 'C++', 'C#', 'MATLAB', 'SolidWorks', 'AutoCAD', 'Git', 'GitHub',
  'Docker', 'Kubernetes', 'AWS', 'Figma', 'Excel', 'Power BI', 'Tableau',
  'Machine Learning', 'Deep Learning', 'Data Analysis', 'Data Science',
  'Artificial Intelligence', 'REST API', 'REST APIs', 'API Design', 'Linux',
  'Swift', 'Kotlin', 'Django', 'Flask', 'Vue.js', 'Next.js', 'Firebase',
  'Circuit Design', 'PCB', 'Arduino', 'Raspberry Pi', 'CCTV', 'Solar', 'ETL',
  'Public Speaking', 'Team Leadership', 'Agile', 'Scrum',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractCvHighlights = (cvText: string, analysis: string = '') => {
  const source = `${cvText}\n${analysis}`.toLowerCase();

  const roles = ROLE_KEYWORDS.filter(kw =>
    new RegExp(escapeRegExp(kw), 'i').test(source)
  ).slice(0, 8);

  const skills = SKILL_KEYWORDS.filter(kw => {
    const pattern = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${pattern}\\b`, 'i').test(source);
  }).slice(0, 12);

  // Education is derived from the raw CV text only (not the AI analysis, which
  // can mention other people/roles and produce false positives).
  const eduMatches: string[] = [];
  // Degree lines
  const degreeRe = /(?:(?:BSc|B\.Sc|BEng|B\.Eng|Bachelor(?:'?s)?|MSc|M\.Eng|MEng|M\.Sc|Master(?:'?s)?|HND|OND)\s+[^.,;\n]{3,60})/gi;
  let m: RegExpExecArray | null;
  while ((m = degreeRe.exec(cvText)) !== null) {
    const clean = m[0].replace(/[\n*]+/g, ' ').replace(/\s+/g, ' ').trim();
    const isPerson = /\b(Professor|Lecturer|Associate|Supervisor|Advisor|Candidate|the late|Dr\.)\b/i.test(clean);
    if (clean.length > 5 && !isPerson && !eduMatches.includes(clean)) eduMatches.push(clean);
  }
  // Universities
  const uniRe = /University of [A-Z][a-zA-Z ]{3,60}/g;
  while ((m = uniRe.exec(cvText)) !== null) {
    const clean = m[0].replace(/[\n*]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length > 12 && !eduMatches.includes(clean)) eduMatches.push(clean);
  }

  return { roles, skills, education: eduMatches.slice(0, 4) };
};

export const getMyCVs = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.uid;

    const cvs = await Cv.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('matchIds');

    res.json({
      success: true,
      cvs: cvs.map(cv => ({
        _id: cv._id,
        fileName: cv.fileName,
        analysis: cv.analysis,
        createdAt: cv.createdAt,
        matches: cv.matchIds,
        highlights: extractCvHighlights(cv.text || '', cv.analysis || ''),
      })),
    });
  } catch (error: any) {
    console.error('Error fetching CVs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch CVs.',
      error: error.message,
    });
  }
};

export const downloadCV = async (req: Request, res: Response) => {
  try {
    const { cvId } = req.params;
    const userId = req.authUser!.uid;
    if (!isValidObjectId(cvId)) {
      res.status(400).json({ success: false, message: 'Invalid CV id.' });
      return;
    }

    const cv = await Cv.findOne({ _id: cvId, userId });
    if (!cv) {
      res.status(404).json({ success: false, message: 'CV not found.' });
      return;
    }

    const safeName = (cv.fileName || 'cv.pdf').replace(/[^\w.\- ]/g, '').replace(/"/g, '');
    res.setHeader('Content-Type', cv.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'cv.pdf'}"`);
    res.send(cv.fileData);
  } catch (error: any) {
    console.error('Error downloading CV:', error);
    res.status(500).json({ success: false, message: 'Failed to download CV.' });
  }
};

export const deleteCV = async (req: Request, res: Response) => {
  try {
    const { cvId } = req.params;
    const userId = req.authUser!.uid;
    if (!isValidObjectId(cvId)) {
      res.status(400).json({ success: false, message: 'Invalid CV id.' });
      return;
    }

    const cv = await Cv.findOneAndDelete({ _id: cvId, userId });
    if (!cv) {
      res.status(404).json({ success: false, message: 'CV not found.' });
      return;
    }

    // Best-effort removal of this CV's vectors from the user's private namespace.
    try {
      const ns = `${CV_NAMESPACE_PREFIX}${userId}`;
      const ids = Array.from({ length: 6 }, (_, i) => `${cvId}-chunk-${i}`);
      await pinecone.index(INDEX_NAME).namespace(ns).deleteMany(ids);
    } catch {
      /* namespace may not exist — ignore */
    }

    res.json({ success: true, message: 'CV deleted.' });
  } catch (error: any) {
    console.error('Error deleting CV:', error);
    res.status(500).json({ success: false, message: 'Failed to delete CV.' });
  }
};

// ---- Endpoints directly consumed by the Cloudflare Worker -------------------
// The Worker owns the chat stream but has no Mongo access, so these two routes
// serve the DB-backed pieces of the assistant pipeline. The Worker forwards the
// user's Firebase Authorization header to authenticate here.

// Given the Pinecone-matched opportunity ids, return the same serialized RAG
// context block the in-server chat pipeline builds. Public data only.
export const getRetrievedOpportunityContext = async (req: Request, res: Response) => {
  try {
    const rawIds: unknown = req.body?.ids;
    const ids = Array.isArray(rawIds)
      ? rawIds.filter((id): id is string => typeof id === 'string' && isValidObjectId(id)).slice(0, 8)
      : [];

    if (ids.length === 0) {
      return res.json({ success: true, context: null });
    }

    const docs = await Opportunity.find({ _id: { $in: ids } }).lean();
    const sorted = ids
      .map(id => docs.find(d => d._id.toString() === id))
      .filter((d): d is typeof d & object => !!d);

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.json({
      success: true,
      context: sorted.length > 0 ? serializeOpportunities(sorted) : null,
    });
  } catch (error: any) {
    console.error('Failed to build opportunity context:', error);
    res.status(500).json({ success: false, error: 'Failed to build opportunity context.' });
  }
};

// Detect persisted paid records + write the MentorshipComplaint ticket, then
// hand back the exact reply string the assistant should stream.
export const recordMentorshipComplaint = async (req: Request, res: Response) => {
  try {
    const message = ((req.body?.message as string) || '').trim().slice(0, 2000);
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required.' });
    }
    const reply = await handleMentorshipComplaint(
      message,
      req.authUser!.uid,
      req.authUser!.email || '',
      (req.body?.userName as string) || ''
    );
    res.json({ success: true, reply });
  } catch (error: any) {
    console.error('Failed to record mentorship complaint:', error);
    res.status(500).json({ success: false, error: 'Failed to record mentorship complaint.' });
  }
};

