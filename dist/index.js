"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_config = require("dotenv/config");
var import_express18 = __toESM(require("express"));
var import_cors = __toESM(require("cors"));
var import_mongoose11 = __toESM(require("mongoose"));
var import_node_cron = __toESM(require("node-cron"));

// src/models/Opportunity.ts
var import_mongoose = __toESM(require("mongoose"));
var OpportunitySchema = new import_mongoose.Schema(
  {
    title: { type: String, required: true },
    organization: { type: String, required: true },
    organizationLogo: { type: String },
    description: { type: String, required: true },
    category: { type: String },
    subcategory: { type: String },
    opportunityType: { type: String },
    targetAudience: [{ type: String }],
    eligibleEducationLevels: [{ type: String }],
    eligibleFields: [{ type: String }],
    eligibleCountries: [{ type: String }],
    eligibleRegions: [{ type: String }],
    location: { type: String },
    remoteAvailable: { type: Boolean, default: false },
    geographicEligibility: { type: String },
    workAuthorizationRequired: { type: String, enum: ["Yes", "No", "Unknown"], default: "Unknown" },
    visaSponsorship: { type: String, enum: ["Yes", "No", "Unknown"], default: "Unknown" },
    fundingType: { type: String },
    fundingAmount: { type: String },
    currency: { type: String },
    tuitionCoverage: { type: Boolean },
    livingStipend: { type: Boolean },
    travelSupport: { type: Boolean },
    applicationFee: { type: String },
    minimumCgpa: { type: Number },
    minimumDegreeClass: { type: String },
    workExperienceRequired: { type: String },
    nyscRequired: { type: String },
    ageRequirement: { type: String },
    ieltsRequired: { type: Boolean },
    greRequired: { type: Boolean },
    gmatRequired: { type: Boolean },
    documentsRequired: [{ type: String }],
    applicationSteps: { type: String },
    deadline: { type: String },
    deadlineTimezone: { type: String },
    status: {
      type: String,
      enum: ["OPEN", "CLOSING SOON", "CLOSED", "UPCOMING", "DEADLINE UNKNOWN"],
      default: "DEADLINE UNKNOWN"
    },
    officialUrl: { type: String, required: true },
    sourceUrl: { type: String },
    sourceName: { type: String },
    dateDiscovered: { type: Date, default: Date.now },
    lastVerified: { type: Date },
    verificationStatus: {
      type: String,
      enum: ["Verified", "Needs review", "Potentially outdated"],
      default: "Needs review"
    },
    priorityScore: { type: Number, default: 0 },
    tags: [{ type: String }],
    isAiDiscovered: { type: Boolean, default: false },
    // True once this opportunity's vector exists in Pinecone. Lets the sync
    // embed only new/changed docs instead of re-embedding everything.
    vectorized: { type: Boolean, default: false }
  },
  { timestamps: true }
);
OpportunitySchema.index({ status: 1 });
OpportunitySchema.index({ deadline: 1 });
OpportunitySchema.index({ eligibleEducationLevels: 1 });
OpportunitySchema.index({ eligibleFields: 1 });
OpportunitySchema.index({ eligibleCountries: 1 });
OpportunitySchema.index({
  title: "text",
  organization: "text",
  description: "text",
  tags: "text"
});
var Opportunity_default = import_mongoose.default.model("Opportunity", OpportunitySchema);

