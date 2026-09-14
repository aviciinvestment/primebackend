import express from 'express';
import { getOpportunities, getOpportunity } from '../controllers/opportunityController';

const router = express.Router();

router.get('/', getOpportunities);
router.get('/:id', getOpportunity);

export default router;
