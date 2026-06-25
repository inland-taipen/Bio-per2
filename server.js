// server.js — Express API server for Biography Agent
// Handles all API routes and serves the frontend static files.

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const db = require('./src/database');
const { QUESTIONS } = require('./src/questionnaire');
const { handleOnboardingTurn, handleInterviewTurn, generateSessionOpener } = require('./src/interviewerAgent');
const { generateBiography } = require('./src/writerAgent');
const { buildCoverageMap, getCoveragePercent } = require('./src/coverageMap');
const { processUploadedConversation } = require('./src/uploadAgent');
const { transcribeAudio, buildWhisperPrompt } = require('./src/transcribeAudio');
const { subjectConfig, render, publicConfig } = require('./subject.config');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer: store uploads in OS temp dir, 50 MB limit
const upload = multer({
  dest: require('os').tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Public config (intentionally NOT behind the access code) ────────────────────
// Lets the branded welcome screen render before the visitor enters the code.
app.get('/api/config', (req, res) => {
  res.json(publicConfig());
});

// ── Access control ──────────────────────────────────────────────────────────────
// If ACCESS_CODE is set, every /api/* route below (except /api/config above and
// /api/health) requires a matching x-access-code header. If ACCESS_CODE is unset,
// the gate is disabled (useful for local dev) and a warning is logged at startup.
const ACCESS_CODE = process.env.ACCESS_CODE || '';

app.use('/api', (req, res, next) => {
  if (!ACCESS_CODE) return next(); // gate disabled
  if (req.path === '/health') return next();
  const provided = req.get('x-access-code') || '';
  if (provided === ACCESS_CODE) return next();
  return res.status(401).json({ error: 'Unauthorized', code: 'ACCESS_CODE_REQUIRED' });
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateApiKey() {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
    return false;
  }
  return true;
}

// ── Subject Routes ─────────────────────────────────────────────────────────────

// GET /api/subjects — list all subjects
app.get('/api/subjects', (req, res) => {
  try {
    const subjects = db.listSubjects();
    res.json({ subjects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subjects — create a new subject
app.post('/api/subjects', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const id = uuidv4();
    db.createSubject(id, name.trim());

    // Initialize coverage map for all 80 questions
    db.initCoverage(id, QUESTIONS.map(q => q.id));

    res.json({ id, name: name.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/subjects/:id — get a subject's full state
app.get('/api/subjects/:id', (req, res) => {
  try {
    const subject = db.getSubject(req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    const coverageRows = db.getCoverage(req.params.id);
    const coverageMap = buildCoverageMap(coverageRows);
    const coveragePercent = Math.round(
      ((Object.values(coverageMap).filter(s => s === 'covered').length +
        Object.values(coverageMap).filter(s => s === 'partial').length * 0.5) /
        80) * 100
    );

    const stats = db.getCoverageStats(req.params.id);
    const openThreads = db.getOpenThreads(req.params.id);
    const biography = db.getLatestBiography(req.params.id);
    const latestSession = db.getLatestSession(req.params.id);

    res.json({
      subject,
      coveragePercent,
      coverageStats: stats,
      openThreadsCount: openThreads.length,
      hasBiography: !!biography,
      latestSessionId: latestSession ? latestSession.id : null,
      sessionNumber: latestSession ? latestSession.session_number : 1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Session Routes ─────────────────────────────────────────────────────────────

// POST /api/subjects/:id/sessions — start a new session
app.post('/api/subjects/:id/sessions', async (req, res) => {
  try {
    if (!validateApiKey()) {
      return res.status(400).json({ error: 'GROQ_API_KEY not configured. Please add it to your .env file.' });
    }

    const subject = db.getSubject(req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    const sessionId = uuidv4();
    const sessionNumber = db.createSession(sessionId, req.params.id);

    const profile = subject.profile;
    let openingMessage;
    let questionId = null;

    if (!profile.onboardingComplete) {
      // First session: start with onboarding
      openingMessage = render(subjectConfig.openings.onboarding);

      // Log opening turn
      db.addTurn(sessionId, req.params.id, 'agent', openingMessage, null, null);
    } else if (sessionNumber === 1) {
      // Onboarding done, first real interview session
      openingMessage = render(subjectConfig.openings.firstInterview);
      questionId = 1;
      db.addTurn(sessionId, req.params.id, 'agent', openingMessage, questionId, 'advance');
    } else {
      // Returning session
      const opener = await generateSessionOpener(req.params.id);
      openingMessage = opener.message;
      questionId = opener.questionId;
      db.addTurn(sessionId, req.params.id, 'agent', openingMessage, questionId, 'advance');
    }

    const coverageRows = db.getCoverage(req.params.id);
    const stats = db.getCoverageStats(req.params.id);

    res.json({
      sessionId,
      sessionNumber,
      openingMessage,
      questionId,
      coverageStats: stats,
      isOnboarding: !profile.onboardingComplete,
    });
  } catch (err) {
    console.error('Session start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Interview Turn Route ───────────────────────────────────────────────────────

// POST /api/interview/turn — process one interview turn
app.post('/api/interview/turn', async (req, res) => {
  try {
    if (!validateApiKey()) {
      return res.status(400).json({ error: 'GROQ_API_KEY not configured. Please add it to your .env file.' });
    }

    const { subjectId, sessionId, message, lastQuestionId, isOnboarding } = req.body;

    if (!subjectId || !sessionId || !message) {
      return res.status(400).json({ error: 'subjectId, sessionId, and message are required' });
    }

    const subject = db.getSubject(subjectId);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    if (isOnboarding) {
      // Handle onboarding turn
      const turns = db.getRecentTurns(subjectId, 10);
      const result = await handleOnboardingTurn(subjectId, message, turns);

      // Log turns
      db.addTurn(sessionId, subjectId, 'user', message, null, null);

      // If onboarding is complete, mark it and set up first real question
      let finalResponse = result.response;
      let onboardingJustCompleted = false;

      if (result.onboardingComplete) {
        const updatedProfile = db.getSubject(subjectId).profile;
        db.updateProfile(subjectId, { ...updatedProfile, onboardingComplete: true });
        onboardingJustCompleted = true;

        finalResponse = (result.response || '') + render(subjectConfig.openings.onboardingComplete);
      }

      db.addTurn(sessionId, subjectId, 'agent', finalResponse, onboardingJustCompleted ? 1 : null, null);

      return res.json({
        agentMessage: finalResponse,
        isOnboarding: !result.onboardingComplete,
        onboardingComplete: result.onboardingComplete || false,
        nextQuestionId: onboardingJustCompleted ? 1 : null,
        coveragePercent: 0,
      });
    }

    // Main interview turn
    const result = await handleInterviewTurn(subjectId, sessionId, message, lastQuestionId || null);

    res.json({
      agentMessage: result.agentMessage,
      reflection: result.reflection,
      question: result.question,
      moveType: result.moveType,
      questionId: result.questionId,
      coveragePercent: result.coveragePercent,
      coverageStats: result.coverageStats,
      isOnboarding: false,
    });
  } catch (err) {
    console.error('Interview turn error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Biography Routes ───────────────────────────────────────────────────────────

// POST /api/subjects/:id/biography — generate biography
app.post('/api/subjects/:id/biography', async (req, res) => {
  try {
    if (!validateApiKey()) {
      return res.status(400).json({ error: 'GROQ_API_KEY not configured.' });
    }

    const subject = db.getSubject(req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    const turns = db.getTurns(req.params.id, 500);
    if (turns.length < 4) {
      return res.status(400).json({ error: 'Not enough interview content to generate a biography. Please conduct more interview sessions first.' });
    }

    const biographyMd = await generateBiography(req.params.id);

    res.json({ biography: biographyMd });
  } catch (err) {
    console.error('Biography generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/subjects/:id/biography — get latest biography
app.get('/api/subjects/:id/biography', (req, res) => {
  try {
    const bio = db.getLatestBiography(req.params.id);
    if (!bio) return res.status(404).json({ error: 'No biography generated yet' });
    res.json({ biography: bio.content_md, generatedAt: bio.generated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/subjects/:id/biography — delete generated biography (keeps interview data)
app.delete('/api/subjects/:id/biography', (req, res) => {
  try {
    const subject = db.getSubject(req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    db.deleteBiographies(req.params.id);
    res.json({ success: true, message: 'Biography deleted. Interview data is preserved.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/subjects/:id — delete subject and ALL associated data
app.delete('/api/subjects/:id', (req, res) => {
  try {
    const subject = db.getSubject(req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    db.deleteSubject(req.params.id);
    res.json({ success: true, message: `"${subject.name}" and all associated data deleted.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Transcript Routes ──────────────────────────────────────────────────────────

// GET /api/subjects/:id/transcript — get full transcript
app.get('/api/subjects/:id/transcript', (req, res) => {
  try {
    const turns = db.getTurns(req.params.id, 500);
    const subject = db.getSubject(req.params.id);
    res.json({ turns, subject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Upload Routes ─────────────────────────────────────────────────────────────

// POST /api/subjects/:id/upload-conversation — ingest any text/transcript
app.post('/api/subjects/:id/upload-conversation', async (req, res) => {
  try {
    if (!validateApiKey()) {
      return res.status(400).json({ error: 'GROQ_API_KEY not configured.' });
    }

    const subject = db.getSubject(req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (text.length > 200000) {
      return res.status(400).json({ error: 'Text too long (max 200,000 characters)' });
    }

    const result = await processUploadedConversation(req.params.id, text);
    res.json(result);
  } catch (err) {
    console.error('Upload conversation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subjects/:id/upload-audio — transcribe audio then ingest
app.post('/api/subjects/:id/upload-audio', upload.single('audio'), async (req, res) => {
  let tmpPath = req.file?.path;
  try {
    if (!validateApiKey()) {
      return res.status(400).json({ error: 'GROQ_API_KEY not configured.' });
    }

    const subject = db.getSubject(req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file received' });
    }

    // Append extension to the temporary file so the Groq API can detect the format
    const originalName = req.file.originalname || 'audio.webm';
    const ext = path.extname(originalName) || '.webm';
    const newPath = tmpPath + ext;
    fs.renameSync(tmpPath, newPath);
    tmpPath = newPath; // Update tmpPath so it gets unlinked in the finally block

    // Build a seed prompt from the subject's known profile to reduce mis-transcription
    const whisperPrompt = buildWhisperPrompt(subject.profile || {});

    // Transcribe via Groq Whisper
    const transcript = await transcribeAudio(tmpPath, { prompt: whisperPrompt });

    if (!transcript || !transcript.trim()) {
      return res.status(422).json({ error: 'Transcription returned empty — audio may be silent or unsupported.' });
    }

    // Run through the same extraction pipeline as text upload
    const result = await processUploadedConversation(req.params.id, transcript);

    res.json({ ...result, transcript });
  } catch (err) {
    console.error('Upload audio error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // Always clean up the temp file
    if (tmpPath) fs.unlink(tmpPath, () => {});
  }
});

// ── Health ─────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apiKeyConfigured: validateApiKey(),
    timestamp: new Date().toISOString(),
  });
});

// ── Serve Frontend ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

// Initialize database then start server
db.initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✦ Biography Agent running at http://localhost:${PORT}`);
    if (!validateApiKey()) {
      console.log(`\n⚠  WARNING: GROQ_API_KEY is not set. Edit .env to add your key.\n`);
    } else {
      console.log(`✓ Groq API key detected.\n`);
    }
    if (!ACCESS_CODE) {
      console.log(`⚠  WARNING: ACCESS_CODE is not set — the app is PUBLICLY accessible. Set ACCESS_CODE to require an unlock code.\n`);
    } else {
      console.log(`✓ Access code protection enabled.\n`);
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
