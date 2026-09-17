import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { isValidObjectId, Types } from 'mongoose';
import pdfParse from 'pdf-parse';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import Opportunity from '../models/Opportunity';
import Cv from '../models/Cv';
import Mentorship from '../models/Mentorship';
import MentorshipComplaint from '../models/MentorshipComplaint';
import { aiReplyCache, embeddingCache } from '../lib/cache';
import { uploadCvPdf, destroyCvPdf } from '../lib/cloudinary';
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

// Second NVIDIA key (LangChain example account). Both keys are tried as
// fallback so whichever account/capacity is available can answer.
const nvidiaChatClient2 = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY_2,
  baseURL: 'https://integrate.api.nvidia.com/v1',
  timeout: 90000,
  maxRetries: 1,
});

// NVIDIA-hosted chat attempts, tried in order until one returns output.
// NVIDIA region/entitlement gates models PER REQUEST-SOURCE: a model that works
// from one IP/region (e.g. meta/muse-glimmer-30b works from a home/US egress)
// can return a bare HTTP 400 from another (Render's server region), while a
// model that 404s is simply not in this account's catalog anywhere. So this is
// a SELF-DISCOVERING battery: it fans out across the models verified good from
// at least one request source. All of these fail FAST (400/404/500 within
// ~1s) if they are unavailable, so the chain stays snappy, and whichever model
// NVIDIA serves to the CURRENT request source answers the request.
const LLM_ATTEMPT_TIMEOUT_MS = 30_000;

// Upper cap on the CV text stored per upload. Matching only ever embeds the
// first 4,000 chars and the chat-memory seeder only uses the first ~5 chunks
// (~4,300 chars), so anything past this is pure bloat; it also bounds the
// decompression-bomb exposure of a 16MB-doc pdf-parse.
const CV_TEXT_MAX_CHARS = 20_000;

type LlmAttempt = { client: OpenAI; model: string };

// Cap concurrent outbound NVIDIA calls so a spike of users can't open unbounded
// parallel streams (the free tier throttles with 429 / ResourceExhausted under
// load). A bounded in-flight gate keeps provider load flat so the soft-failure
// retries stay effective instead of compounding the flood.
const MAX_INFLIGHT_LLM = Math.min(
  Math.max(parseInt(process.env.LLM_MAX_INFLIGHT || '5', 10) || 5, 1),
  20
);

// How long an LLM call may wait for a free slot before failing fast. Without a
// deadline, a provider blip drains the bounded queue and every healthy request
// behind it blocks for the whole attempt chain (minutes) — fail fast with 503
// instead, so the user can simply retry now.
const LLM_SLOT_WAIT_MS = Math.min(
  Math.max(parseInt(process.env.LLM_SLOT_WAIT_MS || '15000', 10) || 15000, 1000),
  120000
);

// Wall-clock budget for one full chat response (all attempts summed). Once it
// elapses the loop stops trying new models/keys so a chat can never run for
// minutes even if every provider is slow.
const CHAT_WALL_CLOCK_MS = Math.min(
  Math.max(parseInt(process.env.CHAT_WALL_CLOCK_MS || '60000', 10) || 60000, 5000),
  180000
);

let inflightLlm = 0;
const llmWaiters: Array<() => void> = [];

// Thrown when no LLM slot freed up within LLM_SLOT_WAIT_MS. Callers map it to a
// clean "server busy" response and MUST NOT treat it as a provider failure that
// triggers more attempts (that would pile onto the queue they just timed out on).
class LlmBusyError extends Error {
  constructor() {
    super('Too many concurrent AI requests at the moment.');
    this.name = 'LlmBusyError';
  }
}

