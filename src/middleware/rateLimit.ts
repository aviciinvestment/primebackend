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

const baseOptions = (name: string, limit: number): Partial<Options> => ({
  windowMs,
  limit,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: errorJson,
  store: sharedStore,
  // req.ip is set by 'trust proxy' from the proxy chain; prefix it so each
  // limiter owns a disjoint key space in the shared Mongo collection.
  keyGenerator: (req: Request) => `${name}:${req.ip || req.socket.remoteAddress || 'unknown'}`,
});

// Global ceiling for the whole API per IP.
export const apiLimiter = rateLimit(baseOptions('api', 120));

// Stricter limits for expensive / abuse-prone endpoints.
export const strictLimiter = rateLimit(baseOptions('strict', 20));

// Very tight limit for the manual sync trigger and legacy auth endpoints.
export const sensitiveLimiter = rateLimit(baseOptions('sensitive', 5));

// Aggressive ceiling for /api/ai/analyze-cv: each hit runs a full PDF parse +
// embed + Pinecone query + LLM completion, so 5/min/IP bounds how quickly a
// single client can drive CPU/memory spikes with large uploads.
export const cvAnalyzeLimiter = rateLimit(baseOptions('cv', 5));