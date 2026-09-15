import axios from 'axios';
import Parser from 'rss-parser';

// ---------------------------------------------------------------------------
// Normalized shape returned by every source adapter. The sync service upserts
// these into MongoDB.
// ---------------------------------------------------------------------------
export interface SourceOpportunity {
  title: string;
  organization: string;
  description: string;
  opportunityType: string;
  location?: string;
  officialUrl: string;
  deadline?: string; // normalized ISO string, or undefined when rolling/unknown
  status?: string;   // raw status hint coming from the source (optional)
  tags: string[];
  category?: string;
  sourceName?: string;
  sourceUrl?: string;
}

// ---------------------------------------------------------------------------
// Shared normalization helpers
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;

const ROLLING_DEADLINE_RE = /rolling|ongoing|open[- ]ended|unknown|varies|n\/a|tbd|no deadline|annual|year[- ]round/i;

// Converts whatever deadline format a source returns into an ISO string.
// Returns undefined for rolling / unknown / unparseable deadlines so those are
// treated as "no deadline" and never auto-expired.
export const toIsoDeadline = (raw?: string | null): string | undefined => {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed || ROLLING_DEADLINE_RE.test(trimmed)) return undefined;

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
};

// OPEN → CLOSING SOON (within 14 days) → CLOSED once the deadline passes.
export const computeStatus = (deadlineIso?: string): string => {
  if (!deadlineIso) return 'DEADLINE UNKNOWN';
  const diff = new Date(deadlineIso).getTime() - Date.now();
  if (diff <= 0) return 'CLOSED';
  if (diff <= 14 * DAY_MS) return 'CLOSING SOON';
  return 'OPEN';
};

