const https = require('https');

const API_KEY = 'pcsk_3aDcfU_Hyn2TTaGwj5u4KdiAU87F9mKf5mNxFRDVgv2zxqLPhpR5cRxL4Cbdn8Lkob65se';
const INDEX_NAME = 'prime-opportunity-index';

const options = {
  hostname: 'api.pinecone.io',
  path: '/indexes',
  method: 'GET',
  headers: {
    'Api-Key': API_KEY,
    'Accept': 'application/json'
  }
};

console.log('Fetching indexes...');
const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Response:', res.statusCode);
    console.log(data);
    const indexes = JSON.parse(data).indexes || [];
    const exists = indexes.some(idx => idx.name === INDEX_NAME);
    
    if (!exists) {
      console.log('Creating index...');
      const createOpts = {
        hostname: 'api.pinecone.io',
        path: '/indexes',
        method: 'POST',
        headers: {
          'Api-Key': API_KEY,
          'Content-Type': 'application/json'
        }
      };
      const createReq = https.request(createOpts, (createRes) => {
        let createData = '';
        createRes.on('data', chunk => createData += chunk);
        createRes.on('end', () => {
          console.log('Create Response:', createRes.statusCode);
          console.log(createData);
        });
      });
      createReq.write(JSON.stringify({
        name: INDEX_NAME,
        dimension: 1024,
        metric: 'cosine',
        spec: { serverless: { cloud: 'aws', region: 'us-east-1' } }
      }));
      createReq.end();
    } else {
      console.log('Index already exists.');
    }
  });
});

req.on('error', e => console.error(e));
req.end();
