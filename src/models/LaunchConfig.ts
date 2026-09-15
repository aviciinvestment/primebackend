import mongoose, { Schema, Document } from 'mongoose';

// Singleton-ish document holding the app's launch state. A single record is
// used by all reads (findOne), seeded with defaults on first access.
//
// Semantics:
//   - launched=false  -> home page shows the waitlist + countdown
//   - launched=true   -> home page shows opportunities + welcome banner
//   - deadline        -> when the app auto-launches even if admin never clicks
//                        "Launch". Set to now + countdownMs, refreshed whenever
//                        the admin unlaunches or changes the timer.
//   - whatsappGroupUrl -> where waitlist joiners are redirected after joining.
export interface ILaunchConfig extends Document {
  launched: boolean;
  launchedAt: Date | null;
  countdownMs: number;
  deadline: Date | null;
  whatsappGroupUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

const LaunchConfigSchema: Schema = new Schema(
  {
    launched: { type: Boolean, default: false },
    launchedAt: { type: Date, default: null },
    countdownMs: { type: Number, default: 5 * 24 * 60 * 60 * 1000 },
    deadline: { type: Date, default: null },
    whatsappGroupUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model<ILaunchConfig>('LaunchConfig', LaunchConfigSchema);