import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

const errorJson = (req: Request, res: Response) => {
  res.status(429).json({ success: false, error: 'Too many requests. Please try again shortly.' });
};

// Global ceiling for the whole API per IP.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: errorJson,
});

// Stricter limits for expensive / abuse-prone endpoints.
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: errorJson,
});

// Very tight limit for the manual sync trigger and legacy auth endpoints.
export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: errorJson,
});