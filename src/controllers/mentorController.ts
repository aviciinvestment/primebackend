import { Request, Response } from 'express';
import Mentor from '../models/Mentor';
import Mentorship from '../models/Mentorship';

const MENTOR_CUT = 0.9; // mentors keep 90%, platform keeps 10%

export const registerMentor = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.uid;
    const { name, email, company, roleType, careerStory } = req.body;

    if (!company?.trim() || !roleType?.trim() || !careerStory?.trim()) {
      res.status(400).json({ success: false, message: 'Company, role type, and career story are all required.' });
      return;
    }
    if (careerStory.trim().length < 20) {
      res.status(400).json({ success: false, message: 'Career story must be at least 20 characters.' });
      return;
    }

    // (Re)applying always goes through admin review before the user is a mentor.
    const mentor = await Mentor.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          name: name || '',
          email: email || '',
          company: company.trim(),
          roleType: roleType.trim(),
          careerStory: careerStory.trim(),
          status: 'pending',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      success: true,
      status: 'pending',
      message: 'Application submitted. An admin will review it before you are approved as a mentor.',
      mentor,
    });
  } catch (error: any) {
    console.error('Error registering mentor:', error);
    res.status(500).json({ success: false, message: 'Failed to register as mentor.' });
  }
};

export const getMentorProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.uid;

    const mentor = await Mentor.findOne({ userId }).lean();
    res.json({
      success: true,
      isMentor: !!mentor && mentor.status === 'approved',
      mentor: mentor || null,
    });
  } catch (error: any) {
    console.error('Error fetching mentor profile:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch mentor profile.' });
  }
};

// Match a paid mentorship request to the best approved mentor. The opportunity
// type/category the mentee is applying for decides the mentor: we score every
// approved mentor against the request text (type + category + title) and pick
// the strongest keyword overlap, tie-breaking toward the least-loaded mentor.
export const assignMentorToMentee = async (mentorship: any) => {
  const approved = await Mentor.find({ status: 'approved' }).lean();
  if (approved.length === 0) return;

  const requestText = [
    mentorship.opportunityType,
    mentorship.opportunityCategory,
    mentorship.opportunityTitle,
  ].filter(Boolean).join(' ');

  const tokens = (text: string): Set<string> =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2)
    );
  const requestTokens = tokens(requestText);

  const scored: Array<{ mentor: any; score: number; load: number }> = [];
  for (const mentor of approved) {
    const mentorText = `${mentor.roleType} ${mentor.company} ${mentor.careerStory || ''}`;
    const mentorTokens = tokens(mentorText);
    let score = 0;
    for (const token of requestTokens) {
      if (mentorTokens.has(token)) score += 1;
    }

    if (score === 0) continue;

    const load = await Mentorship.countDocuments({ mentorId: mentor.userId, status: 'paid' });
    scored.push({ mentor, score, load });
  }

  if (scored.length === 0) return;

  scored.sort((a, b) => b.score - a.score || a.load - b.load);
  const chosen = scored[0].mentor;

  mentorship.mentorId = chosen.userId;
  mentorship.mentorName = chosen.name || (chosen.email || 'Mentor').split('@')[0];
  await mentorship.save();
};

export const getMentorDashboard = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.uid;

    const mentor = await Mentor.findOne({ userId }).lean();
    if (!mentor || mentor.status !== 'approved') {
      res.status(403).json({
        success: false,
        message: 'Only approved mentors can access the mentor dashboard.',
      });
      return;
    }

    const myMentees = await Mentorship.find({ mentorId: userId, status: 'paid' }).sort({ createdAt: -1 }).lean();
    // Least privilege (S7): the open-requests pool is visible to every approved
    // mentor, so the DB projection NEVER selects PII — userEmail and reference
    // (and any other payment/user fields) are not fetched at all, not merely
    // omitted from the JSON response. Only non-PII transaction metrics needed
    // for mentoring assignments are exposed.
    const openRequests = await Mentorship.find(
      { status: 'paid', mentorId: null },
      {
        _id: 1,
        opportunityId: 1,
        opportunityTitle: 1,
        opportunityOrg: 1,
        opportunityType: 1,
        opportunityCategory: 1,
        userName: 1,
        amount: 1,
        currency: 1,
        note: 1,
        createdAt: 1,
      }
    )
      .sort({ createdAt: -1 })
      .lean();

    const totalPaid = myMentees.reduce((sum, m) => sum + (m.amount || 0), 0);

    // Strip PII from the open-requests pool: those listings are visible to
    // every approved mentor (not yet assigned), so no email or payment
    // reference may be exposed. Mentor assignment happens by opportunity.
    const redactOpenRequest = (r: any) => ({
      _id: r._id,
      opportunityId: r.opportunityId || null,
      opportunityTitle: r.opportunityTitle || '',
      opportunityOrg: r.opportunityOrg || '',
      opportunityType: r.opportunityType || '',
      opportunityCategory: r.opportunityCategory || '',
      userName: r.userName ? `${r.userName.charAt(0)}***` : '',
      amount: r.amount || 0,
      currency: r.currency || 'NGN',
      note: r.note || '',
      createdAt: r.createdAt,
    });

    res.json({
      success: true,
      mentor,
      myMentees,
      openRequests: openRequests.map(redactOpenRequest),
      totalMentees: myMentees.length,
      totalEarned: totalPaid * MENTOR_CUT,
    });
  } catch (error: any) {
    console.error('Error fetching mentor dashboard:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch mentor dashboard.' });
  }
};