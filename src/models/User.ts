import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: 'user' | 'admin';
  firstName: string;
  lastName: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', UserSchema);
