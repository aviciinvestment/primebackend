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

// Upsert the Firebase identity into the app-user registry on login. The very
// first user ever registered becomes an admin so there is always someone who
// can approve mentors and manage the platform.
export const syncUser = async (req: Request, res: Response) => {
  try {
    const { uid, email, displayName, photoURL } = req.body || {};
    if (!uid) {
      return res.status(400).json({ success: false, error: 'uid is required.' });
    }

    const isFirstUser = (await AppUser.countDocuments()) === 0;
    const role: 'user' | 'admin' =
      isFirstUser || ADMIN_UIDS.has(String(uid)) ? 'admin' : 'user';

    const user = await AppUser.findOneAndUpdate(
      { uid: String(uid) },
      {
        $set: {
          email: String(email || ''),
          displayName: String(displayName || ''),
          photoURL: String(photoURL || ''),
        },
        $setOnInsert: { role },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        // Existing docs keep whatever role they had unless they match ADMIN_UIDS.
        ...(ADMIN_UIDS.has(String(uid)) ? {} : {}),
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
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ success: false, error: 'uid is required.' });

    const user = await AppUser.findOne({ uid: String(uid) }).lean();
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