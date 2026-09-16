import express from 'express';
import { getOpportunities, getOpportunity, createManualOpportunity } from '../controllers/opportunityController';
import { getSharePreview } from '../controllers/socialPreviewController';
import { requireAdmin } from '../middleware/auth';

const router = express.Router();

router.get('/', getOpportunities);
// Social-preview capsule (server-rendered OG HTML). Registered before /:id so
// "share" is never treated as an opportunity id.
router.get('/share', getSharePreview); //  /api/opportunities/share?id=...
router.get('/:id', getOpportunity);
router.get('/:id/share', getSharePreview); // /api/opportunities/<id>/share
router.post('/', requireAdmin, createManualOpportunity); // POST /api/opportunities (admin create)

export default router;
