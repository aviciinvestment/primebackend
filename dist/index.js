"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  healthHandler: () => healthHandler
});
module.exports = __toCommonJS(index_exports);
var import_config = require("dotenv/config");
var import_express18 = __toESM(require("express"));
var import_compression = __toESM(require("compression"));
var import_cors = __toESM(require("cors"));
var import_mongoose14 = __toESM(require("mongoose"));
var import_node_cron = __toESM(require("node-cron"));
var import_helmet = __toESM(require("helmet"));
var import_multer2 = __toESM(require("multer"));

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
OpportunitySchema.index({ officialUrl: 1 });
OpportunitySchema.index({ status: 1, priorityScore: -1, dateDiscovered: -1 });
OpportunitySchema.index({ status: 1, dateDiscovered: -1 });
OpportunitySchema.index({ status: 1, deadline: 1, dateDiscovered: -1 });
OpportunitySchema.index({ category: 1 });
OpportunitySchema.index({ opportunityType: 1 });
OpportunitySchema.index({
  title: "text",
  organization: "text",
  description: "text",
  tags: "text"
});
var Opportunity_default = import_mongoose.default.model("Opportunity", OpportunitySchema);

// src/controllers/opportunityController.ts
var import_express = require("express");

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

// src/controllers/opportunityController.ts
var MIN_SEARCH_SCORE = parseFloat(process.env.SEMANTIC_MIN_SCORE || "0.15");
var FEED_CACHE_TTL_MS = 120 * 1e3;
var FEED_CACHE_MAX_ENTRIES = 250;
var feedCache = /* @__PURE__ */ new Map();
var feedCacheKey = (req) => {
  const parts = [];
  for (const [key, value] of Object.entries(req.query)) {
    const v = Array.isArray(value) ? value.join(",") : value == null ? "" : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.sort().join("&");
};
var feedCacheGet = (key) => {
  const entry = feedCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > FEED_CACHE_TTL_MS) {
    feedCache.delete(key);
    return null;
  }
  return entry.payload;
};
var feedCacheSet = (key, payload) => {
  if (feedCache.size >= FEED_CACHE_MAX_ENTRIES) {
    const oldestKey = feedCache.keys().next().value;
    if (oldestKey !== void 0) feedCache.delete(oldestKey);
  }
  feedCache.set(key, { at: Date.now(), payload });
};
var invalidateOpportunityFeedCache = () => {
  feedCache.clear();
};
var SORT_KEY_SET = {
  best: [
    { field: "priorityScore", dir: -1 },
    { field: "dateDiscovered", dir: -1 },
    { field: "_id", dir: 1 }
  ],
  newest: [
    { field: "dateDiscovered", dir: -1 },
    { field: "_id", dir: 1 }
  ]
};
var feedSortVariantOf = (req) => {
  if (req.query.search) return "text";
  if (req.query.sort === "newest") return "newest";
  if (req.query.sort === "deadline") return "deadline";
  return "best";
};
var encodeFeedCursor = (doc) => {
  const payload = {
    status: doc.status || "DEADLINE UNKNOWN",
    priorityScore: typeof doc.priorityScore === "number" ? doc.priorityScore : 0,
    dateDiscovered: doc.dateDiscovered instanceof Date ? doc.dateDiscovered.toISOString() : String(doc.dateDiscovered ?? ""),
    _id: String(doc._id)
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
};
var decodeFeedCursor = (raw) => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.status !== "string" || parsed.status.length === 0) return null;
    if (typeof parsed.priorityScore !== "number" || !Number.isFinite(parsed.priorityScore)) return null;
    if (typeof parsed._id !== "string" || !/^[0-9a-fA-F]{24}$/.test(parsed._id)) return null;
    if (typeof parsed.dateDiscovered !== "string" || Number.isNaN(new Date(parsed.dateDiscovered).getTime())) return null;
    return {
      status: parsed.status,
      priorityScore: parsed.priorityScore,
      dateDiscovered: parsed.dateDiscovered,
      _id: parsed._id
    };
  } catch {
    return null;
  }
};
var buildSeekFilter = (cursor, keys) => {
  const prefix = {};
  const or = [];
  for (const { field, dir } of keys) {
    const bound = field === "_id" ? cursor._id : field === "priorityScore" ? cursor.priorityScore : cursor.dateDiscovered;
    or.push({ ...prefix, [field]: { [dir === 1 ? "$gt" : "$lt"]: bound } });
    prefix[field] = bound;
  }
  return { $or: or };
};
var UNSAFE_URL_SCHEMES = ["javascript:", "data:", "file:", "vbscript:", "blob:"];
var sanitizeOfficialUrl = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (UNSAFE_URL_SCHEMES.some((scheme) => lower.startsWith(scheme))) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  } catch {
    return "";
  }
  return raw;
};
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
  const cacheKey = feedCacheKey(req);
  const cached = feedCacheGet(cacheKey);
  if (cached !== null) {
    res.setHeader("Cache-Control", "public, max-age=120");
    return res.json(cached);
  }
  try {
    const MAX_PAGE = 1e3;
    const MAX_LIMIT = 50;
    const rawPage = parseInt(req.query.page);
    const rawLimit = parseInt(req.query.limit);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, MAX_LIMIT) : 10;
    const filter = {};
    if (!req.query.status) {
      filter.status = { $in: ["OPEN", "CLOSING SOON", "UPCOMING", "DEADLINE UNKNOWN"] };
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
        const payload2 = {
          success: true,
          count: Math.min(limit, total2 - pageStart),
          total: total2,
          page,
          pages: Math.ceil(total2 / limit),
          data: relevant.slice(pageStart, pageStart + limit),
          semantic: true
        };
        feedCacheSet(cacheKey, payload2);
        res.setHeader("Cache-Control", "public, max-age=120");
        res.json(payload2);
        return;
      } catch (error) {
        console.error("Semantic search failed, falling back to text search:", error?.message || error);
        filter.$text = { $search: searchText };
      }
    }
    const sortVariant = feedSortVariantOf(req);
    let sortQuery = { priorityScore: -1, dateDiscovered: -1, _id: 1 };
    if (sortVariant === "text") {
      sortQuery = { score: { $meta: "textScore" } };
    } else if (sortVariant === "newest") {
      sortQuery = { dateDiscovered: -1, _id: 1 };
    } else if (sortVariant === "deadline") {
      sortQuery = { deadline: 1, dateDiscovered: -1 };
    }
    const cursorCapable = sortVariant === "best" || sortVariant === "newest";
    const rawAfter = req.query.after;
    const cursor = cursorCapable && rawAfter ? decodeFeedCursor(rawAfter) : null;
    if (cursor) {
      filter.$and = [buildSeekFilter(cursor, SORT_KEY_SET[sortVariant])];
    }
    const hasMore = (found, rows) => found.length > rows.length;
    const nextCursorFrom = (rows) => rows.length > 0 ? encodeFeedCursor(rows[rows.length - 1]) : void 0;
    if (cursor) {
      const found = await Opportunity_default.find(filter).sort(sortQuery).limit(limit + 1);
      const opportunities2 = found.slice(0, limit);
      const nextCursor2 = found.length > opportunities2.length && opportunities2.length > 0 ? encodeFeedCursor(opportunities2[opportunities2.length - 1]) : void 0;
      const payload2 = {
        success: true,
        count: opportunities2.length,
        limit,
        nextCursor: nextCursor2,
        data: opportunities2,
        semantic: false
      };
      feedCacheSet(cacheKey, payload2);
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json(payload2);
      return;
    }
    const skip = (page - 1) * limit;
    const opportunities = await Opportunity_default.find(filter).sort(sortQuery).skip(skip).limit(limit);
    const total = await Opportunity_default.countDocuments(filter);
    const nextCursor = page < Math.ceil(total / limit) && opportunities.length > 0 ? encodeFeedCursor(opportunities[opportunities.length - 1]) : void 0;
    const payload = {
      success: true,
      count: opportunities.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      nextCursor,
      data: opportunities,
      semantic: false
    };
    feedCacheSet(cacheKey, payload);
    res.setHeader("Cache-Control", "public, max-age=120");
    res.json(payload);
  } catch (error) {
    console.error("Error fetching opportunities:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};
var splitList = (value) => {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
};
var createManualOpportunity = async (req, res) => {
  try {
    const b = req.body || {};
    const title = typeof b.title === "string" ? b.title.trim() : "";
    const organization = typeof b.organization === "string" ? b.organization.trim() : "";
    const description = typeof b.description === "string" ? b.description.trim() : "";
    const officialUrl = sanitizeOfficialUrl(b.officialUrl);
    if (!title || !organization || !description || !officialUrl) {
      res.status(400).json({
        success: false,
        error: "title, organization, description, and a valid https:// officialUrl are required."
      });
      return;
    }
    const existing = await Opportunity_default.findOne({ officialUrl }).lean().select("_id title");
    if (existing) {
      res.status(409).json({
        success: false,
        error: `An opportunity with this URL already exists: ${existing.title} (${existing._id})`
      });
      return;
    }
    const validStatuses = ["OPEN", "CLOSING SOON", "CLOSED", "UPCOMING", "DEADLINE UNKNOWN"];
    const status = typeof b.status === "string" && validStatuses.includes(b.status) ? b.status : "OPEN";
    const rawPriority = Number(b.priorityScore);
    const priorityScore = Number.isFinite(rawPriority) ? Math.max(0, Math.min(1e3, Math.round(rawPriority))) : 80;
    const doc = await Opportunity_default.create({
      title,
      organization,
      description,
      officialUrl,
      status,
      category: typeof b.category === "string" ? b.category.trim() : void 0,
      opportunityType: typeof b.opportunityType === "string" ? b.opportunityType.trim() : void 0,
      location: typeof b.location === "string" ? b.location.trim() : void 0,
      deadline: typeof b.deadline === "string" && b.deadline ? b.deadline.trim() : void 0,
      fundingAmount: typeof b.fundingAmount === "string" ? b.fundingAmount.trim() : void 0,
      currency: typeof b.currency === "string" ? b.currency.trim() : void 0,
      eligibleEducationLevels: splitList(b.eligibleEducationLevels),
      eligibleFields: splitList(b.eligibleFields),
      tags: splitList(b.tags),
      verificationStatus: "Verified",
      sourceName: "Admin (manual)",
      isAiDiscovered: false,
      vectorized: false,
      priorityScore,
      dateDiscovered: /* @__PURE__ */ new Date()
    });
    invalidateOpportunityFeedCache();
    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    console.error("Error creating manual opportunity:", error);
    res.status(500).json({ success: false, error: error.message });
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

// src/services/syncOpportunities.ts
var escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var unsafeScheme = /^(?:java|vb|js)?script:|^data:|^file:|^blob:|\s/i;
var safeUrl = (url) => {
  const raw = String(url || "").trim();
  if (!raw || unsafeScheme.test(raw)) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
};
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
      s.officialUrl = safeUrl(rec.officialUrl);
      if (rec.sourceUrl) s.sourceUrl = safeUrl(rec.sourceUrl);
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
  invalidateOpportunityFeedCache();
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

// src/controllers/launchController.ts
var import_express2 = require("express");

// src/models/LaunchConfig.ts
var import_mongoose2 = __toESM(require("mongoose"));
var LaunchConfigSchema = new import_mongoose2.Schema(
  {
    launched: { type: Boolean, default: false },
    launchedAt: { type: Date, default: null },
    countdownMs: { type: Number, default: 5 * 24 * 60 * 60 * 1e3 },
    deadline: { type: Date, default: null },
    whatsappGroupUrl: { type: String, default: "" }
  },
  { timestamps: true }
);
var LaunchConfig_default = import_mongoose2.default.model("LaunchConfig", LaunchConfigSchema);

// src/models/WaitlistEntry.ts
var import_mongoose3 = __toESM(require("mongoose"));
var WaitlistEntrySchema = new import_mongoose3.Schema(
  {
    email: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true }
  },
  { timestamps: true }
);
var WaitlistEntry_default = import_mongoose3.default.model("WaitlistEntry", WaitlistEntrySchema);

// src/controllers/launchController.ts
var DAY_MS2 = 24 * 60 * 60 * 1e3;
var DEFAULT_COUNTDOWN_MS = 5 * DAY_MS2;
var WELCOME_WINDOW_MS = 2 * DAY_MS2;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var COUNT_TTL_MS = 3e4;
var cachedWaitlistCount = -1;
var cachedWaitlistCountAt = 0;
var getWaitlistCount = async () => {
  const now = Date.now();
  if (cachedWaitlistCount >= 0 && now - cachedWaitlistCountAt < COUNT_TTL_MS) {
    return cachedWaitlistCount;
  }
  cachedWaitlistCount = await WaitlistEntry_default.countDocuments();
  cachedWaitlistCountAt = now;
  return cachedWaitlistCount;
};
var isAllowedWhatsappUrl = (raw) => {
  if (!/^https:\/\//i.test(raw)) return false;
  let hostname;
  try {
    hostname = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === "wa.me" || hostname === "chat.whatsapp.com" || hostname === "whatsapp.com" || hostname.endsWith(".whatsapp.com");
};
var getConfig = async () => {
  let config = await LaunchConfig_default.findOne();
  if (!config) {
    config = await LaunchConfig_default.create({
      launched: false,
      launchedAt: null,
      countdownMs: DEFAULT_COUNTDOWN_MS,
      deadline: new Date(Date.now() + DEFAULT_COUNTDOWN_MS),
      whatsappGroupUrl: ""
    });
  } else if (!config.deadline) {
    config.deadline = new Date(Date.now() + (config.countdownMs || DEFAULT_COUNTDOWN_MS));
    await config.save();
  }
  return config;
};
var autoLaunchIfDue = async () => {
  try {
    const config = await getConfig();
    if (!config.launched && config.deadline && new Date(config.deadline).getTime() <= Date.now()) {
      config.launched = true;
      config.launchedAt = /* @__PURE__ */ new Date();
      await config.save();
    }
    return config;
  } catch (error) {
    console.error("autoLaunchIfDue failed:", error);
    return null;
  }
};
var toPublic = (config) => ({
  launched: config.launched,
  launchedAt: config.launchedAt,
  welcomeUntil: config.launchedAt ? new Date(new Date(config.launchedAt).getTime() + WELCOME_WINDOW_MS) : null,
  countdownMs: config.countdownMs,
  deadline: config.deadline,
  whatsappGroupUrl: config.whatsappGroupUrl
});
var getLaunchStatus = async (_req, res) => {
  try {
    await autoLaunchIfDue();
    const config = await getConfig();
    const waitlistCount = await getWaitlistCount();
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ success: true, ...toPublic(config), waitlistCount });
  } catch (error) {
    console.error("Failed to get launch status:", error);
    res.status(500).json({ success: false, error: "Failed to load launch status." });
  }
};
var joinWaitlist = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: "Please enter a valid email address." });
    }
    await WaitlistEntry_default.updateOne(
      { email },
      { $setOnInsert: { email } },
      { upsert: true }
    );
    const config = await getConfig();
    const waitlistCount = await getWaitlistCount();
    res.json({
      success: true,
      waitlistCount,
      whatsappGroupUrl: config.whatsappGroupUrl
    });
  } catch (error) {
    console.error("Failed to join waitlist:", error);
    res.status(500).json({ success: false, error: "Failed to join the waitlist." });
  }
};
var getAdminLaunch = async (_req, res) => {
  try {
    await autoLaunchIfDue();
    const config = await getConfig();
    const entries = await WaitlistEntry_default.find().sort({ createdAt: -1 }).limit(500).lean();
    res.json({
      success: true,
      ...toPublic(config),
      waitlistCount: entries.length,
      waitlist: entries.map((e) => ({ email: e.email, joinedAt: e.createdAt }))
    });
  } catch (error) {
    console.error("Failed to load admin launch data:", error);
    res.status(500).json({ success: false, error: "Failed to load launch data." });
  }
};
var setLaunchState = async (req, res) => {
  try {
    const launched = req.body?.launched === true;
    const config = await getConfig();
    config.launched = launched;
    config.launchedAt = launched ? /* @__PURE__ */ new Date() : null;
    if (!launched) {
      config.deadline = new Date(Date.now() + (config.countdownMs || DEFAULT_COUNTDOWN_MS));
    }
    await config.save();
    res.json({ success: true, launched: config.launched, deadline: config.deadline });
  } catch (error) {
    console.error("Failed to set launch state:", error);
    res.status(500).json({ success: false, error: "Failed to update launch state." });
  }
};
var setLaunchTimer = async (req, res) => {
  try {
    const { days, countdownMs } = req.body || {};
    let ms;
    if (typeof countdownMs === "number" && countdownMs > 0) {
      ms = countdownMs;
    } else if (typeof days === "number" && days > 0) {
      ms = days * DAY_MS2;
    } else {
      return res.status(400).json({ success: false, error: "Provide a positive countdownMs or days." });
    }
    const config = await getConfig();
    config.countdownMs = ms;
    if (!config.launched) {
      config.deadline = new Date(Date.now() + ms);
    }
    await config.save();
    res.json({ success: true, countdownMs: config.countdownMs, deadline: config.deadline });
  } catch (error) {
    console.error("Failed to set launch timer:", error);
    res.status(500).json({ success: false, error: "Failed to update the launch timer." });
  }
};
var setWhatsappGroup = async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (url && !isAllowedWhatsappUrl(url)) {
      return res.status(400).json({
        success: false,
        error: "Only https:// links to WhatsApp (whatsapp.com, wa.me, chat.whatsapp.com) are allowed."
      });
    }
    const config = await getConfig();
    config.whatsappGroupUrl = url;
    await config.save();
    res.json({ success: true, whatsappGroupUrl: config.whatsappGroupUrl });
  } catch (error) {
    console.error("Failed to set WhatsApp group:", error);
    res.status(500).json({ success: false, error: "Failed to save the WhatsApp group link." });
  }
};

