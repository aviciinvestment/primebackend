import express from 'express';
import { syncUser, getUser, recordMentorshipInterest } from '../controllers/userController';

const router = express.Router();

router.post('/', syncUser);
router.get('/', getUser);
router.post('/mentorship-interest', recordMentorshipInterest);

export default router;