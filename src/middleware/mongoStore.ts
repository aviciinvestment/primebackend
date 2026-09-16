import type { Store, IncrementResponse, Options } from 'express-rate-limit';
import { Schema, model, type Model } from 'mongoose';

// ---------------------------------------------------------------------------
// Persistent MongoDB-backed rate-limit store (replaces express-rate-limit's
// volatile in-memory MemoryStore). Survives restarts and is shared across
// horizontally scaled instances because the counter lives in Mongo, not in
// process memory. Reuses the existing mongoose connection — no extra driver
// or connection pool.
//
// Fixed 60-second window modelled as a single document:
//   { _id: "<limiter>:<client ip>", counter, expiresAt }
// The TTL index (expireAfterSeconds: 0) auto-deletes stale documents so the
// collection stays bounded without a sweeper job.
//
// Fail-open: if Mongo errors, log and return a permissive result so a DB blip
// degrades rate limiting (requests pass) instead of 500ing the whole API.
// ---------------------------------------------------------------------------

interface RateLimitDoc {
  _id: string;
  counter: number;
  expiresAt: Date;
}

const RateLimitSchema = new Schema<RateLimitDoc>(
  {
    _id: { type: String, required: true },
    counter: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

let RateLimitModel: Model<RateLimitDoc> | null = null;

const getModel = () => {
  if (!RateLimitModel) {
    RateLimitModel = model('RateLimit', RateLimitSchema) as Model<RateLimitDoc>;
    // Best-effort TTL so expired windows are purged by Mongo itself. Fire and
    // forget: creation is idempotent and cached by the server.
    RateLimitModel.collection
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch(err => console.error('[rate-limit] Could not create TTL index:', err));
  }
  return RateLimitModel;
};

// Every counter document ties a windowMs expiry to a fixed bucket start. Because
// $setOnInsert sets expiresAt only on creation, the window does not slide on each
// hit — the counter resets windowMs after the *first* request in the window.
export class MongoStore implements Store {
  localKeys = false;
  private windowMs: number;

  constructor() {
    this.windowMs = 60 * 1000;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs || this.windowMs;
  }

  // Optional read path used by the middleware if it needs the current count.
  async get(key: string): Promise<IncrementResponse | undefined> {
    const doc = await getModel().findOne({ _id: key }).lean().exec();
    if (!doc) return undefined;
    return { totalHits: doc.counter, resetTime: new Date(doc.expiresAt) };
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      const expiresAt = new Date(Date.now() + this.windowMs);
      const doc = await getModel()
        .findOneAndUpdate(
          { _id: key },
          { $inc: { counter: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, new: true }
        )
        .lean()
        .exec();

      return { totalHits: doc?.counter ?? 1, resetTime: new Date(doc?.expiresAt ?? expiresAt) };
    } catch (err) {
      console.error('[rate-limit] increment failed, failing open:', err);
      return { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await getModel()
        .updateOne({ _id: key, counter: { $gt: 0 } }, { $inc: { counter: -1 } })
        .exec();
    } catch (err) {
      console.error('[rate-limit] decrement failed:', err);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await getModel().deleteOne({ _id: key }).exec();
    } catch (err) {
      console.error('[rate-limit] resetKey failed:', err);
    }
  }
}