// Best-effort deadline extraction from free-text (used for RSS listings where
// there is no structured deadline field).
export const extractDeadlineFromText = (text?: string): string | undefined => {
  if (!text) return undefined;
  // e.g. "deadline: March 15, 2026", "Deadline - 2026-03-15", "apply by March 15 2026"
  const patterns = [
    /deadline[:.\-\s]{1,4}([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /deadline[:.\-\s]{1,4}(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i,
    /apply\s+by\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /(?:before|by)\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match?.[1]) {
      const iso = toIsoDeadline(match[1]);
      if (iso) return iso;
    }
  }
  return undefined;
};

export const normalizeUrl = (url?: string): string => {
  return (url || '').trim().replace(/\/+$/, '').toLowerCase();
};

// Sanitize scraped text: collapse whitespace and fix U+FFFD mojibake from the
// Scholarships.com directory ("Live MA�s" -> "Live MAs").
const cleanExternalText = (text: string): string =>
  String(text || '')
    .replace(/\uFFFD/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// Decode the common HTML entities used by the scraped listing sites.
const decodeEntities = (text: string): string =>
  String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&ldquo;/gi, '"')
    .replace(/&rdquo;/gi, '"')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…');

// Listings use two date styles: "October 2, 2026" and "23 Oct 2026". Normalize
// the day-first form into an ISO-ish "YYYY-MM-DD" so toIsoDeadline can parse it.
const normalizeListDeadline = (raw?: string): string | undefined => {
  if (!raw) return undefined;
  const trimmed = String(raw).trim().replace(/^Deadline[:\s]*/i, '');
  const dayFirst = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!dayFirst) return trimmed;
  const month = String(dayFirst[2]).toLowerCase();
  const MONTH_INDEX: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const mm = MONTH_INDEX[month.slice(0, 3)];
  if (!mm) return trimmed;
  return `${dayFirst[3]}-${mm}-${String(dayFirst[1]).padStart(2, '0')}`;
};

// Stable identity used for de-duplication across sources.
export const sourceKey = (s: SourceOpportunity): { url?: string; title: string; organization: string } => {
  const url = normalizeUrl(s.officialUrl);
  return {
    url: url || undefined,
    title: s.title.trim(),
    organization: s.organization.trim(),
  };
};

const pickType = (title: string, list: string[] = []): string => {
  const haystack = `${title} ${list.join(' ')}`.toLowerCase();
  if (/fellow/.test(haystack)) return 'Fellowship';
  if (/intern/.test(haystack)) return 'Internship';
  if (/(graduate trainee|trainee|graduate)/.test(haystack)) return 'Graduate Trainee';
  if (/scholarship/.test(haystack)) return 'Scholarship';
  return '';
};

// ---------------------------------------------------------------------------
// Source adapter: Arbeitnow Job Board API (free, no auth)
// https://arbeitnow.com API — JSON feed of tech jobs tagged for internships etc.
// ---------------------------------------------------------------------------
const ARBEITNOW_ENDPOINTS = [
  'https://arbeitnow.com/api/jobs',
  'https://arbeitsnow.com/api/jobs',
  'https://arbeitnow.com/api/v1/jobs',
];

async function fetchArbeitnow(_knownUrls?: Set<string>): Promise<SourceOpportunity[]> {
  const results: SourceOpportunity[] = [];
  let lastErr: unknown = null;

  for (const endpoint of ARBEITNOW_ENDPOINTS) {
    try {
      const { data } = await axios.get(endpoint, { timeout: 20000 });
      const jobs: any[] = data?.data?.jobs || data?.jobs || [];
      if (!Array.isArray(jobs)) continue;

      for (const job of jobs) {
        const title = String(job?.title || '').trim();
        if (!title) continue;

        const jobTypes: string[] = Array.isArray(job?.job_types) ? job.job_types : [];
        const tags: string[] = Array.isArray(job?.tags) ? job.tags : [];

        const isRelevant =
          jobTypes.some((t: string) => /intern|trainee|graduate/i.test(t)) ||
          tags.some((t: string) => /intern|trainee|graduate/i.test(t)) ||
          /intern|graduate\s*trainee|trainee/i.test(title);

        if (!isRelevant) continue;

        const url =
          job?.url ||
          (job?.slug ? `https://arbeitnow.com/jobs/${job.slug}` : '') ||
          title;

        results.push({
          title,
          organization: String(job?.company_name || '').trim() || 'Unknown Organization',
          description: String(job?.description || 'No description provided.').trim(),
          opportunityType: pickType(title, [...jobTypes, ...tags]) || 'Internship',
          location: String(job?.location || '').trim() || 'Remote',
          officialUrl: url,
          deadline: toIsoDeadline(job?.deadline || job?.application_deadline),
          tags,
          category: String(job?.category || '').trim() || undefined,
          sourceName: 'Arbeitnow',
        });
      }
      if (results.length > 0) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (results.length === 0 && lastErr) {
    console.error('Arbeitnow fetch failed on all endpoints:', (lastErr as Error)?.message);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Source adapter: ScholarshipAPI (scholarshipapi.com)
// Only active when SCHOLARSHIP_API_KEY is set. Paginates through the catalog.
// ---------------------------------------------------------------------------
async function fetchScholarshipApi(_knownUrls?: Set<string>): Promise<SourceOpportunity[]> {
  const apiKey = process.env.SCHOLARSHIP_API_KEY;
  if (!apiKey) {
    console.log('Skipping ScholarshipAPI — SCHOLARSHIP_API_KEY not set.');
    return [];
  }

  const baseUrl = (process.env.SCHOLARSHIP_API_BASE_URL || 'https://api.scholarshipapi.com/v1/scholarships').replace(/\/$/, '');
  const perPage = parseInt(process.env.SCHOLARSHIP_API_PER_PAGE || '100', 10) || 100;
  const maxPages = parseInt(process.env.SCHOLARSHIP_API_PAGES || '5', 10) || 5;
  const keyHeader = process.env.SCHOLARSHIP_API_KEY_HEADER || 'api-key';
  const useQuery = process.env.SCHOLARSHIP_API_USE_QUERY === 'true';

  const results: SourceOpportunity[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params: Record<string, any> = { per_page: perPage, page };
    if (useQuery) params.api_key = apiKey;

    const { data } = await axios.get(baseUrl, {
      params,
      headers: useQuery ? {} : { [keyHeader]: apiKey },
      timeout: 30000,
    });

    const records: any[] = Array.isArray(data) ? data : data?.data || data?.results || [];
    if (records.length === 0) break;

    for (const r of records) {
      const title = String(r?.name || r?.title || '').trim();
      if (!title) continue;

      const tagsRaw = Array.isArray(r?.tags)
        ? r.tags
        : Array.isArray(r?.eligibility_criteria)
          ? r.eligibility_criteria
          : [];

      const tags = tagsRaw
        .map((t: any) => (typeof t === 'string' ? t : t?.displayName || t?.value || ''))
        .filter(Boolean)
        .slice(0, 12);

      results.push({
        title,
        organization:
          String(r?.organization || '').trim() ||
          String(r?.about_company || '').trim() ||
          title.split(' ').slice(0, 2).join(' '),
        description:
          String(r?.describtion_short || r?.describtion_long || r?.description || 'No description provided.').trim(),
        opportunityType: 'Scholarship',
        location: String(r?.location || r?.eligible_country || '').trim() || 'Various',
        officialUrl: String(r?.url || r?.scholarship_page || r?.scholarship_url || '').trim() || title,
        deadline: toIsoDeadline(r?.deadline),
        status: r?.status,
        tags,
        category: String(r?.type_of_scholarship || r?.category || '').trim() || undefined,
        sourceName: 'ScholarshipAPI',
        sourceUrl: r?.scholarship_page || r?.url,
      });
    }
    if (results.length >= perPage * maxPages) break;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Source adapter: Adzuna API (free; needs ADZUNA_APP_ID + ADZUNA_APP_KEY)
// Filters live job listings by internship / graduate trainee keywords.
// ---------------------------------------------------------------------------
async function fetchAdzuna(_knownUrls?: Set<string>): Promise<SourceOpportunity[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    console.log('Skipping Adzuna — ADZUNA_APP_ID/ADZUNA_APP_KEY not set.');
    return [];
  }

  const country = process.env.ADZUNA_COUNTRY || 'gb';
  const keyword = process.env.ADZUNA_KEYWORD || 'internship graduate trainee';
  const perPage = parseInt(process.env.ADZUNA_PER_PAGE || '50', 10) || 50;
  const maxPages = parseInt(process.env.ADZUNA_PAGES || '3', 10) || 3;

  const results: SourceOpportunity[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await axios.get(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`, {
      params: {
        app_id: appId,
        app_key: appKey,
        what: keyword,
        results_per_page: perPage,
        'content-type': 'application/json',
      },
      timeout: 30000,
    });

    const jobs: any[] = data?.results || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const title = String(job?.title || '').trim();
      if (!title) continue;

      const description = String(job?.description || 'No description provided.').trim();

      results.push({
        title,
        organization: String(job?.company?.display_name || '').trim() || 'Unknown Organization',
        description: description.slice(0, 2000),
        opportunityType: pickType(title) || 'Internship',
        location: String(job?.location?.display_name || '').trim() || 'Remote',
        officialUrl: String(job?.redirect_url || job?.readable_url || '').trim() || title,
        deadline: undefined,
        tags: [job?.contract_type, job?.contract_time, job?.category?.label].filter(Boolean),
        category: String(job?.category?.label || '').trim() || undefined,
        sourceName: 'Adzuna',
        sourceUrl: job?.readable_url,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Source adapter: RSS feeds for niche opportunity sites (no auth required).
// Feeds are configurable via RSS_FEEDS (comma-separated). Each feed failure is
// swallowed so one dead feed never blocks the rest of the sync.
// ---------------------------------------------------------------------------
// youthop.com/feed currently returns 404, so it is not part of the defaults —
// add it back via RSS_FEEDS env when it recovers.
const DEFAULT_RSS_FEEDS = [
  'https://www.opportunitiesforafricans.com/feed/',
];

async function fetchRssFeeds(_knownUrls?: Set<string>): Promise<SourceOpportunity[]> {
  const feeds = (process.env.RSS_FEEDS || '').split(',')
    .map((f: string) => f.trim())
    .filter(Boolean);
  const feedList = feeds.length > 0 ? feeds : DEFAULT_RSS_FEEDS;

  const parser = new Parser();
  const results: SourceOpportunity[] = [];

  for (const feedUrl of feedList) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const feedTitle = String(feed?.title || 'RSS').trim();

      for (const item of (feed?.items || [])) {
        const title = String(item?.title || '').trim();
        if (!title) continue;

        const content = String(item?.contentSnippet || item?.summary || item?.content || '').trim();
        const categories: string[] = Array.isArray(item?.categories) ? item.categories.map(String) : [];
        const feedName = feedTitle.replace(/\s+/g, ' ').trim();

        results.push({
          title,
          organization:
            categories.find((c: string) => c.trim().length > 0) || feedName || 'Unknown Organization',
          description: content.slice(0, 1500) || 'No description provided.',
          opportunityType: pickType(title, categories) || 'Scholarship',
          location: 'Various',
          officialUrl: String(item?.link || item?.guid || '').trim() || title,
          deadline: extractDeadlineFromText(content),
          tags: categories.slice(0, 8),
          category: categories[0] || undefined,
          sourceName: feedName,
          sourceUrl: item?.link,
        });
      }
    } catch (err) {
      console.error(`RSS feed failed (${feedUrl}):`, (err as Error)?.message);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Source adapter: Parse.bot (Scholarships.com directory via canonical API)
// Uses the account API key from PARSE_API_KEY (X-API-Key header). Skips
// silently when the key is missing. GET endpoints take query-string params.
// Credit usage: 1 credit per endpoint call; we cap detail calls per run.
// ---------------------------------------------------------------------------
const PARSE_SCHOLARSHIP_SCRAPER_ID =
  process.env.PARSE_SCHOLARSHIP_SCRAPER_ID || 'e39726f8-b69f-440d-a6f6-d53c1a3e549b';
const PARSE_BASE = `https://api.parse.bot/scraper/${PARSE_SCHOLARSHIP_SCRAPER_ID}`;

interface ParseListing {
  name: string;
  slug: string;
  url: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const PARSE_CALL_DELAY =
  parseInt(process.env.PARSE_CALL_DELAY || '500', 10) || 500;

async function parseCall<T>(
  endpoint: string,
  params: Record<string, any>,
  apiKey: string,
  attempts = 3
): Promise<T> {
  // Pace requests to respect per-second/min credits.
  await sleep(PARSE_CALL_DELAY);

  // Back off quickly and bail early: a throttled run shouldn't stall the sync.
  const MAX_BURST_WAIT = 30_000;
  const retryFloorMs = [3000, 6000, 10000];
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { data } = await axios.get(`${PARSE_BASE}/${endpoint}`, {
        params,
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      });
      return data;
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      if (status !== 429 && !(status >= 500 && status <= 599)) throw err;

      const body = err?.response?.data || {};
      const retryAfter =
        parseInt(body?.retry_after ?? err?.response?.headers?.['retry-after'] ?? '0', 10) || 0;

      // Daily cap won't reset until UTC midnight — don't waste the run retrying.
      if (status === 429 && body?.limit_type === 'daily') {
        throw err;
      }

      const isLastAttempt = attempt >= attempts - 1;
      const wait = isLastAttempt ? 0 : Math.min(
        Math.max(retryAfter, retryFloorMs[attempt] ?? 10000),
        MAX_BURST_WAIT
      );
      console.log(`Parse API ${endpoint} returned ${status}${isLastAttempt ? ', giving up this run.' : `, retrying in ${Math.round(wait / 1000)}s...`}`);
      if (!isLastAttempt) await sleep(wait);
    }
  }
  throw lastErr;
}

async function fetchParseScholarships(_knownUrls?: Set<string>): Promise<SourceOpportunity[]> {
  const apiKey = process.env.PARSE_API_KEY;
  if (!apiKey) {
    console.log('Skipping Parse (Scholarships.com) — PARSE_API_KEY not set.');
    return [];
  }

  const categories = (process.env.PARSE_CATEGORIES || 'academic-major,deadline')
    .split(',')
    .map((c: string) => c.trim())
    .filter(Boolean);
  const subCatsPerCategory = parseInt(process.env.PARSE_SUBCATEGORIES_PER_CATEGORY || '2', 10) || 2;
  const maxListings = parseInt(process.env.PARSE_MAX_LISTINGS || '100', 10) || 100;
  let detailBudget = parseInt(process.env.PARSE_MAX_DETAILS || '30', 10) || 30;

  const results: SourceOpportunity[] = [];
  const seenSlugs = new Set<string>();
  let consecutiveDetailFailures = 0;

  try {
    const base = await parseCall<{ data: { categories: { slug: string }[] } }>(
      'get_scholarship_directory_categories',
      {},
      apiKey,
      2
    );
    const available = new Set((base?.data?.categories || []).map(c => c.slug));

    for (const category of categories) {
      if (!available.has(category)) continue;

      // Discover subcategories (for "deadline" these come out chronologically,
      // so the nearest months are first).
      const subRes = await parseCall<{ data: { subcategories: ParseListing[] } }>(
        'list_subcategories',
        { category_slug: category },
        apiKey,
        2
      );
      const subcategories = (subRes?.data?.subcategories || []).slice(0, subCatsPerCategory);

      for (const sub of subcategories) {
        const listRes = await parseCall<{ data: { scholarships: ParseListing[] } }>(
          'list_scholarships_in_category',
          { category_slug: category, subcategory_slug: sub.slug },
          apiKey,
          2
        );

        for (const item of (listRes?.data?.scholarships || [])) {
          if (seenSlugs.has(item.slug) || results.length >= maxListings) continue;
          seenSlugs.add(item.slug);

          const record: SourceOpportunity = {
            title: cleanExternalText(item.name) || item.slug,
            organization: 'Scholarships.com',
            description: '',
            opportunityType: 'Scholarship',
            location: 'Various',
            officialUrl: item.url || `https://www.scholarships.com/scholarships/${item.slug}`,
            deadline: undefined,
            tags: [category.replace(/-/g, ' '), sub.name],
            category: sub.name,
            sourceName: 'Scholarships.com (Parse)',
          };
          results.push(record);

          // Enrich the first `detailBudget` listings with full detail each run
          // so deadlines stay fresh daily. Budget is consumed per attempt so a
          // failed (429/login-wall) call never spins in a retry loop.
          if (detailBudget > 0) {
            detailBudget -= 1;
            try {
              const detail = await parseCall<{ data: any }>(
                'get_scholarship_detail',
                { scholarship_slug: item.slug },
                apiKey
              );
              const d = detail?.data;
              // Some pages are account-gated and return a "Log In" stub.
              const invalid =
                !d || !d.name || /log\s*in/i.test(String(d.name)) || typeof d.name !== 'string';
              if (!invalid) {
                record.title = cleanExternalText(d.name) || record.title;
                record.deadline = toIsoDeadline(d.deadline);
                record.sourceUrl = d.apply_url;
                if (d.amount) {
                  record.description = `Award amount: ${cleanExternalText(d.amount)}\n\n`;
                }
                if (d.description) {
                  record.description += cleanExternalText(d.description).slice(0, 1500);
                }
                if (Array.isArray(d.eligibility)) {
                  record.tags = [...record.tags, ...d.eligibility.map(String).slice(0, 8)];
                }
                if (!record.description) record.description = 'No description provided.';
              }
              consecutiveDetailFailures = 0;
            } catch (err) {
              // Budget already spent; keep the listing-level record and move on.
              consecutiveDetailFailures += 1;
              if (consecutiveDetailFailures >= 3) {
                // Heavily throttled — stop enriching for this run so the sync
                // finishes fast instead of chewing through backoff waits.
                detailBudget = 0;
                console.log('Parse throttling detected — skipping remaining detail enrichment.');
              } else {
                await sleep(1500);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Parse scholarships fetch failed:', (err as Error)?.message);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Source adapters: ScholarshipAir + ScholarshipTab (Nigeria-focused listings)
// Both are static blog/listing sites. We scrape their Nigerian scholarship page
// (first N pages) — no auth required. Markup differs slightly, so each site has
// its own little parser but they share the same output shape.
// ---------------------------------------------------------------------------
const SCHOLARSHIP_AIR_BASE = 'https://www.scholarshipair.com';
const SCHOLARSHIP_TAB_BASE = 'https://www.scholarshiptab.com';

const SCHOLARSHIP_AIR_PAGES = Math.max(1, parseInt(process.env.SCHOLARSHIP_AIR_PAGES || '2', 10) || 2);
const SCHOLARSHIP_TAB_PAGES = Math.max(1, parseInt(process.env.SCHOLARSHIP_TAB_PAGES || '2', 10) || 2);

const stripTags = (html: string): string =>
  decodeEntities(cleanExternalText(html.replace(/<[^>]+>/g, ' ')));

const pickOrgFromImageExcerpt = (excerpt: string): string => {
  const m = excerpt.match(/<a class="item-logo"[^>]*>\s*<img[^>]*alt="([^"]*)"/i);
  return m?.[1] ? cleanExternalText(m[1]) : '';
};

async function fetchScholarshipAir(_knownUrls?: Set<string>): Promise<SourceOpportunity[]> {
  const results: SourceOpportunity[] = [];
  let lastErr: unknown = null;

  for (let page = 1; page <= SCHOLARSHIP_AIR_PAGES; page += 1) {
    const url = page === 1 ? `${SCHOLARSHIP_AIR_BASE}/` : `${SCHOLARSHIP_AIR_BASE}/page/${page}`;
    try {
      const { data: html } = await axios.get<string>(url, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpportunityRadar/1.0)' },
      });
      const chunks = String(html).split('<li class="item-list-li"');
      for (const chunk of chunks.slice(1)) {
        const href = chunk.match(/href="(\/scholarships\/[^"]+)"/i);
        if (!href) continue;

        const titleMatch = chunk.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
        const title = titleMatch ? stripTags(titleMatch[1]) : '';
        if (!title) continue;

        const descMatch = chunk.match(/<p class="item-desc"[^>]*>([\s\S]*?)<\/p>/i);
        const desc = descMatch ? stripTags(descMatch[1]) : '';

        const org = pickOrgFromImageExcerpt(chunk);
        const deadlineRaw = chunk.match(/class="sko-deadline-post"[^>]*>\s*([^<]*)\s*</i)?.[1] || '';

        results.push({
          title,
          organization: org,
          description: desc || 'No description provided.',
          opportunityType: pickType(title),
          location: 'Nigeria',
          officialUrl: `${SCHOLARSHIP_AIR_BASE}${href[1]}`,
          deadline: toIsoDeadline(normalizeListDeadline(deadlineRaw)),
          tags: ['Nigeria', 'Scholarship'],
          category: '',
          sourceName: 'ScholarshipAir',
          sourceUrl: url,
        });
      }
    } catch (err) {
      lastErr = err;
      console.log(`ScholarshipAir page ${page} failed: ${(err as Error)?.message}`);
    }
  }

  if (results.length === 0 && lastErr) throw lastErr;
  return results;
}

async function fetchScholarshipTab(_knownUrls?: Set<string>): Promise<SourceOpportunity[]> {
  const results: SourceOpportunity[] = [];
  let lastErr: unknown = null;

  for (let page = 1; page <= SCHOLARSHIP_TAB_PAGES; page += 1) {
    const base = `${SCHOLARSHIP_TAB_BASE}/african-students/in/nigeria`;
    const url = page === 1 ? base : `${base}/${page}`;
    try {
      const { data: html } = await axios.get<string>(url, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpportunityRadar/1.0)' },
      });
      const chunks = String(html).split('<li class="item-list-li"');
      for (const chunk of chunks.slice(1)) {
        const href = chunk.match(/href="(\/scholarships\/[^"]+)"/i);
        if (!href) continue;

        const titleMatch = chunk.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
        const title = titleMatch ? stripTags(titleMatch[1]) : '';
        if (!title) continue;

        const descMatch = chunk.match(/<p class="item-desc"[^>]*>([\s\S]*?)<\/p>/i);
        const desc = descMatch ? stripTags(descMatch[1]) : '';

        const deadlineRaw = chunk.match(/<b>Deadline:<\/b>\s*([^<]+)/i)?.[1] || '';
        const typeRaw = chunk.match(/<b id="nic-short">Type:<\/b>\s*<a[^>]*>([^<]+)/i)?.[1] || '';

        results.push({
          title,
          organization: '',
          description: desc || 'No description provided.',
          opportunityType: pickType(`${title} ${typeRaw}`) || cleanExternalText(typeRaw),
          location: 'Nigeria',
          officialUrl: `${SCHOLARSHIP_TAB_BASE}${href[1]}`,
          deadline: toIsoDeadline(normalizeListDeadline(deadlineRaw)),
          tags: ['Nigeria', 'Scholarship'],
          category: cleanExternalText(typeRaw),
          sourceName: 'ScholarshipTab',
          sourceUrl: url,
        });
      }
    } catch (err) {
      lastErr = err;
      console.log(`ScholarshipTab page ${page} failed: ${(err as Error)?.message}`);
    }
  }

  if (results.length === 0 && lastErr) throw lastErr;
  return results;
}

// ---------------------------------------------------------------------------
// Registry — the sync service iterates these in order. Adapters that require an
// API key are only included when their key is configured, so a missing key never
// wastes sync time or spams the log. RSS is self-configuring and always runs.
// ---------------------------------------------------------------------------
export interface SourceAdapter {
  name: string;
  fetch: (knownUrls?: Set<string>) => Promise<SourceOpportunity[]>;
}

export const getSourceAdapters = (): SourceAdapter[] => {
  const adapters: SourceAdapter[] = [
    { name: 'Arbeitnow', fetch: fetchArbeitnow },
    { name: 'ScholarshipAir', fetch: fetchScholarshipAir },
    { name: 'ScholarshipTab', fetch: fetchScholarshipTab },
  ];

  if (process.env.SCHOLARSHIP_API_KEY) {
    adapters.push({ name: 'ScholarshipAPI', fetch: fetchScholarshipApi });
  }
  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) {
    adapters.push({ name: 'Adzuna', fetch: fetchAdzuna });
  }
  if (process.env.PARSE_API_KEY) {
    adapters.push({ name: 'Scholarships.com (Parse)', fetch: fetchParseScholarships });
  }

  adapters.push({ name: 'RSS feeds', fetch: fetchRssFeeds });
  return adapters;
};