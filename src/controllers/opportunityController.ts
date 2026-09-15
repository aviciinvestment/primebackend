import { Request, Response } from 'express';
import Opportunity from '../models/Opportunity';
import { semanticSearchOpportunities } from '../services/opportunityVectorService';

// Minimum cosine similarity for a semantic search result to be considered a
// real match (index metric is cosine, so 0..1). Configurable via env.
const MIN_SEARCH_SCORE = parseFloat(process.env.SEMANTIC_MIN_SCORE || '0.15');

// Split text into meaningful lowercase tokens (drop 1-char/stop noise).
const tokenize = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1)
  );

// True when any query token appears in the opportunity's key visible fields.
// Used to reject semantically-adjacent but actually useless search results.
const sharesToken = (doc: any, queryTokens: Set<string>): boolean => {
  const haystack = [
    doc?.title,
    doc?.organization,
    doc?.category,
    doc?.opportunityType,
    doc?.location,
    (doc?.tags || []).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  for (const token of queryTokens) {
    if (haystack.includes(token)) return true;
  }
  return false;
};

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

    // Expired/closed listings leave the dashboard by default. Pass ?status= to
    // override (e.g. ?status=CLOSED to inspect history).
    if (!req.query.status) {
      filter.status = { $ne: 'CLOSED' };
    } else {
      filter.status = req.query.status;
    }

    if (req.query.category) {
      filter.category = req.query.category;
    }

    if (req.query.type) {
      const types = (req.query.type as string).split(',');
      filter.opportunityType = { $in: types };
    }

    const searchText = ((req.query.search as string) || '').trim();

    // Semantic search first: embed the query, query Pinecone, then intersect
    // the ranked ids with the content filters and paginate in relevance order.
    if (searchText) {
      try {
        const topK = Math.min(page * limit, 500);
        const matches = (await semanticSearchOpportunities(searchText, topK))
          .filter(m => m.score >= MIN_SEARCH_SCORE)
          .slice(0, topK);

        if (matches.length === 0) {
          res.json({ success: true, count: 0, total: 0, page, pages: 0, data: [], semantic: true });
          return;
        }

        const ids = matches.map(m => m.id);
        const scoreBy = new Map(matches.map(m => [m.id, m.score]));
        const docs = await Opportunity.find({ ...filter, _id: { $in: ids } });

        // Keep exactly the order Pinecone ranked them in.
        const ordered = docs
          .map(doc => ({ doc, score: scoreBy.get(doc._id.toString()) || 0 }))
          .sort((a, b) => b.score - a.score)
          .map(o => o.doc);

        // Relevance guard: a "match" must share at least one real token with the
        // query (title/org/type/location/tags), so clearly useless results from
        // embedding proximity are dropped instead of reaching the dashboard.
        const queryTokens = tokenize(searchText);
        const relevant = queryTokens.size > 0
          ? ordered.filter(doc => sharesToken(doc, queryTokens))
          : ordered;

        const total = relevant.length;
        const pageStart = (page - 1) * limit;

        res.json({
          success: true,
          count: Math.min(limit, total - pageStart),
          total,
          page,
          pages: Math.ceil(total / limit),
          data: relevant.slice(pageStart, pageStart + limit),
          semantic: true,
        });
        return;
      } catch (error: any) {
        console.error('Semantic search failed, falling back to text search:', error?.message || error);
        // Vector search is unavailable (malformed query, vector store down) —
        // degrade to MongoDB $text so search still works.
        filter.$text = { $search: searchText };
      }
    }

    let sortQuery: any = { priorityScore: -1, dateDiscovered: -1 };
    if (filter.$text) {
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
      data: opportunities,
      semantic: false,
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