// Acquire a slot within timeoutMs; resolves false (without consuming a slot)
// if the wait times out. The queued entry re-checks on wake-up so a racing
// release can never over-allocate a slot.
const waitForLlmSlot = (timeoutMs: number): Promise<boolean> =>
  new Promise(resolve => {
    if (inflightLlm < MAX_INFLIGHT_LLM) {
      inflightLlm += 1;
      resolve(true);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const entry = () => {
      if (inflightLlm < MAX_INFLIGHT_LLM) {
        inflightLlm += 1;
        if (timer !== undefined) clearTimeout(timer);
        resolve(true);
      }
    };
    llmWaiters.push(entry);
    timer = setTimeout(() => {
      const idx = llmWaiters.indexOf(entry);
      if (idx >= 0) llmWaiters.splice(idx, 1);
      resolve(false);
    }, timeoutMs);
  });

const releaseLlm = (): void => {
  inflightLlm -= 1;
  llmWaiters.shift()?.();
};

// Runs `fn` while holding one LLM slot (acquired before, released in finally).
// The slot is held for the WHOLE attempt, including stream consumption, so at
// most MAX_INFLIGHT_LLM providers/streams are ever open at once. Throws
// LlmBusyError when no slot becomes free within the wait deadline.
const withLlmSlot = async <T>(fn: () => Promise<T>, timeoutMs: number = LLM_SLOT_WAIT_MS): Promise<T> => {
  const acquired = await waitForLlmSlot(timeoutMs);
  if (!acquired) throw new LlmBusyError();
  try {
    return await fn();
  } finally {
    releaseLlm();
  }
};

const chatModelAttempts = (): LlmAttempt[] => {
  const attempts: LlmAttempt[] = [];
  const models = [
    'meta/muse-glimmer-30b',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    'z-ai/glm-5.3-flash',
  ];
  for (const model of models) {
    attempts.push({ client: nvidiaChatClient, model });
    attempts.push({ client: nvidiaChatClient2, model });
  }
  return attempts;
};

// Best-effort extraction of the REAL failure detail from a failed LLM call.
// The OpenAI SDK often reports just "400 status code (no body)" — that text
// hides NVIDIA's actual error, so dig the raw response body/status/headers out
// and surface them (truncated). Keeps the failure note actionable in the UI.
const describeLlmError = (err: any): string => {
  const status = err?.status ? `HTTP ${err.status}` : 'NO_STATUS';
  let body = '';
  try {
    if (typeof err?.body === 'string') body = err.body;
    else if (err?.body) body = JSON.stringify(err.body);
  } catch { body = ''; }
  if (!body && err?.message) body = err.message;
  const extra = err?.code ? ` code=${err.code}` : '';
  return `${status}${extra} ${String(body).slice(0, 400)}`.trim();
};

async function completeChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: {
    temperature?: number;
    maxTokens?: number;
    deadlineMs?: number; // wall-clock budget for the whole attempt chain
  } = {}
): Promise<{ content: string; model: string }> {
  const failures: string[] = [];
  const startedAt = Date.now();
  const deadline = startedAt + (opts.deadlineMs ?? CHAT_WALL_CLOCK_MS);
  const attempts = chatModelAttempts();
  for (const attempt of attempts) {
    if (Date.now() >= deadline) break;
    const { client, model } = attempt;
    // One immediate retry per model for SOFT failures (empty stream, timeouts,
    // NVIDIA capacity "ResourceExhausted", 429/overloaded). NVIDIA shards can
    // return an empty stream or refuse capacity on the first hit and answer on
    // the retry; hard failures (400/404) skip ahead instantly. Retries are
    // immediate (no backoff) and the wall-clock deadline bounds the whole chain.
    for (let round = 0; round < 2; round++) {
      if (Date.now() >= deadline) break;
      const retrying = round === 1;
      try {
        let content = '';
        // Hold a concurrency slot for the FULL attempt (create + stream
        // consume) so we never open more than MAX_INFLIGHT_LLM provider streams.
        await withLlmSlot(async () => {
          const completion = await client.chat.completions.create(
            {
              model,
              messages,
              temperature: opts.temperature ?? 0.6,
              top_p: 0.95,
              max_tokens: opts.maxTokens ?? 700,
              // NVIDIA AI Endpoints returns HTTP 400 with an EMPTY body for these
              // reasoning models when stream:false is used. Streaming is the only
              // reliable mode, so ALWAYS request a stream and accumulate the deltas.
              stream: true,
            },
            // timeout/maxRetries/signal are REQUEST OPTIONS, not body parameters.
            // Passing them inside the body used to be sent to NVIDIA as
            // `"Unsupported parameter(s): timeout, maxRetries"` (a bare 400 for
            // muse, an explicit validation error for nemotron), which made every
            // model fail. As the second SDK argument they abort the attempt and are
            // never serialized into the payload.
            { timeout: LLM_ATTEMPT_TIMEOUT_MS, maxRetries: 0 }
          );
          for await (const chunk of completion) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) content += delta;
          }
        });
        if (content.trim()) {
          console.log(`LLM OK via ${model}`);
          return { content, model };
        }
        failures.push(`${model} -> empty completion${retrying ? '' : ', retrying...'}`);
        if (!retrying) continue;
      } catch (err: any) {
        if (err instanceof LlmBusyError) throw err;
        const detail = describeLlmError(err);
        const soft = /empty|timeout|ResourceExhausted|429|too many|overloaded|unavailable/i.test(detail);
        failures.push(`${model} -> ${detail}${!retrying && soft ? ', retrying...' : ''}`);
        if (!retrying && soft) continue;
        console.warn(`LLM model ${model} failed: ${detail}`);
      }
      break;
    }
  }
  throw new Error(failures.join(' | ') || 'All configured LLM providers failed.');
}

