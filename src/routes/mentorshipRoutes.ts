import express from 'express';
import {
  getMentorshipConfig,
  createMentorshipRequest,
  getMentorships,
} from '../controllers/mentorshipController';

const router = express.Router();

router.get('/config', getMentorshipConfig);
router.get('/', getMentorships);
router.post('/', createMentorshipRequest);

export default router;