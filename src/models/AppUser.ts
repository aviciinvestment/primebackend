import mongoose, { Schema, Document } from 'mongoose';

// Lightweight registry of Firebase-identified users. Kept separate from the
// local User collection (email/password) because the client authenticates via
// Firebase while mentors/mentees are keyed by Firebase uid. The `role` field
// here is what the admin page manages.
export interface IMentorshipInterest {
  choice: 'yes' | 'no' | null;
  source: 'opportunity' | 'general';
  opportunityTitle: string;
  opportunityUrl: string;
  answeredAt: Date;
}

export interface IAppUser extends Document {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'user' | 'admin';
  mentorshipInterest?: IMentorshipInterest;
  createdAt: Date;
  updatedAt: Date;
}

const AppUserSchema: Schema = new Schema(
  {
    uid: { type: String, required: true, unique: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    displayName: { type: String, trim: true },
    photoURL: { type: String },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    mentorshipInterest: {
      choice: { type: String, enum: ['yes', 'no', null], default: null },
      source: { type: String, enum: ['opportunity', 'general'], default: 'general' },
      opportunityTitle: { type: String, default: '' },
      opportunityUrl: { type: String, default: '' },
      answeredAt: { type: Date },
    },
  },
  { timestamps: true }
);

export default mongoose.model<IAppUser>('AppUser', AppUserSchema);