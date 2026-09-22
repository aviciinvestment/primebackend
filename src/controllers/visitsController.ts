import { createHash } from 'crypto';
import { Request, Response } from 'express';
import PageVisit from '../models/PageVisit';

// Visit analytics: a public "record a visit" endpoint + an admin-only stats
// endpoint. Human IPs are hashed before they reach the DB (no raw IPs stored).

// Stable per-visitor key: sha256 of the client IP (preferring the
// Cloudflare-provided header when present). Hashing keeps the raw address out
// of the database while still letting us count unique visitors.
const hashVisitorKey = (ip: string): string =>
  createHash('sha256').update(String(ip || 'unknown')).digest('hex');

const clamp = (value: unknown, max: number): string =>
  String(value ?? '').slice(0, max);

// Registered by the client once per browser session. Recording a visit must
// NEVER affect the app: failures are swallowed and the client still gets 200.
export const recordVisit = async (req: Request, res: Response) => {
  try {
    const cfIp = (req.headers['cf-connecting-ip'] as string) || '';
    const ip = cfIp || req.ip || req.socket.remoteAddress || 'unknown';
    await PageVisit.create({
      visitorKey: hashVisitorKey(ip),
      path: clamp(req.body?.path, 300) || '/',
      referrer: clamp(req.body?.referrer, 300),
      userAgent: clamp(req.headers['user-agent'], 300),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to record visit:', error);
    res.status(200).json({ success: true });
  }
};

// Admin dashboard stats: lifetime totals plus a zero-filled 14-day daily series
// (visits + unique visitors per day) for the trend chart.
export const getVisitStats = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const start14d = new Date(startToday);
    start14d.setDate(startToday.getDate() - 13);

    const [totalVisits, uniqueVisitors, visitsToday, uniqueToday] = await Promise.all([
      PageVisit.countDocuments(),
      PageVisit.distinct('visitorKey'),
      PageVisit.countDocuments({ createdAt: { $gte: startToday } }),
      PageVisit.distinct('visitorKey', { createdAt: { $gte: startToday } }),
    ]);

    const dailyRows = await PageVisit.aggregate<{
      _id: string;
      visits: number;
      unique: number;
    }>([
      { $match: { createdAt: { $gte: start14d } } },
      {
        $project: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          visitorKey: 1,
        },
      },
      { $group: { _id: { day: '$day', visitorKey: '$visitorKey' }, visits: { $sum: 1 } } },
      { $group: { _id: '$_id.day', visits: { $sum: '$visits' }, unique: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const byDay = new Map(dailyRows.map(r => [r._id, { visits: r.visits, unique: r.unique }]));

    // Zero-fill so every day of the window is present, even when no one visited.
    const daily: Array<{ date: string; visits: number; unique: number }> = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(startToday);
      d.setDate(startToday.getDate() - (13 - i));
      const key = d.toISOString().slice(0, 10);
      const row = byDay.get(key);
      daily.push({ date: key, visits: row?.visits ?? 0, unique: row?.unique ?? 0 });
    }

    res.json({
      success: true,
      totalVisits,
      uniqueVisitors: uniqueVisitors.length,
      visitsToday,
      uniqueToday: uniqueToday.length,
      daily,
    });
  } catch (error: any) {
    console.error('Failed to load visit stats:', error);
    res.status(500).json({ success: false, error: 'Failed to load visit stats.' });
  }
};