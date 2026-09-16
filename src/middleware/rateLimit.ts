import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { MongoStore } from './mongoStore';

const errorJson = (req: Request, res: Response) => {
  res.status(429).json({ success: false, error: 'Too many requests. Please try again shortly.' });
};

// ---------------------------------------------------------------------------
// Persistent rate limiting. All limiter instances share ONE MongoStore so the
// counters survive restarts and are consistent across horizontally scaled
// backend instances. Each limiter namespaces its keys (${name}:${ip}) since
// routes overlap (e.g. /api and /api/ai/chat are both mounted) and would
// otherwise collide on the same IP key.
// ---------------------------------------------------------------------------
const sharedStore = new MongoStore();

const windowMs = 60 * 1000;

const makeOptions = (name: string, limit: number, opts: Partial<Options> = {}): Partial<Options> => ({
  windowMs,
  limit,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: errorJson,
  // req.ip is set by 'trust proxy' from the proxy chain; prefix it so each
  // limiter owns a disjoint key space in the shared Mongo collection.
  keyGenerator: (req: Request) => `${name}:${req.ip || req.socket.remoteAddress || 'unknown'}`,
  ...opts,
});

// Public API ceiling per IP: in-memory by default. Every filtered request used to
// cost a Mongo upsert + $inc in the shared store — that write stream was the main
// DB load on a single free-tier instance. MemoryStore is exact, self-expiring
// (60s windows) and perfect for burst control on one instance. Set
// RATE_LIMIT_STORE=mongo to opt back into the persistent shared store if you
// later scale to multiple backend instances.
export const apiLimiter = rateLimit(
  process.env.RATE_LIMIT_STORE === 'mongo'
    ? makeOptions('api', 120, { store: sharedStore })
    : makeOptions('api', 120)
);

// Stricter limits for expensive / abuse-prone endpoints. Kept on the persistent
// Mongo store (low volume, survives restarts, catches repeat abusers).
export const strictLimiter = rateLimit(makeOptions('strict', 20, { store: sharedStore }));

// Very tight limit for the manual sync trigger and legacy auth endpoints.
export const sensitiveLimiter = rateLimit(makeOptions('sensitive', 5, { store: sharedStore }));

// Aggressive ceiling for /api/ai/analyze-cv: each hit runs a full PDF parse +
// embed + Pinecone query + LLM completion, so 5/min/IP bounds how quickly a
// single client can drive CPU/memory spikes with large uploads.
export const cvAnalyzeLimiter = rateLimit(makeOptions('cv', 5, { store: sharedStore }));