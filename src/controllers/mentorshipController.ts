import { Request, Response } from 'express';
import Mentorship from '../models/Mentorship';
import { assignMentorToMentee } from './mentorController';

// Guidance session package offered on the mentorship checkout page.
// Client mirrors this via GET /api/mentorships/config.
const GUIDANCE_AMOUNT = parseInt(process.env.MENTORSHIP_FEE || '20000', 10) || 20000;
const GUIDANCE_CURRENCY = process.env.MENTORSHIP_CURRENCY || 'NGN';

export const getMentorshipConfig = (_req: Request, res: Response) => {
  res.json({
    success: true,
    amount: GUIDANCE_AMOUNT,
    currency: GUIDANCE_CURRENCY,
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || null,
  });
};

export const createMentorshipRequest = async (req: Request, res: Response) => {
  try {
    const {
      userId,
      userEmail,
      userName,
      opportunityId,
      opportunityTitle,
      opportunityOrg,
      opportunityUrl,
      opportunityType,
      opportunityCategory,
      amount,
      currency,
      provider,
      reference,
      status,
      note,
    } = req.body || {};

    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required.' });
    }
    if (!reference) {
      return res.status(400).json({ success: false, error: 'Payment reference is required.' });
    }

    const record = await Mentorship.create({
      userId,
      userEmail,
      userName,
      opportunityId,
      opportunityTitle,
      opportunityOrg,
      opportunityUrl,
      opportunityType,
      opportunityCategory,
      amount,
      currency,
      provider,
      reference,
      status,
      note,
    });

    // Paid requests get a mentor assigned based on the type of scholarship the
    // mentee is applying for. Leave the request unassigned if no mentor fits.
    if (record.status === 'paid') {
      try {
        await assignMentorToMentee(record);
      } catch (err: any) {
        console.error('Mentor assignment failed:', err?.message);
      }
    }

    res.status(201).json({ success: true, data: record });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, error: 'That payment reference was already recorded.' });
    }
    console.error('Failed to create mentorship request:', error);
    res.status(500).json({ success: false, error: 'Failed to create mentorship request.' });
  }
};

export const getMentorships = async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required.' });

    const records = await Mentorship.find({ userId: String(userId) }).sort({ createdAt: -1 });
    res.json({ success: true, count: records.length, data: records });
  } catch (error: any) {
    console.error('Failed to list mentorship requests:', error);
    res.status(500).json({ success: false, error: 'Failed to list mentorship requests.' });
  }
};