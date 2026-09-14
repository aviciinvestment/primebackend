import mongoose, { Schema, Document } from 'mongoose';

export interface IApplication extends Document {
  opportunityId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  dateApplied?: Date;
  status: 'Interested' | 'Saved' | 'Planning to Apply' | 'Applied' | 'Assessment' | 'Interview' | 'Final Stage' | 'Accepted' | 'Rejected' | 'Withdrawn' | 'Expired';
  applicationNotes?: string;
  documentsUsed: string[];
  cvVersion?: string;
  coverLetter?: string;
  applicationUrl?: string;
  nextAction?: string;
  nextActionDate?: Date;
}

const ApplicationSchema: Schema = new Schema(
  {
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dateApplied: { type: Date },
    status: { 
      type: String, 
      enum: ['Interested', 'Saved', 'Planning to Apply', 'Applied', 'Assessment', 'Interview', 'Final Stage', 'Accepted', 'Rejected', 'Withdrawn', 'Expired'],
      default: 'Saved'
    },
    applicationNotes: { type: String },
    documentsUsed: [{ type: String }],
    cvVersion: { type: String },
    coverLetter: { type: String },
    applicationUrl: { type: String },
    nextAction: { type: String },
    nextActionDate: { type: Date }
  },
  { timestamps: true }
);

// Unique compound index so a user can only have one application record per opportunity
ApplicationSchema.index({ opportunityId: 1, userId: 1 }, { unique: true });

export default mongoose.model<IApplication>('Application', ApplicationSchema);