// src/middleware/rateLimit.ts
var import_express_rate_limit = __toESM(require("express-rate-limit"));

// src/middleware/mongoStore.ts
var import_mongoose4 = require("mongoose");
var RateLimitSchema = new import_mongoose4.Schema(
  {
    _id: { type: String, required: true },
    counter: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true }
  },
  { versionKey: false }
);
var RateLimitModel = null;
var getModel = () => {
  if (!RateLimitModel) {
    RateLimitModel = (0, import_mongoose4.model)("RateLimit", RateLimitSchema);
    RateLimitModel.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((err) => console.error("[rate-limit] Could not create TTL index:", err));
  }
  return RateLimitModel;
};
var MongoStore = class {
  localKeys = false;
  windowMs;
  constructor() {
    this.windowMs = 60 * 1e3;
  }
  init(options) {
    this.windowMs = options.windowMs || this.windowMs;
  }
  // Optional read path used by the middleware if it needs the current count.
  async get(key) {
    const doc = await getModel().findOne({ _id: key }).lean().exec();
    if (!doc) return void 0;
    return { totalHits: doc.counter, resetTime: new Date(doc.expiresAt) };
  }
  async increment(key) {
    try {
      const expiresAt = new Date(Date.now() + this.windowMs);
      const doc = await getModel().findOneAndUpdate(
        { _id: key },
        { $inc: { counter: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, new: true }
      ).lean().exec();
      return { totalHits: doc?.counter ?? 1, resetTime: new Date(doc?.expiresAt ?? expiresAt) };
    } catch (err) {
      console.error("[rate-limit] increment failed, failing open:", err);
      return { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }
  async decrement(key) {
    try {
      await getModel().updateOne({ _id: key, counter: { $gt: 0 } }, { $inc: { counter: -1 } }).exec();
    } catch (err) {
      console.error("[rate-limit] decrement failed:", err);
    }
  }
  async resetKey(key) {
    try {
      await getModel().deleteOne({ _id: key }).exec();
    } catch (err) {
      console.error("[rate-limit] resetKey failed:", err);
    }
  }
};

// src/middleware/rateLimit.ts
var errorJson = (req, res) => {
  res.status(429).json({ success: false, error: "Too many requests. Please try again shortly." });
};
var newMongoStore = () => new MongoStore();
var windowMs = 60 * 1e3;
var makeOptions = (name, limit, opts = {}) => ({
  windowMs,
  limit,
  standardHeaders: true,
  // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  // Disable the `X-RateLimit-*` headers
  handler: errorJson,
  // req.ip is set by 'trust proxy' from the proxy chain; ipKeyGenerator
  // normalizes IPv6 -> /56 subnet so limit keys don't collide per-address when
  // the proxy forwards IPv6 clients. Prefix it so each limiter owns a disjoint
  // key space in the shared Mongo collection.
  keyGenerator: (req) => `${name}:${(0, import_express_rate_limit.ipKeyGenerator)(req.ip || req.socket.remoteAddress || "unknown")}`,
  ...opts
});
var apiLimiter = (0, import_express_rate_limit.default)(
  process.env.RATE_LIMIT_STORE === "mongo" ? makeOptions("api", 120, { store: newMongoStore() }) : makeOptions("api", 120)
);
var strictLimiter = (0, import_express_rate_limit.default)(makeOptions("strict", 20, { store: newMongoStore() }));
var chatLimiter = (0, import_express_rate_limit.default)(
  process.env.RATE_LIMIT_STORE === "mongo" ? makeOptions("chat", 20, { store: newMongoStore() }) : makeOptions("chat", 20)
);
var sensitiveLimiter = (0, import_express_rate_limit.default)(makeOptions("sensitive", 5, { store: newMongoStore() }));
var cvAnalyzeLimiter = (0, import_express_rate_limit.default)(makeOptions("cv", 5, { store: newMongoStore() }));
var waitlistLimiter = (0, import_express_rate_limit.default)(
  process.env.RATE_LIMIT_STORE === "mongo" ? makeOptions("waitlist", 5, { store: newMongoStore() }) : makeOptions("waitlist", 5)
);

// src/lib/withLock.ts
var import_mongoose5 = __toESM(require("mongoose"));
var SyncLockSchema = new import_mongoose5.Schema(
  {
    _id: { type: String, required: true },
    // lock name
    acquiredAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    owner: { type: String, required: true }
  },
  { versionKey: false }
);
var SyncLock = import_mongoose5.default.models.SyncLock || import_mongoose5.default.model("SyncLock", SyncLockSchema);
var acquire = async (name, ttlMs, owner) => {
  const now = /* @__PURE__ */ new Date();
  const result = await SyncLock.findOneAndUpdate(
    {
      _id: name,
      $or: [{ expiresAt: { $lt: now } }, { expiresAt: { $exists: false } }]
    },
    { _id: name, acquiredAt: now, expiresAt: new Date(now.getTime() + ttlMs), owner },
    { upsert: true, new: true }
  );
  return result?.owner === owner;
};
var withLock = async (name, ttlMs, fn) => {
  const owner = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const held = await acquire(name, ttlMs, owner);
  if (!held) {
    console.log(`[lock] "${name}" is held by another run \u2014 skipping.`);
    return null;
  }
  try {
    return await fn();
  } finally {
    await SyncLock.deleteOne({ _id: name, owner }).catch(() => {
    });
  }
};

// src/routes/opportunityRoutes.ts
var import_express3 = __toESM(require("express"));

// src/controllers/socialPreviewController.ts
var FRONTEND_URL = (process.env.FRONTEND_URL || "https://prime-ed.vercel.app").replace(/\/+$/, "");
var BRAND_OG_IMAGE = `${FRONTEND_URL}/prime-logo.png`;
var escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
var truncate = (text, max) => {
  const trimmed = (text || "").trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}\u2026`;
};
var cleanLevel = (level) => level.replace(/^Category\s+[A-Z]\s*[-–—]?\s*/i, "").replace(/\s*[-–—]\s*.*$/i, "").trim() || level.trim();
var joinList = (items, limit = 3, clean) => {
  if (!items || items.length === 0) return "";
  const kept = items.slice(0, limit).map((item) => clean ? clean(item) : item.trim()).filter(Boolean);
  const suffix = items.length > limit ? ` & ${items.length - limit} more` : "";
  return `${kept.join(", ")}${suffix}`;
};
var formatDeadline = (deadline) => {
  if (!deadline) return "";
  const date = new Date(deadline);
  if (isNaN(date.getTime())) return deadline;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};
var buildDescription = (opp) => {
  const parts = [];
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
    parts.push(`Funding: ${opp.fundingAmount}${opp.currency ? ` ${opp.currency}` : ""}`);
  }
  const sentence = parts.join(". ");
  if (sentence.length > 2) return truncate(`${sentence}.`, 200);
  return truncate(opp.description || "A new opportunity added on Prime Opportunity.", 200);
};
var buildShareHtml = (opts) => {
  const { appLink, ogTitle, ogDescription, ogImage, status } = opts;
  const o = (value) => escapeHtml(value);
  const statusBadge = status ? `<meta property="og:status" content="${o(status)}">` : "";
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
<p>Opening <a href="${o(appLink)}">${o(ogTitle)}</a>\u2026</p>
</body>
</html>
`;
};
var buildNotFoundHtml = () => {
  const appRoot = FRONTEND_URL;
  const ogTitle = "Opportunity Not Found";
  const ogDescription = "This opportunity is no longer available on Prime Opportunity.";
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
var getSharePreview = async (req, res) => {
  const id = req.params.id || (typeof req.query.id === "string" ? req.query.id : "");
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    res.status(404).set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "public, max-age=60, s-maxage=300").send(buildNotFoundHtml());
    return;
  }
  let opp = null;
  try {
    opp = await Opportunity_default.findById(id).select(
      "title organization description eligibleEducationLevels eligibleFields deadline fundingAmount currency status"
    ).lean();
  } catch {
    opp = null;
  }
  if (!opp) {
    res.status(404).set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "public, max-age=60, s-maxage=300").send(buildNotFoundHtml());
    return;
  }
  const appLink = `${FRONTEND_URL}/opportunities?id=${id}`;
  const ogTitle = truncate(`${opp.title || "Opportunity"}${opp.organization ? ` \xB7 ${opp.organization}` : ""}`, 70);
  const ogDescription = buildDescription(opp);
  const ogImage = BRAND_OG_IMAGE;
  res.status(200).set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "public, max-age=60, s-maxage=300").send(buildShareHtml({ appLink, ogTitle, ogDescription, ogImage, status: opp.status }));
};

