import { Pinecone, type RecordMetadata } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import Opportunity, { IOpportunity } from '../models/Opportunity';

// Shared Pinecone + embedding clients for opportunity vectors.
// Vector IDs use the Opportunity _id string, matching seedVectorDB.ts so the
// manual seed script and the live sync stay consistent.
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const INDEX_NAME = 'prime-opportunity-index';
const embedClient = new OpenAI({
  apiKey: process.env.NVIDIA_EMBED_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

const EMBED_MODEL = 'nvidia/nemotron-3-embed-1b';
const EMBED_DIMENSION = 2048;

// Build the same rich text representation used by seedVectorDB.ts so vectors
// produced at runtime are comparable with the ones seeded manually.
export const buildOpportunityVectorText = (opp: IOpportunity): string => {
  return `
    Title: ${opp.title}
    Organization: ${opp.organization}
    Category: ${opp.category}
    Type: ${opp.opportunityType}
    Location: ${opp.location}
    Description: ${opp.description}
    Tags: ${(opp.tags || []).join(', ')}
  `.trim();
};

export const generateEmbedding = async (text: string): Promise<number[]> => {
  const response = await embedClient.embeddings.create({
    model: EMBED_MODEL,
    input: text,
  });
  return response.data[0].embedding;
};

// Denormalized vector payload. EVERY field the worker's RAG prompt needs is
// embedded in the vector's metadata, so the Cloudflare Worker can serialize the
// full opportunity context (title, org, description, eligibility, deadline,
// link, ...) directly from a Pinecone query — no backend round-trip on chat.
// Canonical keys mirror the Mongo model; the shorter aliases (org, link,
// full_description, eligibility) are kept for direct edge-time extraction.
export const buildOpportunityMetadata = (
  opp: IOpportunity
): RecordMetadata => {
  const eligibleFields = (opp.eligibleFields || []).filter(Boolean);
  const eligibility = (opp.eligibleEducationLevels || []).filter(Boolean);
  const targetAudience = (opp.targetAudience || []).filter(Boolean);
  const tags = (opp.tags || []).slice(0, 12);

  const metadata: RecordMetadata = {
    title: opp.title,
    organization: opp.organization,
    category: opp.category || '',
    opportunityType: opp.opportunityType || '',
    location: opp.location || '',
    deadline: opp.deadline || '',
    status: opp.status || '',
    officialUrl: opp.officialUrl || '',
    tags,
    description: opp.description || '',
    // Direct-extraction aliases used by the worker RAG builder.
    org: opp.organization || '',
    full_description: opp.description || '',
    eligibility: eligibility.join(', '),
    link: opp.officialUrl || '',
  };
  if (eligibleFields.length > 0) metadata.eligibleFields = eligibleFields;
  if (eligibility.length > 0) metadata.eligibleEducationLevels = eligibility;
  if (targetAudience.length > 0) metadata.targetAudience = targetAudience;
  return metadata;
};

export const upsertOpportunityVector = async (opp: IOpportunity): Promise<void> => {
  const index = pinecone.index(INDEX_NAME);
  const embedding = await generateEmbedding(buildOpportunityVectorText(opp));
  await index.upsert([
    {
      id: opp._id.toString(),
      values: embedding,
      metadata: buildOpportunityMetadata(opp),
    },
  ]);
  await Opportunity.updateOne({ _id: opp._id }, { $set: { vectorized: true } });
};

// Vector semantic search: embed the query and return top-K opportunity ids
// ranked by cosine similarity. The caller intersects these ids with content
// filters in MongoDB and keeps the relevance order.
export const semanticSearchOpportunities = async (
  query: string,
  topK = 100
): Promise<{ id: string; score: number }[]> => {
  const index = pinecone.index(INDEX_NAME);
  const embedding = await generateEmbedding(query);
  const queryResponse = await index.query({
    vector: embedding,
    topK,
    includeMetadata: false,
  });
  return (queryResponse.matches || []).map(match => ({
    id: match.id,
    score: match.score ?? 0,
  }));
};

// Delete an opportunity's vector when it expires/leaves the dashboard.
export const deleteOpportunityVector = async (oppId: string): Promise<void> => {
  try {
    await pinecone.index(INDEX_NAME).deleteOne(oppId);
  } catch (err: any) {
    // Missing vector is not fatal — just leave it unmarked.
    if (err?.name && err.name !== 'PineconeNotFoundError') {
      throw err;
    }
  }
};

// Embed a batch of opportunities in small groups to respect rate limits.
// Failures are isolated per item so one bad embedding never kills the sync.
export const embedOpportunitiesBatched = async (
  opps: IOpportunity[],
  batchSize = 10
): Promise<{ embedded: number; failed: number }> => {
  let embedded = 0;
  let failed = 0;

  for (let i = 0; i < opps.length; i += batchSize) {
    const batch = opps.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(opp => upsertOpportunityVector(opp))
    );
    results.forEach(r => {
      if (r.status === 'fulfilled') embedded += 1;
      else {
        failed += 1;
        console.error('Vector embedding failed:', (r.reason as Error)?.message);
      }
    });
  }

  return { embedded, failed };
};