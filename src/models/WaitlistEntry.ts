import mongoose, { Schema, Document } from 'mongoose';

// A single email that joined the pre-launch waitlist. `email` is unique so
// the same address can't be added twice (upserts are idempotent).
export interface IWaitlistEntry extends Document {
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

const WaitlistEntrySchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
  },
  { timestamps: true }
);

export default mongoose.model<IWaitlistEntry>('WaitlistEntry', WaitlistEntrySchema);