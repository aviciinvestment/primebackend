import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Opportunity from '../models/Opportunity';

dotenv.config({ path: path.join(__dirname, '../../.env') });

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/opportunity_radar');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
};

const importData = async () => {
  try {
    await connectDB();
    
    // Clear existing
    await Opportunity.deleteMany();
    console.log('Cleared existing opportunities');

    // Read the raw txt file
    const rawDataPath = path.join(__dirname, '../../../../scratch/raw_opportunities.txt');
    // For when running from compiled dist vs src
    let actualPath = rawDataPath;
    if (!fs.existsSync(actualPath)) {
      // try relative to project root instead if needed, or absolute path since we know it
      actualPath = 'C:/Users/HP/.gemini/antigravity-ide/brain/b1ab1f55-35e3-4b49-9d58-be52ef62e53e/scratch/raw_opportunities.txt';
    }

    const data = fs.readFileSync(actualPath, 'utf8');
    const lines = data.split('\n');

    const opportunities = [];
    let currentCategory = '';
    let currentSubcategory = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('CATEGORY 1 — Final-Year Undergraduate Students')) {
        currentCategory = 'Final-Year Undergraduate';
        continue;
      }
      if (line.startsWith('CATEGORY 2 — Strictly Graduates / Degree Holders')) {
        currentCategory = 'Graduate-Only';
        continue;
      }
      if (line.startsWith('Interpretation:') || line.startsWith('These require a completed')) {
        continue; // Skip explanations
      }
      
      // Heuristic for subcategories (lines without '—' and not starting with Category)
      if (!line.includes('—')) {
        currentSubcategory = line;
        continue;
      }

      // Parse opportunity line
      // Example: "Shell Nigeria Student Industrial Training and Internship Programme (SIWES) — Engineering, Geosciences, IT, Sciences, Social Sciences, Commercial. Nigerian undergraduates; Shell explicitly accepts university students with school-authorised industrial training and a minimum 3.5/5 CGPA. Official application page"
      
      const parts = line.split(' — ');
      if (parts.length < 2) continue; // safety check
      
      const title = parts[0].trim();
      const details = parts.slice(1).join(' — ').trim();
      
      // Determine Organization from title (basic heuristic)
      let organization = title.split(' ')[0]; 
      if (title.includes('University')) organization = 'University';
      else if (title.includes('Bank')) organization = 'Bank';
      else if (title.toLowerCase().includes('goldman sachs')) organization = 'Goldman Sachs';
      else if (title.toLowerCase().includes('amazon')) organization = 'Amazon';
      else if (title.toLowerCase().includes('deloitte')) organization = 'Deloitte';
      else if (title.toLowerCase().includes('kpmg')) organization = 'KPMG';
      else if (title.toLowerCase().includes('pwc')) organization = 'PwC';
      else if (title.toLowerCase().includes('nestlé') || title.toLowerCase().includes('nesternships')) organization = 'Nestlé';
      else if (title.toLowerCase().includes('shell')) organization = 'Shell';
      
      const eligibleEducationLevels = currentCategory === 'Final-Year Undergraduate' 
        ? ['Undergraduate', 'Final-Year'] 
        : ['Graduate', 'Postgraduate'];
        
      const nyscRequired = details.toLowerCase().includes('nysc') ? 'Required/Completed' : 'Unknown';

      // Create opportunity object
      opportunities.push({
        title,
        organization,
        description: details,
        category: currentCategory,
        subcategory: currentSubcategory,
        opportunityType: title.toLowerCase().includes('internship') ? 'Internship' : 
                         title.toLowerCase().includes('scholarship') ? 'Scholarship' : 
                         title.toLowerCase().includes('trainee') ? 'Graduate Trainee' : 'Other',
        eligibleEducationLevels,
        eligibleFields: [details.split('.')[0]], // roughly the fields
        eligibleCountries: details.toLowerCase().includes('nigeria') ? ['Nigeria'] : [],
        nyscRequired,
        officialUrl: '#', // We don't have the actual URLs in the text since they were hyperlink text
        sourceName: 'User Provided List',
        status: 'OPEN',
        isAiDiscovered: false
      });
    }

    await Opportunity.insertMany(opportunities);
    console.log(`Imported ${opportunities.length} opportunities successfully`);
    process.exit();
  } catch (error) {
    console.error(`Error with data import: ${error}`);
    process.exit(1);
  }
};

importData();
