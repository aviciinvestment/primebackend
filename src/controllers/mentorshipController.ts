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
      note,
    } = req.body || {};

    const userId = req.authUser!.uid;
    if (!reference) {
      return res.status(400).json({ success: false, error: 'Payment reference is required.' });
    }

    // Only real Paystack transactions are accepted. The deprecated 'demo'
    // provider (which auto-marked requests as paid without money changing
    // hands) is closed so a request can never reach 'paid' without a genuine,
    // server-verified payment.
    if (provider !== 'paystack') {
      return res.status(400).json({ success: false, error: 'Unknown payment provider.' });
    }
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(400).json({
        success: false,
        error: 'Card payments are not enabled yet. Please try again later.',
      });
    }

    // A mentorship request never starts as 'paid'. It becomes 'paid' only after
    // server-side transaction verification / webhook confirms the Paystack charge.
    let status: 'pending' | 'paid' | 'failed' = 'pending';

    // Guard against forged amounts: a mentorship request must match the
    // configured package price (or be recorded as failed).
    const expectedAmount = GUIDANCE_AMOUNT;
    const finalAmount = Number(amount);
    if (!Number.isFinite(finalAmount) || finalAmount < 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount.' });
    }
    if (finalAmount !== expectedAmount) {
      status = 'failed';
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
      amount: finalAmount,
      currency: currency || GUIDANCE_CURRENCY,
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
    const userId = req.authUser!.uid;

    const records = await Mentorship.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, count: records.length, data: records });
  } catch (error: any) {
    console.error('Failed to list mentorship requests:', error);
    res.status(500).json({ success: false, error: 'Failed to list mentorship requests.' });
  }
};