import mongoose, { Schema, Document } from 'mongoose';

export interface IMentor extends Document {
  userId: string;
  name: string;
  email: string;
  company: string;
  roleType: string;
  careerStory: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

const MentorSchema: Schema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    name: { type: String },
    email: { type: String },
    company: { type: String, required: true, trim: true },
    roleType: { type: String, required: true, trim: true },
    careerStory: { type: String, required: true, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

export default mongoose.model<IMentor>('Mentor', MentorSchema);