import Opportunity from '../models/Opportunity';
import { invalidateOpportunityFeedCache } from '../controllers/opportunityController';
import {
  getSourceAdapters,
  SourceOpportunity,
  sourceKey,
  toIsoDeadline,
  computeStatus,
} from './sources';
import {
  embedOpportunitiesBatched,
  deleteOpportunityVector,
} from './opportunityVectorService';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only http/https external URLs are ever stored. Anything else (javascript:,
// data:, file:, vbscript:, blob:, or an empty/garbage value) is dropped so a
// compromised feed can't inject unsafe schemes into listings users click.
// Defense-in-depth: block executable schemes explicitly before the URL parser
// runs, then confirm the surviving value is plain http(s).
const unsafeScheme = /^(?:java|vb|js)?script:|^data:|^file:|^blob:|\s/i;

const safeUrl = (url?: string | null): string => {
  const raw = String(url || '').trim();
  if (!raw || unsafeScheme.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : '';
  } catch {
    return '';
  }
};

const cleanDescription = (text: string): string =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const cleanText = (text: string | undefined | null): string =>
  String(text || '').replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();

// Find an existing opportunity by (1) normalized URL, then (2) case-insensitive
// title+organization so a re-listed opportunity updates the seeded row instead
// of duplicating it.
const findExisting = async (s: SourceOpportunity): Promise<any | null> => {
  const key = sourceKey(s);

  if (key.url) {
    const byUrl = await Opportunity.findOne({ officialUrl: key.url });
    if (byUrl) return byUrl;
  }

  return Opportunity.findOne({
    title: { $regex: new RegExp(`^${escapeRegExp(key.title)}$`, 'i') },
    organization: { $regex: new RegExp(`^${escapeRegExp(key.organization)}$`, 'i') },
  });
};

const hasChanged = (doc: any, s: SourceOpportunity, status: string): boolean => {
  return (
    String(doc?.title || '') !== s.title ||
    String(doc?.organization || '') !== s.organization ||
    String(doc?.description || '') !== cleanDescription(s.description) ||
    String(doc?.opportunityType || '') !== s.opportunityType ||
    String(doc?.status || '') !== status ||
    String(doc?.deadline || '') !== (s.deadline || '') ||
    (doc?.tags || []).join('|') !== (s.tags || []).join('|')
  );
};

export interface SyncResult {
  sources: { name: string; fetched: number }[];
  inserted: number;
  updated: number;
  closed: number;
  embedded: number;
  embedFailed: number;
  durationMs: number;
}

// Run one full sync: fetch every enabled source, upsert new/changed listings,
// expire anything whose deadline has passed, and embed new/changed docs into
// Pinecone immediately (batched) while removing vectors of expired ones.
export const runOpportunitySync = async (): Promise<SyncResult> => {
  const startedAt = Date.now();
  let inserted = 0;
  let updated = 0;
  let closed = 0;

  const adapters = getSourceAdapters();
  const sourceReports: { name: string; fetched: number }[] = [];
  const pendingVecs: any[] = [];

  for (const adapter of adapters) {
    let fetched: SourceOpportunity[] = [];
    try {
      fetched = await adapter.fetch();
    } catch (err) {
      console.error(`Source "${adapter.name}" failed, skipping:`, (err as Error)?.message);
    }
    sourceReports.push({ name: adapter.name, fetched: fetched.length });

    // De-duplicate within a single run (same URL or same title+org).
    const seen = new Set<string>();
    const unique = fetched.filter(rec => {
      const key = sourceKey(rec);
      const fingerprint = key.url || `${key.title.toLowerCase()}||${key.organization.toLowerCase()}`;
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });

    for (const rec of unique) {
      const s: SourceOpportunity = {
        ...rec,
        title: cleanText(rec.title),
        organization: cleanText(rec.organization) || 'Unknown Organization',
        description: cleanDescription(rec.description),
        deadline: toIsoDeadline(rec.deadline),
        tags: (rec.tags || []).slice(0, 12),
      };
      // Sanitize external URLs before they reach the DB (see safeUrl above).
      s.officialUrl = safeUrl(rec.officialUrl);
      if (rec.sourceUrl) s.sourceUrl = safeUrl(rec.sourceUrl);

      // Status: external "closed" hint wins; otherwise drive from the deadline.
      let status = s.deadline ? computeStatus(s.deadline) : 'DEADLINE UNKNOWN';
      if (rec.status && /close/i.test(rec.status)) status = 'CLOSED';

      const existing = await findExisting(s);

      if (!existing) {
        const doc = await Opportunity.create({
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
          verificationStatus: 'Verified',
          lastVerified: new Date(),
          isAiDiscovered: false,
        });
        inserted += 1;
        pendingVecs.push(doc);
        continue;
      }

      const wasClosed = existing.status === 'CLOSED';
      updated += 1;

      await Opportunity.updateOne(
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
            tags: s.tags.filter((t: string) => !existing.tags.includes(t)).concat(existing.tags).slice(0, 12),
            category: s.category || existing.category,
            sourceName: s.sourceName || existing.sourceName,
            sourceUrl: s.sourceUrl || existing.sourceUrl,
            verificationStatus: 'Verified',
            lastVerified: new Date(),
          },
        }
      );

      if (status === 'CLOSED' && !wasClosed) {
        // Expired listing — remove from the feed AND from Pinecone so the AI
        // matcher stops returning it.
        closed += 1;
        await deleteOpportunityVector(existing._id.toString()).catch(() => undefined);
        await Opportunity.updateOne({ _id: existing._id }, { $set: { vectorized: false } });
        continue;
      }

      if ((!existing.vectorized || hasChanged(existing, s, status) || wasClosed) && status !== 'CLOSED') {
        pendingVecs.push(existing);
      }
    }
  }

  // Sweep: anything already in the DB whose deadline has now passed gets closed
  // and removed from Pinecone (covers non-source records like the initial seed).
  const sweepCandidates = await Opportunity.find({
    status: { $ne: 'CLOSED' },
    deadline: { $nin: [null, ''] },
  });

  for (const doc of sweepCandidates) {
    const deadlineIso = toIsoDeadline(doc.deadline);
    if (!deadlineIso) continue;

    const newStatus = computeStatus(deadlineIso);
    if (newStatus === doc.status) continue;

    await Opportunity.updateOne(
      { _id: doc._id },
      { $set: { status: newStatus, lastVerified: new Date() } }
    );

    if (newStatus === 'CLOSED') {
      closed += 1;
      await deleteOpportunityVector(doc._id.toString()).catch(() => undefined);
      await Opportunity.updateOne({ _id: doc._id }, { $set: { vectorized: false } });
    }
  }

  // Embed new/changed docs into Pinecone immediately, in small batches.
  const embedResult = await embedOpportunitiesBatched(pendingVecs);

  // The public feed is cached in memory for 60s (P-01); drop it now so the
  // just-committed insertions/updates/closures show up on the next request.
  invalidateOpportunityFeedCache();

  return {
    sources: sourceReports,
    inserted,
    updated,
    closed,
    embedded: embedResult.embedded,
    embedFailed: embedResult.failed,
    durationMs: Date.now() - startedAt,
  };
};