// src/services/sources.ts
var import_axios = __toESM(require("axios"));
var import_rss_parser = __toESM(require("rss-parser"));
var DAY_MS = 24 * 60 * 60 * 1e3;
var ROLLING_DEADLINE_RE = /rolling|ongoing|open[- ]ended|unknown|varies|n\/a|tbd|no deadline|annual|year[- ]round/i;
var toIsoDeadline = (raw) => {
  if (!raw) return void 0;
  const trimmed = String(raw).trim();
  if (!trimmed || ROLLING_DEADLINE_RE.test(trimmed)) return void 0;
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return void 0;
  return parsed.toISOString();
};
var computeStatus = (deadlineIso) => {
  if (!deadlineIso) return "DEADLINE UNKNOWN";
  const diff = new Date(deadlineIso).getTime() - Date.now();
  if (diff <= 0) return "CLOSED";
  if (diff <= 14 * DAY_MS) return "CLOSING SOON";
  return "OPEN";
};
var extractDeadlineFromText = (text) => {
  if (!text) return void 0;
  const patterns = [
    /deadline[:.\-\s]{1,4}([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /deadline[:.\-\s]{1,4}(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i,
    /apply\s+by\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /(?:before|by)\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match?.[1]) {
      const iso = toIsoDeadline(match[1]);
      if (iso) return iso;
    }
  }
  return void 0;
};
var normalizeUrl = (url) => {
  return (url || "").trim().replace(/\/+$/, "").toLowerCase();
};
var cleanExternalText = (text) => String(text || "").replace(/\uFFFD/g, "'").replace(/\s+/g, " ").trim();
var decodeEntities = (text) => String(text || "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&rsquo;/gi, "'").replace(/&lsquo;/gi, "'").replace(/&ldquo;/gi, '"').replace(/&rdquo;/gi, '"').replace(/&mdash;/gi, "\u2014").replace(/&ndash;/gi, "\u2013").replace(/&hellip;/gi, "\u2026");
var normalizeListDeadline = (raw) => {
  if (!raw) return void 0;
  const trimmed = String(raw).trim().replace(/^Deadline[:\s]*/i, "");
  const dayFirst = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!dayFirst) return trimmed;
  const month = String(dayFirst[2]).toLowerCase();
  const MONTH_INDEX = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };
  const mm = MONTH_INDEX[month.slice(0, 3)];
  if (!mm) return trimmed;
  return `${dayFirst[3]}-${mm}-${String(dayFirst[1]).padStart(2, "0")}`;
};
var sourceKey = (s) => {
  const url = normalizeUrl(s.officialUrl);
  return {
    url: url || void 0,
    title: s.title.trim(),
    organization: s.organization.trim()
  };
};
var pickType = (title, list = []) => {
  const haystack = `${title} ${list.join(" ")}`.toLowerCase();
  if (/fellow/.test(haystack)) return "Fellowship";
  if (/intern/.test(haystack)) return "Internship";
  if (/(graduate trainee|trainee|graduate)/.test(haystack)) return "Graduate Trainee";
  if (/scholarship/.test(haystack)) return "Scholarship";
  return "";
};
var ARBEITNOW_ENDPOINTS = [
  "https://arbeitnow.com/api/jobs",
  "https://arbeitsnow.com/api/jobs",
  "https://arbeitnow.com/api/v1/jobs"
];
async function fetchArbeitnow(_knownUrls) {
  const results = [];
  let lastErr = null;
  for (const endpoint of ARBEITNOW_ENDPOINTS) {
    try {
      const { data } = await import_axios.default.get(endpoint, { timeout: 2e4 });
      const jobs = data?.data?.jobs || data?.jobs || [];
      if (!Array.isArray(jobs)) continue;
      for (const job of jobs) {
        const title = String(job?.title || "").trim();
        if (!title) continue;
        const jobTypes = Array.isArray(job?.job_types) ? job.job_types : [];
        const tags = Array.isArray(job?.tags) ? job.tags : [];
        const isRelevant = jobTypes.some((t) => /intern|trainee|graduate/i.test(t)) || tags.some((t) => /intern|trainee|graduate/i.test(t)) || /intern|graduate\s*trainee|trainee/i.test(title);
        if (!isRelevant) continue;
        const url = job?.url || (job?.slug ? `https://arbeitnow.com/jobs/${job.slug}` : "") || title;
        results.push({
          title,
          organization: String(job?.company_name || "").trim() || "Unknown Organization",
          description: String(job?.description || "No description provided.").trim(),
          opportunityType: pickType(title, [...jobTypes, ...tags]) || "Internship",
          location: String(job?.location || "").trim() || "Remote",
          officialUrl: url,
          deadline: toIsoDeadline(job?.deadline || job?.application_deadline),
          tags,
          category: String(job?.category || "").trim() || void 0,
          sourceName: "Arbeitnow"
        });
      }
      if (results.length > 0) break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (results.length === 0 && lastErr) {
    console.error("Arbeitnow fetch failed on all endpoints:", lastErr?.message);
  }
  return results;
}
async function fetchScholarshipApi(_knownUrls) {
  const apiKey = process.env.SCHOLARSHIP_API_KEY;
  if (!apiKey) {
    console.log("Skipping ScholarshipAPI \u2014 SCHOLARSHIP_API_KEY not set.");
    return [];
  }
  const baseUrl = (process.env.SCHOLARSHIP_API_BASE_URL || "https://api.scholarshipapi.com/v1/scholarships").replace(/\/$/, "");
  const perPage = parseInt(process.env.SCHOLARSHIP_API_PER_PAGE || "100", 10) || 100;
  const maxPages = parseInt(process.env.SCHOLARSHIP_API_PAGES || "5", 10) || 5;
  const keyHeader = process.env.SCHOLARSHIP_API_KEY_HEADER || "api-key";
  const useQuery = process.env.SCHOLARSHIP_API_USE_QUERY === "true";
  const results = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const params = { per_page: perPage, page };
    if (useQuery) params.api_key = apiKey;
    const { data } = await import_axios.default.get(baseUrl, {
      params,
      headers: useQuery ? {} : { [keyHeader]: apiKey },
      timeout: 3e4
    });
    const records = Array.isArray(data) ? data : data?.data || data?.results || [];
    if (records.length === 0) break;
    for (const r of records) {
      const title = String(r?.name || r?.title || "").trim();
      if (!title) continue;
      const tagsRaw = Array.isArray(r?.tags) ? r.tags : Array.isArray(r?.eligibility_criteria) ? r.eligibility_criteria : [];
      const tags = tagsRaw.map((t) => typeof t === "string" ? t : t?.displayName || t?.value || "").filter(Boolean).slice(0, 12);
      results.push({
        title,
        organization: String(r?.organization || "").trim() || String(r?.about_company || "").trim() || title.split(" ").slice(0, 2).join(" "),
        description: String(r?.describtion_short || r?.describtion_long || r?.description || "No description provided.").trim(),
        opportunityType: "Scholarship",
        location: String(r?.location || r?.eligible_country || "").trim() || "Various",
        officialUrl: String(r?.url || r?.scholarship_page || r?.scholarship_url || "").trim() || title,
        deadline: toIsoDeadline(r?.deadline),
        status: r?.status,
        tags,
        category: String(r?.type_of_scholarship || r?.category || "").trim() || void 0,
        sourceName: "ScholarshipAPI",
        sourceUrl: r?.scholarship_page || r?.url
      });
    }
    if (results.length >= perPage * maxPages) break;
  }
  return results;
}
async function fetchAdzuna(_knownUrls) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    console.log("Skipping Adzuna \u2014 ADZUNA_APP_ID/ADZUNA_APP_KEY not set.");
    return [];
  }
  const country = process.env.ADZUNA_COUNTRY || "gb";
  const keyword = process.env.ADZUNA_KEYWORD || "internship graduate trainee";
  const perPage = parseInt(process.env.ADZUNA_PER_PAGE || "50", 10) || 50;
  const maxPages = parseInt(process.env.ADZUNA_PAGES || "3", 10) || 3;
  const results = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await import_axios.default.get(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`, {
      params: {
        app_id: appId,
        app_key: appKey,
        what: keyword,
        results_per_page: perPage,
        "content-type": "application/json"
      },
      timeout: 3e4
    });
    const jobs = data?.results || [];
    if (jobs.length === 0) break;
    for (const job of jobs) {
      const title = String(job?.title || "").trim();
      if (!title) continue;
      const description = String(job?.description || "No description provided.").trim();
      results.push({
        title,
        organization: String(job?.company?.display_name || "").trim() || "Unknown Organization",
        description: description.slice(0, 2e3),
        opportunityType: pickType(title) || "Internship",
        location: String(job?.location?.display_name || "").trim() || "Remote",
        officialUrl: String(job?.redirect_url || job?.readable_url || "").trim() || title,
        deadline: void 0,
        tags: [job?.contract_type, job?.contract_time, job?.category?.label].filter(Boolean),
        category: String(job?.category?.label || "").trim() || void 0,
        sourceName: "Adzuna",
        sourceUrl: job?.readable_url
      });
    }
  }
  return results;
}
var DEFAULT_RSS_FEEDS = [
  "https://www.opportunitiesforafricans.com/feed/"
];
async function fetchRssFeeds(_knownUrls) {
  const feeds = (process.env.RSS_FEEDS || "").split(",").map((f) => f.trim()).filter(Boolean);
  const feedList = feeds.length > 0 ? feeds : DEFAULT_RSS_FEEDS;
  const parser = new import_rss_parser.default();
  const results = [];
  for (const feedUrl of feedList) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const feedTitle = String(feed?.title || "RSS").trim();
      for (const item of feed?.items || []) {
        const title = String(item?.title || "").trim();
        if (!title) continue;
        const content = String(item?.contentSnippet || item?.summary || item?.content || "").trim();
        const categories = Array.isArray(item?.categories) ? item.categories.map(String) : [];
        const feedName = feedTitle.replace(/\s+/g, " ").trim();
        results.push({
          title,
          organization: categories.find((c) => c.trim().length > 0) || feedName || "Unknown Organization",
          description: content.slice(0, 1500) || "No description provided.",
          opportunityType: pickType(title, categories) || "Scholarship",
          location: "Various",
          officialUrl: String(item?.link || item?.guid || "").trim() || title,
          deadline: extractDeadlineFromText(content),
          tags: categories.slice(0, 8),
          category: categories[0] || void 0,
          sourceName: feedName,
          sourceUrl: item?.link
        });
      }
    } catch (err) {
      console.error(`RSS feed failed (${feedUrl}):`, err?.message);
    }
  }
  return results;
}
var PARSE_SCHOLARSHIP_SCRAPER_ID = process.env.PARSE_SCHOLARSHIP_SCRAPER_ID || "e39726f8-b69f-440d-a6f6-d53c1a3e549b";
var PARSE_BASE = `https://api.parse.bot/scraper/${PARSE_SCHOLARSHIP_SCRAPER_ID}`;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var PARSE_CALL_DELAY = parseInt(process.env.PARSE_CALL_DELAY || "500", 10) || 500;
async function parseCall(endpoint, params, apiKey, attempts = 3) {
  await sleep(PARSE_CALL_DELAY);
  const MAX_BURST_WAIT = 3e4;
  const retryFloorMs = [3e3, 6e3, 1e4];
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { data } = await import_axios.default.get(`${PARSE_BASE}/${endpoint}`, {
        params,
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json"
        },
        timeout: 6e4
      });
      return data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      if (status !== 429 && !(status >= 500 && status <= 599)) throw err;
      const body = err?.response?.data || {};
      const retryAfter = parseInt(body?.retry_after ?? err?.response?.headers?.["retry-after"] ?? "0", 10) || 0;
      if (status === 429 && body?.limit_type === "daily") {
        throw err;
      }
      const isLastAttempt = attempt >= attempts - 1;
      const wait = isLastAttempt ? 0 : Math.min(
        Math.max(retryAfter, retryFloorMs[attempt] ?? 1e4),
        MAX_BURST_WAIT
      );
      console.log(`Parse API ${endpoint} returned ${status}${isLastAttempt ? ", giving up this run." : `, retrying in ${Math.round(wait / 1e3)}s...`}`);
      if (!isLastAttempt) await sleep(wait);
    }
  }
  throw lastErr;
}
async function fetchParseScholarships(_knownUrls) {
  const apiKey = process.env.PARSE_API_KEY;
  if (!apiKey) {
    console.log("Skipping Parse (Scholarships.com) \u2014 PARSE_API_KEY not set.");
    return [];
  }
  const categories = (process.env.PARSE_CATEGORIES || "academic-major,deadline").split(",").map((c) => c.trim()).filter(Boolean);
  const subCatsPerCategory = parseInt(process.env.PARSE_SUBCATEGORIES_PER_CATEGORY || "2", 10) || 2;
  const maxListings = parseInt(process.env.PARSE_MAX_LISTINGS || "100", 10) || 100;
  let detailBudget = parseInt(process.env.PARSE_MAX_DETAILS || "30", 10) || 30;
  const results = [];
  const seenSlugs = /* @__PURE__ */ new Set();
  let consecutiveDetailFailures = 0;
  try {
    const base = await parseCall(
      "get_scholarship_directory_categories",
      {},
      apiKey,
      2
    );
    const available = new Set((base?.data?.categories || []).map((c) => c.slug));
    for (const category of categories) {
      if (!available.has(category)) continue;
      const subRes = await parseCall(
        "list_subcategories",
        { category_slug: category },
        apiKey,
        2
      );
      const subcategories = (subRes?.data?.subcategories || []).slice(0, subCatsPerCategory);
      for (const sub of subcategories) {
        const listRes = await parseCall(
          "list_scholarships_in_category",
          { category_slug: category, subcategory_slug: sub.slug },
          apiKey,
          2
        );
        for (const item of listRes?.data?.scholarships || []) {
          if (seenSlugs.has(item.slug) || results.length >= maxListings) continue;
          seenSlugs.add(item.slug);
          const record = {
            title: cleanExternalText(item.name) || item.slug,
            organization: "Scholarships.com",
            description: "",
            opportunityType: "Scholarship",
            location: "Various",
            officialUrl: item.url || `https://www.scholarships.com/scholarships/${item.slug}`,
            deadline: void 0,
            tags: [category.replace(/-/g, " "), sub.name],
            category: sub.name,
            sourceName: "Scholarships.com (Parse)"
          };
          results.push(record);
          if (detailBudget > 0) {
            detailBudget -= 1;
            try {
              const detail = await parseCall(
                "get_scholarship_detail",
                { scholarship_slug: item.slug },
                apiKey
              );
              const d = detail?.data;
              const invalid = !d || !d.name || /log\s*in/i.test(String(d.name)) || typeof d.name !== "string";
              if (!invalid) {
                record.title = cleanExternalText(d.name) || record.title;
                record.deadline = toIsoDeadline(d.deadline);
                record.sourceUrl = d.apply_url;
                if (d.amount) {
                  record.description = `Award amount: ${cleanExternalText(d.amount)}

`;
                }
                if (d.description) {
                  record.description += cleanExternalText(d.description).slice(0, 1500);
                }
                if (Array.isArray(d.eligibility)) {
                  record.tags = [...record.tags, ...d.eligibility.map(String).slice(0, 8)];
                }
                if (!record.description) record.description = "No description provided.";
              }
              consecutiveDetailFailures = 0;
            } catch (err) {
              consecutiveDetailFailures += 1;
              if (consecutiveDetailFailures >= 3) {
                detailBudget = 0;
                console.log("Parse throttling detected \u2014 skipping remaining detail enrichment.");
              } else {
                await sleep(1500);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Parse scholarships fetch failed:", err?.message);
  }
  return results;
}
var SCHOLARSHIP_AIR_BASE = "https://www.scholarshipair.com";
var SCHOLARSHIP_TAB_BASE = "https://www.scholarshiptab.com";
var SCHOLARSHIP_AIR_PAGES = Math.max(1, parseInt(process.env.SCHOLARSHIP_AIR_PAGES || "2", 10) || 2);
var SCHOLARSHIP_TAB_PAGES = Math.max(1, parseInt(process.env.SCHOLARSHIP_TAB_PAGES || "2", 10) || 2);
var stripTags = (html) => decodeEntities(cleanExternalText(html.replace(/<[^>]+>/g, " ")));
var pickOrgFromImageExcerpt = (excerpt) => {
  const m = excerpt.match(/<a class="item-logo"[^>]*>\s*<img[^>]*alt="([^"]*)"/i);
  return m?.[1] ? cleanExternalText(m[1]) : "";
};
async function fetchScholarshipAir(_knownUrls) {
  const results = [];
  let lastErr = null;
  for (let page = 1; page <= SCHOLARSHIP_AIR_PAGES; page += 1) {
    const url = page === 1 ? `${SCHOLARSHIP_AIR_BASE}/` : `${SCHOLARSHIP_AIR_BASE}/page/${page}`;
    try {
      const { data: html } = await import_axios.default.get(url, {
        timeout: 2e4,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OpportunityRadar/1.0)" }
      });
      const chunks = String(html).split('<li class="item-list-li"');
      for (const chunk of chunks.slice(1)) {
        const href = chunk.match(/href="(\/scholarships\/[^"]+)"/i);
        if (!href) continue;
        const titleMatch = chunk.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
        const title = titleMatch ? stripTags(titleMatch[1]) : "";
        if (!title) continue;
        const descMatch = chunk.match(/<p class="item-desc"[^>]*>([\s\S]*?)<\/p>/i);
        const desc = descMatch ? stripTags(descMatch[1]) : "";
        const org = pickOrgFromImageExcerpt(chunk);
        const deadlineRaw = chunk.match(/class="sko-deadline-post"[^>]*>\s*([^<]*)\s*</i)?.[1] || "";
        results.push({
          title,
          organization: org,
          description: desc || "No description provided.",
          opportunityType: pickType(title),
          location: "Nigeria",
          officialUrl: `${SCHOLARSHIP_AIR_BASE}${href[1]}`,
          deadline: toIsoDeadline(normalizeListDeadline(deadlineRaw)),
          tags: ["Nigeria", "Scholarship"],
          category: "",
          sourceName: "ScholarshipAir",
          sourceUrl: url
        });
      }
    } catch (err) {
      lastErr = err;
      console.log(`ScholarshipAir page ${page} failed: ${err?.message}`);
    }
  }
  if (results.length === 0 && lastErr) throw lastErr;
  return results;
}
async function fetchScholarshipTab(_knownUrls) {
  const results = [];
  let lastErr = null;
  for (let page = 1; page <= SCHOLARSHIP_TAB_PAGES; page += 1) {
    const base = `${SCHOLARSHIP_TAB_BASE}/african-students/in/nigeria`;
    const url = page === 1 ? base : `${base}/${page}`;
    try {
      const { data: html } = await import_axios.default.get(url, {
        timeout: 2e4,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OpportunityRadar/1.0)" }
      });
      const chunks = String(html).split('<li class="item-list-li"');
      for (const chunk of chunks.slice(1)) {
        const href = chunk.match(/href="(\/scholarships\/[^"]+)"/i);
        if (!href) continue;
        const titleMatch = chunk.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
        const title = titleMatch ? stripTags(titleMatch[1]) : "";
        if (!title) continue;
        const descMatch = chunk.match(/<p class="item-desc"[^>]*>([\s\S]*?)<\/p>/i);
        const desc = descMatch ? stripTags(descMatch[1]) : "";
        const deadlineRaw = chunk.match(/<b>Deadline:<\/b>\s*([^<]+)/i)?.[1] || "";
        const typeRaw = chunk.match(/<b id="nic-short">Type:<\/b>\s*<a[^>]*>([^<]+)/i)?.[1] || "";
        results.push({
          title,
          organization: "",
          description: desc || "No description provided.",
          opportunityType: pickType(`${title} ${typeRaw}`) || cleanExternalText(typeRaw),
          location: "Nigeria",
          officialUrl: `${SCHOLARSHIP_TAB_BASE}${href[1]}`,
          deadline: toIsoDeadline(normalizeListDeadline(deadlineRaw)),
          tags: ["Nigeria", "Scholarship"],
          category: cleanExternalText(typeRaw),
          sourceName: "ScholarshipTab",
          sourceUrl: url
        });
      }
    } catch (err) {
      lastErr = err;
      console.log(`ScholarshipTab page ${page} failed: ${err?.message}`);
    }
  }
  if (results.length === 0 && lastErr) throw lastErr;
  return results;
}
var getSourceAdapters = () => {
  const adapters = [
    { name: "Arbeitnow", fetch: fetchArbeitnow },
    { name: "ScholarshipAir", fetch: fetchScholarshipAir },
    { name: "ScholarshipTab", fetch: fetchScholarshipTab }
  ];
  if (process.env.SCHOLARSHIP_API_KEY) {
    adapters.push({ name: "ScholarshipAPI", fetch: fetchScholarshipApi });
  }
  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) {
    adapters.push({ name: "Adzuna", fetch: fetchAdzuna });
  }
  if (process.env.PARSE_API_KEY) {
    adapters.push({ name: "Scholarships.com (Parse)", fetch: fetchParseScholarships });
  }
  adapters.push({ name: "RSS feeds", fetch: fetchRssFeeds });
  return adapters;
};

