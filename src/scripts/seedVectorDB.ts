import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import Opportunity from '../models/Opportunity';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const mongoUri = process.env.MONGO_URI;
const pineconeApiKey = process.env.PINECONE_API_KEY;
const nvidiaEmbedApiKey = process.env.NVIDIA_EMBED_API_KEY;

if (!mongoUri || !pineconeApiKey || !nvidiaEmbedApiKey) {
  console.error('Missing required API keys in .env');
  process.exit(1);
}

const pinecone = new Pinecone({ apiKey: pineconeApiKey });

const nvidiaClient = new OpenAI({
  apiKey: nvidiaEmbedApiKey,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

const INDEX_NAME = 'prime-opportunity-index';

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await nvidiaClient.embeddings.create({
      model: 'nvidia/nemotron-3-embed-1b',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

async function seedVectorDB() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri as string);
    console.log('MongoDB connected.');

    console.log('Checking Pinecone index...');
    const existingIndexes = await pinecone.listIndexes();
    const indexExists = existingIndexes.indexes?.some(idx => idx.name === INDEX_NAME);

    if (!indexExists) {
      console.log(`Creating Pinecone index: ${INDEX_NAME}...`);
      await pinecone.createIndex({
        name: INDEX_NAME,
        dimension: 2048, // nvidia/nemotron-3-embed-1b dimension
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1',
          },
        },
      });
      console.log('Index created. Waiting for it to be ready...');
      // Wait a moment for index to initialize
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      console.log(`Index ${INDEX_NAME} already exists.`);
    }

    const index = pinecone.index(INDEX_NAME);

    console.log('Fetching opportunities from MongoDB...');
    const opportunities = await Opportunity.find({});
    console.log(`Found ${opportunities.length} opportunities. Generating embeddings...`);

    const batchSize = 10;
    for (let i = 0; i < opportunities.length; i += batchSize) {
      const batch = opportunities.slice(i, i + batchSize);
      console.log(`Processing batch ${i / batchSize + 1} of ${Math.ceil(opportunities.length / batchSize)}...`);
      
      const vectors = [];
      
      for (const opp of batch) {
        // Create a rich text representation of the opportunity
        const textToEmbed = `
          Title: ${opp.title}
          Organization: ${opp.organization}
          Category: ${opp.category}
          Type: ${opp.opportunityType}
          Location: ${opp.location}
          Description: ${opp.description}
          Tags: ${opp.tags.join(', ')}
        `.trim();
        
        const embedding = await generateEmbedding(textToEmbed);
        
        vectors.push({
          id: opp._id.toString(),
          values: embedding,
          metadata: {
            title: opp.title,
            organization: opp.organization,
            category: opp.category || '',
            opportunityType: opp.opportunityType || '',
            location: opp.location || ''
          }
        });
      }
      
      await index.upsert(vectors);
      console.log(`Upserted ${vectors.length} vectors.`);
    }

    console.log('Vector database seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error during vector database seeding:', error);
    process.exit(1);
  }
}

seedVectorDB();
