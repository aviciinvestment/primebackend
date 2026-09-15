import { Request, Response } from 'express';
import Application, { ApplicationStatus } from '../models/Application';

const VALID_STATUSES: ApplicationStatus[] = ['saved', 'applied', 'interview', 'accepted', 'rejected'];

const populateApplication = (app: any) => {
  const opp = app.opportunityId?._doc || app.opportunityId;
  return {
    _id: app._id.toString(),
    opportunityId: (app.opportunityId?._id || app.opportunityId)?.toString(),
    status: app.status,
    clicked: app.clicked,
    clickedAt: app.clickedAt || null,
    dateApplied: app.dateApplied || null,
    updatedAt: app.updatedAt || null,
    opportunity: opp ? { ...opp } : null,
  };
};

// @desc    Get a user's applications (with populated opportunities)
// @route   GET /api/applications?userId=...
// @access  Public (scoped by userId param; matches existing CV convention)
export const getApplications = async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || '';
    if (!userId) {
      res.status(400).json({ success: false, message: 'userId is required' });
      return;
    }

    const apps = await Application.find({ userId }).populate('opportunityId').sort({ updatedAt: -1 });

    res.json({ success: true, count: apps.length, data: apps.map(populateApplication) });
  } catch (error: any) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};

// @desc    Create/update a user's application record for one opportunity
// @route   POST /api/applications
// @access  Public (scoped by userId in body)
//
// Body: { userId, opportunityId, status?, clicked? }
//  - status: 'saved' | 'applied' | 'interview' | 'accepted' | 'rejected'
//  - clicked: true when the user opened the opportunity link (visited marker)
export const upsertApplication = async (req: Request, res: Response) => {
  try {
    const userId = (req.body?.userId as string) || '';
    const opportunityId = (req.body?.opportunityId as string) || '';
    const status = req.body?.status as ApplicationStatus | undefined;
    const clicked = req.body?.clicked === true;

    if (!userId || !opportunityId) {
      res.status(400).json({ success: false, message: 'userId and opportunityId are required' });
      return;
    }
    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    const existing = await Application.findOne({ userId, opportunityId });

    if (!existing) {
      // First interaction with this opportunity: fresh record defaults to
      // 'saved' unless an explicit status was chosen.
      const record = await Application.create({
        userId,
        opportunityId,
        status: status || 'saved',
        clicked,
        clickedAt: clicked ? new Date() : undefined,
        dateApplied: status === 'applied' ? new Date() : undefined,
      });
      const populated = await record.populate('opportunityId');
      res.status(201).json({ success: true, data: populateApplication(populated) });
      return;
    }

    const updates: any = {};
    if (status && status !== existing.status) {
      updates.status = status;
      if (status === 'applied' && !existing.dateApplied) {
        updates.dateApplied = new Date();
      }
    }
    if (clicked) {
      updates.clicked = true;
      updates.clickedAt = new Date();
    }

    if (Object.keys(updates).length > 0) {
      Object.assign(existing, updates);
      await existing.save();
    }

    const populated = await existing.populate('opportunityId');
    res.json({ success: true, data: populateApplication(populated) });
  } catch (error: any) {
    console.error('Error upserting application:', error);
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};