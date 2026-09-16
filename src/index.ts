import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import cors from 'cors';
import mongoose from 'mongoose';
import cron from 'node-cron';
import helmet from 'helmet';
import multer from 'multer';
import { runOpportunitySync } from './services/syncOpportunities';
import { autoLaunchIfDue } from './controllers/launchController';
import { apiLimiter, sensitiveLimiter, strictLimiter } from './middleware/rateLimit';
import { withLock } from './lib/withLock';

const app = express();
const port = process.env.PORT || 5000;

// Behind a reverse proxy (Render LB / Cloudflare / a VPS load balancer),
// Express must trust upstream headers so req.ip / rate limiter IPs come from
// X-Forwarded-For / CF-Connecting-IP instead of treating everyone as the
// proxy's IP. Trust all hops: the Mongo-backed rate limiter then keys on the
// real client IP forwarded through the Worker's CF-Connecting-IP header.
app.set('trust proxy', true);

// Security headers.
app.use(helmet());

// Gzip JSON responses (opportunity arrays are large). Runs early so the
// compressed stream flows through the rest of the middleware unchanged.
app.use(compression());

// Strict CORS allow-list. Without CORS_ORIGIN we only permit the local dev
// frontends; production origins go in CORS_ORIGIN (comma-separated), or * to
// allow everything (not recommended). Any localhost port is always allowed so
// local dev works regardless of the Vite port.
const defaultOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : defaultOrigins;
const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin: (origin, cb) => {
      if (
        !origin ||
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin) ||
        isLocalhost.test(origin)
      ) {
        return cb(null, true);
      }
      return cb(new Error('Not allowed by CORS'));
    },
  })
);

app.use(express.json({ limit: '1mb' }));

// Global per-IP ceiling + tighter limits on expensive and abuse-prone routes.
app.use('/api', apiLimiter);
app.use('/api/ai/chat', strictLimiter);
app.use('/api/sync', sensitiveLimiter);

import opportunityRoutes from './routes/opportunityRoutes';
// Legacy /api/auth (email+password+JWT) is disabled — the client signs in via Firebase.
import aiRoutes from './routes/aiRoutes';
import mentorRoutes from './routes/mentorRoutes';
import syncRoutes from './routes/syncRoutes';
import applicationRoutes from './routes/applicationRoutes';
import mentorshipRoutes from './routes/mentorshipRoutes';
import userRoutes from './routes/userRoutes';
import adminRoutes from './routes/adminRoutes';
import launchRoutes from './routes/launchRoutes';

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Opportunity Radar API is running' });
});

app.use('/api/opportunities', opportunityRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/mentors', mentorRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/mentorships', mentorshipRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/launch', launchRoutes);

// Multer errors (file too big, wrong type) -> clean HTTP responses instead of
// a generic 500, and shield the error message from the client.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum allowed size is 5MB.'
        : 'Invalid file upload.';
    return res.status(status).json({ success: false, message });
  }
  if (err instanceof Error && err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ success: false, message: 'Only PDF files are allowed.' });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'Origin not allowed.' });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error.' });
});

// Database connection
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/opportunity-radar';

// Start server immediately
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Daily opportunity sync: run once on boot, then on a cron schedule.
// Pulls fresh listings from external APIs/RSS, closes expired deadlines, and
// embeds new/changed opportunities into Pinecone immediately.
// Wrapped in a distributed lock so overlapping instances/retries never run in parallel.
const scheduleOpportunitySync = () => {
  const cronExpression = process.env.SYNC_CRON || '0 6 * * *'; // default: daily 06:00
  const timezone = process.env.SYNC_TIMEZONE || 'Africa/Lagos';

  console.log(`Scheduling opportunity sync: ${cronExpression} (${timezone})`);
  cron.schedule(cronExpression, async () => {
    console.log('[sync] Starting scheduled opportunity sync...');
    try {
      const result = await withLock('opportunity-sync', 45 * 60 * 1000, runOpportunitySync);
      if (result) console.log('[sync] Scheduled sync complete:', JSON.stringify(result));
    } catch (error) {
      console.error('[sync] Scheduled sync failed:', error);
    }
  });

  // Kick off an initial sync right after boot so the feed is fresh immediately.
  console.log('[sync] Running initial opportunity sync at boot...');
  withLock('opportunity-sync', 45 * 60 * 1000, runOpportunitySync)
    .then(result => result && console.log('[sync] Initial sync complete:', JSON.stringify(result)))
    .catch(error => console.error('[sync] Initial sync failed:', error));
};

// Auto-launch: if the admin never clicked "Launch" and the countdown has
// elapsed, launch the app automatically.
const scheduleLaunchCheck = () => {
  cron.schedule('*/1 * * * *', async () => {
    try {
      const config = await withLock('auto-launch-check', 60 * 1000, autoLaunchIfDue);
      if (config?.launched) {
        console.log('[launch] App auto-launched (countdown elapsed).');
      }
    } catch (error) {
      console.error('[launch] schedule check failed:', error);
    }
  });
};

mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log('Connected to MongoDB');
    scheduleOpportunitySync();
    scheduleLaunchCheck();
  })
  .catch((error) => {
    console.error('MongoDB connection error. Running in mock mode.', error.message);
    console.log('Opportunity sync requires MongoDB — it will start once the database reconnects.');
    // Retry connecting + scheduling when the DB becomes available.
    mongoose.connection.on('connected', () => {
      scheduleOpportunitySync();
      scheduleLaunchCheck();
    });
  });