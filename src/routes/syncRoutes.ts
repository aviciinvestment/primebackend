import express from 'express';
import { runOpportunitySync } from '../services/syncOpportunities';
import { requireAdmin } from '../middleware/auth';

const router = express.Router();

// POST /api/sync/run — manually trigger a full opportunity sync.
// Admin only (verified Firebase token, not the old spoofable header).
router.post('/run', requireAdmin, async (_req, res) => {
  try {
    const result = await runOpportunitySync();
    res.json({ success: true, result });
  } catch (error: any) {
    console.error('Manual sync failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;