import express from 'express';
import { registerMentor, getMentorProfile } from '../controllers/mentorController';

const router = express.Router();

router.post('/register', registerMentor);
router.get('/profile', getMentorProfile);

export default router;