// src/lib/firebaseAdmin.ts
var import_app = require("firebase-admin/app");
var import_auth = require("firebase-admin/auth");
var FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "primeopportunity-18381";
var app = null;
var initFirebaseAdmin = () => {
  if (!app) {
    app = (0, import_app.getApps)()[0] || (0, import_app.initializeApp)({ projectId: FIREBASE_PROJECT_ID });
  }
  return app;
};
var getAdminAuth = () => {
  initFirebaseAdmin();
  return (0, import_auth.getAuth)();
};

// src/models/AppUser.ts
var import_mongoose6 = __toESM(require("mongoose"));
var AppUserSchema = new import_mongoose6.Schema(
  {
    uid: { type: String, required: true, unique: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    displayName: { type: String, trim: true },
    photoURL: { type: String },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    mentorshipInterest: {
      choice: { type: String, enum: ["yes", "no", null], default: null },
      source: { type: String, enum: ["opportunity", "general"], default: "general" },
      opportunityTitle: { type: String, default: "" },
      opportunityUrl: { type: String, default: "" },
      answeredAt: { type: Date }
    }
  },
  { timestamps: true }
);
var AppUser_default = import_mongoose6.default.model("AppUser", AppUserSchema);

// src/middleware/auth.ts
var BEARER_RE = /^Bearer\s+(.+)$/i;
var verifyToken = async (req) => {
  const header = req.headers.authorization || "";
  const match = BEARER_RE.exec(header);
  if (!match?.[1]) {
    const err = new Error("Authentication required.");
    err.status = 401;
    throw err;
  }
  const decoded = await getAdminAuth().verifyIdToken(match[1].trim());
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    emailVerified: !!decoded.email_verified
  };
};
var requireAuth = async (req, res, next) => {
  try {
    req.authUser = await verifyToken(req);
    if (!req.authUser.emailVerified) {
      const user = await AppUser_default.findOne({ uid: req.authUser.uid }).select("role").lean();
      if (!user || user.role !== "admin") {
        return res.status(403).json({
          success: false,
          code: "EMAIL_NOT_VERIFIED",
          error: "Please verify your email before continuing."
        });
      }
    }
    return next();
  } catch (error) {
    return res.status(error?.status || 401).json({ success: false, error: error?.status === 401 ? "Authentication required." : "Invalid or expired session." });
  }
};
var requireAdmin = async (req, res, next) => {
  try {
    req.authUser = await verifyToken(req);
    const user = await AppUser_default.findOne({ uid: req.authUser.uid }).lean();
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Admin access only." });
    }
    return next();
  } catch (error) {
    return res.status(error?.status || 401).json({ success: false, error: error?.status === 401 ? "Authentication required." : "Invalid or expired session." });
  }
};

