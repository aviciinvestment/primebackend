import mongoose, { Schema, Document } from 'mongoose';

// Escalation raised from the chat widget when a user reports a payment /
// mentorship problem (e.g. "I paid but no mentor was assigned yet"). Stored
// with the user's details so admins can review and follow up.
export interface IMentorshipComplaint extends Document {
  ticket: string;
  userId: string;
  userEmail: string;
  userName: string;
  message: string;
  payments: Array<{
    reference: string;
    amount: number;
    currency: string;
    mentorName: string;
    createdAt: Date;
  }>;
  status: 'open' | 'resolved';
  createdAt: Date;
  updatedAt: Date;
}

const MentorshipComplaintSchema: Schema = new Schema(
  {
    ticket: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, trim: true, lowercase: true },
    userName: { type: String, trim: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    payments: {
      type: [
        {
          reference: { type: String },
          amount: { type: Number, min: 0 },
          currency: { type: String, default: 'NGN' },
          mentorName: { type: String },
          createdAt: { type: Date },
        },
      ],
      default: [],
    },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  },
  { timestamps: true }
);

// Admin inbox lists by status, newest first.
MentorshipComplaintSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IMentorshipComplaint>('MentorshipComplaint', MentorshipComplaintSchema);