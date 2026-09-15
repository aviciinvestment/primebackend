import express from 'express';
import { getApplications, upsertApplication } from '../controllers/applicationController';

const router = express.Router();

router.get('/', getApplications);
router.post('/', upsertApplication);

export default router;