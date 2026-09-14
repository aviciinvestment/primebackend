import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { PDFParse } from 'pdf-parse';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import Opportunity from '../models/Opportunity';
import Cv from '../models/Cv';

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const INDEX_NAME = 'prime-opportunity-index';

const nvidiaEmbedClient = new OpenAI({
  apiKey: process.env.NVIDIA_EMBED_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

const nvidiaChatClient = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
  timeout: 90000,
  maxRetries: 1,
});

// Each user's CV vectors live in their OWN namespace (cvs-<userId>).
// This guarantees a chat query can never retrieve another user's CV data,
// even if a malicious request is made.
const CV_NAMESPACE_PREFIX = 'cvs-';

const chunkText = (text: string, chunkSize = 1000, overlap = 150): string[] => {
  const clean = text.trim();
  if (clean.length <= chunkSize) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    chunks.push(clean.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
};

// Store a user's CV as chunked vectors in their private Pinecone namespace.
// Any previous CV vectors for this user are removed, so the namespace always
// reflects their most recent CV.
const seedUserCvVectors = async (
  cvText: string,
  userId: string,
  cvId: string,
  fileName: string
): Promise<{ namespace: string; chunks: number }> => {
const namespace = `${CV_NAMESPACE_PREFIX}${userId}`;
  const index = pinecone.index(INDEX_NAME);

  // Delete this user's previous CV vectors (refreshes their private namespace).
  // The namespace may not exist yet on first upload — that is fine, skip it.
  try {
    await index.deleteAll({ namespace });
  } catch (err: any) {
    if (err?.name !== 'PineconeNotFoundError') {
      throw err;
    }
  }

  const chunks = chunkText(cvText).slice(0, 5);
  const embedResponse = await nvidiaEmbedClient.embeddings.create({
    model: 'nvidia/nemotron-3-embed-1b',
    input: chunks,
  });

  const vectors = embedResponse.data.map((item, i) => ({
    id: `${cvId}-chunk-${i}`,
    values: item.embedding,
    metadata: {
      type: 'cv',
      userId,
      cvId,
      fileName,
      chunkIndex: i,
      text: chunks[i],
    },
  }));

  await index.upsert({ namespace, records: vectors });
  return { namespace, chunks: vectors.length };
};

export const analyzeCV = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No CV file uploaded.' });
      return;
    }

    // 1. Extract Text from PDF
    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const cvText = pdfData.text.trim();

    if (!cvText) {
      res.status(400).json({ success: false, message: 'Could not extract text from the provided PDF.' });
      return;
    }
    
    // We limit the text to the first 4000 characters to avoid huge embedding token limits
    const truncatedCVText = cvText.substring(0, 4000);

    // 2. Generate Embedding for the CV
    const embedResponse = await nvidiaEmbedClient.embeddings.create({
      model: 'nvidia/nemotron-3-embed-1b',
      input: truncatedCVText,
    });
    const cvVector = embedResponse.data[0].embedding;

    // 3. Query Pinecone for Top Matches
    const index = pinecone.index(INDEX_NAME);
    const queryResponse = await index.query({
      vector: cvVector,
      topK: 5,
      includeMetadata: true,
    });

    const matchIds = queryResponse.matches.map(match => match.id);
    
    // Fetch full data for these opportunities
    const matchedOpportunities = await Opportunity.find({ _id: { $in: matchIds } });
    
    // Sort them exactly as Pinecone returned them
    const sortedOpportunities = matchIds.map(id => matchedOpportunities.find(o => o._id.toString() === id)).filter(Boolean);

    // 4. Generate AI Analysis using DeepSeek
    // Create a prompt that includes the CV and the matched opportunities
    const oppsContext = sortedOpportunities.map((opp, index) => 
      `[${index + 1}] ${opp?.title} at ${opp?.organization}\nCategory: ${opp?.category}\nType: ${opp?.opportunityType}\nLocation: ${opp?.location}\nDescription: ${opp?.description}\n`
    ).join('\n');

    const prompt = `You are an expert career advisor.
A user has uploaded their CV, and our semantic search engine has found the top matching opportunities from our database.
Analyze the user's CV and explain why these specific opportunities are a great match for them. Highlight their strengths and suggest the best one to apply for.

USER CV:
${truncatedCVText}

TOP MATCHING OPPORTUNITIES:
${oppsContext}

Provide a personalized, encouraging response to the user. Use markdown formatting. Keep it concise but highly valuable. Do not hallucinate opportunities that are not in the list.`;

    const completion = await nvidiaChatClient.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 1024,
      stream: false,
    });

    const analysis = completion.choices[0].message.content;

    // 5. Persist CV + matches to MongoDB (assigned to the authenticated user)
    const userId = (req.body.userId as string) || '';
    let savedCv: any = null;
    if (userId) {
      const cv = new Cv({
        userId,
        userEmail: req.body.userEmail || '',
        userName: req.body.userName || '',
        fileName: req.file.originalname,
        contentType: req.file.mimetype,
        fileData: req.file.buffer,
        text: cvText,
        analysis,
        matchIds: sortedOpportunities.map(o => o!._id),
      });
      await cv.save();
      savedCv = cv;

      // 5b. Vectorize the CV into the user's private Pinecone namespace so the
      // chat assistant has personalized context. Failure here must NOT block
      // the CV analysis result.
      try {
        await seedUserCvVectors(cvText, userId, savedCv._id.toString(), req.file.originalname);
      } catch (vecErr) {
        console.error('Could not seed CV vectors to Pinecone:', vecErr);
      }
    }

    // 6. Return Results
    res.json({
      success: true,
      analysis,
      matches: sortedOpportunities,
      cvId: savedCv?._id || null,
    });
  } catch (error: any) {
    console.error('Error analyzing CV:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze CV.',
      error: error.message,
    });
  }
};

