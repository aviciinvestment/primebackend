import express from 'express';
import { runOpportunitySync } from '../services/syncOpportunities';

const router = express.Router();

// POST /api/sync/run — manually trigger a full opportunity sync.
// Useful for testing and for external schedulers (cron/CI) if desired.
// The built-in scheduler in index.ts runs this automatically on boot + daily.
router.post('/run', async (_req, res) => {
  try {
    const result = await runOpportunitySync();
    res.json({ success: true, result });
  } catch (error: any) {
    console.error('Manual sync failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;