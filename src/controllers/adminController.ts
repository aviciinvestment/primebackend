import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import AppUser from '../models/AppUser';
import Mentor from '../models/Mentor';
import Mentorship from '../models/Mentorship';
import MentorshipComplaint from '../models/MentorshipComplaint';

const PLATFORM_CUT = 0.1; // platform keeps 10% of every mentee payment

// Admin list pagination: bounded page/limit parsing (B-05). The admin list
// endpoints used to return the ENTIRE table per request; as users/mentees grow
// that meant megabyte JSON payloads and unbounded sort/skip work. Defaults to
// 100 rows/page, clamped to 200, with the pages/total the client needs for
// "load more" buttons.
const ADMIN_LIST_LIMIT = 100;
const ADMIN_LIST_MAX_LIMIT = 200;

const parsePagination = (req: Request): { page: number; limit: number; skip: number } => {
  const rawPage = parseInt(String(req.query.page ?? ''), 10);
  const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1
    ? Math.min(rawLimit, ADMIN_LIST_MAX_LIMIT)
    : ADMIN_LIST_LIMIT;
  return { page, limit, skip: (page - 1) * limit };
};

export const getOverview = async (_req: Request, res: Response) => {
  try {
    const [totalUsers, totalMentors, pendingMentorApplications, totalMentees, revenueAgg] =
      await Promise.all([
        AppUser.countDocuments(),
        Mentor.countDocuments({ status: 'approved' }),
        Mentor.countDocuments({ status: 'pending' }),
        Mentorship.countDocuments({ status: 'paid', mentorId: { $ne: null } }),
        Mentorship.aggregate<{ gross: number; count: number }>([
          { $match: { status: 'paid' } },
          { $group: { _id: null, gross: { $sum: { $ifNull: ['$amount', 0] } }, count: { $sum: 1 } } },
        ]),
      ]);

    const grossRevenue = revenueAgg[0]?.gross ?? 0;
    const paidMenteeCount = revenueAgg[0]?.count ?? 0;

    res.json({
      success: true,
      totalUsers,
      totalMentors,
      pendingMentorApplications,
      totalMentees,
      paidMenteeCount,
      grossRevenue,
      platformRevenue: grossRevenue * PLATFORM_CUT,
      mentorPayout: grossRevenue * (1 - PLATFORM_CUT),
    });
  } catch (error: any) {
    console.error('Failed to load admin overview:', error);
    res.status(500).json({ success: false, error: 'Failed to load overview.' });
  }
};

export const listUsers = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const [users, total] = await Promise.all([
      AppUser.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AppUser.countDocuments(),
    ]);
    res.json({
      success: true,
      users: users.map(u => ({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        photoURL: u.photoURL,
        role: u.role,
        createdAt: u.createdAt,
        mentorshipInterest: u.mentorshipInterest || null,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    console.error('Failed to list users:', error);
    res.status(500).json({ success: false, error: 'Failed to list users.' });
  }
};

export const listMentors = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const [mentors, total] = await Promise.all([
      Mentor.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Mentor.countDocuments(),
    ]);

    // One aggregation for every mentor's paid count + gross instead of N+1 queries.
    const stats = await Mentorship.aggregate<{ mentorId: string; total: number; gross: number }>([
      { $match: { status: 'paid', mentorId: { $ne: null } } },
      { $group: { _id: '$mentorId', total: { $sum: 1 }, gross: { $sum: { $ifNull: ['$amount', 0] } } } },
    ]);
    const statsByMentor = new Map(stats.map(s => [s._id, s]));

    const results = mentors.map(m => {
      const stat = statsByMentor.get(m.userId);
      const menteesCount = stat?.total ?? 0;
      const gross = stat?.gross ?? 0;
      return {
        userId: m.userId,
        name: m.name,
        email: m.email,
        company: m.company,
        roleType: m.roleType,
        careerStory: m.careerStory,
        status: m.status,
        menteesCount,
        accountBalance: gross * (1 - PLATFORM_CUT),
        createdAt: m.createdAt,
      };
    });

    res.json({ success: true, mentors: results, total, page, pages: Math.ceil(total / limit) });
  } catch (error: any) {
    console.error('Failed to list mentors:', error);
    res.status(500).json({ success: false, error: 'Failed to list mentors.' });
  }
};

export const listMentees = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const [requests, total] = await Promise.all([
      Mentorship.find({ status: 'paid' }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Mentorship.countDocuments({ status: 'paid' }),
    ]);
    res.json({
      success: true,
      mentees: requests.map(r => ({
        id: r._id,
        userName: r.userName,
        userEmail: r.userEmail,
        opportunityTitle: r.opportunityTitle,
        opportunityOrg: r.opportunityOrg,
        opportunityType: r.opportunityType,
        mentorId: r.mentorId,
        mentorName: r.mentorName,
        amount: r.amount,
        currency: r.currency,
        platformCut: (r.amount || 0) * PLATFORM_CUT,
        mentorCut: (r.amount || 0) * (1 - PLATFORM_CUT),
        reference: r.reference,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    console.error('Failed to list mentees:', error);
    res.status(500).json({ success: false, error: 'Failed to list mentees.' });
  }
};

export const promoteUser = async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const user = await AppUser.findOne({ uid });
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    user.role = 'admin';
    await user.save();

    res.json({ success: true, user: { uid: user.uid, email: user.email, displayName: user.displayName, role: user.role } });
  } catch (error: any) {
    console.error('Failed to promote user:', error);
    res.status(500).json({ success: false, error: 'Failed to promote user.' });
  }
};

export const listComplaints = async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const filter = status === 'open' || status === 'resolved' ? { status } : {};
    const complaints = await MentorshipComplaint.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({
      success: true,
      complaints: complaints.map(c => ({
        id: c._id,
        ticket: c.ticket,
        userId: c.userId,
        userEmail: c.userEmail,
        userName: c.userName,
        message: c.message,
        payments: c.payments,
        status: c.status,
        createdAt: c.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('Failed to list complaints:', error);
    res.status(500).json({ success: false, error: 'Failed to list complaints.' });
  }
};

export const resolveComplaint = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid complaint id.' });
    }

    const complaint = await MentorshipComplaint.findByIdAndUpdate(
      id,
      { status: 'resolved' },
      { new: true }
    );
    if (!complaint) {
      return res.status(404).json({ success: false, error: 'Complaint not found.' });
    }

    res.json({ success: true, complaint });
  } catch (error: any) {
    console.error('Failed to resolve complaint:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve complaint.' });
  }
};

// A user is only declared a mentor once an admin accepts their application.
export const reviewMentorApplication = async (req: Request, res: Response) => {
  try {
    const { uid, action } = req.params; // action: 'approve' | 'reject'
    const mentor = await Mentor.findOne({ userId: uid });
    if (!mentor) return res.status(404).json({ success: false, error: 'Mentor application not found.' });

    if (action === 'approve') {
      mentor.status = 'approved';
    } else if (action === 'reject') {
      mentor.status = 'rejected';
    } else {
      return res.status(400).json({ success: false, error: 'Action must be approve or reject.' });
    }
    await mentor.save();

    const appUser = await AppUser.findOne({ uid });
    res.json({
      success: true,
      message: action === 'approve' ? 'Mentor approved.' : 'Mentor application rejected.',
      mentor,
      appUser,
    });
  } catch (error: any) {
    console.error('Failed to review mentor application:', error);
    res.status(500).json({ success: false, error: 'Failed to review mentor application.' });
  }
};