// src/services/opportunityVectorService.ts
var import_pinecone = require("@pinecone-database/pinecone");
var import_openai = __toESM(require("openai"));
var pinecone = new import_pinecone.Pinecone({ apiKey: process.env.PINECONE_API_KEY });
var INDEX_NAME = "prime-opportunity-index";
var embedClient = new import_openai.default({
  apiKey: process.env.NVIDIA_EMBED_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1"
});
var EMBED_MODEL = "nvidia/nemotron-3-embed-1b";
var buildOpportunityVectorText = (opp) => {
  return `
    Title: ${opp.title}
    Organization: ${opp.organization}
    Category: ${opp.category}
    Type: ${opp.opportunityType}
    Location: ${opp.location}
    Description: ${opp.description}
    Tags: ${(opp.tags || []).join(", ")}
  `.trim();
};
var generateEmbedding = async (text) => {
  const response = await embedClient.embeddings.create({
    model: EMBED_MODEL,
    input: text
  });
  return response.data[0].embedding;
};
var upsertOpportunityVector = async (opp) => {
  const index = pinecone.index(INDEX_NAME);
  const embedding = await generateEmbedding(buildOpportunityVectorText(opp));
  await index.upsert([
    {
      id: opp._id.toString(),
      values: embedding,
      metadata: {
        title: opp.title,
        organization: opp.organization,
        category: opp.category || "",
        opportunityType: opp.opportunityType || "",
        location: opp.location || "",
        deadline: opp.deadline || "",
        status: opp.status || "",
        officialUrl: opp.officialUrl || ""
      }
    }
  ]);
  await Opportunity_default.updateOne({ _id: opp._id }, { $set: { vectorized: true } });
};
var semanticSearchOpportunities = async (query, topK = 100) => {
  const index = pinecone.index(INDEX_NAME);
  const embedding = await generateEmbedding(query);
  const queryResponse = await index.query({
    vector: embedding,
    topK,
    includeMetadata: false
  });
  return (queryResponse.matches || []).map((match) => ({
    id: match.id,
    score: match.score ?? 0
  }));
};
var deleteOpportunityVector = async (oppId) => {
  try {
    await pinecone.index(INDEX_NAME).deleteOne(oppId);
  } catch (err) {
    if (err?.name && err.name !== "PineconeNotFoundError") {
      throw err;
    }
  }
};
var embedOpportunitiesBatched = async (opps, batchSize = 10) => {
  let embedded = 0;
  let failed = 0;
  for (let i = 0; i < opps.length; i += batchSize) {
    const batch = opps.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((opp) => upsertOpportunityVector(opp))
    );
    results.forEach((r) => {
      if (r.status === "fulfilled") embedded += 1;
      else {
        failed += 1;
        console.error("Vector embedding failed:", r.reason?.message);
      }
    });
  }
  return { embedded, failed };
};

// src/services/syncOpportunities.ts
var escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var cleanDescription = (text) => text.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
var cleanText = (text) => String(text || "").replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim();
var findExisting = async (s) => {
  const key = sourceKey(s);
  if (key.url) {
    const byUrl = await Opportunity_default.findOne({ officialUrl: key.url });
    if (byUrl) return byUrl;
  }
  return Opportunity_default.findOne({
    title: { $regex: new RegExp(`^${escapeRegExp(key.title)}$`, "i") },
    organization: { $regex: new RegExp(`^${escapeRegExp(key.organization)}$`, "i") }
  });
};
var hasChanged = (doc, s, status) => {
  return String(doc?.title || "") !== s.title || String(doc?.organization || "") !== s.organization || String(doc?.description || "") !== cleanDescription(s.description) || String(doc?.opportunityType || "") !== s.opportunityType || String(doc?.status || "") !== status || String(doc?.deadline || "") !== (s.deadline || "") || (doc?.tags || []).join("|") !== (s.tags || []).join("|");
};
var runOpportunitySync = async () => {
  const startedAt = Date.now();
  let inserted = 0;
  let updated = 0;
  let closed = 0;
  const adapters = getSourceAdapters();
  const sourceReports = [];
  const pendingVecs = [];
  for (const adapter of adapters) {
    let fetched = [];
    try {
      fetched = await adapter.fetch();
    } catch (err) {
      console.error(`Source "${adapter.name}" failed, skipping:`, err?.message);
    }
    sourceReports.push({ name: adapter.name, fetched: fetched.length });
    const seen = /* @__PURE__ */ new Set();
    const unique = fetched.filter((rec) => {
      const key = sourceKey(rec);
      const fingerprint = key.url || `${key.title.toLowerCase()}||${key.organization.toLowerCase()}`;
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
    for (const rec of unique) {
      const s = {
        ...rec,
        title: cleanText(rec.title),
        organization: cleanText(rec.organization) || "Unknown Organization",
        description: cleanDescription(rec.description),
        deadline: toIsoDeadline(rec.deadline),
        tags: (rec.tags || []).slice(0, 12)
      };
      let status = s.deadline ? computeStatus(s.deadline) : "DEADLINE UNKNOWN";
      if (rec.status && /close/i.test(rec.status)) status = "CLOSED";
      const existing = await findExisting(s);
      if (!existing) {
        const doc = await Opportunity_default.create({
          title: s.title,
          organization: s.organization,
          description: s.description,
          opportunityType: s.opportunityType,
          location: s.location,
          officialUrl: s.officialUrl,
          deadline: s.deadline,
          status,
          tags: s.tags,
          category: s.category,
          sourceName: s.sourceName,
          sourceUrl: s.sourceUrl,
          verificationStatus: "Verified",
          lastVerified: /* @__PURE__ */ new Date(),
          isAiDiscovered: false
        });
        inserted += 1;
        pendingVecs.push(doc);
        continue;
      }
      const wasClosed = existing.status === "CLOSED";
      updated += 1;
      await Opportunity_default.updateOne(
        { _id: existing._id },
        {
          $set: {
            title: s.title,
            organization: s.organization,
            description: s.description || existing.description,
            opportunityType: s.opportunityType,
            location: s.location,
            officialUrl: s.officialUrl,
            deadline: s.deadline,
            status,
            tags: s.tags.filter((t) => !existing.tags.includes(t)).concat(existing.tags).slice(0, 12),
            category: s.category || existing.category,
            sourceName: s.sourceName || existing.sourceName,
            sourceUrl: s.sourceUrl || existing.sourceUrl,
            verificationStatus: "Verified",
            lastVerified: /* @__PURE__ */ new Date()
          }
        }
      );
      if (status === "CLOSED" && !wasClosed) {
        closed += 1;
        await deleteOpportunityVector(existing._id.toString()).catch(() => void 0);
        await Opportunity_default.updateOne({ _id: existing._id }, { $set: { vectorized: false } });
        continue;
      }
      if ((!existing.vectorized || hasChanged(existing, s, status) || wasClosed) && status !== "CLOSED") {
        pendingVecs.push(existing);
      }
    }
  }
  const sweepCandidates = await Opportunity_default.find({
    status: { $ne: "CLOSED" },
    deadline: { $nin: [null, ""] }
  });
  for (const doc of sweepCandidates) {
    const deadlineIso = toIsoDeadline(doc.deadline);
    if (!deadlineIso) continue;
    const newStatus = computeStatus(deadlineIso);
    if (newStatus === doc.status) continue;
    await Opportunity_default.updateOne(
      { _id: doc._id },
      { $set: { status: newStatus, lastVerified: /* @__PURE__ */ new Date() } }
    );
    if (newStatus === "CLOSED") {
      closed += 1;
      await deleteOpportunityVector(doc._id.toString()).catch(() => void 0);
      await Opportunity_default.updateOne({ _id: doc._id }, { $set: { vectorized: false } });
    }
  }
  const embedResult = await embedOpportunitiesBatched(pendingVecs);
  return {
    sources: sourceReports,
    inserted,
    updated,
    closed,
    embedded: embedResult.embedded,
    embedFailed: embedResult.failed,
    durationMs: Date.now() - startedAt
  };
};

// src/routes/opportunityRoutes.ts
var import_express2 = __toESM(require("express"));

// src/controllers/opportunityController.ts
var import_express = require("express");
var MIN_SEARCH_SCORE = parseFloat(process.env.SEMANTIC_MIN_SCORE || "0.15");
var tokenize = (text) => new Set(
  text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 1)
);
var sharesToken = (doc, queryTokens) => {
  const haystack = [
    doc?.title,
    doc?.organization,
    doc?.category,
    doc?.opportunityType,
    doc?.location,
    (doc?.tags || []).join(" ")
  ].filter(Boolean).join(" ").toLowerCase();
  for (const token of queryTokens) {
    if (haystack.includes(token)) return true;
  }
  return false;
};
var getOpportunities = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = {};
    if (!req.query.status) {
      filter.status = { $ne: "CLOSED" };
    } else {
      filter.status = req.query.status;
    }
    if (req.query.category) {
      filter.category = req.query.category;
    }
    if (req.query.type) {
      const types = req.query.type.split(",");
      filter.opportunityType = { $in: types };
    }
    const searchText = (req.query.search || "").trim();
    if (searchText) {
      try {
        const topK = Math.min(page * limit, 500);
        const matches = (await semanticSearchOpportunities(searchText, topK)).filter((m) => m.score >= MIN_SEARCH_SCORE).slice(0, topK);
        if (matches.length === 0) {
          res.json({ success: true, count: 0, total: 0, page, pages: 0, data: [], semantic: true });
          return;
        }
        const ids = matches.map((m) => m.id);
        const scoreBy = new Map(matches.map((m) => [m.id, m.score]));
        const docs = await Opportunity_default.find({ ...filter, _id: { $in: ids } });
        const ordered = docs.map((doc) => ({ doc, score: scoreBy.get(doc._id.toString()) || 0 })).sort((a, b) => b.score - a.score).map((o) => o.doc);
        const queryTokens = tokenize(searchText);
        const relevant = queryTokens.size > 0 ? ordered.filter((doc) => sharesToken(doc, queryTokens)) : ordered;
        const total2 = relevant.length;
        const pageStart = (page - 1) * limit;
        res.json({
          success: true,
          count: Math.min(limit, total2 - pageStart),
          total: total2,
          page,
          pages: Math.ceil(total2 / limit),
          data: relevant.slice(pageStart, pageStart + limit),
          semantic: true
        });
        return;
      } catch (error) {
        console.error("Semantic search failed, falling back to text search:", error?.message || error);
        filter.$text = { $search: searchText };
      }
    }
    let sortQuery = { priorityScore: -1, dateDiscovered: -1 };
    if (filter.$text) {
      sortQuery = { score: { $meta: "textScore" } };
    } else if (req.query.sort === "newest") {
      sortQuery = { dateDiscovered: -1 };
    } else if (req.query.sort === "deadline") {
      sortQuery = { deadline: 1, dateDiscovered: -1 };
    }
    const opportunities = await Opportunity_default.find(filter).sort(sortQuery).skip(skip).limit(limit);
    const total = await Opportunity_default.countDocuments(filter);
    res.json({
      success: true,
      count: opportunities.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: opportunities,
      semantic: false
    });
  } catch (error) {
    console.error("Error fetching opportunities:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};
var getOpportunity = async (req, res) => {
  try {
    const opportunity = await Opportunity_default.findById(req.params.id);
    if (!opportunity) {
      res.status(404).json({ success: false, error: "Opportunity not found" });
      return;
    }
    res.status(200).json({ success: true, data: opportunity });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// src/routes/opportunityRoutes.ts
var router = import_express2.default.Router();
router.get("/", getOpportunities);
router.get("/:id", getOpportunity);
var opportunityRoutes_default = router;

// src/routes/authRoutes.ts
var import_express4 = __toESM(require("express"));

// src/controllers/authController.ts
var import_express3 = require("express");
var import_bcrypt = __toESM(require("bcrypt"));
var import_jsonwebtoken = __toESM(require("jsonwebtoken"));

// src/models/User.ts
var import_mongoose2 = __toESM(require("mongoose"));
var UserSchema = new import_mongoose2.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true }
  },
  { timestamps: true }
);
var User_default = import_mongoose2.default.model("User", UserSchema);

// src/controllers/authController.ts
var registerUser = async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    const existingUser = await User_default.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, error: "Email already exists" });
    }
    const salt = await import_bcrypt.default.genSalt(10);
    const passwordHash = await import_bcrypt.default.hash(password, salt);
    const user = await User_default.create({
      email,
      passwordHash,
      firstName,
      lastName
    });
    const token = import_jsonwebtoken.default.sign({ id: user._id }, process.env.JWT_SECRET || "secret", {
      expiresIn: "30d"
    });
    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server error" });
  }
};
var loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User_default.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, error: "Invalid credentials" });
    }
    const isMatch = await import_bcrypt.default.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: "Invalid credentials" });
    }
    const token = import_jsonwebtoken.default.sign({ id: user._id }, process.env.JWT_SECRET || "secret", {
      expiresIn: "30d"
    });
    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server error" });
  }
};

