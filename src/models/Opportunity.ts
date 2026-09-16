import mongoose, { Schema, Document } from 'mongoose';

export interface IOpportunity extends Document {
  title: string;
  organization: string;
  organizationLogo?: string;
  description: string;
  category: string; // e.g., 'Category A - Undergraduate', 'Category B - Graduate'
  subcategory: string;
  opportunityType: string;
  
  // Eligibility
  targetAudience: string[];
  eligibleEducationLevels: string[];
  eligibleFields: string[];
  eligibleCountries: string[];
  eligibleRegions: string[];
  location: string;
  remoteAvailable: boolean;
  geographicEligibility?: string;
  workAuthorizationRequired?: 'Yes' | 'No' | 'Unknown';
  visaSponsorship?: 'Yes' | 'No' | 'Unknown';
  
  // Funding
  fundingType: string;
  fundingAmount?: string;
  currency?: string;
  tuitionCoverage?: boolean;
  livingStipend?: boolean;
  travelSupport?: boolean;
  
  // Requirements
  applicationFee?: string;
  minimumCgpa?: number;
  minimumDegreeClass?: string;
  workExperienceRequired?: string;
  nyscRequired?: string;
  ageRequirement?: string;
  ieltsRequired?: boolean;
  greRequired?: boolean;
  gmatRequired?: boolean;
  documentsRequired: string[];
  
  applicationSteps?: string;
  
  // Timeline
  deadline?: string;
  deadlineTimezone?: string;
  status: 'OPEN' | 'CLOSING SOON' | 'CLOSED' | 'UPCOMING' | 'DEADLINE UNKNOWN';
  
  // Sources & Verification
  officialUrl: string;
  sourceUrl?: string;
  sourceName?: string;
  dateDiscovered: Date;
  lastVerified?: Date;
  verificationStatus: 'Verified' | 'Needs review' | 'Potentially outdated';
  
  priorityScore: number;
  tags: string[];
  isAiDiscovered: boolean;
  vectorized: boolean;
}

const OpportunitySchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    organization: { type: String, required: true },
    organizationLogo: { type: String },
    description: { type: String, required: true },
    category: { type: String },
    subcategory: { type: String },
    opportunityType: { type: String },
    
    targetAudience: [{ type: String }],
    eligibleEducationLevels: [{ type: String }],
    eligibleFields: [{ type: String }],
    eligibleCountries: [{ type: String }],
    eligibleRegions: [{ type: String }],
    location: { type: String },
    remoteAvailable: { type: Boolean, default: false },
    geographicEligibility: { type: String },
    workAuthorizationRequired: { type: String, enum: ['Yes', 'No', 'Unknown'], default: 'Unknown' },
    visaSponsorship: { type: String, enum: ['Yes', 'No', 'Unknown'], default: 'Unknown' },
    
    fundingType: { type: String },
    fundingAmount: { type: String },
    currency: { type: String },
    tuitionCoverage: { type: Boolean },
    livingStipend: { type: Boolean },
    travelSupport: { type: Boolean },
    
    applicationFee: { type: String },
    minimumCgpa: { type: Number },
    minimumDegreeClass: { type: String },
    workExperienceRequired: { type: String },
    nyscRequired: { type: String },
    ageRequirement: { type: String },
    ieltsRequired: { type: Boolean },
    greRequired: { type: Boolean },
    gmatRequired: { type: Boolean },
    documentsRequired: [{ type: String }],
    
    applicationSteps: { type: String },
    
    deadline: { type: String },
    deadlineTimezone: { type: String },
    status: { 
      type: String, 
      enum: ['OPEN', 'CLOSING SOON', 'CLOSED', 'UPCOMING', 'DEADLINE UNKNOWN'],
      default: 'DEADLINE UNKNOWN'
    },
    
    officialUrl: { type: String, required: true },
    sourceUrl: { type: String },
    sourceName: { type: String },
    dateDiscovered: { type: Date, default: Date.now },
    lastVerified: { type: Date },
    verificationStatus: { 
      type: String, 
      enum: ['Verified', 'Needs review', 'Potentially outdated'],
      default: 'Needs review'
    },
    
    priorityScore: { type: Number, default: 0 },
    tags: [{ type: String }],
    isAiDiscovered: { type: Boolean, default: false },
    // True once this opportunity's vector exists in Pinecone. Lets the sync
    // embed only new/changed docs instead of re-embedding everything.
    vectorized: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// Indexes for common queries
OpportunitySchema.index({ status: 1 });
OpportunitySchema.index({ deadline: 1 });
OpportunitySchema.index({ eligibleEducationLevels: 1 });
OpportunitySchema.index({ eligibleFields: 1 });
OpportunitySchema.index({ eligibleCountries: 1 });
// Feeds sort by status then priority/discovery date; dedupe/search by URL.
OpportunitySchema.index({ officialUrl: 1 });
OpportunitySchema.index({ status: 1, priorityScore: -1, dateDiscovered: -1 });
// Feed sort variants + filter fields hit by ?sort=newest|deadline&category=&type=
OpportunitySchema.index({ status: 1, dateDiscovered: -1 });
OpportunitySchema.index({ status: 1, deadline: 1, dateDiscovered: -1 });
OpportunitySchema.index({ category: 1 });
OpportunitySchema.index({ opportunityType: 1 });

// Full-text search index
OpportunitySchema.index({
  title: 'text',
  organization: 'text',
  description: 'text',
  tags: 'text',
});

export default mongoose.model<IOpportunity>('Opportunity', OpportunitySchema);