// ---- Per-user chat burst limiter (Tier 2, Item 6) --------------------------
// The chat endpoint calls the shared NVIDIA API layer, so a single user spamming
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
// Shared CV-match pipeline: embed → Pinecone query → persist
// Used by the analyzeCV (PDF upload) endpoint and by the background
// cv-match-refresh job so the two paths stay identical. There is NO LLM step
// here: matching is pure embedding + vector similarity, which keeps uploads to
// ~1-2s and lets the refresh job recompute every user's matches daily.
// ---------------------------------------------------------------------------

interface ComputeCvMatchesArgs {
  cvText: string;
  userId: string;
  userEmail: string;
  userName: string;
  fileName: string;
  contentType: string;
  // The raw PDF is stored on Cloudinary for new uploads (cloudinaryId/Url);
  // fileData is only used as a fallback when Cloudinary is unavailable, and by
  // legacy (pre-Cloudinary) docs.
  fileData?: Buffer;
  cloudinaryId?: string;
  cloudinaryUrl?: string;
  // When set, refresh the existing CV doc instead of creating a duplicate
  // record.
  existingCvId?: string;
  // On a fresh upload, delete the user's OLDER CVs that share the same file
  // name so re-uploads don't pile up identical twins in the list.
  replaceSameFile?: boolean;
}

// True when two match-id lists are the same SET (order-insensitive). The stored
// list holds Mongo ObjectIds while Pinecone ids arrive as strings, so compare
// normalized string forms.
const matchesEqual = (stored: unknown[] | undefined | null, current: string[]): boolean => {
  if (!stored || stored.length !== current.length) return false;
  const a = [...stored].map(id => String(id)).sort();
  const b = [...current].map(id => String(id)).sort();
  return a.every((v, i) => v === b[i]);
};

async function computeCvMatches({ cvText, userId, userEmail, userName, fileName, contentType, fileData, cloudinaryId, cloudinaryUrl, existingCvId, replaceSameFile }: ComputeCvMatchesArgs) {
  const truncatedCVText = cvText.substring(0, 4000);
  const textHash = createHash('sha256').update(cvText).digest('hex');

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

  // Upsert semantics: an existing doc is updated in place (no new record); a
  // fresh upload replaces older records with the SAME fileName so re-uploads
  // never pile up identical twins (which made "delete" look broken — deleting
  // one copy left another identical one in the list).
  let cv: any;
  if (existingCvId) {
    cv = await Cv.findById(existingCvId);
    if (!cv) {
      throw new Error('The saved CV no longer exists. Please upload a fresh PDF.');
    }
  }

  // Chat-memory re-seeding is needed when the text actually changed (or this
  // is a brand-new CV); it runs in the background so it never holds up the
  // user's answer.
  const needsSeed = !cv || cv.vectorTextHash !== textHash;

  if (existingCvId) {
    cv.userEmail = userEmail;
    cv.userName = userName;
    cv.fileName = fileName;
    cv.contentType = contentType;
    if (fileData) cv.fileData = fileData;
    if (cloudinaryId) {
      cv.cloudinaryId = cloudinaryId;
      cv.cloudinaryUrl = cloudinaryUrl || cv.cloudinaryUrl;
    }
    cv.text = cvText;
    cv.matchIds = sortedOpportunities.map(o => o!._id);
    cv.vectorTextHash = textHash;
  } else {
    cv = new Cv({
      userId,
      userEmail,
      userName,
      fileName,
      contentType,
      ...(fileData ? { fileData } : {}),
      ...(cloudinaryId ? { cloudinaryId, cloudinaryUrl } : {}),
      text: cvText,
      matchIds: sortedOpportunities.map(o => o!._id),
      vectorTextHash: textHash,
    });
  }
  await cv.save();

  if (!existingCvId && replaceSameFile) {
    try {
      // Remove older same-name duplicates AND their orphaned Cloudinary assets
      // so storage doesn't stack identical files per user.
      const dups = await Cv.find({ _id: { $ne: cv._id }, userId, fileName })
        .select('cloudinaryId')
        .lean();
      if (dups.length > 0) {
        await Cv.deleteMany({ _id: { $in: dups.map(d => d._id) } });
        await Promise.allSettled(
          dups.filter(d => d.cloudinaryId).map(d => destroyCvPdf(d.cloudinaryId as string))
        );
      }
    } catch (dupErr) {
      console.error('Could not remove older duplicate CVs:', dupErr);
    }
  }

  // Seed CV vectors into the user's private Pinecone namespace so the chat
  // assistant has personalized context. Fire-and-forget: the match result does
  // not depend on it, and failure is non-fatal. The per-namespace mutex keeps
  // concurrent seeds from stomping each other.
  if (needsSeed) {
    const cvNamespace = `${CV_NAMESPACE_PREFIX}${userId}`;
    const cvId = cv._id.toString();
    void (async () => {
      try {
        await withNamespaceLock(cvNamespace, () =>
          seedUserCvVectors(cvText, userId, cvId, fileName)
        );
      } catch (vecErr) {
        console.error('Could not seed CV vectors to Pinecone:', vecErr);
      }
    })();
  }

  return { matches: sortedOpportunities, cvId: cv._id.toString() };
}

