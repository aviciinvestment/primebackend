import mongoose, { Schema, Document } from 'mongoose';

// One document per app page view/session load. The visitor's IP is NEVER stored
// raw — only a sha256 hash of it becomes the `visitorKey`, so we can count
// unique visitors without keeping identifiable network data.
export interface IPageVisit extends Document {
  visitorKey: string;
  path: string;
  referrer: string;
  userAgent: string;
  createdAt: Date;
}

const PageVisitSchema: Schema = new Schema(
  {
    visitorKey: { type: String, required: true, index: true },
    path: { type: String, default: '/', trim: true },
    referrer: { type: String, default: '', trim: true },
    userAgent: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

// Date-bucketed queries (today / last N days) drive the admin stats, so an
// index on createdAt keeps those fast as the collection grows.
PageVisitSchema.index({ createdAt: -1 });

export default mongoose.model<IPageVisit>('PageVisit', PageVisitSchema);