import express from 'express';
import {
  registerMentor,
  getMentorProfile,
  getMentorDashboard,
} from '../controllers/mentorController';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

router.post('/register', requireAuth, registerMentor);
router.get('/profile', requireAuth, getMentorProfile);
router.get('/dashboard', requireAuth, getMentorDashboard);

export default router;