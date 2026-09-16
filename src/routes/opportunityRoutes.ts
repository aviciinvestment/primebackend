import express from 'express';
import { getOpportunities, getOpportunity } from '../controllers/opportunityController';
import { getSharePreview } from '../controllers/socialPreviewController';

const router = express.Router();

router.get('/', getOpportunities);
// Social-preview capsule (server-rendered OG HTML). Registered before /:id so
// "share" is never treated as an opportunity id.
router.get('/share', getSharePreview); //  /api/opportunities/share?id=...
router.get('/:id', getOpportunity);
router.get('/:id/share', getSharePreview); // /api/opportunities/<id>/share

export default router;
