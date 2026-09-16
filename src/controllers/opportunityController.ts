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
// so the public feed reflects the change right away (not after the 120s TTL).
export const invalidateOpportunityFeedCache = (): void => {
  feedCache.clear();
};

// ---------------------------------------------------------------------------
// Feed cursor — keyset pagination (replaces O(n) $skip for deep scrolling).
//
// The cursor is an opaque base64url payload holding the last-seen sort-bound
// tuple {status, priorityScore, dateDiscovered, _id}. Requests pass it back as
// ?after=<cursor>; the next page then seeks DIRECTLY past that boundary with
// $gt/$lt on the same index keys the sort uses, so cost stays flat no matter
// how deep the user scrolls. Decoding is strict and fails closed: a malformed
// cursor simply means "start from the beginning again" (no 4xx, no throw).
// ---------------------------------------------------------------------------

interface FeedCursor {
  status: string;
  priorityScore: number;
  dateDiscovered: string;
  _id: string;
}

// The exact field tuple (in sort order) we may keyset-seek on. Each entry maps
// a Mongo field to its sort direction. 'best' and 'newest' are cursor-capable;
// 'deadline'/'text' keep the (clamped, index-backed, cached) skip fallback
// because nullable deadlines and relevance scores do not keyset cleanly.
const SORT_KEY_SET = {
  best: [
    { field: 'priorityScore', dir: -1 as const },
    { field: 'dateDiscovered', dir: -1 as const },
    { field: '_id', dir: 1 as const },
  ],
  newest: [
    { field: 'dateDiscovered', dir: -1 as const },
    { field: '_id', dir: 1 as const },
  ],
} as const;

const feedSortVariantOf = (req: Request): 'best' | 'newest' | 'deadline' | 'text' => {
  if (req.query.search) return 'text';
  if (req.query.sort === 'newest') return 'newest';
  if (req.query.sort === 'deadline') return 'deadline';
  return 'best';
};

const encodeFeedCursor = (doc: {
  status: string;
  priorityScore: number;
  dateDiscovered?: Date | string;
  _id: unknown;
}): string => {
  const payload: FeedCursor = {
    status: doc.status || 'DEADLINE UNKNOWN',
    priorityScore: typeof doc.priorityScore === 'number' ? doc.priorityScore : 0,
    dateDiscovered:
      doc.dateDiscovered instanceof Date
        ? doc.dateDiscovered.toISOString()
        : String(doc.dateDiscovered ?? ''),
    _id: String(doc._id),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
};

const decodeFeedCursor = (raw: string): FeedCursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.status !== 'string' || parsed.status.length === 0) return null;
    if (typeof parsed.priorityScore !== 'number' || !Number.isFinite(parsed.priorityScore)) return null;
    if (typeof parsed._id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(parsed._id)) return null;
    if (typeof parsed.dateDiscovered !== 'string' || Number.isNaN(new Date(parsed.dateDiscovered).getTime())) return null;
    return {
      status: parsed.status,
      priorityScore: parsed.priorityScore,
      dateDiscovered: parsed.dateDiscovered,
      _id: parsed._id,
    };
  } catch {
    return null; // malformed / truncated / tampered cursor → feed from page 1
  }
};

// Builds the $or seek predicate for a keyset: (k1 > b1) OR (k1 = b1 AND k2 > b2)
// OR (k1 = b1 AND k2 = b2 AND k3 > b3)... — the standard efficient resume.
const buildSeekFilter = (
  cursor: FeedCursor,
  keys: readonly { field: 'priorityScore' | 'dateDiscovered' | '_id'; dir: -1 | 1 }[]
): Record<string, unknown> => {
  const prefix: Record<string, unknown> = {};
  const or: Record<string, unknown>[] = [];
  for (const { field, dir } of keys) {
    const bound = field === '_id' ? cursor._id : field === 'priorityScore' ? cursor.priorityScore : cursor.dateDiscovered;
    or.push({ ...prefix, [field]: { [dir === 1 ? '$gt' : '$lt']: bound } });
    prefix[field] = bound;
  }
  return { $or: or };
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
    res.setHeader('Cache-Control', 'public, max-age=120');
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
        res.setHeader('Cache-Control', 'public, max-age=120');
        res.json(payload);
        return;
      } catch (error: any) {
        console.error('Semantic search failed, falling back to text search:', error?.message || error);
        // Vector search is unavailable (malformed query, vector store down) —
        // degrade to MongoDB $text so search still works.
        filter.$text = { $search: searchText };
      }
    }

    const sortVariant = feedSortVariantOf(req);

    let sortQuery: any = { priorityScore: -1, dateDiscovered: -1, _id: 1 };
    if (sortVariant === 'text') {
      sortQuery = { score: { $meta: 'textScore' } };
    } else if (sortVariant === 'newest') {
      sortQuery = { dateDiscovered: -1, _id: 1 };
    } else if (sortVariant === 'deadline') {
      sortQuery = { deadline: 1, dateDiscovered: -1 };
    }

    const cursorCapable = sortVariant === 'best' || sortVariant === 'newest';
    const rawAfter = req.query.after as string | undefined;
    const cursor = cursorCapable && rawAfter ? decodeFeedCursor(rawAfter) : null;

    if (cursor) {
      // Keyset seek: land straight past the last-seen page boundary using the
      // index, so a deep scroll costs the same as page 1 (no $skip, no count).
      filter.$and = [buildSeekFilter(cursor, SORT_KEY_SET[sortVariant as 'best' | 'newest'])];
    }

    const hasMore = (found: typeof opportunities, rows: typeof opportunities) => found.length > rows.length;
    const nextCursorFrom = (rows: typeof opportunities) =>
      rows.length > 0 ? encodeFeedCursor(rows[rows.length - 1]) : undefined;

    if (cursor) {
      // Cursor page: fetch one extra row to detect a following page without a
      // full countDocuments pass — the key win that keeps latency flat.
      const found = await Opportunity.find(filter)
        .sort(sortQuery)
        .limit(limit + 1);
      const opportunities = found.slice(0, limit);
      const nextCursor =
        found.length > opportunities.length && opportunities.length > 0
          ? encodeFeedCursor(opportunities[opportunities.length - 1])
          : undefined;

      const payload = {
        success: true,
        count: opportunities.length,
        limit,
        nextCursor,
        data: opportunities,
        semantic: false,
      };
      feedCacheSet(cacheKey, payload);
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json(payload);
      return;
    }

    // Legacy page/limit path (still clamped + index-backed + cached). Also
    // returns nextCursor when more rows exist so cursor-capable clients can
    // seamlessly switch over on the very next fetch.
    const skip = (page - 1) * limit;
    const opportunities = await Opportunity.find(filter)
      .sort(sortQuery)
      .skip(skip)
      .limit(limit);

    const total = await Opportunity.countDocuments(filter);
    const nextCursor =
      page < Math.ceil(total / limit) && opportunities.length > 0
        ? encodeFeedCursor(opportunities[opportunities.length - 1])
        : undefined;

    const payload = {
      success: true,
      count: opportunities.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      nextCursor,
      data: opportunities,
      semantic: false,
    };
    feedCacheSet(cacheKey, payload);
    res.setHeader('Cache-Control', 'public, max-age=120');
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
