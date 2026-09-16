import type { Request, Response } from 'express';
import Opportunity from '../models/Opportunity';

// Where the SPA lives. The capsule page lives on the API origin (dynamic HTML)
// and hands humans off to this origin via meta-refresh + canonical link.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://prime-ed.vercel.app').replace(/\/+$/, '');

// Brand asset served by the static host — stable fallback for og:image when an
// opportunity has no organization logo.
const BRAND_OG_IMAGE = `${FRONTEND_URL}/student_cutout_v2.webp`;

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const truncate = (text: string, max: number): string => {
  const trimmed = (text || '').trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
};

const cleanLevel = (level: string): string =>
  level
    .replace(/^Category\s+[A-Z]\s*[-–—]?\s*/i, '')
    .replace(/\s*[-–—]\s*.*$/i, '')
    .trim() || level.trim();

const joinList = (items: string[] | undefined, limit = 3, clean?: (s: string) => string): string => {
  if (!items || items.length === 0) return '';
  const kept = items
    .slice(0, limit)
    .map(item => (clean ? clean(item) : item.trim()))
    .filter(Boolean);
  const suffix = items.length > limit ? ` & ${items.length - limit} more` : '';
  return `${kept.join(', ')}${suffix}`;
};

const formatDeadline = (deadline?: string): string => {
  if (!deadline) return '';
  const date = new Date(deadline);
  if (isNaN(date.getTime())) return deadline;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const buildDescription = (opp: {
  eligibleEducationLevels?: string[];
  eligibleFields?: string[];
  deadline?: string;
  fundingAmount?: string;
  currency?: string;
  description?: string;
}): string => {
  const parts: string[] = [];
  if (opp.eligibleEducationLevels?.length) {
    parts.push(`Open to ${joinList(opp.eligibleEducationLevels, 3, cleanLevel)}`);
  }
  if (opp.eligibleFields?.length) {
    parts.push(`Fields: ${joinList(opp.eligibleFields, 3)}`);
  }
  if (opp.deadline) {
    parts.push(`Apply by ${formatDeadline(opp.deadline)}`);
  }
  if (opp.fundingAmount) {
    parts.push(`Funding: ${opp.fundingAmount}${opp.currency ? ` ${opp.currency}` : ''}`);
  }
  const sentence = parts.join('. ');
  if (sentence.length > 2) return truncate(`${sentence}.`, 200);
  return truncate(opp.description || 'A new opportunity added on Prime Opportunity.', 200);
};

interface ShareHtmlOptions {
  appLink: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  status?: string;
}

const buildShareHtml = (opts: ShareHtmlOptions): string => {
  const { appLink, ogTitle, ogDescription, ogImage, status } = opts;
  const o = (value: unknown) => escapeHtml(value);
  const statusBadge = status ? `<meta property="og:status" content="${o(status)}">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o(ogTitle)}</title>
<meta name="description" content="${o(ogDescription)}">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${o(appLink)}">
<meta http-equiv="refresh" content="0; url=${o(appLink)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${o(appLink)}">
<meta property="og:title" content="${o(ogTitle)}">
<meta property="og:description" content="${o(ogDescription)}">
<meta property="og:image" content="${o(ogImage)}">
<meta property="og:site_name" content="Prime Opportunity">
${statusBadge}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${o(ogTitle)}">
<meta name="twitter:description" content="${o(ogDescription)}">
<meta name="twitter:image" content="${o(ogImage)}">
<meta name="theme-color" content="#0a0f16">
</head>
<body>
<p>Opening <a href="${o(appLink)}">${o(ogTitle)}</a>…</p>
</body>
</html>
`;
};

const buildNotFoundHtml = (): string => {
  const appRoot = FRONTEND_URL;
  const ogTitle = 'Opportunity Not Found';
  const ogDescription = 'This opportunity is no longer available on Prime Opportunity.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${ogTitle}</title>
<meta name="description" content="${ogDescription}">
<meta name="robots" content="noindex,follow">
<meta http-equiv="refresh" content="0; url=${escapeHtml(appRoot)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(appRoot)}">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDescription}">
<meta property="og:site_name" content="Prime Opportunity">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${ogDescription}">
<meta name="theme-color" content="#0a0f16">
</head>
<body>
<p><a href="${escapeHtml(appRoot)}">Back to Prime Opportunity</a></p>
</body>
</html>
`;
};

// ---------------------------------------------------------------------------
// Social-preview capsule: server-rendered HTML page carrying the Open Graph
// tags for one opportunity, so WhatsApp/Slack/X crawlers see a rich card
// without executing any JavaScript (a Vercel static SPA cannot render dynamic
// head tags itself). Crawlers read the tags; humans hit the <meta refresh>
// and land on the app's deep link <FRONTEND_URL>/opportunities?id=<id>.
//
// The capsule is reachable two ways, mirroring the `?id=XYZ` and
// `/opportunities/:id` intercept patterns from the task:
//   GET /api/opportunities/share?id=<id>
//   GET /api/opportunities/<id>/share
// ---------------------------------------------------------------------------
export const getSharePreview = async (
  req: Request<{ id?: string }>,
  res: Response
): Promise<void> => {
  const id = req.params.id || (typeof req.query.id === 'string' ? req.query.id : '');
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    res
      .status(404)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', 'public, max-age=60, s-maxage=300')
      .send(buildNotFoundHtml());
    return;
  }

  let opp: {
    title?: string;
    organization?: string;
    organizationLogo?: string;
    description?: string;
    eligibleEducationLevels?: string[];
    eligibleFields?: string[];
    deadline?: string;
    fundingAmount?: string;
    currency?: string;
    status?: string;
  } | null = null;
  try {
    opp = await Opportunity.findById(id)
      .select(
        'title organization organizationLogo description eligibleEducationLevels eligibleFields deadline fundingAmount currency status'
      )
      .lean();
  } catch {
    // DB unreachable or the id is valid-shaped but unknown: serve the same
    // 404 capsule instead of exposing an error, and keep it noindex.
    opp = null;
  }

  if (!opp) {
    res
      .status(404)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', 'public, max-age=60, s-maxage=300')
      .send(buildNotFoundHtml());
    return;
  }

  const appLink = `${FRONTEND_URL}/opportunities?id=${id}`;
  const ogTitle = truncate(`${opp.title || 'Opportunity'}${opp.organization ? ` · ${opp.organization}` : ''}`, 70);
  const ogDescription = buildDescription(opp);
  const ogImage =
    opp.organizationLogo && /^https?:\/\//i.test(opp.organizationLogo)
      ? opp.organizationLogo
      : BRAND_OG_IMAGE;

  res
    .status(200)
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'public, max-age=60, s-maxage=300')
    .send(buildShareHtml({ appLink, ogTitle, ogDescription, ogImage, status: opp.status }));
};