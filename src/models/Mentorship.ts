import mongoose, { Schema, Document } from 'mongoose';

export interface IMentorship extends Document {
  userId: string;
  userEmail?: string;
  userName?: string;
  opportunityId?: string;
  opportunityTitle?: string;
  opportunityOrg?: string;
  opportunityUrl?: string;
  opportunityType?: string;
  opportunityCategory?: string;
  mentorId?: string;
  mentorName?: string;
  amount: number;
  currency: string;
  provider: string; // 'paystack' | 'demo'
  reference: string;
  status: 'paid' | 'pending' | 'failed';
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MentorshipSchema: Schema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, trim: true, lowercase: true },
    userName: { type: String, trim: true },
    opportunityId: { type: String },
    opportunityTitle: { type: String, trim: true },
    opportunityOrg: { type: String, trim: true },
    opportunityUrl: { type: String, trim: true },
    opportunityType: { type: String, trim: true },
    opportunityCategory: { type: String, trim: true },
    mentorId: { type: String, index: true },
    mentorName: { type: String },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'NGN' },
    provider: { type: String, enum: ['paystack', 'demo'], required: true },
    reference: { type: String, required: true, unique: true },
    status: { type: String, enum: ['paid', 'pending', 'failed'], default: 'pending' },
    note: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model<IMentorship>('Mentorship', MentorshipSchema);