// src/routes/opportunityRoutes.ts
var router = import_express3.default.Router();
router.get("/", getOpportunities);
router.get("/share", getSharePreview);
router.get("/:id", getOpportunity);
router.get("/:id/share", getSharePreview);
router.post("/", requireAdmin, createManualOpportunity);
var opportunityRoutes_default = router;

// src/routes/aiRoutes.ts
var import_express5 = __toESM(require("express"));
var import_multer = __toESM(require("multer"));

// src/controllers/aiController.ts
var import_express4 = require("express");
var import_crypto2 = require("crypto");
var import_mongoose10 = require("mongoose");
var import_pdf_parse = __toESM(require("pdf-parse"));
var import_pinecone2 = require("@pinecone-database/pinecone");
var import_openai2 = __toESM(require("openai"));

// src/models/Cv.ts
var import_mongoose7 = __toESM(require("mongoose"));
var CvSchema = new import_mongoose7.Schema(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String },
    userName: { type: String },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    fileData: { type: Buffer },
    cloudinaryId: { type: String },
    cloudinaryUrl: { type: String },
    text: { type: String },
    analysis: { type: String },
    matchIds: [{ type: import_mongoose7.Schema.Types.ObjectId, ref: "Opportunity" }]
  },
  { timestamps: true }
);
CvSchema.index({ userId: 1, createdAt: -1 });
var Cv_default = import_mongoose7.default.model("Cv", CvSchema);

// src/models/Mentorship.ts
var import_mongoose8 = __toESM(require("mongoose"));
var MentorshipSchema = new import_mongoose8.Schema(
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
    provider: { type: String, enum: ["paystack"], required: true },
    reference: { type: String, required: true, unique: true },
    status: { type: String, enum: ["paid", "pending", "failed"], default: "pending" },
    note: { type: String, trim: true }
  },
  { timestamps: true }
);
MentorshipSchema.index({ status: 1 });
MentorshipSchema.index({ status: 1, mentorId: 1 });
MentorshipSchema.index({ mentorId: 1, status: 1 });
var Mentorship_default = import_mongoose8.default.model("Mentorship", MentorshipSchema);

