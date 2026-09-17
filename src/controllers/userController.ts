import { Request, Response } from 'express';
import AppUser from '../models/AppUser';
import Mentor from '../models/Mentor';

// Firestore/Firebase UIDs that should always be admins (comma-separated).
const ADMIN_UIDS = new Set(
  (process.env.ADMIN_UIDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// Accept only https (or empty) avatar URLs, capped to a sane size. Prevents
// javascript:/data: URLs or megabyte strings from being persisted and later
// rendered as an <img src> or dumped into DB/admin pages (A-08).
const sanitizePhotoUrl = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https:\/\/.+/i.test(raw) && raw.length <= 2048) return raw;
  return '';
};

// Upsert the Firebase identity into the app-user registry on login. Nobody is
// ever auto-promoted (not even the first user): admin is granted only to UIDs
// listed in ADMIN_UIDS, so there is no race where a random early signup owns
// the account.
export const syncUser = async (req: Request, res: Response) => {
  try {
    const uid = req.authUser!.uid;
    const { email, displayName, photoURL } = req.body || {};

    const role: 'user' | 'admin' = ADMIN_UIDS.has(String(uid)) ? 'admin' : 'user';

    const user = await AppUser.findOneAndUpdate(
      { uid: String(uid) },
      {
        $set: {
          email: String(email || ''),
          displayName: String(displayName || '').slice(0, 120),
          photoURL: sanitizePhotoUrl(photoURL),
        },
        $setOnInsert: { role },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    // Honor ADMIN_UIDS for existing users too.
    if (ADMIN_UIDS.has(String(uid)) && user.role !== 'admin') {
      user.role = 'admin';
      await user.save();
    }

    const isMentor = !!(await Mentor.findOne({ userId: String(uid), status: 'approved' }).lean());

    res.json({
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: user.role,
        isMentor,
      },
    });
  } catch (error: any) {
    console.error('Failed to sync user:', error);
    res.status(500).json({ success: false, error: 'Failed to sync user.' });
  }
};

export const getUser = async (req: Request, res: Response) => {
  try {
    const uid = req.authUser!.uid;

    const user = await AppUser.findOne({ uid }).lean();
    res.json({
      success: true,
      user: user
        ? { uid: user.uid, email: user.email, displayName: user.displayName, role: user.role }
        : null,
    });
  } catch (error: any) {
    console.error('Failed to fetch user:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user.' });
  }
};

// Record whether a user is interested in paid mentorship (the "coming soon"
// page asks Yes/No). The answer surfaces on the admin user list.
export const recordMentorshipInterest = async (req: Request, res: Response) => {
  try {
    const uid = req.authUser!.uid;
    const { choice, source, opportunityTitle, opportunityUrl } = req.body || {};
    if (choice !== 'yes' && choice !== 'no') {
      return res.status(400).json({ success: false, error: 'choice must be "yes" or "no".' });
    }

    const user = await AppUser.findOneAndUpdate(
      { uid: String(uid) },
      {
        $set: {
          mentorshipInterest: {
            choice,
            source: source === 'opportunity' ? 'opportunity' : 'general',
            opportunityTitle: String(opportunityTitle || ''),
            opportunityUrl: String(opportunityUrl || ''),
            answeredAt: new Date(),
          },
        },
        $setOnInsert: { role: 'user' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, mentorshipInterest: user ? user.mentorshipInterest : null });
  } catch (error: any) {
    console.error('Failed to record mentorship interest:', error);
    res.status(500).json({ success: false, error: 'Failed to record mentorship interest.' });
  }
};