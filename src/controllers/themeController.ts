import { Request, Response } from 'express';
import ThemeConfig, { ThemeId } from '../models/ThemeConfig';

const VALID_THEMES: ThemeId[] = ['light', 'dark', 'midnight'];

// A single global config record: first access creates it, every read reuses it.
const getConfig = async () => {
  let config = await ThemeConfig.findOne();
  if (!config) {
    config = await ThemeConfig.create({ theme: 'dark' });
  }
  return config;
};

// Public: every page fetches this on load and applies it, so the theme the
// admin chose is reflected everywhere. Short cache — it is served off Cloudflare.
export const getTheme = async (_req: Request, res: Response) => {
  try {
    const config = await getConfig();
    res.setHeader('Cache-Control', 'public, max-age=15');
    res.json({ success: true, theme: config.theme });
  } catch (error: any) {
    console.error('Failed to load theme:', error);
    res.status(500).json({ success: false, error: 'Failed to load theme.' });
  }
};

// Admin-only (mounted under the requireAdmin router): switch the global theme.
export const setTheme = async (req: Request, res: Response) => {
  try {
    const raw = String(req.body?.theme ?? '');
    if (!VALID_THEMES.includes(raw as ThemeId)) {
      return res.status(400).json({
        success: false,
        error: 'Theme must be one of: light, dark, midnight.',
      });
    }
    const config = await getConfig();
    config.theme = raw as ThemeId;
    await config.save();
    res.json({ success: true, theme: config.theme });
  } catch (error: any) {
    console.error('Failed to update theme:', error);
    res.status(500).json({ success: false, error: 'Failed to update theme.' });
  }
};