// src/models/MentorshipComplaint.ts
var import_mongoose9 = __toESM(require("mongoose"));
var MentorshipComplaintSchema = new import_mongoose9.Schema(
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
MentorshipComplaintSchema.index({ status: 1, createdAt: -1 });
var MentorshipComplaint_default = import_mongoose9.default.model("MentorshipComplaint", MentorshipComplaintSchema);

// src/lib/cache.ts
var LRUCache = class {
  constructor(max = 500, ttlMs = 6e4) {
    this.ttlMs = ttlMs;
    this.max = max;
  }
  ttlMs;
  max;
  map = /* @__PURE__ */ new Map();
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return void 0;
    if (entry.created + this.ttlMs < Date.now()) {
      this.map.delete(key);
      return void 0;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }
  set(key, value) {
    if (this.get(key) !== void 0) return;
    this.map.set(key, { value, created: Date.now() });
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
  }
  get size() {
    return this.map.size;
  }
};
var aiReplyCache = new LRUCache(300, 30 * 60 * 1e3);
var embeddingCache = new LRUCache(2e3, 24 * 60 * 60 * 1e3);

// src/lib/cloudinary.ts
var import_crypto = require("crypto");
var CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
var API_KEY = process.env.CLOUDINARY_API_KEY || "";
var API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
var UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || "prime-cv-uploads";
var API_BASE_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;
var CV_FOLDER = "prime-opportunity/cvs";
var BASIC_AUTH = "Basic " + Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");
var isConfigured = () => Boolean(CLOUD_NAME && API_KEY && API_SECRET);
var uploadCvPdf = async (buffer, originalName) => {
  if (!isConfigured()) throw new Error("Cloudinary is not configured (missing env vars).");
  const cleanName = (originalName || "cv.pdf").replace(/[^\w.\- ]/g, "_").slice(0, 40);
  const publicId = `${Date.now()}-${(0, import_crypto.randomBytes)(4).toString("hex")}-${cleanName}`;
  const body = new URLSearchParams({
    upload_preset: UPLOAD_PRESET,
    folder: CV_FOLDER,
    public_id: publicId.replace(/\.[a-zA-Z0-9]+$/, ""),
    file: `data:application/pdf;base64,${buffer.toString("base64")}`
  });
  const res = await fetch(`${API_BASE_URL}/raw/upload`, {
    method: "POST",
    headers: { Authorization: BASIC_AUTH },
    body
  });
  const bodyJson = await res.json().catch(() => ({}));
  if (!res.ok || !bodyJson?.public_id) {
    throw new Error(
      `Cloudinary upload failed (HTTP ${res.status}): ${bodyJson?.error?.message || res.statusText || "unknown"}`
    );
  }
  return {
    cloudinaryId: bodyJson.public_id,
    cloudinaryUrl: bodyJson.secure_url || `https://res.cloudinary.com/${CLOUD_NAME}/raw/upload/${bodyJson.public_id}`
  };
};
var destroyCvPdf = async (publicId) => {
  try {
    if (!isConfigured()) return;
    const body = new URLSearchParams({ public_id: publicId });
    const res = await fetch(`${API_BASE_URL}/raw/destroy`, {
      method: "POST",
      headers: {
        Authorization: BASIC_AUTH,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    if (!res.ok) {
      console.error(
        "Cloudinary destroy failed (best-effort):",
        res.status,
        await res.text().catch(() => "")
      );
    }
  } catch (error) {
    console.error("Cloudinary destroy failed (best-effort):", error);
  }
};

// ../shared/chatPolicies.ts
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
var buildMentorshipReply = (fee, currency) => `Great choice! Our **mentorship guidance** pairs you with an industry mentor who reviews your applications, coaches you, and boosts your chances of getting in.

It costs **${currency} ${Number(fee).toLocaleString()}** per opportunity and you can pay securely right from the page.

Click the button below to get started.`;
var buildComplaintReply = (userEmail, ticket) => `I'm sorry to hear that \u2014 you should already have a mentor after paying.

I've sent your message straight to our admin team along with your account details (email: ${userEmail || "not provided"}). You don't need to do anything else; someone will follow up on your payment and assign a mentor as soon as possible.

Your ticket number is **${ticket}** \u2014 you can reference it if you reach out again.`;
var serializeOpportunities = (opps) => opps.map(
  (opp, idx) => `[${idx + 1}] ${opp.title || ""} at ${opp.organization || ""}
Type: ${opp.opportunityType || "Unknown"}
Category: ${opp.category || "N/A"}
Location: ${opp.location || "N/A"}
Field(s): ${opp.eligibleFields && opp.eligibleFields.length > 0 ? opp.eligibleFields.join(", ") : "N/A"}
Eligibility: ${opp.eligibleEducationLevels && opp.eligibleEducationLevels.length > 0 ? opp.eligibleEducationLevels.join(", ") : opp.targetAudience && opp.targetAudience.length > 0 ? opp.targetAudience.join(", ") : "N/A"}
Deadline: ${opp.deadline ? String(opp.deadline) : "Not specified"}
Status: ${opp.status || "Unknown"}
Tags: ${opp.tags && opp.tags.length > 0 ? opp.tags.join(", ") : "None"}
Description: ${opp.description || "N/A"}
More info: ${opp.officialUrl || "N/A"}`
).join("\n\n");
var buildSystemPrompt = (opts) => {
  const { userCvContext, retrievedContext } = opts;
  return `You are PrimeOpportunity AI, a friendly and knowledgeable assistant for PrimeOpportunity \u2014 a platform that helps Nigerian students and early-career professionals discover tailored scholarships, internships, graduate trainee programmes, and fellowships.

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
};

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
var nvidiaChatClient2 = new import_openai2.default({
  apiKey: process.env.NVIDIA_API_KEY_2,
  baseURL: "https://integrate.api.nvidia.com/v1",
  timeout: 9e4,
  maxRetries: 1
});
var LLM_ATTEMPT_TIMEOUT_MS = 3e4;
var MAX_INFLIGHT_LLM = 5;
var inflightLlm = 0;
var llmWaiters = [];
var acquireLlm = async () => {
  while (inflightLlm >= MAX_INFLIGHT_LLM) {
    await new Promise((resolve) => {
      llmWaiters.push(resolve);
    });
  }
  inflightLlm += 1;
};
var releaseLlm = () => {
  inflightLlm -= 1;
  llmWaiters.shift()?.();
};
var withLlmSlot = async (fn) => {
  await acquireLlm();
  try {
    return await fn();
  } finally {
    releaseLlm();
  }
};
var chatModelAttempts = () => {
  const attempts = [];
  const models = [
    "meta/muse-glimmer-30b",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "z-ai/glm-5.3-flash"
  ];
  for (const model2 of models) {
    attempts.push({ client: nvidiaChatClient, model: model2 });
    attempts.push({ client: nvidiaChatClient2, model: model2 });
  }
  return attempts;
};
var describeLlmError = (err) => {
  const status = err?.status ? `HTTP ${err.status}` : "NO_STATUS";
  let body = "";
  try {
    if (typeof err?.body === "string") body = err.body;
    else if (err?.body) body = JSON.stringify(err.body);
  } catch {
    body = "";
  }
  if (!body && err?.message) body = err.message;
  const extra = err?.code ? ` code=${err.code}` : "";
  return `${status}${extra} ${String(body).slice(0, 400)}`.trim();
};
async function completeChat(messages, opts = {}) {
  const failures = [];
  for (const attempt of chatModelAttempts()) {
    const { client, model: model2 } = attempt;
    for (let round = 0; round < 2; round++) {
      const retrying = round === 1;
      try {
        let content = "";
        await withLlmSlot(async () => {
          const completion = await client.chat.completions.create(
            {
              model: model2,
              messages,
              temperature: opts.temperature ?? 0.6,
              top_p: 0.95,
              max_tokens: opts.maxTokens ?? 700,
              // NVIDIA AI Endpoints returns HTTP 400 with an EMPTY body for these
              // reasoning models when stream:false is used. Streaming is the only
              // reliable mode, so ALWAYS request a stream and accumulate the deltas.
              stream: true
            },
            // timeout/maxRetries/signal are REQUEST OPTIONS, not body parameters.
            // Passing them inside the body used to be sent to NVIDIA as
            // `"Unsupported parameter(s): timeout, maxRetries"` (a bare 400 for
            // muse, an explicit validation error for nemotron), which made every
            // model fail. As the second SDK argument they abort the attempt and are
            // never serialized into the payload.
            { timeout: LLM_ATTEMPT_TIMEOUT_MS, maxRetries: 0 }
          );
          for await (const chunk of completion) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) content += delta;
          }
        });
        if (content.trim()) {
          console.log(`LLM OK via ${model2}`);
          return { content, model: model2 };
        }
        if (!retrying) {
          failures.push(`${model2} -> empty completion, retrying...`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        failures.push(`${model2} -> empty completion`);
      } catch (err) {
        const detail = describeLlmError(err);
        const soft = /empty|timeout|ResourceExhausted|429|too many|overloaded|unavailable/i.test(detail);
        if (!retrying && soft) {
          failures.push(`${model2} -> ${detail}, retrying...`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        failures.push(`${model2} -> ${detail}`);
        console.warn(`LLM model ${model2} failed: ${detail}`);
      }
      break;
    }
  }
  throw new Error(failures.join(" | ") || "All configured LLM providers failed.");
}
var CHAT_RATE_LIMIT = { CEILING: 3, WINDOW_MS: 6e4 };
var chatBuckets = /* @__PURE__ */ new Map();
var chatRateLimitCheck = (uid) => {
  const now = Date.now();
  const entry = chatBuckets.get(uid);
  if (!entry) {
    chatBuckets.set(uid, { tokens: CHAT_RATE_LIMIT.CEILING - 1, last: now });
    return true;
  }
  const refill = (now - entry.last) / CHAT_RATE_LIMIT.WINDOW_MS * CHAT_RATE_LIMIT.CEILING;
  entry.tokens = Math.min(CHAT_RATE_LIMIT.CEILING, entry.tokens + refill);
  entry.last = now;
  if (entry.tokens < 1) return false;
  entry.tokens -= 1;
  return true;
};
var CHAT_RATE_SWEEP_MS = 6e4;
var sweepChatBuckets = () => {
  const cutoff = Date.now() - 2 * CHAT_RATE_LIMIT.WINDOW_MS;
  for (const [uid, entry] of chatBuckets) {
    if (entry.last < cutoff) chatBuckets.delete(uid);
  }
};
setInterval(sweepChatBuckets, CHAT_RATE_SWEEP_MS).unref();
var CV_NAMESPACE_PREFIX = "cvs-";
var embedText = async (text) => {
  const key = (0, import_crypto2.createHash)("sha256").update(text).digest("hex");
  const cached = embeddingCache.get(key);
  if (cached) return cached;
  const response = await nvidiaEmbedClient.embeddings.create({
    model: "nvidia/nemotron-3-embed-1b",
    input: text
  });
  const vector = response.data[0].embedding;
  embeddingCache.set(key, vector);
  return vector;
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
  return buildComplaintReply(userEmail, ticket);
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
var namespaceLocks = /* @__PURE__ */ new Map();
async function withNamespaceLock(namespace, fn) {
  const previous = namespaceLocks.get(namespace) ?? Promise.resolve();
  let releaseLock;
  const current = new Promise((resolve) => {
    releaseLock = resolve;
  });
  const tail = previous.then(() => current);
  namespaceLocks.set(namespace, tail);
  await previous;
  try {
    return await fn();
  } finally {
    releaseLock();
    if (namespaceLocks.get(namespace) === tail) {
      namespaceLocks.delete(namespace);
    }
  }
}
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
async function runCvMatch({ cvText, userId, userEmail, userName, fileName, contentType, fileData, cloudinaryId, cloudinaryUrl, existingCvId, replaceSameFile }) {
  const truncatedCVText = cvText.substring(0, 4e3);
  const cvVector = await embedText(truncatedCVText);
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
  let analysis = "";
  try {
    const result = await completeChat(
      [{ role: "user", content: prompt }],
      { temperature: 0.7, maxTokens: 1024 }
    );
    analysis = result.content;
  } catch (llmErr) {
    console.error("All LLM models failed during CV match:", llmErr);
    analysis = `Your top matching opportunities were updated. The AI summary is temporarily unavailable \u2014 try refreshing the analysis again in a moment. (Server detail: ${llmErr?.message || "unknown"})`;
  }
  let cv;
  if (existingCvId) {
    cv = await Cv_default.findById(existingCvId);
    if (!cv) {
      throw new Error("The saved CV no longer exists. Please upload a fresh PDF.");
    }
    cv.userEmail = userEmail;
    cv.userName = userName;
    cv.fileName = fileName;
    cv.contentType = contentType;
    if (fileData) cv.fileData = fileData;
    if (cloudinaryId) {
      cv.cloudinaryId = cloudinaryId;
      cv.cloudinaryUrl = cloudinaryUrl || cv.cloudinaryUrl;
    }
    cv.text = cvText;
    cv.analysis = analysis;
    cv.matchIds = sortedOpportunities.map((o) => o._id);
  } else {
    cv = new Cv_default({
      userId,
      userEmail,
      userName,
      fileName,
      contentType,
      ...fileData ? { fileData } : {},
      ...cloudinaryId ? { cloudinaryId, cloudinaryUrl } : {},
      text: cvText,
      analysis,
      matchIds: sortedOpportunities.map((o) => o._id)
    });
  }
  await cv.save();
  if (!existingCvId && replaceSameFile) {
    try {
      const dups = await Cv_default.find({ _id: { $ne: cv._id }, userId, fileName }).select("cloudinaryId").lean();
      if (dups.length > 0) {
        await Cv_default.deleteMany({ _id: { $in: dups.map((d) => d._id) } });
        await Promise.allSettled(
          dups.filter((d) => d.cloudinaryId).map((d) => destroyCvPdf(d.cloudinaryId))
        );
      }
    } catch (dupErr) {
      console.error("Could not remove older duplicate CVs:", dupErr);
    }
  }
  try {
    const cvNamespace = `${CV_NAMESPACE_PREFIX}${userId}`;
    await withNamespaceLock(
      cvNamespace,
      () => seedUserCvVectors(cvText, userId, cv._id.toString(), fileName)
    );
  } catch (vecErr) {
    console.error("Could not seed CV vectors to Pinecone:", vecErr);
  }
  return { analysis, matches: sortedOpportunities, cvId: cv._id.toString() };
}
var analyzeCV = async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "No CV file uploaded." });
      return;
    }
    const PDF_MAGIC = Buffer.from("%PDF-", "utf8");
    if (!req.file.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      res.status(400).json({ success: false, message: "Only PDF files are allowed." });
      return;
    }
    let pdfData;
    try {
      pdfData = await (0, import_pdf_parse.default)(req.file.buffer);
    } catch (pdfErr) {
      console.error("PDF parsing failed:", pdfErr);
      res.status(400).json({
        success: false,
        message: "Could not read this PDF. It may be password-protected or damaged \u2014 re-export it as a standard text PDF and try again.",
        error: pdfErr?.message
      });
      return;
    }
    const cvText = (pdfData.text || "").trim();
    if (!cvText) {
      res.status(400).json({ success: false, message: "Could not extract text from the provided PDF." });
      return;
    }
    const userId = req.authUser.uid;
    let cloudinaryId;
    let cloudinaryUrl;
    try {
      const up = await uploadCvPdf(req.file.buffer, req.file.originalname);
      cloudinaryId = up.cloudinaryId;
      cloudinaryUrl = up.cloudinaryUrl;
    } catch (upErr) {
      console.error("Cloudinary upload failed \u2014 falling back to storing the PDF in Mongo:", upErr);
    }
    const { analysis, matches, cvId } = await runCvMatch({
      cvText,
      userId,
      userEmail: req.authUser.email || "",
      userName: req.body.userName || "",
      fileName: req.file.originalname,
      contentType: req.file.mimetype,
      fileData: cloudinaryId ? void 0 : req.file.buffer,
      cloudinaryId,
      cloudinaryUrl,
      replaceSameFile: true
    });
    res.json({ success: true, analysis, matches, cvId });
  } catch (error) {
    console.error("Error analyzing CV:", error);
    res.status(500).json({
      success: false,
      message: "Failed to analyze CV.",
      error: error.message
    });
  }
};
var reanalyzeCV = async (req, res) => {
  try {
    const userId = req.authUser.uid;
    const latestCv = await Cv_default.findOne({ userId }).sort({ createdAt: -1 });
    if (!latestCv) {
      res.status(400).json({ success: false, message: "No saved CV found. Upload a CV first." });
      return;
    }
    const cvText = (latestCv.text || "").trim();
    if (!cvText) {
      res.status(400).json({ success: false, message: "Saved CV has no extractable text. Upload a fresh PDF." });
      return;
    }
    const { analysis, matches, cvId } = await runCvMatch({
      cvText,
      userId,
      userEmail: req.authUser.email || latestCv.userEmail || "",
      fileName: latestCv.fileName,
      contentType: latestCv.contentType,
      fileData: latestCv.fileData,
      userName: req.body?.userName || latestCv.userName || "",
      existingCvId: latestCv._id.toString()
    });
    res.json({ success: true, analysis, matches, cvId });
  } catch (error) {
    console.error("Error re-analyzing CV:", error);
    res.status(500).json({
      success: false,
      message: "Failed to re-analyze CV.",
      error: error.message
    });
  }
};
var chatWithAI = async (req, res) => {
  try {
    const message = (req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ success: false, message: "Message is required." });
      return;
    }
    if (message.length > 2e3) {
      res.status(400).json({ success: false, message: "Message exceeds the 2000 character limit." });
      return;
    }
    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const history = rawHistory.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-10);
    const userId = req.authUser.uid;
    const userEmail = (req.authUser.email || "").trim();
    const userName = (req.body?.userName || "").trim();
    const stream = req.body?.stream === true;
    if (!chatRateLimitCheck(userId)) {
      res.setHeader("Retry-After", String(Math.ceil(CHAT_RATE_LIMIT.WINDOW_MS / 1e3)));
      res.status(429).json({ success: false, message: "You are sending messages too quickly. Please slow down and try again in a moment." });
      return;
    }
    const startSse = () => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
    };
    const writeSse = (frame) => {
      if (stream && !res.writableEnded) res.write(`data: ${JSON.stringify(frame)}

`);
    };
    const respondDone = (reply2, action) => {
      if (stream) {
        writeSse({ type: "done", reply: reply2, action: action || null });
        res.end();
      } else {
        res.json({ success: true, reply: reply2, action: action || void 0 });
      }
    };
    if (stream) {
      startSse();
    }
    const cacheKey = (0, import_crypto2.createHash)("sha256").update(`${userId}|${message}`).digest("hex");
    const cached = aiReplyCache.get(cacheKey);
    if (cached) {
      return respondDone(cached.reply);
    }
    if (isOffTopic(message)) {
      return respondDone(OFF_TOPIC_REFUSAL);
    }
    if (hasMentorshipComplaint(message)) {
      const reply2 = await handleMentorshipComplaint(message, userId, userEmail, userName);
      return respondDone(reply2);
    }
    if (hasMentorshipIntent(message)) {
      const fee = parseInt(process.env.MENTORSHIP_FEE || "20000", 10) || 2e4;
      const currency = process.env.MENTORSHIP_CURRENCY || "NGN";
      return respondDone(
        buildMentorshipReply(String(fee), currency),
        { type: "mentorship" }
      );
    }
    const messageVector = await embedText(message);
    const index = pinecone2.index(INDEX_NAME2);
    const cvNamespace = userId ? `${CV_NAMESPACE_PREFIX}${userId}` : null;
    const [queryResponse, cvQuery] = await Promise.all([
      index.query({ vector: messageVector, topK: 5, includeMetadata: true }),
      cvNamespace ? index.namespace(cvNamespace).query({ vector: messageVector, topK: 4, includeMetadata: true }).catch((err) => {
        console.error("Could not query user CV namespace:", err?.message || err);
        return null;
      }) : Promise.resolve(null)
    ]);
    const matchIds = queryResponse.matches.map((match) => match.id);
    let retrievedContext = "No specific opportunities were retrieved for this question. Answer generally using your knowledge.";
    if (matchIds.length > 0) {
      const matchedOpportunities = await Opportunity_default.find({ _id: { $in: matchIds } });
      const sortedOpportunities = matchIds.map((id) => matchedOpportunities.find((o) => o._id.toString() === id)).filter(Boolean);
      if (sortedOpportunities.length > 0) {
        retrievedContext = serializeOpportunities(sortedOpportunities);
      }
    }
    let userCvContext = "";
    if (userId && cvNamespace) {
      try {
        let cvChunks = (cvQuery?.matches || []).filter((match) => match.metadata && typeof match.metadata.text === "string").map((match) => match.metadata.text);
        if (cvChunks.length === 0) {
          await withNamespaceLock(cvNamespace, async () => {
            const recheck = await index.namespace(cvNamespace).query({
              vector: messageVector,
              topK: 4,
              includeMetadata: true
            });
            const recheckChunks = recheck.matches.filter((match) => match.metadata && typeof match.metadata.text === "string").map((match) => match.metadata.text);
            if (recheckChunks.length > 0) {
              cvChunks = recheckChunks;
              return;
            }
            const existingCv = await Cv_default.findOne({ userId }).sort({ createdAt: -1 }).select("text fileName _id");
            if (existingCv) {
              console.log(`Self-healing CV vectors for userId=${userId}...`);
              await seedUserCvVectors(
                existingCv.text,
                userId,
                existingCv._id.toString(),
                existingCv.fileName
              );
              const healedQuery = await index.namespace(cvNamespace).query({
                vector: messageVector,
                topK: 4,
                includeMetadata: true
              });
              cvChunks = healedQuery.matches.filter((match) => match.metadata && typeof match.metadata.text === "string").map((match) => match.metadata.text);
            }
          });
        }
        if (cvChunks.length > 0) {
          userCvContext = cvChunks.join("\n\n");
        }
      } catch (cvErr) {
        console.error("Could not retrieve user CV context:", cvErr);
      }
    }
    const systemPrompt = buildSystemPrompt({ userCvContext, retrievedContext });
    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message }
    ];
    const abort = new AbortController();
    req.on("close", () => abort.abort());
    if (stream) {
      let reply2 = "";
      let streamed = false;
      for (const attempt of chatModelAttempts()) {
        if (abort.signal.aborted) break;
        for (let round = 0; round < 2; round++) {
          const retrying = round === 1;
          try {
            await withLlmSlot(async () => {
              const completion = await attempt.client.chat.completions.create(
                {
                  model: attempt.model,
                  messages,
                  temperature: 0.6,
                  top_p: 0.95,
                  max_tokens: 700,
                  stream: true
                },
                // timeout/maxRetries/signal are request options — NVIDIA rejects
                // them in the body ("Unsupported parameter(s): ...").
                { timeout: LLM_ATTEMPT_TIMEOUT_MS, maxRetries: 0, signal: abort.signal }
              );
              streamed = true;
              for await (const chunk of completion) {
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) {
                  reply2 += delta;
                  writeSse({ type: "delta", text: delta });
                }
              }
            });
            if (reply2.trim()) break;
          } catch (err) {
            const detail = describeLlmError(err);
            const soft = /empty|timeout|ResourceExhausted|429|too many|overloaded|unavailable/i.test(detail);
            console.warn(`Chat stream model ${attempt.model} failed: ${detail}${retrying ? "" : ", retrying..."}`);
            if (!retrying && soft) {
              await new Promise((r) => setTimeout(r, 1500));
              continue;
            }
          }
          break;
        }
        if (reply2.trim() || abort.signal.aborted) break;
      }
      if (!streamed) {
        writeSse({ type: "error", message: "All AI providers are unavailable right now. Please try again shortly." });
        return res.end();
      }
      if (!reply2.trim()) {
        reply2 = "Sorry, I could not generate a response. Please try again.";
      }
      aiReplyCache.set(cacheKey, { reply: reply2 });
      writeSse({ type: "done", reply: reply2 });
      res.end();
      return;
    }
    const { content: nonStreamReply } = await completeChat(messages, { temperature: 0.6, maxTokens: 700 });
    const reply = nonStreamReply.trim() || "Sorry, I could not generate a response. Please try again.";
    aiReplyCache.set(cacheKey, { reply });
    res.json({ success: true, reply });
  } catch (error) {
    console.error("Error in AI chat:", error);
    if (res.headersSent && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: "error", message: "Failed to process chat message." })}

`);
      return res.end();
    }
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
    const userId = req.authUser.uid;
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
    const userId = req.authUser.uid;
    if (!(0, import_mongoose10.isValidObjectId)(cvId)) {
      res.status(400).json({ success: false, message: "Invalid CV id." });
      return;
    }
    const cv = await Cv_default.findOne({ _id: cvId, userId });
    if (!cv) {
      res.status(404).json({ success: false, message: "CV not found." });
      return;
    }
    if (cv.cloudinaryUrl) {
      return res.redirect(302, cv.cloudinaryUrl);
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
    const userId = req.authUser.uid;
    if (!(0, import_mongoose10.isValidObjectId)(cvId)) {
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
    if (cv.cloudinaryId) {
      await destroyCvPdf(cv.cloudinaryId);
    }
    res.json({ success: true, message: "CV deleted." });
  } catch (error) {
    console.error("Error deleting CV:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete CV.",
      error: error.message
    });
  }
};
var getRetrievedOpportunityContext = async (req, res) => {
  try {
    const rawIds = req.body?.ids;
    const ids = Array.isArray(rawIds) ? rawIds.filter((id) => typeof id === "string" && (0, import_mongoose10.isValidObjectId)(id)).slice(0, 8) : [];
    if (ids.length === 0) {
      return res.json({ success: true, context: null });
    }
    const docs = await Opportunity_default.find({ _id: { $in: ids } }).lean();
    const sorted = ids.map((id) => docs.find((d) => d._id.toString() === id)).filter((d) => !!d);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json({
      success: true,
      context: sorted.length > 0 ? serializeOpportunities(sorted) : null
    });
  } catch (error) {
    console.error("Failed to build opportunity context:", error);
    res.status(500).json({ success: false, error: "Failed to build opportunity context." });
  }
};
var recordMentorshipComplaint = async (req, res) => {
  try {
    const message = (req.body?.message || "").trim().slice(0, 2e3);
    if (!message) {
      return res.status(400).json({ success: false, error: "Message is required." });
    }
    const reply = await handleMentorshipComplaint(
      message,
      req.authUser.uid,
      req.authUser.email || "",
      req.body?.userName || ""
    );
    res.json({ success: true, reply });
  } catch (error) {
    console.error("Failed to record mentorship complaint:", error);
    res.status(500).json({ success: false, error: "Failed to record mentorship complaint." });
  }
};

// src/routes/aiRoutes.ts
var router2 = import_express5.default.Router();
var storage = import_multer.default.memoryStorage();
var upload = (0, import_multer.default)({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  // 5MB limit
  // First boundary layer: accept only PDF-claimed uploads. Note multer's
  // fileFilter runs BEFORE the file buffer exists, so it can only trust the
  // declared Content-Type — browsers legitimately send application/pdf, but
  // some clients label PDFs as application/octet-stream. The authoritative
  // check is the %PDF- magic-byte gate in analyzeCV, which runs on the actual
  // buffer before pdf-parse (second boundary layer).
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.mimetype === "application/octet-stream") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  }
});
router2.post("/analyze-cv", cvAnalyzeLimiter, requireAuth, upload.single("cv"), analyzeCV);
router2.post("/reanalyze-cv", cvAnalyzeLimiter, requireAuth, reanalyzeCV);
router2.get("/my-cvs", requireAuth, getMyCVs);
router2.get("/cv/:cvId/download", requireAuth, downloadCV);
router2.delete("/cv/:cvId", requireAuth, deleteCV);
router2.post("/chat", requireAuth, chatWithAI);
router2.post("/opportunity-context", requireAuth, getRetrievedOpportunityContext);
router2.post("/mentorship-complaint", requireAuth, recordMentorshipComplaint);
var aiRoutes_default = router2;

