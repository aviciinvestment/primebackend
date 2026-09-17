import express from 'express';
import { getLaunchStatus, joinWaitlist } from '../controllers/launchController';
import { waitlistLimiter } from '../middleware/rateLimit';

const router = express.Router();

router.get('/status', getLaunchStatus);
router.post('/waitlist', waitlistLimiter, joinWaitlist);

export default router;