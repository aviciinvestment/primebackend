import { Pinecone } from '@pinecone-database/pinecone';

const pineconeApiKey = 'pcsk_3aDcfU_Hyn2TTaGwj5u4KdiAU87F9mKf5mNxFRDVgv2zxqLPhpR5cRxL4Cbdn8Lkob65se';
const pinecone = new Pinecone({ apiKey: pineconeApiKey });

const INDEX_NAME = 'prime-opportunity-index';

async function testPinecone() {
  console.log('Testing pinecone...');
  try {
    const existingIndexes = await pinecone.listIndexes();
    console.log('Indexes:', existingIndexes);
    const indexExists = existingIndexes.indexes?.some(idx => idx.name === INDEX_NAME);

    if (!indexExists) {
      console.log(`Creating Pinecone index: ${INDEX_NAME}...`);
      await pinecone.createIndex({
        name: INDEX_NAME,
        dimension: 1024,
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1',
          },
        },
      });
      console.log('Created index successfully.');
    } else {
      console.log('Index already exists');
    }
  } catch (err) {
    console.error('Error with pinecone:', err);
  }
}

testPinecone();