// ---- CV Analysis (PDF upload) --------------------------------------------
// Lightweight on purpose: PDF text extraction + Cloudinary upload run in
// parallel, then the text is capped and matched against the current feed
// (embed + Pinecone query, ~1-2s). No LLM summary is produced on this path.

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

    // pdf-parse@1.1.4 is a plain async function (module.exports = Pdf), so it is
    // called directly with the buffer — `new PDFParse(...)` (the v2 API) was
    // undefined here, making EVERY upload crash with "PDFParse is not a
    // constructor" and a generic 500 "Failed to analyze CV.".
    // Text extraction and the Cloudinary upload only depend on the raw buffer,
    // so the two run in PARALLEL (shaves the upload round-trip off the wait).
    const [pdfResult, cloudResult] = await Promise.all([
      (async (): Promise<{ ok: true; text: string } | { ok: false; error: any }> => {
        try {
          const pdfData = await pdfParse(req.file.buffer);
          return { ok: true, text: pdfData.text || '' };
        } catch (pdfErr: any) {
          return { ok: false, error: pdfErr };
        }
      })(),
      (async (): Promise<
        { ok: true; cloudinaryId: string; cloudinaryUrl: string } | { ok: false; error: any }
      > => {
        try {
          const up = await uploadCvPdf(req.file.buffer, req.file.originalname);
          return { ok: true, cloudinaryId: up.cloudinaryId, cloudinaryUrl: up.cloudinaryUrl };
        } catch (upErr: any) {
          console.error('Cloudinary upload failed — falling back to storing the PDF in Mongo:', upErr);
          return { ok: false, error: upErr };
        }
      })(),
    ]);

    if (!pdfResult.ok) {
      // Parse failed but the file may have reached Cloudinary already (it ran
      // in parallel) — remove it so a garbage file isn't left orphaned.
      if (cloudResult.ok) void destroyCvPdf(cloudResult.cloudinaryId);
      console.error('PDF parsing failed:', pdfResult.error);
      res.status(400).json({
        success: false,
        message:
          'Could not read this PDF. It may be password-protected or damaged — re-export it as a standard text PDF and try again.',
      });
      return;
    }
    const cvText = (pdfResult.text || '').trim().slice(0, CV_TEXT_MAX_CHARS);

    if (!cvText) {
      res.status(400).json({ success: false, message: 'Could not extract text from the provided PDF.' });
      return;
    }

    const userId = req.authUser!.uid;

    // Cloudinary keeps the PDF out of Mongo; if it was unavailable, the
    // in-Mongo buffer is used so downloads never break.
    const cloudinaryId = cloudResult.ok ? cloudResult.cloudinaryId : undefined;
    const cloudinaryUrl = cloudResult.ok ? cloudResult.cloudinaryUrl : undefined;

    const { matches, cvId } = await computeCvMatches({
      cvText,
      userId,
      userEmail: req.authUser!.email || '',
      userName: req.body.userName || '',
      fileName: req.file.originalname,
      contentType: req.file.mimetype,
      fileData: cloudinaryId ? undefined : req.file.buffer,
      cloudinaryId,
      cloudinaryUrl,
      replaceSameFile: true,
    });

    res.json({ success: true, matches, cvId });
  } catch (error: any) {
    console.error('Error analyzing CV:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze CV.',
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
      let reply = '';
      let streamed = false;
      const chatDeadline = Date.now() + CHAT_WALL_CLOCK_MS;
      for (const attempt of chatModelAttempts()) {
        if (abort.signal.aborted || Date.now() >= chatDeadline) break;
        for (let round = 0; round < 2; round++) {
          if (abort.signal.aborted || Date.now() >= chatDeadline) break;
          const retrying = round === 1;
          try {
            // Hold a concurrency slot for create + stream consumption (see
            // withLlmSlot) so a chat spike can't open unbounded provider streams.
            await withLlmSlot(async () => {
              const completion = await attempt.client.chat.completions.create(
                {
                  model: attempt.model,
                  messages,
                  temperature: 0.6,
                  top_p: 0.95,
                  max_tokens: 700,
                  stream: true,
                },
                // timeout/maxRetries/signal are request options — NVIDIA rejects
                // them in the body ("Unsupported parameter(s): ...").
                { timeout: Math.min(LLM_ATTEMPT_TIMEOUT_MS, chatDeadline - Date.now()), maxRetries: 0, signal: abort.signal }
              );
              streamed = true;
              for await (const chunk of completion) {
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) {
                  reply += delta;
                  writeSse({ type: 'delta', text: delta });
                }
              }
            });
            if (reply.trim()) break;
          } catch (err: any) {
            if (err instanceof LlmBusyError) {
              writeSse({ type: 'error', message: 'The AI is busy right now — too many requests at once. Please try again in a moment.' });
              return res.end();
            }
            const detail = describeLlmError(err);
            const soft = /empty|timeout|ResourceExhausted|429|too many|overloaded|unavailable/i.test(detail);
            console.warn(`Chat stream model ${attempt.model} failed: ${detail}${!retrying && soft ? ', retrying...' : ''}`);
            if (!retrying && soft) continue;
          }
          break;
        }
        if (reply.trim() || abort.signal.aborted) break;
      }
      if (!streamed) {
        writeSse({ type: 'error', message: 'All AI providers are unavailable right now. Please try again shortly.' });
        return res.end();
      }
      if (!reply.trim()) {
        reply = 'Sorry, I could not generate a response. Please try again.';
      }
      aiReplyCache.set(cacheKey, { reply });
      writeSse({ type: 'done', reply });
      res.end();
      return;
    }

    const { content: nonStreamReply } = await completeChat(messages, { temperature: 0.6, maxTokens: 700 });

    const reply = nonStreamReply.trim() || 'Sorry, I could not generate a response. Please try again.';

    aiReplyCache.set(cacheKey, { reply });
    res.json({ success: true, reply });
  } catch (error: any) {
    // A busy gate is a TRANSIENT condition (queue full for a moment), handled
    // distinctly from a real failure so the user can simply retry right away.
    if (error instanceof LlmBusyError) {
      console.log('AI chat deferred: LLM slot queue full.');
      if (res.headersSent && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'The AI is busy right now — too many requests at once. Please try again in a moment.' })}\n\n`);
        return res.end();
      }
      res.status(503).json({ success: false, message: 'The AI is busy right now — too many requests at once. Please try again in a moment.' });
      return;
    }
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

const extractCvHighlights = (cvText: string) => {
  const source = cvText.toLowerCase();

  const roles = ROLE_KEYWORDS.filter(kw =>
    new RegExp(escapeRegExp(kw), 'i').test(source)
  ).slice(0, 8);

  const skills = SKILL_KEYWORDS.filter(kw => {
    const pattern = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${pattern}\\b`, 'i').test(source);
  }).slice(0, 12);

  // Education is derived from the raw CV text only (never from generated text,
  // which can mention other people/roles and produce false positives).
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
        createdAt: cv.createdAt,
        matches: cv.matchIds,
        highlights: extractCvHighlights(cv.text || ''),
      })),
    });
  } catch (error: any) {
    console.error('Error fetching CVs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch CVs.',
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

    // New uploads live on Cloudinary. We PROXY the bytes through this
    // authenticated route (a 302 to the public CDN URL would hand out the raw,
    // unauthenticated PDF to anyone who captured/copied the URL), streaming the
    // response instead of buffering the whole file in memory.
    if (cv.cloudinaryUrl) {
      const upstream = await fetch(cv.cloudinaryUrl, { signal: AbortSignal.timeout(30_000) });
      if (!upstream.ok || !upstream.body) {
        throw new Error(`Cloudinary fetch failed (HTTP ${upstream.status}).`);
      }
      const contentLength = upstream.headers.get('Content-Length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      // Stream the remote body straight to the client.
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(value);
        if (res.writableEnded) break;
      }
      return res.end();
    }

    // Legacy docs keep the buffer in Mongo.
    if (!cv.fileData) throw new Error('This CV has no stored file.');
    res.send(cv.fileData);
  } catch (error: any) {
    console.error('Error downloading CV:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to download CV.' });
    } else {
      res.end();
    }
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

    // Best-effort removal of the raw PDF asset (never blocks the delete).
    if (cv.cloudinaryId) {
      await destroyCvPdf(cv.cloudinaryId);
    }

    res.json({ success: true, message: 'CV deleted.' });
  } catch (error: any) {
    console.error('Error deleting CV:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete CV.',
    });
  }
};

