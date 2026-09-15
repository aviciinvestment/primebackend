import mongoose, { Schema } from 'mongoose';

// A single-document collection used as a distributed lock so overlapping
// sync/cron jobs (multiple server instances, retries) never run concurrently.
interface ISyncLock {
  expiresAt: Date;
  owner: string;
  acquiredAt: Date;
}

const SyncLockSchema: Schema = new Schema(
  {
    _id: { type: String, required: true }, // lock name
    acquiredAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    owner: { type: String, required: true },
  },
  { versionKey: false }
);

const SyncLock =
  (mongoose.models.SyncLock as mongoose.Model<ISyncLock>) ||
  mongoose.model<ISyncLock>('SyncLock', SyncLockSchema);

// Try to acquire the named lock for `ttlMs`. Returns true if this caller holds it.
const acquire = async (name: string, ttlMs: number, owner: string): Promise<boolean> => {
  const now = new Date();
  const result = await SyncLock.findOneAndUpdate(
    {
      _id: name,
      $or: [{ expiresAt: { $lt: now } }, { expiresAt: { $exists: false } }],
    },
    { _id: name, acquiredAt: now, expiresAt: new Date(now.getTime() + ttlMs), owner },
    { upsert: true, new: true }
  );
  return result?.owner === owner;
};

// Run `fn` only if the lock is free; returns null when another run held it.
// The lock is released on completion; a crashed run expires via the TTL.
export const withLock = async <T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T | null> => {
  const owner = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const held = await acquire(name, ttlMs, owner);
  if (!held) {
    console.log(`[lock] "${name}" is held by another run — skipping.`);
    return null;
  }

  try {
    return await fn();
  } finally {
    await SyncLock.deleteOne({ _id: name, owner }).catch(() => {
      /* best-effort release */
    });
  }
};