// src/routes/authRoutes.ts
var router2 = import_express4.default.Router();
router2.post("/register", registerUser);
router2.post("/login", loginUser);
var authRoutes_default = router2;

// src/routes/aiRoutes.ts
var import_express6 = __toESM(require("express"));
var import_multer = __toESM(require("multer"));

// src/controllers/aiController.ts
var import_express5 = require("express");
var import_mongoose6 = require("mongoose");
var import_pdf_parse = require("pdf-parse");
var import_pinecone2 = require("@pinecone-database/pinecone");
var import_openai2 = __toESM(require("openai"));

// src/models/Cv.ts
var import_mongoose3 = __toESM(require("mongoose"));
var CvSchema = new import_mongoose3.Schema(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String },
    userName: { type: String },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    fileData: { type: Buffer, required: true },
    text: { type: String },
    analysis: { type: String },
    matchIds: [{ type: import_mongoose3.Schema.Types.ObjectId, ref: "Opportunity" }]
  },
  { timestamps: true }
);
CvSchema.index({ userId: 1, createdAt: -1 });
var Cv_default = import_mongoose3.default.model("Cv", CvSchema);

// src/models/Mentorship.ts
var import_mongoose4 = __toESM(require("mongoose"));
var MentorshipSchema = new import_mongoose4.Schema(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, trim: true, lowercase: true },
    userName: { type: String, trim: true },
    opportunityId: { type: String },
    opportunityTitle: { type: String, trim: true },
    opportunityOrg: { type: String, trim: true },
    opportunityUrl: { type: String, trim: true },
    opportunityType: { type: String, trim: true },
    opportunityCategory: { type: String, trim: true },
    mentorId: { type: String, index: true },
    mentorName: { type: String },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "NGN" },
    provider: { type: String, enum: ["paystack", "demo"], required: true },
    reference: { type: String, required: true, unique: true },
    status: { type: String, enum: ["paid", "pending", "failed"], default: "pending" },
    note: { type: String, trim: true }
  },
  { timestamps: true }
);
var Mentorship_default = import_mongoose4.default.model("Mentorship", MentorshipSchema);

// src/models/MentorshipComplaint.ts
var import_mongoose5 = __toESM(require("mongoose"));
var MentorshipComplaintSchema = new import_mongoose5.Schema(
  {
    ticket: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, trim: true, lowercase: true },
    userName: { type: String, trim: true },
    message: { type: String, required: true, trim: true, maxlength: 2e3 },
    payments: {
      type: [
        {
          reference: { type: String },
          amount: { type: Number, min: 0 },
          currency: { type: String, default: "NGN" },
          mentorName: { type: String },
          createdAt: { type: Date }
        }
      ],
      default: []
    },
    status: { type: String, enum: ["open", "resolved"], default: "open" }
  },
  { timestamps: true }
);
var MentorshipComplaint_default = import_mongoose5.default.model("MentorshipComplaint", MentorshipComplaintSchema);