export const chatWithAI = async (req: Request, res: Response) => {
  try {
    const message = (req.body.message as string || '').trim();
    if (!message) {
      res.status(400).json({ success: false, message: 'Message is required.' });
      return;
    }

    // Conversation history (last 10 messages max) - [{role: 'user'|'assistant', content: string}]
    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const history = rawHistory
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10);

    // The chat is only ever personalized with the requesting user's own CV.
    // userId scope is enforced by querying ONLY that user's private Pinecone namespace.
    const userId = (req.body.userId as string || '').trim();

    // 1. Generate Embedding for the user's message
    const embedResponse = await nvidiaEmbedClient.embeddings.create({
      model: 'nvidia/nemotron-3-embed-1b',
      input: message,
    });
    const messageVector = embedResponse.data[0].embedding;

    // 2. Query Pinecone for relevant opportunities
    const index = pinecone.index(INDEX_NAME);
    const queryResponse = await index.query({
      vector: messageVector,
      topK: 5,
      includeMetadata: true,
    });

    const matchIds = queryResponse.matches.map(match => match.id);

    // 3. Fetch full opportunity data so the AI has rich context
    let retrievedContext = 'No specific opportunities were retrieved for this question. Answer generally using your knowledge.';
    if (matchIds.length > 0) {
      const matchedOpportunities = await Opportunity.find({ _id: { $in: matchIds } });
      const sortedOpportunities = matchIds
        .map(id => matchedOpportunities.find(o => o._id.toString() === id))
        .filter(Boolean);

      if (sortedOpportunities.length > 0) {
        retrievedContext = sortedOpportunities.map((opp, idx) => {
          const tags = opp!.tags && opp!.tags.length > 0 ? opp!.tags.join(', ') : 'None';
          return `[${idx + 1}] ${opp!.title} at ${opp!.organization}
  Type: ${opp!.opportunityType || 'Unknown'}
  Category: ${opp!.category || 'N/A'}
  Location: ${opp!.location || 'N/A'}
  Field(s): ${opp!.eligibleFields ? opp!.eligibleFields.join(', ') : 'N/A'}
  Eligibility: ${opp!.eligibleEducationLevels ? opp!.eligibleEducationLevels.join(', ') : (opp!.targetAudience ? opp!.targetAudience.join(', ') : 'N/A')}
  Deadline: ${opp!.deadline || 'Not specified'}
  Status: ${opp!.status || 'Unknown'}
  Tags: ${tags}
  Description: ${opp!.description || 'N/A'}
  More info: ${opp!.officialUrl || 'N/A'}`;
        }).join('\n\n');
      }
    }

// 4. Retrieve the requesting user's OWN CV from their private namespace
    //    (only ever this user's vectors — never another user's)
    let userCvContext = '';
    if (userId) {
      try {
        const cvNamespace = `${CV_NAMESPACE_PREFIX}${userId}`;
        let cvQuery = await index.namespace(cvNamespace).query({
          vector: messageVector,
          topK: 4,
          includeMetadata: true,
        });

        let cvChunks = cvQuery.matches
          .filter(match => match.metadata && typeof match.metadata.text === 'string')
          .map(match => match.metadata!.text as string);

        // Self-heal: the user has a CV stored but it was never vectorized
        // (e.g. uploaded before namespace seeding existed, or a transient seed
        // failure). Vectorize their most recent CV on demand so the assistant
        // always has the current user's own context.
        if (cvChunks.length === 0) {
          const existingCv = await Cv.findOne({ userId })
            .sort({ createdAt: -1 })
            .select('text fileName _id');
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
              includeMetadata: true,
            });
            cvChunks = cvQuery.matches
              .filter(match => match.metadata && typeof match.metadata.text === 'string')
              .map(match => match.metadata!.text as string);
          }
        }

        if (cvChunks.length > 0) {
          userCvContext = cvChunks.join('\n\n');
        }
      } catch (cvErr) {
        console.error('Could not retrieve user CV context:', cvErr);
      }
    }

    // 5. Build system prompt (RAG instructions)
    const systemPrompt = `You are PrimeOpportunity AI, a friendly and knowledgeable assistant for PrimeOpportunity — a platform that helps Nigerian students and early-career professionals discover tailored scholarships, internships, graduate trainee programmes, and fellowships.

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

USER'S OWN CV PROFILE:
${userCvContext || 'The current user has not uploaded a CV yet (or none is vectorized). Do not claim you can see their CV.'}

RETRIEVED OPPORTUNITIES:
${retrievedContext}`;

    const completion = await nvidiaChatClient.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ],
      temperature: 0.6,
      top_p: 0.95,
      max_tokens: 700,
      stream: false,
    });

    const reply = completion.choices[0].message.content?.trim() || 'Sorry, I could not generate a response. Please try again.';

    res.json({ success: true, reply });
  } catch (error: any) {
    console.error('Error in AI chat:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process chat message.',
      error: error.message,
    });
  }
};

