import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { PDFParse } from 'pdf-parse';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import Opportunity from '../models/Opportunity';
import Cv from '../models/Cv';
import Mentorship from '../models/Mentorship';
import MentorshipComplaint from '../models/MentorshipComplaint';
import { aiReplyCache } from '../lib/cache';
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

// Each user's CV vectors live in their OWN namespace (cvs-<userId>).
// This guarantees a chat query can never retrieve another user's CV data,
// even if a malicious request is made.
const CV_NAMESPACE_PREFIX = 'cvs-';

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

export const analyzeCV = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No CV file uploaded.' });
      return;
    }

    // 1. Extract Text from PDF
    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const cvText = pdfData.text.trim();

    if (!cvText) {
      res.status(400).json({ success: false, message: 'Could not extract text from the provided PDF.' });
      return;
    }
    
    // We limit the text to the first 4000 characters to avoid huge embedding token limits
    const truncatedCVText = cvText.substring(0, 4000);

    // 2. Generate Embedding for the CV
    const embedResponse = await nvidiaEmbedClient.embeddings.create({
      model: 'nvidia/nemotron-3-embed-1b',
      input: truncatedCVText,
    });
    const cvVector = embedResponse.data[0].embedding;

    // 3. Query Pinecone for Top Matches
    const index = pinecone.index(INDEX_NAME);
    const queryResponse = await index.query({
      vector: cvVector,
      topK: 5,
      includeMetadata: true,
    });

    const matchIds = queryResponse.matches.map(match => match.id);
    
    // Fetch full data for these opportunities
    const matchedOpportunities = await Opportunity.find({ _id: { $in: matchIds } });
    
    // Sort them exactly as Pinecone returned them
    const sortedOpportunities = matchIds.map(id => matchedOpportunities.find(o => o._id.toString() === id)).filter(Boolean);

    // 4. Generate AI Analysis using DeepSeek
    // Create a prompt that includes the CV and the matched opportunities
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

// 5. Persist CV + matches to MongoDB (assigned to the authenticated user)
    const userId = req.authUser!.uid;
    let savedCv: any = null;
    if (userId) {
      const cv = new Cv({
        userId,
        userEmail: req.body.userEmail || '',
        userName: req.body.userName || '',
        fileName: req.file.originalname,
        contentType: req.file.mimetype,
        fileData: req.file.buffer,
        text: cvText,
        analysis,
        matchIds: sortedOpportunities.map(o => o!._id),
      });
      await cv.save();
      savedCv = cv;

      // 5b. Vectorize the CV into the user's private Pinecone namespace so the
      // chat assistant has personalized context. Failure here must NOT block
      // the CV analysis result.
      try {
        await seedUserCvVectors(cvText, userId, savedCv._id.toString(), req.file.originalname);
      } catch (vecErr) {
        console.error('Could not seed CV vectors to Pinecone:', vecErr);
      }
    }

    // 6. Return Results
    res.json({
      success: true,
      analysis,
      matches: sortedOpportunities,
      cvId: savedCv?._id || null,
    });
  } catch (error: any) {
    console.error('Error analyzing CV:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze CV.',
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
    const message = ((req.body?.message as string) || '').trim();
    if (!message) {
      res.status(400).json({ success: false, message: 'Message is required.' });
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
    const userEmail = ((req.body?.userEmail as string) || req.authUser!.email || '').trim();
    const userName = ((req.body?.userName as string) || '').trim();

    const stream = req.body?.stream === true;

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
    const cacheKey = `${userId}|${message}`;
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

    // 1. Generate Embedding for the user's message
    const embedResponse = await nvidiaEmbedClient.embeddings.create({
      model: 'nvidia/nemotron-3-embed-1b',
      input: message,
    });
    const messageVector = embedResponse.data[0].embedding;

    // 2. Query Pinecone for relevant opportunities
    const index = pinecone.index(INDEX_NAME);
    const queryResponse = await index.query({
      vector: messageVector,
      topK: 5,
      includeMetadata: true,
    });

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

    // 4. Retrieve the requesting user's OWN CV from their private namespace
    //    (only ever this user's vectors — never another user's)
    let userCvContext = '';
    if (userId) {
      try {
        const cvNamespace = `${CV_NAMESPACE_PREFIX}${userId}`;
        let cvQuery = await index.namespace(cvNamespace).query({
          vector: messageVector,
          topK: 4,
          includeMetadata: true,
        });

        let cvChunks = cvQuery.matches
          .filter(match => match.metadata && typeof match.metadata.text === 'string')
          .map(match => match.metadata!.text as string);

        // Self-heal: the user has a CV stored but it was never vectorized
        // (e.g. uploaded before namespace seeding existed, or a transient seed
        // failure). Vectorize their most recent CV on demand so the assistant
        // always has the current user's own context.
        if (cvChunks.length === 0) {
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
            cvQuery = await index.namespace(cvNamespace).query({
              vector: messageVector,
              topK: 4,
              includeMetadata: true,
            });
            cvChunks = cvQuery.matches
              .filter(match => match.metadata && typeof match.metadata.text === 'string')
              .map(match => match.metadata!.text as string);
          }
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

