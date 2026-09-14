import { Request, Response } from 'express';
import Mentor from '../models/Mentor';

export const registerMentor = async (req: Request, res: Response) => {
  try {
    const { userId, name, email, company, roleType, careerStory } = req.body;

    if (!userId) {
      res.status(400).json({ success: false, message: 'userId is required.' });
      return;
    }
    if (!company?.trim() || !roleType?.trim() || !careerStory?.trim()) {
      res.status(400).json({ success: false, message: 'Company, role type, and career story are all required.' });
      return;
    }
    if (careerStory.trim().length < 20) {
      res.status(400).json({ success: false, message: 'Career story must be at least 20 characters.' });
      return;
    }

    const mentor = await Mentor.findOneAndUpdate(
      { userId },
      {
        userId,
        name: name || '',
        email: email || '',
        company: company.trim(),
        roleType: roleType.trim(),
        careerStory: careerStory.trim(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ success: true, role: 'mentor', mentor });
  } catch (error: any) {
    console.error('Error registering mentor:', error);
    res.status(500).json({ success: false, message: 'Failed to register as mentor.' });
  }
};

export const getMentorProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || '';
    if (!userId) {
      res.status(400).json({ success: false, message: 'userId is required.' });
      return;
    }

    const mentor = await Mentor.findOne({ userId }).lean();
    res.json({ success: true, isMentor: !!mentor, mentor: mentor || null });
  } catch (error: any) {
    console.error('Error fetching mentor profile:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch mentor profile.' });
  }
};