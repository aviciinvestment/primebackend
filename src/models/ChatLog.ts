import mongoose, { Schema, Document } from 'mongoose';

// One row per AI-chat the assistant had with a member: the exact message the
// user sent and the full reply they received. Written by BOTH chat producers
// (the Express /api/ai/chat pipeline with source 'server', and the Cloudflare
// Worker which posts the finished exchange to /api/ai/chat-log with source
// 'worker'). Fire-and-forget on the hot path — a logging failure must never
// fail or slow a chat. Admins review via /admin/chats.
export interface IChatLog extends Document {
  userId: string;
  userEmail: string;
  userName: string;
  message: string;
  reply: string;
  source: 'server' | 'worker';
  createdAt: Date;
  updatedAt: Date;
}

const ChatLogSchema: Schema = new Schema(
  {
    // Filled from the VERIFIED Firebase token (never the request body).
    userId: { type: String, index: true },
    userEmail: { type: String, trim: true, lowercase: true, index: true },
    // Display name — safe to keep the client-sent value here because this is
    // only used for admin readability, never for authorization or addressing.
    userName: { type: String, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    reply: { type: String, required: true, trim: true, maxlength: 8000 },
    source: { type: String, enum: ['server', 'worker'], required: true },
  },
  { timestamps: true }
);

// Admin activity feed is newest first.
ChatLogSchema.index({ createdAt: -1 });

export default mongoose.model<IChatLog>('ChatLog', ChatLogSchema);