import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

import opportunityRoutes from './routes/opportunityRoutes';
import authRoutes from './routes/authRoutes';
import aiRoutes from './routes/aiRoutes';
import mentorRoutes from './routes/mentorRoutes';

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Opportunity Radar API is running' });
});

app.use('/api/opportunities', opportunityRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/mentors', mentorRoutes);

// Database connection
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/opportunity-radar';

// Start server immediately
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((error) => {
    console.error('MongoDB connection error. Running in mock mode.', error.message);
  });












