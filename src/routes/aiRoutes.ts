import express from 'express';
import multer from 'multer';
import {
  analyzeCV,
  getMyCVs,
  downloadCV,
  deleteCV,
  chatWithAI,
  getRetrievedOpportunityContext,
  recordMentorshipComplaint,
} from '../controllers/aiController';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

// Configure multer for memory storage (we just need the buffer)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

// Every AI endpoint is keyed to the authenticated user's identity.
router.post('/analyze-cv', requireAuth, upload.single('cv'), analyzeCV);
router.get('/my-cvs', requireAuth, getMyCVs);
router.get('/cv/:cvId/download', requireAuth, downloadCV);
router.delete('/cv/:cvId', requireAuth, deleteCV);
router.post('/chat', requireAuth, chatWithAI);

// DB-backed endpoints consumed by the Cloudflare Worker chat pipeline.
router.post('/opportunity-context', requireAuth, getRetrievedOpportunityContext);
router.post('/mentorship-complaint', requireAuth, recordMentorshipComplaint);

export default router;