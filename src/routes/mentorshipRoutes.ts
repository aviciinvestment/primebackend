import express from 'express';
import {
  getMentorshipConfig,
  createMentorshipRequest,
  getMentorships,
} from '../controllers/mentorshipController';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

router.get('/config', getMentorshipConfig);
router.get('/', requireAuth, getMentorships);
router.post('/', requireAuth, createMentorshipRequest);

export default router;