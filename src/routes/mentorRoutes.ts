import express from 'express';
import {
  registerMentor,
  getMentorProfile,
  getMentorDashboard,
} from '../controllers/mentorController';

const router = express.Router();

router.post('/register', registerMentor);
router.get('/profile', getMentorProfile);
router.get('/dashboard', getMentorDashboard);

export default router;