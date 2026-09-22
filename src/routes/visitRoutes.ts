import express from 'express';
import { recordVisit } from '../controllers/visitsController';

const router = express.Router();

// Public: called by the client once per browser session to record a page visit.
// The per-IP apiLimiter (mounted on /api) already caps abuse.
router.post('/', recordVisit);

export default router;