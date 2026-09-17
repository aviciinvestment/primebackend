import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { MongoStore } from './mongoStore';

const errorJson = (req: Request, res: Response) => {
  res.status(429).json({ success: false, error: 'Too many requests. Please try again shortly.' });
};

// ---------------------------------------------------------------------------
// Persistent rate limiting. Each limiter gets its OWN MongoStore instance
// (express-rate-limit v8 rejects a store shared across limiters), but they all
// back onto the same Mongo collection, so counters survive restarts and stay
// consistent across horizontally scaled backend instances. Each limiter
// namespaces its keys (${name}:${ip}) since routes overlap (e.g. /api and
// /api/ai/chat are both mounted) and would otherwise collide on the same IP key.
// ---------------------------------------------------------------------------
const newMongoStore = (): MongoStore => new MongoStore();

const windowMs = 60 * 1000;

const makeOptions = (name: string, limit: number, opts: Partial<Options> = {}): Partial<Options> => ({
  windowMs,
  limit,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: errorJson,
  // req.ip is set by 'trust proxy' (1 hop) from the proxy chain; ipKeyGenerator
  // normalizes IPv6 -> /56 subnet so limit keys don't collide per-address when
  // the proxy forwards IPv6 clients. Prefix it so each limiter owns a disjoint
  // key space in the shared Mongo collection.
  //
  // CF-Connecting-IP is set by Cloudflare at the edge and cannot be spoofed by
  // a caller, so requests that arrive THROUGH the Worker (chat context/complaint
  // endpoints) get their true client IP keyed directly from it. Direct-to-Render
  // requests have no such header and fall back to req.ip (trust proxy 1 already
  // consumed the trusted hop). Prefer it over req.ip so the un-trusted-but-CF-set
  // header wins where available.
  keyGenerator: (req: Request) => {
    const cfIp = (req.headers['cf-connecting-ip'] as string) || '';
    const ip = cfIp || req.ip || req.socket.remoteAddress || 'unknown';
    return `${name}:${ipKeyGenerator(ip)}`;
  },
  ...opts,
});

// Public API ceiling per IP: in-memory by default. Every filtered request used to
// cost a Mongo upsert + $inc in the shared store — that write stream was the main
// DB load on a single free-tier instance. MemoryStore is exact, self-expiring
// (60s windows) and perfect for burst control on one instance. Set
// RATE_LIMIT_STORE=mongo to opt back into the persistent store if you
// later scale to multiple backend instances.
export const apiLimiter = rateLimit(
  process.env.RATE_LIMIT_STORE === 'mongo'
    ? makeOptions('api', 120, { store: newMongoStore() })
    : makeOptions('api', 120)
);

// Stricter limits for expensive / abuse-prone endpoints. Kept on the persistent
// Mongo store (low volume, survives restarts, catches repeat abusers).
export const strictLimiter = rateLimit(makeOptions('strict', 20, { store: newMongoStore() }));

// Chat is the highest-volume protected endpoint. It ALSO has its own per-user
// token bucket in aiController (keyed on verified uid), so the IP ceiling here
// is just a burst backstop. In-memory by default — the Mongo store's per-message
// upsert write was pure DB overhead on a single instance. Set RATE_LIMIT_STORE
// =mongo before scaling to multiple backend instances.
export const chatLimiter = rateLimit(
  process.env.RATE_LIMIT_STORE === 'mongo'
    ? makeOptions('chat', 20, { store: newMongoStore() })
    : makeOptions('chat', 20)
);

// Very tight limit for the manual sync trigger and legacy auth endpoints.
export const sensitiveLimiter = rateLimit(makeOptions('sensitive', 5, { store: newMongoStore() }));

// Aggressive ceiling for /api/ai/analyze-cv: each hit runs a full PDF parse +
// embed + Pinecone query + LLM completion, so 5/min/IP bounds how quickly a
// single client can drive CPU/memory spikes with large uploads.
export const cvAnalyzeLimiter = rateLimit(makeOptions('cv', 5, { store: newMongoStore() }));

// Public waitlist signup. The per-email upsert is already idempotent, so this
// mainly stops a spam script hammering the DB writes and count query.
export const waitlistLimiter = rateLimit(
  process.env.RATE_LIMIT_STORE === 'mongo'
    ? makeOptions('waitlist', 5, { store: newMongoStore() })
    : makeOptions('waitlist', 5)
);