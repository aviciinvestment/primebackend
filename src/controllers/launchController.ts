import { Request, Response } from 'express';
import LaunchConfig, { ILaunchConfig } from '../models/LaunchConfig';
import WaitlistEntry from '../models/WaitlistEntry';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COUNTDOWN_MS = 5 * DAY_MS;
const WELCOME_WINDOW_MS = 2 * DAY_MS; // welcome banner is shown for 2 days after launch

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fetch the single launch config, seeding it with defaults on first access.
const getConfig = async (): Promise<ILaunchConfig> => {
  let config = await LaunchConfig.findOne();
  if (!config) {
    config = await LaunchConfig.create({
      launched: false,
      launchedAt: null,
      countdownMs: DEFAULT_COUNTDOWN_MS,
      deadline: new Date(Date.now() + DEFAULT_COUNTDOWN_MS),
      whatsappGroupUrl: '',
    });
  } else if (!config.deadline) {
    config.deadline = new Date(Date.now() + (config.countdownMs || DEFAULT_COUNTDOWN_MS));
    await config.save();
  }
  return config;
};

// If the countdown lapsed and the admin never launched, launch automatically.
// Called from a cron job and defensively from the public status endpoint.
export const autoLaunchIfDue = async (): Promise<ILaunchConfig | null> => {
  try {
    const config = await getConfig();
    if (!config.launched && config.deadline && new Date(config.deadline).getTime() <= Date.now()) {
      config.launched = true;
      config.launchedAt = new Date();
      await config.save();
    }
    return config;
  } catch (error) {
    console.error('autoLaunchIfDue failed:', error);
    return null;
  }
};

const toPublic = (config: ILaunchConfig) => ({
  launched: config.launched,
  launchedAt: config.launchedAt,
  welcomeUntil: config.launchedAt
    ? new Date(new Date(config.launchedAt).getTime() + WELCOME_WINDOW_MS)
    : null,
  countdownMs: config.countdownMs,
  deadline: config.deadline,
  whatsappGroupUrl: config.whatsappGroupUrl,
});

// Public — tells the home page whether to show the waitlist or the feed, plus
// the live waitlist count so the hero can render "X people already joined".
export const getLaunchStatus = async (_req: Request, res: Response) => {
  try {
    await autoLaunchIfDue();
    const config = await getConfig();
    const waitlistCount = await WaitlistEntry.countDocuments();
    res.json({ success: true, ...toPublic(config), waitlistCount });
  } catch (error: any) {
    console.error('Failed to get launch status:', error);
    res.status(500).json({ success: false, error: 'Failed to load launch status.' });
  }
};

// Public — add an email to the waitlist. Duplicates are ignored (upsert on the
// unique email). Returns the updated count so the home page can refresh it, and
// the WhatsApp invite link the user is redirected to after joining.
export const joinWaitlist = async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    await WaitlistEntry.updateOne(
      { email },
      { $setOnInsert: { email } },
      { upsert: true }
    );

    const config = await getConfig();
    const waitlistCount = await WaitlistEntry.countDocuments();
    res.json({
      success: true,
      waitlistCount,
      whatsappGroupUrl: config.whatsappGroupUrl,
    });
  } catch (error: any) {
    console.error('Failed to join waitlist:', error);
    res.status(500).json({ success: false, error: 'Failed to join the waitlist.' });
  }
};

// Admin — full state plus every joined email (newest first).
export const getAdminLaunch = async (_req: Request, res: Response) => {
  try {
    await autoLaunchIfDue();
    const config = await getConfig();
    const entries = await WaitlistEntry.find().sort({ createdAt: -1 }).limit(500).lean();
    res.json({
      success: true,
      ...toPublic(config),
      waitlistCount: entries.length,
      waitlist: entries.map(e => ({ email: e.email, joinedAt: e.createdAt })),
    });
  } catch (error: any) {
    console.error('Failed to load admin launch data:', error);
    res.status(500).json({ success: false, error: 'Failed to load launch data.' });
  }
};

// Admin — launch or unlaunch the app. Unlaunching restarts the countdown.
export const setLaunchState = async (req: Request, res: Response) => {
  try {
    const launched = req.body?.launched === true;
    const config = await getConfig();

    config.launched = launched;
    config.launchedAt = launched ? new Date() : null;
    if (!launched) {
      config.deadline = new Date(Date.now() + (config.countdownMs || DEFAULT_COUNTDOWN_MS));
    }
    await config.save();

    res.json({ success: true, launched: config.launched, deadline: config.deadline });
  } catch (error: any) {
    console.error('Failed to set launch state:', error);
    res.status(500).json({ success: false, error: 'Failed to update launch state.' });
  }
};

// Admin — adjust the countdown. Accepts days or a raw ms duration.
export const setLaunchTimer = async (req: Request, res: Response) => {
  try {
    const { days, countdownMs } = req.body || {};
    let ms: number;
    if (typeof countdownMs === 'number' && countdownMs > 0) {
      ms = countdownMs;
    } else if (typeof days === 'number' && days > 0) {
      ms = days * DAY_MS;
    } else {
      return res.status(400).json({ success: false, error: 'Provide a positive countdownMs or days.' });
    }

    const config = await getConfig();
    config.countdownMs = ms;
    if (!config.launched) {
      // Restart the countdown from now so the change takes effect immediately.
      config.deadline = new Date(Date.now() + ms);
    }
    await config.save();

    res.json({ success: true, countdownMs: config.countdownMs, deadline: config.deadline });
  } catch (error: any) {
    console.error('Failed to set launch timer:', error);
    res.status(500).json({ success: false, error: 'Failed to update the launch timer.' });
  }
};

// Admin — where users get redirected after joining the waitlist (WhatsApp group).
export const setWhatsappGroup = async (req: Request, res: Response) => {
  try {
    const url = String(req.body?.url || '').trim();
    const config = await getConfig();
    config.whatsappGroupUrl = url;
    await config.save();
    res.json({ success: true, whatsappGroupUrl: config.whatsappGroupUrl });
  } catch (error: any) {
    console.error('Failed to set WhatsApp group:', error);
    res.status(500).json({ success: false, error: 'Failed to save the WhatsApp group link.' });
  }
};