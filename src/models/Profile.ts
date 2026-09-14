import mongoose, { Schema, Document } from 'mongoose';

export interface IProfile extends Document {
  userId: mongoose.Types.ObjectId;
  // Personal
  country: string;
  stateOrCity: string;
  currentLocation: string;
  ageRange: string;
  nationality: string;
  
  // Academic
  educationLevel: string;
  university: string;
  courseOfStudy: string;
  faculty: string;
  currentYear: string;
  expectedGraduationDate: Date;
  cgpa: number;
  gradingScale: number;
  academicAchievements: string[];
  
  // Career
  desiredCareerField: string;
  desiredIndustries: string[];
  technicalSkills: string[];
  professionalSkills: string[];
  certifications: string[];
  workExperience: any[]; // define more rigidly later
  internshipExperience: any[];
  leadershipExperience: string[];
  researchExperience: string[];
  
  // Preferences
  opportunityPreferences: string[];
  geographicPreferences: string[];
  
  // CV Analysis
  cvUrl?: string;
  cvScore?: number;
  cvAnalysis?: any;
}

const ProfileSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    country: { type: String },
    stateOrCity: { type: String },
    currentLocation: { type: String },
    ageRange: { type: String },
    nationality: { type: String },
    
    educationLevel: { type: String },
    university: { type: String },
    courseOfStudy: { type: String },
    faculty: { type: String },
    currentYear: { type: String },
    expectedGraduationDate: { type: Date },
    cgpa: { type: Number },
    gradingScale: { type: Number },
    academicAchievements: [{ type: String }],
    
    desiredCareerField: { type: String },
    desiredIndustries: [{ type: String }],
    technicalSkills: [{ type: String }],
    professionalSkills: [{ type: String }],
    certifications: [{ type: String }],
    workExperience: [{ type: Schema.Types.Mixed }],
    internshipExperience: [{ type: Schema.Types.Mixed }],
    leadershipExperience: [{ type: String }],
    researchExperience: [{ type: String }],
    
    opportunityPreferences: [{ type: String }],
    geographicPreferences: [{ type: String }],
    
    cvUrl: { type: String },
    cvScore: { type: Number },
    cvAnalysis: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export default mongoose.model<IProfile>('Profile', ProfileSchema);
