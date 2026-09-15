import express from 'express';
import { getApplications, upsertApplication } from '../controllers/applicationController';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

router.get('/', requireAuth, getApplications);
router.post('/', requireAuth, upsertApplication);

export default router;