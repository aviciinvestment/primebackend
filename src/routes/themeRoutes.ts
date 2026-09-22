import express from 'express';
import { getTheme } from '../controllers/themeController';

// Public (no auth): lets every visitor resolve the global theme so the look the
// admin picked is reflected on everyone's page.
const router = express.Router();

router.get('/', getTheme);

export default router;