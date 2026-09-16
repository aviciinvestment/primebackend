import { Request, Response } from 'express';
import Opportunity from '../models/Opportunity';
import { semanticSearchOpportunities } from '../services/opportunityVectorService';

// Minimum cosine similarity for a semantic search result to be considered a
// real match (index metric is cosine, so 0..1). Configurable via env.
const MIN_SEARCH_SCORE = parseFloat(process.env.SEMANTIC_MIN_SCORE || '0.15');

// ---------------------------------------------------------------------------
// Public feed cache (P-01). The /api/opportunities listing is public,
// read-heavy, and (outside of syncs) only changes when deadlines expire. Serve
// repeat requests straight from memory for up to 120s to cut Mongo + (for
// searches) Pinecone round-trips, and clear the whole cache after each sync so
// freshly inserted/closed listings surface immediately. The key is the
// normalized query string; the cache is size-bounded and self-evicting.
// ---------------------------------------------------------------------------
const FEED_CACHE_TTL_MS = 120 * 1000;
const FEED_CACHE_MAX_ENTRIES = 250;

interface FeedCacheEntry {
  at: number;
  payload: unknown;
}

const feedCache = new Map<string, FeedCacheEntry>();

const feedCacheKey = (req: Request): string => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(req.query)) {
    const v = Array.isArray(value) ? value.join(',') : value == null ? '' : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.sort().join('&');
};

const feedCacheGet = (key: string): unknown | null => {
  const entry = feedCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > FEED_CACHE_TTL_MS) {
    feedCache.delete(key);
    return null;
  }
  return entry.payload;
};

const feedCacheSet = (key: string, payload: unknown): void => {
  if (feedCache.size >= FEED_CACHE_MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldestKey = feedCache.keys().next().value;
    if (oldestKey !== undefined) feedCache.delete(oldestKey);
  }
  feedCache.set(key, { at: Date.now(), payload });
};

// Called by the opportunity sync after it commits new/updated/closed listings
// so the public feed reflects the change right away (not after the 60s TTL).
export const invalidateOpportunityFeedCache = (): void => {
  feedCache.clear();
};

// ---------------------------------------------------------------------------
// URL safety (S12). Any URL that reaches the dashboard is rendered as a link
// users click, so stored listings must never carry an executable scheme
// (javascript:, data:, file:, vbscript:). Defense-in-depth: reject at the
// input boundary AND at the storage boundary (see syncOpportunities.safeUrl).
// ---------------------------------------------------------------------------

// URL schemes that can execute content when followed as a link — stored-XSS.
const UNSAFE_URL_SCHEMES: ReadonlyArray<string> = ['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'];

// Strict validation: returns the trimmed URL when it is a plain http(s) link
// with none of the executable schemes, and '' (falsy) otherwise. Fail closed.
export const sanitizeOfficialUrl = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';

  const lower = raw.toLowerCase();
  if (UNSAFE_URL_SCHEMES.some(scheme => lower.startsWith(scheme))) return '';

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  } catch {
    return '';
  }

  return raw;
};

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
  const cacheKey = feedCacheKey(req);
  const cached = feedCacheGet(cacheKey);
  if (cached !== null) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json(cached);
  }

  try {
    // Clamp pagination so a public endpoint can't be forced into massive
    // Mongo skips or megabyte-sized JSON responses via ?page=&limit=.
    const MAX_PAGE = 1000;
    const MAX_LIMIT = 50;
    const rawPage = parseInt(req.query.page as string);
    const rawLimit = parseInt(req.query.limit as string);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, MAX_LIMIT) : 10;
    const skip = (page - 1) * limit;

    // Build filter query based on query params
    const filter: any = {};

    // Expired/closed listings leave the dashboard by default. Pass ?status= to
    // override (e.g. ?status=CLOSED to inspect history). Using $in over $ne lets
    // Mongo seek the status prefix of the feed compound index instead of
    // scanning for the inequality.
    if (!req.query.status) {
      filter.status = { $in: ['OPEN', 'CLOSING SOON', 'UPCOMING', 'DEADLINE UNKNOWN'] };
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

        const payload = {
          success: true,
          count: Math.min(limit, total - pageStart),
          total,
          page,
          pages: Math.ceil(total / limit),
          data: relevant.slice(pageStart, pageStart + limit),
          semantic: true,
        };
        feedCacheSet(cacheKey, payload);
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(payload);
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

    const payload = {
      success: true,
      count: opportunities.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: opportunities,
      semantic: false,
    };
    feedCacheSet(cacheKey, payload);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(payload);
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
