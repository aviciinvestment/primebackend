import mongoose, { Schema, Document } from 'mongoose';

export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'interview'
  | 'accepted'
  | 'rejected';

export interface IApplication extends Document {
  // Firebase UID (string), matching the Cv model's per-user convention.
  userId: string;
  opportunityId: mongoose.Types.ObjectId;
  status: ApplicationStatus;
  // True once the user has opened the opportunity's link at least once — used
  // by the dashboard to show a "visited" differentiator.
  clicked: boolean;
  clickedAt?: Date;
  dateApplied?: Date;
}

const ApplicationSchema: Schema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity', required: true },
    status: {
      type: String,
      enum: ['saved', 'applied', 'interview', 'accepted', 'rejected'],
      default: 'saved',
    },
    clicked: { type: Boolean, default: false },
    clickedAt: { type: Date },
    dateApplied: { type: Date },
  },
  { timestamps: true }
);

// Unique compound index so a user can only have one record per opportunity.
ApplicationSchema.index({ opportunityId: 1, userId: 1 }, { unique: true });

export default mongoose.model<IApplication>('Application', ApplicationSchema);