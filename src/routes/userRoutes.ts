import express from 'express';
import { syncUser, getUser } from '../controllers/userController';

const router = express.Router();

router.post('/', syncUser);
router.get('/', getUser);

export default router;