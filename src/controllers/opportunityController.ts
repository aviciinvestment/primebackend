import { Request, Response } from 'express';
import Opportunity from '../models/Opportunity';


// @desc    Get all opportunities (with optional filters)
// @route   GET /api/opportunities
// @access  Public
export const getOpportunities = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    
    // Build filter query based on query params
    const filter: any = {};
    
    if (req.query.category) {
      filter.category = req.query.category;
    }
    
    if (req.query.type) {
      const types = (req.query.type as string).split(',');
      filter.opportunityType = { $in: types };
    }
    
    if (req.query.status) {
      filter.status = req.query.status;
    }
    
    if (req.query.search) {
      filter.$text = { $search: req.query.search as string };
    }
    
    let sortQuery: any = { priorityScore: -1, dateDiscovered: -1 };
    if (req.query.search) {
      sortQuery = { score: { $meta: 'textScore' } };
    } else if (req.query.sort === 'newest') {
      sortQuery = { dateDiscovered: -1 };
    } else if (req.query.sort === 'deadline') {
      sortQuery = { deadline: 1, dateDiscovered: -1 };
    }
    
    const opportunities = await Opportunity.find(filter)
      .sort(sortQuery)
      .skip(skip)
      .limit(limit);
      
    const total = await Opportunity.countDocuments(filter);
    
    res.json({
      success: true,
      count: opportunities.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: opportunities
    });
  } catch (error: any) {
    console.error('Error fetching opportunities:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

export const getAllOpportunities = getOpportunities;

// @desc    Get single opportunity
// @route   GET /api/opportunities/:id
// @access  Public
export const getOpportunity = async (req: Request, res: Response) => {
  try {
    const opportunity = await Opportunity.findById(req.params.id);

    if (!opportunity) {
      res.status(404).json({ success: false, error: 'Opportunity not found' });
      return;
    }

    res.status(200).json({ success: true, data: opportunity });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};
