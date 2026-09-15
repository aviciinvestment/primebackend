import type { NextFunction, Request, Response } from 'express';
import { getAdminAuth } from '../lib/firebaseAdmin';
import AppUser from '../models/AppUser';

// Verified Firebase identity attached to the request by requireAuth/requireAdmin.
// Controllers must use `req.authUser.uid` — never a client-supplied userId.
interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

const BEARER_RE = /^Bearer\s+(.+)$/i;

// Parse + verify a Firebase ID token and return the verified identity.
const verifyToken = async (req: Request): Promise<AuthUser> => {
  const header = req.headers.authorization || '';
  const match = BEARER_RE.exec(header);
  if (!match?.[1]) {
    const err: any = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }

  const decoded = await getAdminAuth().verifyIdToken(match[1].trim());
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    emailVerified: !!decoded.email_verified,
  };
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    req.authUser = await verifyToken(req);
    return next();
  } catch (error: any) {
    return res
      .status(error?.status || 401)
      .json({ success: false, error: error?.status === 401 ? 'Authentication required.' : 'Invalid or expired session.' });
  }
};

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    req.authUser = await verifyToken(req);

    const user = await AppUser.findOne({ uid: req.authUser.uid }).lean();
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access only.' });
    }

    return next();
  } catch (error: any) {
    return res
      .status(error?.status || 401)
      .json({ success: false, error: error?.status === 401 ? 'Authentication required.' : 'Invalid or expired session.' });
  }
};