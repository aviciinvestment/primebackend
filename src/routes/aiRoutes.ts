import express from 'express';
import multer from 'multer';
import { analyzeCV, getMyCVs, downloadCV, deleteCV, chatWithAI } from '../controllers/aiController';

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
  }
});

router.post('/analyze-cv', upload.single('cv'), analyzeCV);
router.get('/my-cvs', getMyCVs);
router.get('/cv/:cvId/download', downloadCV);
router.delete('/cv/:cvId', deleteCV);
router.post('/chat', chatWithAI);

export default router;
