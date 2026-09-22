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
import { refreshCvMatches } from './controllers/aiController';
import { apiLimiter, chatLimiter, sensitiveLimiter } from './middleware/rateLimit';
import { withLock } from './lib/withLock';

const app = express();
const port = process.env.PORT || 5000;

// Behind a reverse proxy (Render LB / Cloudflare / a VPS load balancer),
// Express must trust upstream headers so req.ip / rate-limiter IPs come from
// X-Forwarded-For instead of treating everyone as the proxy's IP.
// ONLY the closest hop (1) is trusted — trusting every hop lets a client that
// can reach us directly spoof arbitrary X-Forwarded-For values and rewrite its
// own rate-limit key. The Cloudflare Worker also forwards CF-Connecting-IP
// (set by Cloudflare at the edge, not spoofable by the caller), which the rate
// limiter prefers (see rateLimit.ts).
app.set('trust proxy', 1);

// Security headers.
app.use(helmet());

// Gzip JSON responses (opportunity arrays are large). Runs early so the
// compressed stream flows through the rest of the middleware unchanged.
// SSE chat streams are deliberately EXCLUDED: zlib buffering would delay tiny
// 'data:' frames, so llamaChat streaming would not actually stream.
app.use(compression({
  filter: (req, res) => {
    const contentType = String(res.getHeader('Content-Type') || '');
    return !contentType.includes('text/event-stream') && compression.filter(req, res);
  },
}));

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
// Chat uses the in-memory limiter (per-user burst control lives in aiController);
// strictLimiter stays reserved for low-volume admin/sensitive endpoints.
app.use('/api/ai/chat', chatLimiter);
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
import visitRoutes from './routes/visitRoutes';
import themeRoutes from './routes/themeRoutes';

// Load-balancer health probe (Tier 1, Item 1). The LB checks GET /healthz and
// marks the instance ready only when BOTH hold: this handler is executing (the
// Express event loop is live) AND Mongo reports readyState === 1 (Connected).
// Any other Mongo state (0 disconnected, 2 connecting, 3 disconnecting) returns
// 503 so the LB drains the box instead of routing traffic to one that can't
// reach the data layer. Deliberately constant-time — no DB round-trip on the
// heartbeat path. Outside /api, so heartbeat probes never burn rate-limit
// budget either.
export const healthHandler: express.RequestHandler = (_req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.setHeader('Cache-Control', 'no-store');
  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? 'ok' : 'degraded',
    db: mongoose.connection.readyState,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};
app.get('/healthz', healthHandler);

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
app.use('/api/visits', visitRoutes);
app.use('/api/theme', themeRoutes);

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

// ---------------------------------------------------------------------------
// Boot pipeline (Tier 1, Item 1): the listener opens ONLY after Mongo is
// confirmed connected, so the app never accepts web traffic before the data
// layer is reachable. Unreachable Mongo is retried up to MONGO_RETRY_ATTEMPTS,
// then the process exits non-zero — Render/LB restarts the instance instead of
// letting a DB-less box 500 on every route. /healthz keeps the LB honest during
// operation: a post-boot Mongo drop flips it to 503 and the LB drains us.
// ---------------------------------------------------------------------------
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/opportunity-radar';
const MONGO_CONNECT_RETRIES = Math.min(Math.max(parseInt(process.env.MONGO_RETRY_ATTEMPTS || '10', 10), 1), 30);
const MONGO_RETRY_DELAY_MS = Math.min(Math.max(parseInt(process.env.MONGO_RETRY_MS || '3000', 10), 250), 30000);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= MONGO_CONNECT_RETRIES; attempt++) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      return;
    } catch (error: any) {
      console.error(
        `MongoDB connection attempt ${attempt}/${MONGO_CONNECT_RETRIES} failed: ${error?.message || error}`
      );
      if (attempt === MONGO_CONNECT_RETRIES) throw error;
      await delay(MONGO_RETRY_DELAY_MS);
    }
  }
}

// Daily opportunity sync: run once on boot, then on a cron schedule.
// Pulls fresh listings from external APIs/RSS, closes expired deadlines, and
// embeds new/changed opportunities into Pinecone immediately.
// Wrapped in a distributed lock so overlapping instances/retries never run in parallel.
//
// After every successful sync (boot or cron) we ALSO refresh every user's saved
// CV matches against the freshly-updated feed, so the "Filter by CV" feed on the
// dashboard stays current without any user action — this is the CV filter's
// automatic daily update. A belt-and-braces midday cron runs the CV refresh even
// on days the opportunity sync finds nothing new (e.g. deadlines flipping status).
const runSyncAndRefresh = async () => {
  const result = await withLock('opportunity-sync', 45 * 60 * 1000, runOpportunitySync);
  if (result) {
    console.log('[sync] Sync complete:', JSON.stringify(result));
    try {
      await withLock('cv-match-refresh', 30 * 60 * 1000, refreshCvMatches);
    } catch (error) {
      console.error('[sync] CV match refresh after sync failed:', error);
    }
  }
  return result;
};

const scheduleOpportunitySync = () => {
  const cronExpression = process.env.SYNC_CRON || '0 6 * * *'; // default: daily 06:00
  const cvRefreshCron = process.env.CV_REFRESH_CRON || '0 12 * * *'; // default: daily 12:00
  const timezone = process.env.SYNC_TIMEZONE || 'Africa/Lagos';

  console.log(`Scheduling opportunity sync: ${cronExpression} (${timezone})`);
  cron.schedule(cronExpression, async () => {
    console.log('[sync] Starting scheduled opportunity sync...');
    try {
      await runSyncAndRefresh();
    } catch (error) {
      console.error('[sync] Scheduled sync failed:', error);
    }
  });

  // Independent daily CV refresh (in case the opportunity sync finds nothing
  // new / is skipped by its lock — matches can still drift as deadlines close).
  console.log(`Scheduling CV match refresh: ${cvRefreshCron} (${timezone})`);
  cron.schedule(cvRefreshCron, async () => {
    console.log('[cv-refresh] Starting scheduled CV match refresh...');
    try {
      const result = await withLock('cv-match-refresh', 30 * 60 * 1000, refreshCvMatches);
      if (result) console.log('[cv-refresh] Complete:', JSON.stringify(result));
    } catch (error) {
      console.error('[cv-refresh] Scheduled refresh failed:', error);
    }
  });

  // Kick off an initial sync + CV refresh right after boot so the feed (and CV
  // matches) are current immediately.
  console.log('[sync] Running initial sync at boot...');
  runSyncAndRefresh()
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

async function main() {
  if (process.env.PRIME_BOOT === '0') return; // test harness: import routes without booting

  await waitForDatabase();
  console.log('Connected to MongoDB');

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });

  scheduleOpportunitySync();
  scheduleLaunchCheck();
}

main().catch((error) => {
  console.error(
    'Fatal: MongoDB unreachable — refusing to accept traffic. Exiting.',
    error?.message || error
  );
  process.exit(1);
});