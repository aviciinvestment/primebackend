import express from 'express';
import { getLaunchStatus, joinWaitlist } from '../controllers/launchController';

const router = express.Router();

router.get('/status', getLaunchStatus);
router.post('/waitlist', joinWaitlist);

export default router;