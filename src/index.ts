import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import cron from 'node-cron';
import { runOpportunitySync } from './services/syncOpportunities';

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    // Comma-separated list of allowed origins, e.g. CORS_ORIGIN=https://app.example.com,http://localhost:5173
    // Leave unset (or CORS_ORIGIN=*) to allow all origins.
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((s: string) => s.trim()).filter(Boolean)
      : true,
  })
);
app.use(express.json());

import opportunityRoutes from './routes/opportunityRoutes';
import authRoutes from './routes/authRoutes';
import aiRoutes from './routes/aiRoutes';
import mentorRoutes from './routes/mentorRoutes';
import syncRoutes from './routes/syncRoutes';
import applicationRoutes from './routes/applicationRoutes';
import mentorshipRoutes from './routes/mentorshipRoutes';
import userRoutes from './routes/userRoutes';
import adminRoutes from './routes/adminRoutes';

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Opportunity Radar API is running' });
});

app.use('/api/opportunities', opportunityRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/mentors', mentorRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/mentorships', mentorshipRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

// Database connection
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/opportunity-radar';

// Start server immediately
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Daily opportunity sync: run once on boot, then on a cron schedule.
// Pulls fresh listings from external APIs/RSS, closes expired deadlines, and
// embeds new/changed opportunities into Pinecone immediately.
const scheduleOpportunitySync = () => {
  const cronExpression = process.env.SYNC_CRON || '0 6 * * *'; // default: daily 06:00
  const timezone = process.env.SYNC_TIMEZONE || 'Africa/Lagos';

  console.log(`Scheduling opportunity sync: ${cronExpression} (${timezone})`);
  cron.schedule(cronExpression, async () => {
    console.log('[sync] Starting scheduled opportunity sync...');
    try {
      const result = await runOpportunitySync();
      console.log('[sync] Scheduled sync complete:', JSON.stringify(result));
    } catch (error) {
      console.error('[sync] Scheduled sync failed:', error);
    }
  });

  // Kick off an initial sync right after boot so the feed is fresh immediately.
  console.log('[sync] Running initial opportunity sync at boot...');
  runOpportunitySync()
    .then(result => console.log('[sync] Initial sync complete:', JSON.stringify(result)))
    .catch(error => console.error('[sync] Initial sync failed:', error));
};

mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log('Connected to MongoDB');
    scheduleOpportunitySync();
  })
  .catch((error) => {
    console.error('MongoDB connection error. Running in mock mode.', error.message);
    console.log('Opportunity sync requires MongoDB — it will start once the database reconnects.');
    // Retry connecting + scheduling when the DB becomes available.
    mongoose.connection.on('connected', scheduleOpportunitySync);
  });












