import express from 'express';
import { syncUser, getUser, recordMentorshipInterest } from '../controllers/userController';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

router.post('/', requireAuth, syncUser);
router.get('/', requireAuth, getUser);
router.post('/mentorship-interest', requireAuth, recordMentorshipInterest);

export default router;