// Deterministically extract key roles, skills and education from CV text
// so the Profile page can show relevant chips without an extra AI call.
const ROLE_KEYWORDS = [
  'Software Engineer', 'Software Developer', 'Frontend Developer', 'Backend Developer',
  'Full Stack Developer', 'Data Scientist', 'Data Analyst', 'Machine Learning Engineer',
  'Product Manager', 'Project Manager', 'UI/UX Designer', 'Graphic Designer',
  'Web Developer', 'Mobile Developer', 'DevOps Engineer', 'Cloud Engineer',
  'Systems Engineer', 'Electrical Engineer', 'Mechanical Engineer', 'Civil Engineer',
  'Researcher', 'Intern', 'Consultant', 'Accountant', 'Marketing Analyst',
  'Graduate Trainee', 'Tutor', 'Team Lead',
];

const SKILL_KEYWORDS = [
  'Python', 'JavaScript', 'TypeScript', 'React', 'React.js', 'Node.js', 'NodeJS',
  'Express', 'Express.js', 'MongoDB', 'SQL', 'MySQL', 'PostgreSQL', 'HTML', 'CSS',
  'Tailwind', 'Java', 'C++', 'C#', 'MATLAB', 'SolidWorks', 'AutoCAD', 'Git', 'GitHub',
  'Docker', 'Kubernetes', 'AWS', 'Figma', 'Excel', 'Power BI', 'Tableau',
  'Machine Learning', 'Deep Learning', 'Data Analysis', 'Data Science',
  'Artificial Intelligence', 'REST API', 'REST APIs', 'API Design', 'Linux',
  'Swift', 'Kotlin', 'Django', 'Flask', 'Vue.js', 'Next.js', 'Firebase',
  'Circuit Design', 'PCB', 'Arduino', 'Raspberry Pi', 'CCTV', 'Solar', 'ETL',
  'Public Speaking', 'Team Leadership', 'Agile', 'Scrum',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractCvHighlights = (cvText: string, analysis: string = '') => {
  const source = `${cvText}\n${analysis}`.toLowerCase();

  const roles = ROLE_KEYWORDS.filter(kw =>
    new RegExp(escapeRegExp(kw), 'i').test(source)
  ).slice(0, 8);

  const skills = SKILL_KEYWORDS.filter(kw => {
    const pattern = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${pattern}\\b`, 'i').test(source);
  }).slice(0, 12);

  // Education is derived from the raw CV text only (not the AI analysis, which
  // can mention other people/roles and produce false positives).
  const eduMatches: string[] = [];
  // Degree lines
  const degreeRe = /(?:(?:BSc|B\.Sc|BEng|B\.Eng|Bachelor(?:'?s)?|MSc|M\.Eng|MEng|M\.Sc|Master(?:'?s)?|HND|OND)\s+[^.,;\n]{3,60})/gi;
  let m: RegExpExecArray | null;
  while ((m = degreeRe.exec(cvText)) !== null) {
    const clean = m[0].replace(/[\n*]+/g, ' ').replace(/\s+/g, ' ').trim();
    const isPerson = /\b(Professor|Lecturer|Associate|Supervisor|Advisor|Candidate|the late|Dr\.)\b/i.test(clean);
    if (clean.length > 5 && !isPerson && !eduMatches.includes(clean)) eduMatches.push(clean);
  }
  // Universities
  const uniRe = /University of [A-Z][a-zA-Z ]{3,60}/g;
  while ((m = uniRe.exec(cvText)) !== null) {
    const clean = m[0].replace(/[\n*]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length > 12 && !eduMatches.includes(clean)) eduMatches.push(clean);
  }

  return { roles, skills, education: eduMatches.slice(0, 4) };
};

export const getMyCVs = async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || '';
    if (!userId) {
      res.status(400).json({ success: false, message: 'userId is required.' });
      return;
    }

    const cvs = await Cv.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('matchIds');

    res.json({
      success: true,
      cvs: cvs.map(cv => ({
        _id: cv._id,
        fileName: cv.fileName,
        analysis: cv.analysis,
        createdAt: cv.createdAt,
        matches: cv.matchIds,
        highlights: extractCvHighlights(cv.text || '', cv.analysis || ''),
      })),
    });
  } catch (error: any) {
    console.error('Error fetching CVs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch CVs.',
      error: error.message,
    });
  }
};

export const downloadCV = async (req: Request, res: Response) => {
  try {
    const { cvId } = req.params;
    const userId = (req.query.userId as string) || '';
    if (!userId) {
      res.status(400).json({ success: false, message: 'userId is required.' });
      return;
    }
    if (!isValidObjectId(cvId)) {
      res.status(400).json({ success: false, message: 'Invalid CV id.' });
      return;
    }

    const cv = await Cv.findOne({ _id: cvId, userId });
    if (!cv) {
      res.status(404).json({ success: false, message: 'CV not found.' });
      return;
    }

    const safeName = (cv.fileName || 'cv.pdf').replace(/[^\w.\- ]/g, '').replace(/"/g, '');
    res.setHeader('Content-Type', cv.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'cv.pdf'}"`);
    res.send(cv.fileData);
  } catch (error: any) {
    console.error('Error downloading CV:', error);
    res.status(500).json({ success: false, message: 'Failed to download CV.' });
  }
};

export const deleteCV = async (req: Request, res: Response) => {
  try {
    const { cvId } = req.params;
    const userId = (req.body.userId as string) || '';
    if (!userId) {
      res.status(400).json({ success: false, message: 'userId is required.' });
      return;
    }
    if (!isValidObjectId(cvId)) {
      res.status(400).json({ success: false, message: 'Invalid CV id.' });
      return;
    }

    const cv = await Cv.findOneAndDelete({ _id: cvId, userId });
    if (!cv) {
      res.status(404).json({ success: false, message: 'CV not found.' });
      return;
    }

    // Best-effort removal of this CV's vectors from the user's private namespace.
    try {
      const ns = `${CV_NAMESPACE_PREFIX}${userId}`;
      const ids = Array.from({ length: 6 }, (_, i) => `${cvId}-chunk-${i}`);
      await pinecone.index(INDEX_NAME).namespace(ns).deleteMany(ids);
    } catch {
      /* namespace may not exist — ignore */
    }

    res.json({ success: true, message: 'CV deleted.' });
  } catch (error: any) {
    console.error('Error deleting CV:', error);
    res.status(500).json({ success: false, message: 'Failed to delete CV.' });
  }
};

