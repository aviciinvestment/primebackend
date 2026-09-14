import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Opportunity from '../models/Opportunity';

// Load env vars
dotenv.config({ path: path.join(__dirname, '../../.env') });

const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
  console.error('MONGO_URI is not defined in .env file');
  process.exit(1);
}

const seedDatabase = async () => {
  try {
    console.log('Connecting to MongoDB...', mongoUri);
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected successfully!');

    console.log('Clearing existing opportunities...');
    await Opportunity.deleteMany({});
    
    const seedPath = path.join(__dirname, '../seed.json');
    const rawData = fs.readFileSync(seedPath, 'utf8');
    const rawOpportunities = JSON.parse(rawData);

    const formattedOpportunities = rawOpportunities.map((opp: any) => {
      // Map statuses to Enum
      let statusEnum = 'DEADLINE UNKNOWN';
      if (opp.status) {
        const s = opp.status.toUpperCase();
        if (s.includes('OPEN') || s.includes('PORTAL')) statusEnum = 'OPEN';
        else if (s.includes('CLOSE')) statusEnum = 'CLOSED';
        else if (s.includes('UPCOMING')) statusEnum = 'UPCOMING';
      }

      return {
        title: opp.title,
        organization: opp.organization || opp.title.split(' ')[0] || 'Unknown Organization',
        description: opp.description || opp.eligibility || 'No description provided.',
        category: opp.category,
        opportunityType: opp.type,
        location: opp.location,
        officialUrl: opp.directLink || opp.url || 'https://google.com/search?q=' + encodeURIComponent(opp.title),
        deadline: opp.deadline,
        status: statusEnum,
        tags: opp.tags || []
      };
    });

    console.log(`Inserting ${formattedOpportunities.length} formatted opportunities into the database...`);
    await Opportunity.insertMany(formattedOpportunities);

    console.log('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