// src/routes/mentorRoutes.ts
var import_express7 = __toESM(require("express"));

// src/controllers/mentorController.ts
var import_express6 = require("express");

// src/models/Mentor.ts
var import_mongoose11 = __toESM(require("mongoose"));
var MentorSchema = new import_mongoose11.Schema(
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
MentorSchema.index({ status: 1 });
var Mentor_default = import_mongoose11.default.model("Mentor", MentorSchema);

// src/controllers/mentorController.ts
var MENTOR_CUT = 0.9;
var registerMentor = async (req, res) => {
  try {
    const userId = req.authUser.uid;
    const { name, email, company, roleType, careerStory } = req.body;
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
    const userId = req.authUser.uid;
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
    const userId = req.authUser.uid;
    const mentor = await Mentor_default.findOne({ userId }).lean();
    if (!mentor || mentor.status !== "approved") {
      res.status(403).json({
        success: false,
        message: "Only approved mentors can access the mentor dashboard."
      });
      return;
    }
    const myMentees = await Mentorship_default.find({ mentorId: userId, status: "paid" }).sort({ createdAt: -1 }).lean();
    const openRequests = await Mentorship_default.find(
      { status: "paid", mentorId: null },
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
        createdAt: 1
      }
    ).sort({ createdAt: -1 }).lean();
    const totalPaid = myMentees.reduce((sum, m) => sum + (m.amount || 0), 0);
    const redactOpenRequest = (r) => ({
      _id: r._id,
      opportunityId: r.opportunityId || null,
      opportunityTitle: r.opportunityTitle || "",
      opportunityOrg: r.opportunityOrg || "",
      opportunityType: r.opportunityType || "",
      opportunityCategory: r.opportunityCategory || "",
      userName: r.userName ? `${r.userName.charAt(0)}***` : "",
      amount: r.amount || 0,
      currency: r.currency || "NGN",
      note: r.note || "",
      createdAt: r.createdAt
    });
    res.json({
      success: true,
      mentor,
      myMentees,
      openRequests: openRequests.map(redactOpenRequest),
      totalMentees: myMentees.length,
      totalEarned: totalPaid * MENTOR_CUT
    });
  } catch (error) {
    console.error("Error fetching mentor dashboard:", error);
    res.status(500).json({ success: false, message: "Failed to fetch mentor dashboard." });
  }
};

