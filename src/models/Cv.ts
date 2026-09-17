import mongoose, { Schema, Document } from 'mongoose';

export interface ICv extends Document {
  userId: string;
  userEmail?: string;
  userName?: string;
  fileName: string;
  contentType: string;
  fileData?: Buffer;
  // New uploads store the PDF on Cloudinary instead of inside Mongo; these
  // references back it. Legacy docs keep fileData until replaced.
  cloudinaryId?: string;
  cloudinaryUrl?: string;
  text: string;
  analysis: string;
  matchIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const CvSchema: Schema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String },
    userName: { type: String },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    fileData: { type: Buffer },
    cloudinaryId: { type: String },
    cloudinaryUrl: { type: String },
    text: { type: String },
    analysis: { type: String },
    matchIds: [{ type: Schema.Types.ObjectId, ref: 'Opportunity' }],
  },
  { timestamps: true }
);

CvSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<ICv>('Cv', CvSchema);