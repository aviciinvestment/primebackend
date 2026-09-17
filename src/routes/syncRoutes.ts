import express from 'express';
import { runOpportunitySync } from '../services/syncOpportunities';
import { requireAdmin } from '../middleware/auth';
import { withLock } from '../lib/withLock';

const router = express.Router();

// Same lock identity/TTL as the scheduled + boot jobs (index.ts) so the manual
// endpoint, the daily 06:00 cron, and the boot sync all serialize on one
// distributed lock. A manual run during an active sync is rejected instead of
// doubling load on the single NVIDIA/Pinecone keys (Section 1.6).
const SYNC_LOCK_NAME = 'opportunity-sync';
const SYNC_LOCK_TTL_MS = 45 * 60 * 1000;

// POST /api/sync/run — manually trigger a full opportunity sync.
// Admin only (verified Firebase token, not the old spoofable header).
router.post('/run', requireAdmin, async (_req, res) => {
  try {
    const result = await withLock(SYNC_LOCK_NAME, SYNC_LOCK_TTL_MS, runOpportunitySync);
    if (!result) {
      res
        .status(409)
        .json({ success: false, error: 'A sync is already running. Try again shortly.' });
      return;
    }
    res.json({ success: true, result });
  } catch (error: any) {
    console.error('Manual sync failed:', error);
    res.status(500).json({ success: false, error: 'Sync failed.' });
  }
});

export default router;