// ---- Background CV-match refresh ------------------------------------------
// Keeps every user's saved CV matches in sync with the CURRENT feed. The feed
// changes daily (opportunity sync inserts/closes listings), so the "Filter by
// CV" feed would otherwise go stale until the user re-uploaded. This job re-runs
// the SAME match-only pipeline (embed → Pinecone query) that analyzeCV uses —
// no LLM — per user's latest CV, writes new matchIds, and back-fills chat-memory
// vectors when a stored CV changed. Runs after each opportunity sync AND on a
// daily cron (see index.ts). Concurrency-bounded so it never floods NVIDIA/Pinecone.

interface CvRefreshSummary {
  users: number;
  refreshed: number;
  seeded: number;
  failed: number;
  durationMs: number;
}

export const refreshCvMatches = async (): Promise<CvRefreshSummary> => {
  const startedAt = Date.now();
  let refreshed = 0;
  let seeded = 0;
  let failed = 0;

  // One row per user: their most recent CV (aggregate keeps this O(1) per row).
  const latestByUser = await Cv.aggregate<{ _id: string; doc?: any }>([
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$userId', doc: { $first: '$$ROOT' } } },
    { $match: { 'doc.text': { $exists: true, $ne: '' } } },
  ]);
  const docs = latestByUser
    .map(g => g.doc)
    .filter((d): d is any => !!d && typeof d.text === 'string');

  const index = pinecone.index(INDEX_NAME);

  const processDoc = async (doc: any) => {
    const text = (doc.text || '').slice(0, 4000);
    const textHash = createHash('sha256').update(doc.text || '').digest('hex');
    try {
      const vector = await embedText(text);
      const queryResponse = await index.query({
        vector,
        topK: 5,
        includeMetadata: true,
      });
      const matchIds = queryResponse.matches
        .map(match => match.id)
        .filter(id => /^[0-9a-fA-F]{24}$/.test(id));

      const isObjectIdArray = Array.isArray(doc.matchIds);
      if (!(isObjectIdArray && matchesEqual(doc.matchIds, matchIds))) {
        await Cv.updateOne(
          { _id: doc._id },
          { $set: { matchIds: matchIds.map(id => new Types.ObjectId(id)) } }
        );
        refreshed += 1;
      }

      // Chat-memory re-seed only when the stored CV text changed since the
      // vectors were built; guarded by the per-namespace mutex.
      if (doc.vectorTextHash !== textHash) {
        await withNamespaceLock(`${CV_NAMESPACE_PREFIX}${doc.userId}`, () =>
          seedUserCvVectors(doc.text || '', doc.userId, doc._id.toString(), doc.fileName || 'cv.pdf')
        );
        await Cv.updateOne({ _id: doc._id }, { $set: { vectorTextHash: textHash } });
        seeded += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`CV match refresh failed for userId=${doc.userId}:`, err);
    }
  };

  const CONCURRENCY = Math.min(
    4,
    Math.max(1, parseInt(process.env.CV_REFRESH_CONCURRENCY || '4', 10) || 4)
  );
  let cursor = 0;
  const worker = async () => {
    while (cursor < docs.length) {
      const doc = docs[cursor];
      cursor += 1;
      await processDoc(doc);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (docs.length > 0) {
    console.log(
      `[cv-refresh] checked ${docs.length} user CVs: ${refreshed} refreshed, ${seeded} seeded, ${failed} failed in ${Date.now() - startedAt}ms`
    );
  }

  return {
    users: docs.length,
    refreshed,
    seeded,
    failed,
    durationMs: Date.now() - startedAt,
  };
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