// src/controllers/aiController.ts
var pinecone2 = new import_pinecone2.Pinecone({ apiKey: process.env.PINECONE_API_KEY });
var INDEX_NAME2 = "prime-opportunity-index";
var nvidiaEmbedClient = new import_openai2.default({
  apiKey: process.env.NVIDIA_EMBED_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1"
});
var nvidiaChatClient = new import_openai2.default({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
  timeout: 9e4,
  maxRetries: 1
});
var CV_NAMESPACE_PREFIX = "cvs-";
var OFF_TOPIC_REFUSAL = "I don't have information on that in this jurisdiction. I can only help you with scholarships, internships, graduate trainee programmes, and fellowships on PrimeOpportunity.";
var OFF_TOPIC_PATTERNS = [
  /hack (into|his|her|their|my)|crack (a )?password|break into (an?|the|my|someone'?s) (account|phone|computer|pc|system)|create (a )?virus|malware|phishing/i,
  /medical advice|diagnos[ei] my|my sympto|prescription for|medication for|dosage|cure (my|for)|treat(ment)? for/i,
  /my (boyfriend|girlfriend)|how to (flirt|date|get a girlfriend|get a boyfriend)|dating (tips|advice)|relationship (advice|problem)s?/i,
  /pray (to|for)|bible verse|quran[^ ]* verse|sermon|religious (question|advice)|my church/i,
  /political party|election (results|predictions)|vote for (a )?party/i,
  /betting (tips|tricks)|sports betting|casino|jackpot|lottery (numbers|tickets)|bitcoin|cryptocurrenc|forex (trading)?|stock (tips|market predictions)|compound (a )?bomb/i,
  /tell (me|us) a joke|make (me|us) laugh|roast me|movie (recommendation|suggestion|plot)|music (recommendation|suggestion)|game (cheats|walkthrough|hacks)|how to (win|beat) (fortnite|a game)/i,
  /recipe for|how to (cook|bake|make) (a |an |some )?(meal|dish|cake|pasta|soup)/i,
  /horoscop|tarot|astrolog|fortune tell(er|ing)?|dream meaning|palm reading|zodiac sign/i,
  /solve (this|my) (math|physics|chemistry) (problem|question)|homework (help|answer)|write (an essay|a poem|a story|a song|a rap|a letter) (about|for)|essay about|poem about|translate (this |the )?(to|into) (french|spanish|german)/i
];
var isOffTopic = (message) => {
  const text = ` ${message.toLowerCase()} `;
  return OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(text));
};
var MENTORSHIP_INTENT_PATTERNS = [
  /\bneed (a |some |any )?(mentor|mentorship|guidance)\b/i,
  /\bwant (a |to (get|buy|purchase|access|have|use|sign up for) |some )?(mentor|mentorship)\b/i,
  /\bget (a |me )?(mentor|mentorship)\b/i,
  /\b(how|where) (do|can|should) (i|me) (get|buy|purchase|access|find) (a )?(mentor|mentorship)\b/i,
  /\b(pay|buy|purchase|paying|subscribe|sign up) (for |to |some )?(a )?(mentor|mentorship)\b/i,
  /\b(mentor|mentorship) (me|to help me|for me,? please|please|guidance, please)\b/i,
  /\b(am|i.?m|i am) (looking for|searching for|interested in) (a )?(mentor|mentorship)\b/i,
  /\bmentorship\b/i,
  /\bguide me through (an? )?(application|opportunity)/i
];
var MENTORSHIP_COMPLAINT_PATTERNS = [
  /\bpaid\b[^.!?\n]{0,120}\b(?:but|yet|however|still)\b[^.!?\n]{0,80}\b(?:no|not|never|nothing|still|yet)\b[^.!?\n]{0,60}\b(?:mentor|guidance|assigned|matched|reviewed|contacted)\b/i,
  /\b(?:no|not|never|nothing|still|yet)\b[^.!?\n]{0,80}\b(?:mentor|guidance|assigned|matched|reviewed)\b[^.!?\n]{0,80}\b(?:paid|payment|money|since)\b/i,
  /\bh[ae]vent\b[^.!?\n]{0,40}\b(?:been )?(?:given|assigned|allocated|matched|received|gotten|seen)\b[^.!?\n]{0,50}\b(?:mentor|guidance)\b/i,
  /\b(?:given|assigned|allocated|matched|attached)\b[^.!?\n]{0,40}\b(?:no|not|never)\b[^.!?\n]{0,40}\b(?:mentor|guidance)\b/i,
  /\b(?:mentor|guidance|mentor is)\b[^.!?\n]{0,60}\b(?:not|no|never|still|yet|awaiting|pending)\b[^.!?\n]{0,60}\b(?:paid|payment|money)\b/i,
  /\bnot given a mentor\b|\bstill (?:haven.?t|didn.?t) (?:gotten|received|seen) (?:a |my )?mentor\b|\bno mentor (yet|still|assigned)?\b/i,
  /\b(?:yet to|not yet|haven.?t|h[ae]vent|still waiting|not received|no response|no feedback|no one)\b[^.!?\n]{0,100}\b(?:mentor|guidance|mentorship)\b/i,
  /\bcomplaint\b[^.!?\n]{0,140}\b(?:mentor|mentorship|paid|payment)\b/i,
  /\b(fraud|scam|ripped off|took my money)\b/i
];
var hasMentorshipIntent = (message) => MENTORSHIP_INTENT_PATTERNS.some((pattern) => pattern.test(message));
var hasMentorshipComplaint = (message) => MENTORSHIP_COMPLAINT_PATTERNS.some((pattern) => pattern.test(message));
var makeTicket = () => {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TKT-${Date.now().toString(36).toUpperCase()}-${suffix}`;
};
var handleMentorshipComplaint = async (message, userId, userEmail, userName) => {
  const ticket = makeTicket();
  try {
    let payments = [];
    if (userId) {
      const paidRecords = await Mentorship_default.find({ userId, status: "paid" }).select("reference amount currency mentorName createdAt").sort({ createdAt: -1 }).limit(10).lean();
      payments = paidRecords.map((r) => ({
        reference: r.reference,
        amount: r.amount,
        currency: r.currency,
        mentorName: r.mentorName || "",
        createdAt: r.createdAt
      }));
    }
    await MentorshipComplaint_default.create({
      ticket,
      userId,
      userEmail,
      userName,
      message: message.slice(0, 2e3),
      payments
    });
    console.log(`AI chat escalated complaint ${ticket} from user "${userName}" (${userEmail || userId || "guest"}) to admins.`);
  } catch (err) {
    console.error("Failed to persist mentorship complaint:", err);
  }
  return `I'm sorry to hear that \u2014 you should already have a mentor after paying.

I've sent your message straight to our admin team along with your account details (email: ${userEmail || "not provided"}). You don't need to do anything else; someone will follow up on your payment and assign a mentor as soon as possible.

Your ticket number is **${ticket}** \u2014 you can reference it if you reach out again.`;
};
var chunkText = (text, chunkSize = 1e3, overlap = 150) => {
  const clean = text.trim();
  if (clean.length <= chunkSize) return [clean];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    chunks.push(clean.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
};
var seedUserCvVectors = async (cvText, userId, cvId, fileName) => {
  const namespace = `${CV_NAMESPACE_PREFIX}${userId}`;
  const index = pinecone2.index(INDEX_NAME2);
  try {
    await index.namespace(namespace).deleteAll();
  } catch (err) {
    if (err?.name !== "PineconeNotFoundError") {
      throw err;
    }
  }
  const chunks = chunkText(cvText).slice(0, 5);
  const embedResponse = await nvidiaEmbedClient.embeddings.create({
    model: "nvidia/nemotron-3-embed-1b",
    input: chunks
  });
  const vectors = embedResponse.data.map((item, i) => ({
    id: `${cvId}-chunk-${i}`,
    values: item.embedding,
    metadata: {
      type: "cv",
      userId,
      cvId,
      fileName,
      chunkIndex: i,
      text: chunks[i]
    }
  }));
  await index.namespace(namespace).upsert(vectors);
  return { namespace, chunks: vectors.length };
};
var analyzeCV = async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "No CV file uploaded." });
      return;
    }
    const parser = new import_pdf_parse.PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const cvText = pdfData.text.trim();
    if (!cvText) {
      res.status(400).json({ success: false, message: "Could not extract text from the provided PDF." });
      return;
    }
    const truncatedCVText = cvText.substring(0, 4e3);
    const embedResponse = await nvidiaEmbedClient.embeddings.create({
      model: "nvidia/nemotron-3-embed-1b",
      input: truncatedCVText
    });
    const cvVector = embedResponse.data[0].embedding;
    const index = pinecone2.index(INDEX_NAME2);
    const queryResponse = await index.query({
      vector: cvVector,
      topK: 5,
      includeMetadata: true
    });
    const matchIds = queryResponse.matches.map((match) => match.id);
    const matchedOpportunities = await Opportunity_default.find({ _id: { $in: matchIds } });
    const sortedOpportunities = matchIds.map((id) => matchedOpportunities.find((o) => o._id.toString() === id)).filter(Boolean);
    const oppsContext = sortedOpportunities.map(
      (opp, index2) => `[${index2 + 1}] ${opp?.title} at ${opp?.organization}
Category: ${opp?.category}
Type: ${opp?.opportunityType}
Location: ${opp?.location}
Description: ${opp?.description}
`
    ).join("\n");
    const prompt = `You are an expert career advisor.
A user has uploaded their CV, and our semantic search engine has found the top matching opportunities from our database.
Analyze the user's CV and explain why these specific opportunities are a great match for them. Highlight their strengths and suggest the best one to apply for.

USER CV:
${truncatedCVText}

TOP MATCHING OPPORTUNITIES:
${oppsContext}

Provide a personalized, encouraging response to the user. Use markdown formatting. Keep it concise but highly valuable. Do not hallucinate opportunities that are not in the list.`;
    const completion = await nvidiaChatClient.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 1024,
      stream: false
    });
    const analysis = completion.choices[0].message.content;
    const userId = req.body.userId || "";
    let savedCv = null;
    if (userId) {
      const cv = new Cv_default({
        userId,
        userEmail: req.body.userEmail || "",
        userName: req.body.userName || "",
        fileName: req.file.originalname,
        contentType: req.file.mimetype,
        fileData: req.file.buffer,
        text: cvText,
        analysis,
        matchIds: sortedOpportunities.map((o) => o._id)
      });
      await cv.save();
      savedCv = cv;
      try {
        await seedUserCvVectors(cvText, userId, savedCv._id.toString(), req.file.originalname);
      } catch (vecErr) {
        console.error("Could not seed CV vectors to Pinecone:", vecErr);
      }
    }
    res.json({
      success: true,
      analysis,
      matches: sortedOpportunities,
      cvId: savedCv?._id || null
    });
  } catch (error) {
    console.error("Error analyzing CV:", error);
    res.status(500).json({
      success: false,
      message: "Failed to analyze CV.",
      error: error.message
    });
  }
};
var chatWithAI = async (req, res) => {
  try {
    const message = (req.body.message || "").trim();
    if (!message) {
      res.status(400).json({ success: false, message: "Message is required." });
      return;
    }
    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const history = rawHistory.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-10);
    const userId = (req.body.userId || "").trim();
    if (isOffTopic(message)) {
      res.json({ success: true, reply: OFF_TOPIC_REFUSAL });
      return;
    }
    if (hasMentorshipComplaint(message)) {
      const reply2 = await handleMentorshipComplaint(
        message,
        userId,
        (req.body.userEmail || "").trim(),
        (req.body.userName || "").trim()
      );
      res.json({ success: true, reply: reply2 });
      return;
    }
    if (hasMentorshipIntent(message)) {
      const fee = parseInt(process.env.MENTORSHIP_FEE || "20000", 10) || 2e4;
      const currency = process.env.MENTORSHIP_CURRENCY || "NGN";
      res.json({
        success: true,
        action: { type: "mentorship" },
        reply: `Great choice! Our **mentorship guidance** pairs you with an industry mentor who reviews your applications, coaches you, and boosts your chances of getting in.

It costs **${currency} ${fee.toLocaleString()}** per opportunity and you can pay securely right from the page.

Click the button below to get started.`
      });
      return;
    }
    const embedResponse = await nvidiaEmbedClient.embeddings.create({
      model: "nvidia/nemotron-3-embed-1b",
      input: message
    });
    const messageVector = embedResponse.data[0].embedding;
    const index = pinecone2.index(INDEX_NAME2);
    const queryResponse = await index.query({
      vector: messageVector,
      topK: 5,
      includeMetadata: true
    });
    const matchIds = queryResponse.matches.map((match) => match.id);
    let retrievedContext = "No specific opportunities were retrieved for this question. Answer generally using your knowledge.";
    if (matchIds.length > 0) {
      const matchedOpportunities = await Opportunity_default.find({ _id: { $in: matchIds } });
      const sortedOpportunities = matchIds.map((id) => matchedOpportunities.find((o) => o._id.toString() === id)).filter(Boolean);
      if (sortedOpportunities.length > 0) {
        retrievedContext = sortedOpportunities.map((opp, idx) => {
          const tags = opp.tags && opp.tags.length > 0 ? opp.tags.join(", ") : "None";
          return `[${idx + 1}] ${opp.title} at ${opp.organization}
  Type: ${opp.opportunityType || "Unknown"}
  Category: ${opp.category || "N/A"}
  Location: ${opp.location || "N/A"}
  Field(s): ${opp.eligibleFields ? opp.eligibleFields.join(", ") : "N/A"}
  Eligibility: ${opp.eligibleEducationLevels ? opp.eligibleEducationLevels.join(", ") : opp.targetAudience ? opp.targetAudience.join(", ") : "N/A"}
  Deadline: ${opp.deadline || "Not specified"}
  Status: ${opp.status || "Unknown"}
  Tags: ${tags}
  Description: ${opp.description || "N/A"}
  More info: ${opp.officialUrl || "N/A"}`;
        }).join("\n\n");
      }
    }
    let userCvContext = "";
    if (userId) {
      try {
        const cvNamespace = `${CV_NAMESPACE_PREFIX}${userId}`;
        let cvQuery = await index.namespace(cvNamespace).query({
          vector: messageVector,
          topK: 4,
          includeMetadata: true
        });
        let cvChunks = cvQuery.matches.filter((match) => match.metadata && typeof match.metadata.text === "string").map((match) => match.metadata.text);
        if (cvChunks.length === 0) {
          const existingCv = await Cv_default.findOne({ userId }).sort({ createdAt: -1 }).select("text fileName _id");
          if (existingCv) {
            console.log(`Self-healing CV vectors for userId=${userId}...`);
            await seedUserCvVectors(
              existingCv.text,
              userId,
              existingCv._id.toString(),
              existingCv.fileName
            );
            cvQuery = await index.namespace(cvNamespace).query({
              vector: messageVector,
              topK: 4,
              includeMetadata: true
            });
            cvChunks = cvQuery.matches.filter((match) => match.metadata && typeof match.metadata.text === "string").map((match) => match.metadata.text);
          }
        }
        if (cvChunks.length > 0) {
          userCvContext = cvChunks.join("\n\n");
        }
      } catch (cvErr) {
        console.error("Could not retrieve user CV context:", cvErr);
      }
    }
    const systemPrompt = `You are PrimeOpportunity AI, a friendly and knowledgeable assistant for PrimeOpportunity \u2014 a platform that helps Nigerian students and early-career professionals discover tailored scholarships, internships, graduate trainee programmes, and fellowships.

ABOUT THE PLATFORM:
- The site offers a searchable, filterable feed of opportunities (Scholarship, Internship, Graduate Trainee, Fellowship).
- Users can filter by Opportunity Type and Education Level (Undergraduate, Final-Year, Recent Graduate, Postgraduate).
- Logged-in users can upload their CV (PDF) and the AI analyzes their profile to find perfect matches, then filter the feed by "CV Match".
- Opportunities include details like organization, category, location, deadline, eligibility, funding, and official application links.

YOUR JOB:
Using the RETRIEVED OPPORTUNITIES and the USER'S OWN CV PROFILE sections below when relevant, answer the user's question accurately and helpfully. Follow these rules:
1. When the user asks about specific opportunities (e.g. "internships in Lagos", "scholarships for engineering"), prioritize the retrieved opportunities and clearly list the most relevant ones with their organization, deadline, and a link to apply.
2. When the user asks personalized questions ("what internships fit my CV?", "summarize my CV", "what are my strengths?"), use the USER'S OWN CV PROFILE to give tailored advice.
3. When answering, cite the opportunity title and organization so the user can verify.
4. Use a hyperlink markdown format for official links, e.g. [Apply here](https://example.com).
5. Do NOT invent or hallucinate opportunities that are not in the retrieved list. If nothing relevant was retrieved, say so and give general advice instead.
6. Keep answers concise (under ~250 words), well-structured with bullet points where helpful. Respond in plain markdown.
7. If the user asks about logging in, uploading a CV, filters, or how the site works, explain those features.

PRIVACY RULES (STRICT):
- The USER'S OWN CV PROFILE belongs solely to the current user. You must NEVER claim to know the details, CV, or personal information of any other user.
- Never reveal, repeat, or export raw CV information in a way that could be shared with others; summarize it only for the user who owns it.
- If asked about another person's CV or data, politely decline.

SCOPE GUARDRAIL (STRICT \u2014 NEVER BREAK):
- You may ONLY answer questions related to PrimeOpportunity and its content: discovering and applying for scholarships, internships, graduate trainee programmes, and fellowships for Nigerian students and early-career professionals; platform features (search, filters, sort, CV upload, CV Match, login, account); and personalized advice based on the user's OWN CV so long as it stays relevant to those opportunities.
- If the user asks about anything outside that scope \u2014 general knowledge, schoolwork, medical, legal, financial/investment, political, religious, relationship, entertainment, recipes, sports, tech/coding, current events, or ANY topic unrelated to the platform \u2014 you MUST NOT answer it or add any extra detail.
- In that case, reply with EXACTLY this message and nothing else: "${OFF_TOPIC_REFUSAL}"
- When in doubt, refuse with that exact message. Never improvise an answer outside the platform's scope.

USER'S OWN CV PROFILE:
${userCvContext || "The current user has not uploaded a CV yet (or none is vectorized). Do not claim you can see their CV."}

RETRIEVED OPPORTUNITIES:
${retrievedContext}`;
    const completion = await nvidiaChatClient.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: message }
      ],
      temperature: 0.6,
      top_p: 0.95,
      max_tokens: 700,
      stream: false
    });
    const reply = completion.choices[0].message.content?.trim() || "Sorry, I could not generate a response. Please try again.";
    res.json({ success: true, reply });
  } catch (error) {
    console.error("Error in AI chat:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process chat message.",
      error: error.message
    });
  }
};
var ROLE_KEYWORDS = [
  "Software Engineer",
  "Software Developer",
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "Data Scientist",
  "Data Analyst",
  "Machine Learning Engineer",
  "Product Manager",
  "Project Manager",
  "UI/UX Designer",
  "Graphic Designer",
  "Web Developer",
  "Mobile Developer",
  "DevOps Engineer",
  "Cloud Engineer",
  "Systems Engineer",
  "Electrical Engineer",
  "Mechanical Engineer",
  "Civil Engineer",
  "Researcher",
  "Intern",
  "Consultant",
  "Accountant",
  "Marketing Analyst",
  "Graduate Trainee",
  "Tutor",
  "Team Lead"
];
var SKILL_KEYWORDS = [
  "Python",
  "JavaScript",
  "TypeScript",
  "React",
  "React.js",
  "Node.js",
  "NodeJS",
  "Express",
  "Express.js",
  "MongoDB",
  "SQL",
  "MySQL",
  "PostgreSQL",
  "HTML",
  "CSS",
  "Tailwind",
  "Java",
  "C++",
  "C#",
  "MATLAB",
  "SolidWorks",
  "AutoCAD",
  "Git",
  "GitHub",
  "Docker",
  "Kubernetes",
  "AWS",
  "Figma",
  "Excel",
  "Power BI",
  "Tableau",
  "Machine Learning",
  "Deep Learning",
  "Data Analysis",
  "Data Science",
  "Artificial Intelligence",
  "REST API",
  "REST APIs",
  "API Design",
  "Linux",
  "Swift",
  "Kotlin",
  "Django",
  "Flask",
  "Vue.js",
  "Next.js",
  "Firebase",
  "Circuit Design",
  "PCB",
  "Arduino",
  "Raspberry Pi",
  "CCTV",
  "Solar",
  "ETL",
  "Public Speaking",
  "Team Leadership",
  "Agile",
  "Scrum"
];
var escapeRegExp2 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var extractCvHighlights = (cvText, analysis = "") => {
  const source = `${cvText}
${analysis}`.toLowerCase();
  const roles = ROLE_KEYWORDS.filter(
    (kw) => new RegExp(escapeRegExp2(kw), "i").test(source)
  ).slice(0, 8);
  const skills = SKILL_KEYWORDS.filter((kw) => {
    const pattern = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${pattern}\\b`, "i").test(source);
  }).slice(0, 12);
  const eduMatches = [];
  const degreeRe = /(?:(?:BSc|B\.Sc|BEng|B\.Eng|Bachelor(?:'?s)?|MSc|M\.Eng|MEng|M\.Sc|Master(?:'?s)?|HND|OND)\s+[^.,;\n]{3,60})/gi;
  let m;
  while ((m = degreeRe.exec(cvText)) !== null) {
    const clean = m[0].replace(/[\n*]+/g, " ").replace(/\s+/g, " ").trim();
    const isPerson = /\b(Professor|Lecturer|Associate|Supervisor|Advisor|Candidate|the late|Dr\.)\b/i.test(clean);
    if (clean.length > 5 && !isPerson && !eduMatches.includes(clean)) eduMatches.push(clean);
  }
  const uniRe = /University of [A-Z][a-zA-Z ]{3,60}/g;
  while ((m = uniRe.exec(cvText)) !== null) {
    const clean = m[0].replace(/[\n*]+/g, " ").replace(/\s+/g, " ").trim();
    if (clean.length > 12 && !eduMatches.includes(clean)) eduMatches.push(clean);
  }
  return { roles, skills, education: eduMatches.slice(0, 4) };
};
var getMyCVs = async (req, res) => {
  try {
    const userId = req.query.userId || "";
    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required." });
      return;
    }
    const cvs = await Cv_default.find({ userId }).sort({ createdAt: -1 }).limit(10).populate("matchIds");
    res.json({
      success: true,
      cvs: cvs.map((cv) => ({
        _id: cv._id,
        fileName: cv.fileName,
        analysis: cv.analysis,
        createdAt: cv.createdAt,
        matches: cv.matchIds,
        highlights: extractCvHighlights(cv.text || "", cv.analysis || "")
      }))
    });
  } catch (error) {
    console.error("Error fetching CVs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch CVs.",
      error: error.message
    });
  }
};
var downloadCV = async (req, res) => {
  try {
    const { cvId } = req.params;
    const userId = req.query.userId || "";
    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required." });
      return;
    }
    if (!(0, import_mongoose6.isValidObjectId)(cvId)) {
      res.status(400).json({ success: false, message: "Invalid CV id." });
      return;
    }
    const cv = await Cv_default.findOne({ _id: cvId, userId });
    if (!cv) {
      res.status(404).json({ success: false, message: "CV not found." });
      return;
    }
    const safeName = (cv.fileName || "cv.pdf").replace(/[^\w.\- ]/g, "").replace(/"/g, "");
    res.setHeader("Content-Type", cv.contentType || "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName || "cv.pdf"}"`);
    res.send(cv.fileData);
  } catch (error) {
    console.error("Error downloading CV:", error);
    res.status(500).json({ success: false, message: "Failed to download CV." });
  }
};
var deleteCV = async (req, res) => {
  try {
    const { cvId } = req.params;
    const userId = req.body.userId || "";
    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required." });
      return;
    }
    if (!(0, import_mongoose6.isValidObjectId)(cvId)) {
      res.status(400).json({ success: false, message: "Invalid CV id." });
      return;
    }
    const cv = await Cv_default.findOneAndDelete({ _id: cvId, userId });
    if (!cv) {
      res.status(404).json({ success: false, message: "CV not found." });
      return;
    }
    try {
      const ns = `${CV_NAMESPACE_PREFIX}${userId}`;
      const ids = Array.from({ length: 6 }, (_, i) => `${cvId}-chunk-${i}`);
      await pinecone2.index(INDEX_NAME2).namespace(ns).deleteMany(ids);
    } catch {
    }
    res.json({ success: true, message: "CV deleted." });
  } catch (error) {
    console.error("Error deleting CV:", error);
    res.status(500).json({ success: false, message: "Failed to delete CV." });
  }
};

// src/routes/aiRoutes.ts
var router3 = import_express6.default.Router();
var storage = import_multer.default.memoryStorage();
var upload = (0, import_multer.default)({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  }
});
router3.post("/analyze-cv", upload.single("cv"), analyzeCV);
router3.get("/my-cvs", getMyCVs);
router3.get("/cv/:cvId/download", downloadCV);
router3.delete("/cv/:cvId", deleteCV);
router3.post("/chat", chatWithAI);
var aiRoutes_default = router3;

// src/routes/mentorRoutes.ts
var import_express8 = __toESM(require("express"));

// src/controllers/mentorController.ts
var import_express7 = require("express");

// src/models/Mentor.ts
var import_mongoose7 = __toESM(require("mongoose"));
var MentorSchema = new import_mongoose7.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    name: { type: String },
    email: { type: String },
    company: { type: String, required: true, trim: true },
    roleType: { type: String, required: true, trim: true },
    careerStory: { type: String, required: true, trim: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" }
  },
  { timestamps: true }
);
var Mentor_default = import_mongoose7.default.model("Mentor", MentorSchema);

// src/controllers/mentorController.ts
var MENTOR_CUT = 0.9;
var registerMentor = async (req, res) => {
  try {
    const { userId, name, email, company, roleType, careerStory } = req.body;
    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required." });
      return;
    }
    if (!company?.trim() || !roleType?.trim() || !careerStory?.trim()) {
      res.status(400).json({ success: false, message: "Company, role type, and career story are all required." });
      return;
    }
    if (careerStory.trim().length < 20) {
      res.status(400).json({ success: false, message: "Career story must be at least 20 characters." });
      return;
    }
    const mentor = await Mentor_default.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          name: name || "",
          email: email || "",
          company: company.trim(),
          roleType: roleType.trim(),
          careerStory: careerStory.trim(),
          status: "pending"
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({
      success: true,
      status: "pending",
      message: "Application submitted. An admin will review it before you are approved as a mentor.",
      mentor
    });
  } catch (error) {
    console.error("Error registering mentor:", error);
    res.status(500).json({ success: false, message: "Failed to register as mentor." });
  }
};
var getMentorProfile = async (req, res) => {
  try {
    const userId = req.query.userId || "";
    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required." });
      return;
    }
    const mentor = await Mentor_default.findOne({ userId }).lean();
    res.json({
      success: true,
      isMentor: !!mentor && mentor.status === "approved",
      mentor: mentor || null
    });
  } catch (error) {
    console.error("Error fetching mentor profile:", error);
    res.status(500).json({ success: false, message: "Failed to fetch mentor profile." });
  }
};
var assignMentorToMentee = async (mentorship) => {
  const approved = await Mentor_default.find({ status: "approved" }).lean();
  if (approved.length === 0) return;
  const requestText = [
    mentorship.opportunityType,
    mentorship.opportunityCategory,
    mentorship.opportunityTitle
  ].filter(Boolean).join(" ");
  const tokens = (text) => new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2)
  );
  const requestTokens = tokens(requestText);
  const scored = [];
  for (const mentor of approved) {
    const mentorText = `${mentor.roleType} ${mentor.company} ${mentor.careerStory || ""}`;
    const mentorTokens = tokens(mentorText);
    let score = 0;
    for (const token of requestTokens) {
      if (mentorTokens.has(token)) score += 1;
    }
    if (score === 0) continue;
    const load = await Mentorship_default.countDocuments({ mentorId: mentor.userId, status: "paid" });
    scored.push({ mentor, score, load });
  }
  if (scored.length === 0) return;
  scored.sort((a, b) => b.score - a.score || a.load - b.load);
  const chosen = scored[0].mentor;
  mentorship.mentorId = chosen.userId;
  mentorship.mentorName = chosen.name || (chosen.email || "Mentor").split("@")[0];
  await mentorship.save();
};
var getMentorDashboard = async (req, res) => {
  try {
    const userId = req.query.userId || "";
    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required." });
      return;
    }
    const mentor = await Mentor_default.findOne({ userId }).lean();
    if (!mentor || mentor.status !== "approved") {
      res.status(403).json({
        success: false,
        message: "Only approved mentors can access the mentor dashboard."
      });
      return;
    }
    const myMentees = await Mentorship_default.find({ mentorId: userId, status: "paid" }).sort({ createdAt: -1 }).lean();
    const openRequests = await Mentorship_default.find({ status: "paid", mentorId: null }).sort({ createdAt: -1 }).lean();
    const totalPaid = myMentees.reduce((sum, m) => sum + (m.amount || 0), 0);
    res.json({
      success: true,
      mentor,
      myMentees,
      openRequests,
      totalMentees: myMentees.length,
      totalEarned: totalPaid * MENTOR_CUT
    });
  } catch (error) {
    console.error("Error fetching mentor dashboard:", error);
    res.status(500).json({ success: false, message: "Failed to fetch mentor dashboard." });
  }
};

// src/routes/mentorRoutes.ts
var router4 = import_express8.default.Router();
router4.post("/register", registerMentor);
router4.get("/profile", getMentorProfile);
router4.get("/dashboard", getMentorDashboard);
var mentorRoutes_default = router4;

// src/routes/syncRoutes.ts
var import_express9 = __toESM(require("express"));
var router5 = import_express9.default.Router();
router5.post("/run", async (_req, res) => {
  try {
    const result = await runOpportunitySync();
    res.json({ success: true, result });
  } catch (error) {
    console.error("Manual sync failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
var syncRoutes_default = router5;

// src/routes/applicationRoutes.ts
var import_express11 = __toESM(require("express"));

// src/controllers/applicationController.ts
var import_express10 = require("express");

// src/models/Application.ts
var import_mongoose8 = __toESM(require("mongoose"));
var ApplicationSchema = new import_mongoose8.Schema(
  {
    userId: { type: String, required: true, index: true },
    opportunityId: { type: import_mongoose8.Schema.Types.ObjectId, ref: "Opportunity", required: true },
    status: {
      type: String,
      enum: ["saved", "applied", "interview", "accepted", "rejected"],
      default: "saved"
    },
    clicked: { type: Boolean, default: false },
    clickedAt: { type: Date },
    dateApplied: { type: Date }
  },
  { timestamps: true }
);
ApplicationSchema.index({ opportunityId: 1, userId: 1 }, { unique: true });
var Application_default = import_mongoose8.default.model("Application", ApplicationSchema);

// src/controllers/applicationController.ts
var VALID_STATUSES = ["saved", "applied", "interview", "accepted", "rejected"];
var populateApplication = (app2) => {
  const opp = app2.opportunityId?._doc || app2.opportunityId;
  return {
    _id: app2._id.toString(),
    opportunityId: (app2.opportunityId?._id || app2.opportunityId)?.toString(),
    status: app2.status,
    clicked: app2.clicked,
    clickedAt: app2.clickedAt || null,
    dateApplied: app2.dateApplied || null,
    updatedAt: app2.updatedAt || null,
    opportunity: opp ? { ...opp } : null
  };
};
var getApplications = async (req, res) => {
  try {
    const userId = req.query.userId || "";
    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required" });
      return;
    }
    const apps = await Application_default.find({ userId }).populate("opportunityId").sort({ updatedAt: -1 });
    res.json({ success: true, count: apps.length, data: apps.map(populateApplication) });
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};
var upsertApplication = async (req, res) => {
  try {
    const userId = req.body?.userId || "";
    const opportunityId = req.body?.opportunityId || "";
    const status = req.body?.status;
    const clicked = req.body?.clicked === true;
    if (!userId || !opportunityId) {
      res.status(400).json({ success: false, message: "userId and opportunityId are required" });
      return;
    }
    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }
    const existing = await Application_default.findOne({ userId, opportunityId });
    if (!existing) {
      const record = await Application_default.create({
        userId,
        opportunityId,
        status: status || "saved",
        clicked,
        clickedAt: clicked ? /* @__PURE__ */ new Date() : void 0,
        dateApplied: status === "applied" ? /* @__PURE__ */ new Date() : void 0
      });
      const populated2 = await record.populate("opportunityId");
      res.status(201).json({ success: true, data: populateApplication(populated2) });
      return;
    }
    const updates = {};
    if (status && status !== existing.status) {
      updates.status = status;
      if (status === "applied" && !existing.dateApplied) {
        updates.dateApplied = /* @__PURE__ */ new Date();
      }
    }
    if (clicked) {
      updates.clicked = true;
      updates.clickedAt = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updates).length > 0) {
      Object.assign(existing, updates);
      await existing.save();
    }
    const populated = await existing.populate("opportunityId");
    res.json({ success: true, data: populateApplication(populated) });
  } catch (error) {
    console.error("Error upserting application:", error);
    res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

// src/routes/applicationRoutes.ts
var router6 = import_express11.default.Router();
router6.get("/", getApplications);
router6.post("/", upsertApplication);
var applicationRoutes_default = router6;

// src/routes/mentorshipRoutes.ts
var import_express13 = __toESM(require("express"));

// src/controllers/mentorshipController.ts
var import_express12 = require("express");
var GUIDANCE_AMOUNT = parseInt(process.env.MENTORSHIP_FEE || "20000", 10) || 2e4;
var GUIDANCE_CURRENCY = process.env.MENTORSHIP_CURRENCY || "NGN";
var getMentorshipConfig = (_req, res) => {
  res.json({
    success: true,
    amount: GUIDANCE_AMOUNT,
    currency: GUIDANCE_CURRENCY,
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || null
  });
};
var createMentorshipRequest = async (req, res) => {
  try {
    const {
      userId,
      userEmail,
      userName,
      opportunityId,
      opportunityTitle,
      opportunityOrg,
      opportunityUrl,
      opportunityType,
      opportunityCategory,
      amount,
      currency,
      provider,
      reference,
      status,
      note
    } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required." });
    }
    if (!reference) {
      return res.status(400).json({ success: false, error: "Payment reference is required." });
    }
    const record = await Mentorship_default.create({
      userId,
      userEmail,
      userName,
      opportunityId,
      opportunityTitle,
      opportunityOrg,
      opportunityUrl,
      opportunityType,
      opportunityCategory,
      amount,
      currency,
      provider,
      reference,
      status,
      note
    });
    if (record.status === "paid") {
      try {
        await assignMentorToMentee(record);
      } catch (err) {
        console.error("Mentor assignment failed:", err?.message);
      }
    }
    res.status(201).json({ success: true, data: record });
  } catch (error) {
    if (error?.code === 11e3) {
      return res.status(409).json({ success: false, error: "That payment reference was already recorded." });
    }
    console.error("Failed to create mentorship request:", error);
    res.status(500).json({ success: false, error: "Failed to create mentorship request." });
  }
};
var getMentorships = async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, error: "userId is required." });
    const records = await Mentorship_default.find({ userId: String(userId) }).sort({ createdAt: -1 });
    res.json({ success: true, count: records.length, data: records });
  } catch (error) {
    console.error("Failed to list mentorship requests:", error);
    res.status(500).json({ success: false, error: "Failed to list mentorship requests." });
  }
};

// src/routes/mentorshipRoutes.ts
var router7 = import_express13.default.Router();
router7.get("/config", getMentorshipConfig);
router7.get("/", getMentorships);
router7.post("/", createMentorshipRequest);
var mentorshipRoutes_default = router7;

// src/routes/userRoutes.ts
var import_express15 = __toESM(require("express"));

// src/controllers/userController.ts
var import_express14 = require("express");

// src/models/AppUser.ts
var import_mongoose9 = __toESM(require("mongoose"));
var AppUserSchema = new import_mongoose9.Schema(
  {
    uid: { type: String, required: true, unique: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    displayName: { type: String, trim: true },
    photoURL: { type: String },
    role: { type: String, enum: ["user", "admin"], default: "user" }
  },
  { timestamps: true }
);
var AppUser_default = import_mongoose9.default.model("AppUser", AppUserSchema);

// src/controllers/userController.ts
var ADMIN_UIDS = new Set(
  (process.env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean)
);
var syncUser = async (req, res) => {
  try {
    const { uid, email, displayName, photoURL } = req.body || {};
    if (!uid) {
      return res.status(400).json({ success: false, error: "uid is required." });
    }
    const isFirstUser = await AppUser_default.countDocuments() === 0;
    const role = isFirstUser || ADMIN_UIDS.has(String(uid)) ? "admin" : "user";
    const user = await AppUser_default.findOneAndUpdate(
      { uid: String(uid) },
      {
        $set: {
          email: String(email || ""),
          displayName: String(displayName || ""),
          photoURL: String(photoURL || "")
        },
        $setOnInsert: { role }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        // Existing docs keep whatever role they had unless they match ADMIN_UIDS.
        ...ADMIN_UIDS.has(String(uid)) ? {} : {}
      }
    );
    if (ADMIN_UIDS.has(String(uid)) && user.role !== "admin") {
      user.role = "admin";
      await user.save();
    }
    const isMentor = !!await Mentor_default.findOne({ userId: String(uid), status: "approved" }).lean();
    res.json({
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: user.role,
        isMentor
      }
    });
  } catch (error) {
    console.error("Failed to sync user:", error);
    res.status(500).json({ success: false, error: "Failed to sync user." });
  }
};
var getUser = async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ success: false, error: "uid is required." });
    const user = await AppUser_default.findOne({ uid: String(uid) }).lean();
    res.json({
      success: true,
      user: user ? { uid: user.uid, email: user.email, displayName: user.displayName, role: user.role } : null
    });
  } catch (error) {
    console.error("Failed to fetch user:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user." });
  }
};

// src/routes/userRoutes.ts
var router8 = import_express15.default.Router();
router8.post("/", syncUser);
router8.get("/", getUser);
var userRoutes_default = router8;

// src/routes/adminRoutes.ts
var import_express17 = __toESM(require("express"));

// src/controllers/adminController.ts
var import_express16 = require("express");
var import_mongoose10 = require("mongoose");
var PLATFORM_CUT = 0.1;
var requireAdmin = async (req, res, next) => {
  try {
    const uid = String(req.headers["x-user-uid"] || "");
    if (!uid) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    const user = await AppUser_default.findOne({ uid });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Admin access only." });
    }
    return next();
  } catch (error) {
    console.error("requireAdmin error:", error);
    return res.status(500).json({ success: false, error: "Server error." });
  }
};
var getOverview = async (_req, res) => {
  try {
    const [totalUsers, totalMentors, pendingMentorApplications, totalMentees, paidRequests] = await Promise.all([
      AppUser_default.countDocuments(),
      Mentor_default.countDocuments({ status: "approved" }),
      Mentor_default.countDocuments({ status: "pending" }),
      Mentorship_default.countDocuments({ status: "paid", mentorId: { $ne: null } }),
      Mentorship_default.find({ status: "paid" }).lean()
    ]);
    const grossRevenue = paidRequests.reduce((sum, m) => sum + (m.amount || 0), 0);
    res.json({
      success: true,
      totalUsers,
      totalMentors,
      pendingMentorApplications,
      totalMentees,
      paidMenteeCount: paidRequests.length,
      grossRevenue,
      platformRevenue: grossRevenue * PLATFORM_CUT,
      mentorPayout: grossRevenue * (1 - PLATFORM_CUT)
    });
  } catch (error) {
    console.error("Failed to load admin overview:", error);
    res.status(500).json({ success: false, error: "Failed to load overview." });
  }
};
var listUsers = async (_req, res) => {
  try {
    const users = await AppUser_default.find().sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      users: users.map((u) => ({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        photoURL: u.photoURL,
        role: u.role,
        createdAt: u.createdAt
      }))
    });
  } catch (error) {
    console.error("Failed to list users:", error);
    res.status(500).json({ success: false, error: "Failed to list users." });
  }
};
var listMentors = async (_req, res) => {
  try {
    const mentors = await Mentor_default.find().sort({ createdAt: -1 }).lean();
    const results = await Promise.all(
      mentors.map(async (m) => {
        const [menteesCount, paid] = await Promise.all([
          Mentorship_default.countDocuments({ mentorId: m.userId, status: "paid" }),
          Mentorship_default.find({ mentorId: m.userId, status: "paid" }).lean()
        ]);
        const gross = paid.reduce((sum, r) => sum + (r.amount || 0), 0);
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
          createdAt: m.createdAt
        };
      })
    );
    res.json({ success: true, mentors: results });
  } catch (error) {
    console.error("Failed to list mentors:", error);
    res.status(500).json({ success: false, error: "Failed to list mentors." });
  }
};
var listMentees = async (_req, res) => {
  try {
    const requests = await Mentorship_default.find({ status: "paid" }).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      mentees: requests.map((r) => ({
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
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    console.error("Failed to list mentees:", error);
    res.status(500).json({ success: false, error: "Failed to list mentees." });
  }
};
var promoteUser = async (req, res) => {
  try {
    const { uid } = req.params;
    const user = await AppUser_default.findOne({ uid });
    if (!user) return res.status(404).json({ success: false, error: "User not found." });
    user.role = "admin";
    await user.save();
    res.json({ success: true, user: { uid: user.uid, email: user.email, displayName: user.displayName, role: user.role } });
  } catch (error) {
    console.error("Failed to promote user:", error);
    res.status(500).json({ success: false, error: "Failed to promote user." });
  }
};
var listComplaints = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status === "open" || status === "resolved" ? { status } : {};
    const complaints = await MentorshipComplaint_default.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      success: true,
      complaints: complaints.map((c) => ({
        id: c._id,
        ticket: c.ticket,
        userId: c.userId,
        userEmail: c.userEmail,
        userName: c.userName,
        message: c.message,
        payments: c.payments,
        status: c.status,
        createdAt: c.createdAt
      }))
    });
  } catch (error) {
    console.error("Failed to list complaints:", error);
    res.status(500).json({ success: false, error: "Failed to list complaints." });
  }
};
var resolveComplaint = async (req, res) => {
  try {
    const { id } = req.params;
    if (!(0, import_mongoose10.isValidObjectId)(id)) {
      return res.status(400).json({ success: false, error: "Invalid complaint id." });
    }
    const complaint = await MentorshipComplaint_default.findByIdAndUpdate(
      id,
      { status: "resolved" },
      { new: true }
    );
    if (!complaint) {
      return res.status(404).json({ success: false, error: "Complaint not found." });
    }
    res.json({ success: true, complaint });
  } catch (error) {
    console.error("Failed to resolve complaint:", error);
    res.status(500).json({ success: false, error: "Failed to resolve complaint." });
  }
};
var reviewMentorApplication = async (req, res) => {
  try {
    const { uid, action } = req.params;
    const mentor = await Mentor_default.findOne({ userId: uid });
    if (!mentor) return res.status(404).json({ success: false, error: "Mentor application not found." });
    if (action === "approve") {
      mentor.status = "approved";
    } else if (action === "reject") {
      mentor.status = "rejected";
    } else {
      return res.status(400).json({ success: false, error: "Action must be approve or reject." });
    }
    await mentor.save();
    const appUser = await AppUser_default.findOne({ uid });
    res.json({
      success: true,
      message: action === "approve" ? "Mentor approved." : "Mentor application rejected.",
      mentor,
      appUser
    });
  } catch (error) {
    console.error("Failed to review mentor application:", error);
    res.status(500).json({ success: false, error: "Failed to review mentor application." });
  }
};

// src/routes/adminRoutes.ts
var router9 = import_express17.default.Router();
router9.use(requireAdmin);
router9.get("/overview", getOverview);
router9.get("/users", listUsers);
router9.get("/mentors", listMentors);
router9.get("/mentees", listMentees);
router9.get("/complaints", listComplaints);
router9.post("/users/:uid/promote", promoteUser);
router9.post("/mentors/:uid/:action", reviewMentorApplication);
router9.post("/complaints/:id/resolve", resolveComplaint);
var adminRoutes_default = router9;

// src/index.ts
var app = (0, import_express18.default)();
var port = process.env.PORT || 5e3;
app.use(
  (0, import_cors.default)({
    // Comma-separated list of allowed origins, e.g. CORS_ORIGIN=https://app.example.com,http://localhost:5173
    // Leave unset (or CORS_ORIGIN=*) to allow all origins.
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean) : true
  })
);
app.use(import_express18.default.json());
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Opportunity Radar API is running" });
});
app.use("/api/opportunities", opportunityRoutes_default);
app.use("/api/auth", authRoutes_default);
app.use("/api/ai", aiRoutes_default);
app.use("/api/mentors", mentorRoutes_default);
app.use("/api/sync", syncRoutes_default);
app.use("/api/applications", applicationRoutes_default);
app.use("/api/mentorships", mentorshipRoutes_default);
app.use("/api/users", userRoutes_default);
app.use("/api/admin", adminRoutes_default);
var mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/opportunity-radar";
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
var scheduleOpportunitySync = () => {
  const cronExpression = process.env.SYNC_CRON || "0 6 * * *";
  const timezone = process.env.SYNC_TIMEZONE || "Africa/Lagos";
  console.log(`Scheduling opportunity sync: ${cronExpression} (${timezone})`);
  import_node_cron.default.schedule(cronExpression, async () => {
    console.log("[sync] Starting scheduled opportunity sync...");
    try {
      const result = await runOpportunitySync();
      console.log("[sync] Scheduled sync complete:", JSON.stringify(result));
    } catch (error) {
      console.error("[sync] Scheduled sync failed:", error);
    }
  });
  console.log("[sync] Running initial opportunity sync at boot...");
  runOpportunitySync().then((result) => console.log("[sync] Initial sync complete:", JSON.stringify(result))).catch((error) => console.error("[sync] Initial sync failed:", error));
};
import_mongoose11.default.connect(mongoUri, { serverSelectionTimeoutMS: 5e3 }).then(() => {
  console.log("Connected to MongoDB");
  scheduleOpportunitySync();
}).catch((error) => {
  console.error("MongoDB connection error. Running in mock mode.", error.message);
  console.log("Opportunity sync requires MongoDB \u2014 it will start once the database reconnects.");
  import_mongoose11.default.connection.on("connected", scheduleOpportunitySync);
});
