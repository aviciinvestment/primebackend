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
  logChat,
} from '../controllers/aiController';
import { requireAuth } from '../middleware/auth';
import { cvAnalyzeLimiter } from '../middleware/rateLimit';

const router = express.Router();

// Configure multer for memory storage (we just need the buffer)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  // First boundary layer: accept only PDF-claimed uploads. Note multer's
  // fileFilter runs BEFORE the file buffer exists, so it can only trust the
  // declared Content-Type — browsers legitimately send application/pdf, but
  // some clients label PDFs as application/octet-stream. The authoritative
  // check is the %PDF- magic-byte gate in analyzeCV, which runs on the actual
  // buffer before pdf-parse (second boundary layer).
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

// Every AI endpoint is keyed to the authenticated user's identity. The CV
// analyzer is the most expensive route (PDF parse + embed + Pinecone + LLM),
// so it gets its own aggressive limiter before any file is processed.
router.post('/analyze-cv', cvAnalyzeLimiter, requireAuth, upload.single('cv'), analyzeCV);
router.get('/my-cvs', requireAuth, getMyCVs);
router.get('/cv/:cvId/download', requireAuth, downloadCV);
router.delete('/cv/:cvId', requireAuth, deleteCV);
router.post('/chat', requireAuth, chatWithAI);

// DB-backed endpoints consumed by the Cloudflare Worker chat pipeline.
router.post('/opportunity-context', requireAuth, getRetrievedOpportunityContext);
router.post('/mentorship-complaint', requireAuth, recordMentorshipComplaint);

// The Worker streamed a reply itself — log the finished exchange here so the
// admin Chat Activity feed covers worker-side chats too. Same identity rules:
// the forwarded Firebase token is verified, so the log row can't be forged.
router.post('/chat-log', requireAuth, logChat);

export default router;