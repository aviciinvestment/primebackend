import mongoose, { Schema, Document } from 'mongoose';

// Singleton-ish document holding the app-wide theme. A single record is used
// by all reads (findOne), seeded with 'dark' on first access. The admin page
// switches the look and every visitor's page picks it up on load.
//
// Themes:
//   - light    -> bright, high-contrast light theme
//   - dark     -> the original deep green-black theme
//   - midnight -> pure black canvas, no green blend
export type ThemeId = 'light' | 'dark' | 'midnight';

export interface IThemeConfig extends Document {
  theme: ThemeId;
  createdAt: Date;
  updatedAt: Date;
}

const ThemeConfigSchema: Schema = new Schema(
  {
    theme: { type: String, enum: ['light', 'dark', 'midnight'], default: 'dark' as ThemeId },
  },
  { timestamps: true }
);

export default mongoose.model<IThemeConfig>('ThemeConfig', ThemeConfigSchema);