// src/routes/mentorRoutes.ts
var router3 = import_express7.default.Router();
router3.post("/register", requireAuth, registerMentor);
router3.get("/profile", requireAuth, getMentorProfile);
router3.get("/dashboard", requireAuth, getMentorDashboard);
var mentorRoutes_default = router3;

// src/routes/syncRoutes.ts
var import_express8 = __toESM(require("express"));
var router4 = import_express8.default.Router();
var SYNC_LOCK_NAME = "opportunity-sync";
var SYNC_LOCK_TTL_MS = 45 * 60 * 1e3;
router4.post("/run", requireAdmin, async (_req, res) => {
  try {
    const result = await withLock(SYNC_LOCK_NAME, SYNC_LOCK_TTL_MS, runOpportunitySync);
    if (!result) {
      res.status(409).json({ success: false, error: "A sync is already running. Try again shortly." });
      return;
    }
    res.json({ success: true, result });
  } catch (error) {
    console.error("Manual sync failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
var syncRoutes_default = router4;

// src/routes/applicationRoutes.ts
var import_express10 = __toESM(require("express"));

// src/controllers/applicationController.ts
var import_express9 = require("express");

// src/models/Application.ts
var import_mongoose12 = __toESM(require("mongoose"));
var ApplicationSchema = new import_mongoose12.Schema(
  {
    userId: { type: String, required: true, index: true },
    opportunityId: { type: import_mongoose12.Schema.Types.ObjectId, ref: "Opportunity", required: true },
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
var Application_default = import_mongoose12.default.model("Application", ApplicationSchema);

// src/controllers/applicationController.ts
var VALID_STATUSES = ["saved", "applied", "interview", "accepted", "rejected"];
var populateApplication = (app3) => {
  const opp = app3.opportunityId?._doc || app3.opportunityId;
  return {
    _id: app3._id.toString(),
    opportunityId: (app3.opportunityId?._id || app3.opportunityId)?.toString(),
    status: app3.status,
    clicked: app3.clicked,
    clickedAt: app3.clickedAt || null,
    dateApplied: app3.dateApplied || null,
    updatedAt: app3.updatedAt || null,
    opportunity: opp ? { ...opp } : null
  };
};
var getApplications = async (req, res) => {
  try {
    const userId = req.authUser.uid;
    const apps = await Application_default.find({ userId }).populate("opportunityId").sort({ updatedAt: -1 });
    res.json({ success: true, count: apps.length, data: apps.map(populateApplication) });
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};
var upsertApplication = async (req, res) => {
  try {
    const userId = req.authUser.uid;
    const opportunityId = req.body?.opportunityId || "";
    const status = req.body?.status;
    const clicked = req.body?.clicked === true;
    if (!opportunityId) {
      res.status(400).json({ success: false, message: "opportunityId is required" });
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
      if (updates.status) existing.status = updates.status;
      if (updates.dateApplied) existing.dateApplied = updates.dateApplied;
      if (updates.clicked === true) existing.clicked = true;
      if (updates.clickedAt) existing.clickedAt = updates.clickedAt;
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
var router5 = import_express10.default.Router();
router5.get("/", requireAuth, getApplications);
router5.post("/", requireAuth, upsertApplication);
var applicationRoutes_default = router5;

// src/routes/mentorshipRoutes.ts
var import_express12 = __toESM(require("express"));

// src/controllers/mentorshipController.ts
var import_express11 = require("express");
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
      note
    } = req.body || {};
    const userId = req.authUser.uid;
    if (!reference) {
      return res.status(400).json({ success: false, error: "Payment reference is required." });
    }
    if (provider !== "paystack") {
      return res.status(400).json({ success: false, error: "Unknown payment provider." });
    }
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(400).json({
        success: false,
        error: "Card payments are not enabled yet. Please try again later."
      });
    }
    let status = "pending";
    const expectedAmount = GUIDANCE_AMOUNT;
    const finalAmount = Number(amount);
    if (!Number.isFinite(finalAmount) || finalAmount < 0) {
      return res.status(400).json({ success: false, error: "Invalid amount." });
    }
    if (finalAmount !== expectedAmount) {
      status = "failed";
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
      amount: finalAmount,
      currency: currency || GUIDANCE_CURRENCY,
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
    const userId = req.authUser.uid;
    const records = await Mentorship_default.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, count: records.length, data: records });
  } catch (error) {
    console.error("Failed to list mentorship requests:", error);
    res.status(500).json({ success: false, error: "Failed to list mentorship requests." });
  }
};

// src/routes/mentorshipRoutes.ts
var router6 = import_express12.default.Router();
router6.get("/config", getMentorshipConfig);
router6.get("/", requireAuth, getMentorships);
router6.post("/", requireAuth, createMentorshipRequest);
var mentorshipRoutes_default = router6;

// src/routes/userRoutes.ts
var import_express14 = __toESM(require("express"));

// src/controllers/userController.ts
var import_express13 = require("express");
var ADMIN_UIDS = new Set(
  (process.env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean)
);
var syncUser = async (req, res) => {
  try {
    const uid = req.authUser.uid;
    const { email, displayName, photoURL } = req.body || {};
    const role = ADMIN_UIDS.has(String(uid)) ? "admin" : "user";
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
        setDefaultsOnInsert: true
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
    const uid = req.authUser.uid;
    const user = await AppUser_default.findOne({ uid }).lean();
    res.json({
      success: true,
      user: user ? { uid: user.uid, email: user.email, displayName: user.displayName, role: user.role } : null
    });
  } catch (error) {
    console.error("Failed to fetch user:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user." });
  }
};
var recordMentorshipInterest = async (req, res) => {
  try {
    const uid = req.authUser.uid;
    const { choice, source, opportunityTitle, opportunityUrl } = req.body || {};
    if (choice !== "yes" && choice !== "no") {
      return res.status(400).json({ success: false, error: 'choice must be "yes" or "no".' });
    }
    const user = await AppUser_default.findOneAndUpdate(
      { uid: String(uid) },
      {
        $set: {
          mentorshipInterest: {
            choice,
            source: source === "opportunity" ? "opportunity" : "general",
            opportunityTitle: String(opportunityTitle || ""),
            opportunityUrl: String(opportunityUrl || ""),
            answeredAt: /* @__PURE__ */ new Date()
          }
        },
        $setOnInsert: { role: "user" }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, mentorshipInterest: user ? user.mentorshipInterest : null });
  } catch (error) {
    console.error("Failed to record mentorship interest:", error);
    res.status(500).json({ success: false, error: "Failed to record mentorship interest." });
  }
};

// src/routes/userRoutes.ts
var router7 = import_express14.default.Router();
router7.post("/", requireAuth, syncUser);
router7.get("/", requireAuth, getUser);
router7.post("/mentorship-interest", requireAuth, recordMentorshipInterest);
var userRoutes_default = router7;

// src/routes/adminRoutes.ts
var import_express16 = __toESM(require("express"));

// src/controllers/adminController.ts
var import_express15 = require("express");
var import_mongoose13 = require("mongoose");
var PLATFORM_CUT = 0.1;
var getOverview = async (_req, res) => {
  try {
    const [totalUsers, totalMentors, pendingMentorApplications, totalMentees, revenueAgg] = await Promise.all([
      AppUser_default.countDocuments(),
      Mentor_default.countDocuments({ status: "approved" }),
      Mentor_default.countDocuments({ status: "pending" }),
      Mentorship_default.countDocuments({ status: "paid", mentorId: { $ne: null } }),
      Mentorship_default.aggregate([
        { $match: { status: "paid" } },
        { $group: { _id: null, gross: { $sum: { $ifNull: ["$amount", 0] } }, count: { $sum: 1 } } }
      ])
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
        createdAt: u.createdAt,
        mentorshipInterest: u.mentorshipInterest || null
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
    const stats = await Mentorship_default.aggregate([
      { $match: { status: "paid", mentorId: { $ne: null } } },
      { $group: { _id: "$mentorId", total: { $sum: 1 }, gross: { $sum: { $ifNull: ["$amount", 0] } } } }
    ]);
    const statsByMentor = new Map(stats.map((s) => [s._id, s]));
    const results = mentors.map((m) => {
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
        createdAt: m.createdAt
      };
    });
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
    if (!(0, import_mongoose13.isValidObjectId)(id)) {
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
var router8 = import_express16.default.Router();
router8.use(requireAdmin);
router8.get("/overview", getOverview);
router8.get("/users", listUsers);
router8.get("/mentors", listMentors);
router8.get("/mentees", listMentees);
router8.get("/complaints", listComplaints);
router8.get("/launch", getAdminLaunch);
router8.post("/launch/state", setLaunchState);
router8.post("/launch/timer", setLaunchTimer);
router8.post("/launch/whatsapp", setWhatsappGroup);
router8.post("/users/:uid/promote", promoteUser);
router8.post("/mentors/:uid/:action", reviewMentorApplication);
router8.post("/complaints/:id/resolve", resolveComplaint);
var adminRoutes_default = router8;

// src/routes/launchRoutes.ts
var import_express17 = __toESM(require("express"));
var router9 = import_express17.default.Router();
router9.get("/status", getLaunchStatus);
router9.post("/waitlist", waitlistLimiter, joinWaitlist);
var launchRoutes_default = router9;

// src/index.ts
var app2 = (0, import_express18.default)();
var port = process.env.PORT || 5e3;
app2.set("trust proxy", true);
app2.use((0, import_helmet.default)());
app2.use((0, import_compression.default)({
  filter: (req, res) => {
    const contentType = String(res.getHeader("Content-Type") || "");
    return !contentType.includes("text/event-stream") && import_compression.default.filter(req, res);
  }
}));
var defaultOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
var configuredOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
var allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : defaultOrigins;
var isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app2.use(
  (0, import_cors.default)({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin) || isLocalhost.test(origin)) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"));
    }
  })
);
app2.use(import_express18.default.json({ limit: "1mb" }));
app2.use("/api", apiLimiter);
app2.use("/api/ai/chat", chatLimiter);
app2.use("/api/sync", sensitiveLimiter);
var healthHandler = (_req, res) => {
  const dbReady = import_mongoose14.default.connection.readyState === 1;
  res.setHeader("Cache-Control", "no-store");
  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? "ok" : "degraded",
    db: import_mongoose14.default.connection.readyState,
    uptime: process.uptime(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
};
app2.get("/healthz", healthHandler);
app2.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Opportunity Radar API is running" });
});
app2.use("/api/opportunities", opportunityRoutes_default);
app2.use("/api/ai", aiRoutes_default);
app2.use("/api/mentors", mentorRoutes_default);
app2.use("/api/sync", syncRoutes_default);
app2.use("/api/applications", applicationRoutes_default);
app2.use("/api/mentorships", mentorshipRoutes_default);
app2.use("/api/users", userRoutes_default);
app2.use("/api/admin", adminRoutes_default);
app2.use("/api/launch", launchRoutes_default);
app2.use((err, _req, res, _next) => {
  if (err instanceof import_multer2.default.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large. Maximum allowed size is 5MB." : "Invalid file upload.";
    return res.status(status).json({ success: false, message });
  }
  if (err instanceof Error && err.message === "Only PDF files are allowed") {
    return res.status(400).json({ success: false, message: "Only PDF files are allowed." });
  }
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, error: "Origin not allowed." });
  }
  console.error("Unhandled error:", err);
  return res.status(500).json({ success: false, error: "Internal server error." });
});
var mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/opportunity-radar";
var MONGO_CONNECT_RETRIES = Math.min(Math.max(parseInt(process.env.MONGO_RETRY_ATTEMPTS || "10", 10), 1), 30);
var MONGO_RETRY_DELAY_MS = Math.min(Math.max(parseInt(process.env.MONGO_RETRY_MS || "3000", 10), 250), 3e4);
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForDatabase() {
  for (let attempt = 1; attempt <= MONGO_CONNECT_RETRIES; attempt++) {
    try {
      await import_mongoose14.default.connect(mongoUri, { serverSelectionTimeoutMS: 5e3 });
      return;
    } catch (error) {
      console.error(
        `MongoDB connection attempt ${attempt}/${MONGO_CONNECT_RETRIES} failed: ${error?.message || error}`
      );
      if (attempt === MONGO_CONNECT_RETRIES) throw error;
      await delay(MONGO_RETRY_DELAY_MS);
    }
  }
}
var scheduleOpportunitySync = () => {
  const cronExpression = process.env.SYNC_CRON || "0 6 * * *";
  const timezone = process.env.SYNC_TIMEZONE || "Africa/Lagos";
  console.log(`Scheduling opportunity sync: ${cronExpression} (${timezone})`);
  import_node_cron.default.schedule(cronExpression, async () => {
    console.log("[sync] Starting scheduled opportunity sync...");
    try {
      const result = await withLock("opportunity-sync", 45 * 60 * 1e3, runOpportunitySync);
      if (result) console.log("[sync] Scheduled sync complete:", JSON.stringify(result));
    } catch (error) {
      console.error("[sync] Scheduled sync failed:", error);
    }
  });
  console.log("[sync] Running initial opportunity sync at boot...");
  withLock("opportunity-sync", 45 * 60 * 1e3, runOpportunitySync).then((result) => result && console.log("[sync] Initial sync complete:", JSON.stringify(result))).catch((error) => console.error("[sync] Initial sync failed:", error));
};
var scheduleLaunchCheck = () => {
  import_node_cron.default.schedule("*/1 * * * *", async () => {
    try {
      const config = await withLock("auto-launch-check", 60 * 1e3, autoLaunchIfDue);
      if (config?.launched) {
        console.log("[launch] App auto-launched (countdown elapsed).");
      }
    } catch (error) {
      console.error("[launch] schedule check failed:", error);
    }
  });
};
async function main() {
  if (process.env.PRIME_BOOT === "0") return;
  await waitForDatabase();
  console.log("Connected to MongoDB");
  app2.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  scheduleOpportunitySync();
  scheduleLaunchCheck();
}
main().catch((error) => {
  console.error(
    "Fatal: MongoDB unreachable \u2014 refusing to accept traffic. Exiting.",
    error?.message || error
  );
  process.exit(1);
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  healthHandler
});
