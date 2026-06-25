// uploadAgent.js — Biographical data extraction from uploaded conversations.
// Accepts any freeform text (WhatsApp exports, interview transcripts, plain notes, JSON turns)
// and returns structured updates for: profile, coverage map, and open threads.
// Downstream of this: same DB writes as the live interview (updateProfile, markCoverage, addThread, addTurn).

const Groq = require('groq-sdk');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { QUESTIONS } = require('./questionnaire');
const { buildCoverageMap } = require('./coverageMap');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

// ── System prompt ─────────────────────────────────────────────────────────────

const UPLOAD_SYSTEM_PROMPT = `You are a biographical data extraction specialist. You receive raw conversation text (WhatsApp voice note transcripts, chat exports, interview notes, phone memos, or any freeform biographical content) and extract structured information for a biography project.

Your job: read the text, find every biographical fact, and map it to a structured output.

WHAT TO EXTRACT:

1. PROFILE UPDATES — factual attributes of the subject:
   - name, birthDecade, birthPlace, hometown, profession, lifeFocus
   - importantPeople (a string list of names + relationship)
   - spouse, children
   - Any other concrete facts: education, religion, nationality, etc.

2. COVERAGE UPDATES — which biographical topics are addressed?
   You will be given the full list of 80 questions. For each question addressed in the text, return:
   { questionId: <int>, status: "partial" | "covered" }
   "covered" = the text gives a rich, specific answer to this question.
   "partial" = the text mentions it but lacks depth or specifics.
   Be generous — if the text touches on a topic even briefly, mark it partial.

3. NEW THREADS — topics, people, or events mentioned that deserve deeper exploration later.
   Each thread should be a single sentence describing what was mentioned and why it's interesting.
   Flag sensitive threads (death, grief, divorce, abuse, trauma, addiction, estrangement) by setting sensitivity = "sensitive".

4. SUMMARY — a 2–3 sentence human-readable summary of what was found in this upload.

OUTPUT FORMAT (return only valid JSON):
{
  "profileUpdates": { "fieldName": "extracted value" },
  "coverageUpdates": [
    { "questionId": <int>, "status": "partial" | "covered" }
  ],
  "newThreads": [
    { "text": "thread description", "sensitivity": "normal" | "sensitive" }
  ],
  "summary": "2–3 sentence summary of what was found"
}

IMPORTANT:
- The subject may be speaking casually or in their native language patterns — be liberal in interpretation.
- If the text is a two-person dialogue, treat the non-interviewer as the subject.
- If the text is entirely in a non-English language but the profile says English, still extract facts.
- Do NOT invent facts. Only extract what is explicitly stated or very strongly implied.
- Return only valid JSON. No commentary outside the JSON object.`;

// ── Sensitivity detection (mirrors interviewerAgent.js) ───────────────────────

function detectSensitivity(text) {
  const sensitiveKeywords = [
    'death', 'died', 'grief', 'loss', 'divorce', 'abuse', 'trauma', 'estrang',
    'mental health', 'depression', 'addiction', 'suicide', 'affair', 'violence',
    'regret', 'shame', 'secret', 'never spoke', 'stopped speaking',
  ];
  const lower = text.toLowerCase();
  return sensitiveKeywords.some(kw => lower.includes(kw));
}

// ── Build extraction context ──────────────────────────────────────────────────

function buildUploadContext(profile, rawText) {
  // Current profile
  const profileStr = Object.keys(profile).length > 0
    ? `Current subject profile: ${JSON.stringify(profile, null, 2)}`
    : 'Subject profile: not yet built.';

  // List all 80 questions so the LLM can map coverage
  const questionsStr = QUESTIONS.map(q =>
    `[Q${q.id} S${q.section}] ${q.skeleton}`
  ).join('\n');

  return `${profileStr}

== FULL QUESTION LIST (80 questions) ==
${questionsStr}

== UPLOADED TEXT TO ANALYZE ==
${rawText.trim()}

Now extract all biographical information from the uploaded text and return the structured JSON.`;
}

// ── Acknowledgement message ───────────────────────────────────────────────────

/**
 * Generate a warm, in-character agent message acknowledging what was learned
 * from the upload and asking a natural follow-up question.
 * Returns { agentMessage, questionId }
 */
async function generateUploadAcknowledgement(subjectId, summary, coverageUpdates) {
  const subject = db.getSubject(subjectId);
  if (!subject) return { agentMessage: summary, questionId: null };
  const profile = subject.profile || {};

  // Find the most interesting newly-covered question to follow up on
  const { getNextQuestions, buildCoverageMap } = require('./coverageMap');
  const coverageRows = db.getCoverage(subjectId);
  const coverageMap = buildCoverageMap(coverageRows);
  const nextQs = getNextQuestions(coverageMap, profile).slice(0, 3);
  const nextQsStr = nextQs.map(q => `[Q${q.id}] ${q.skeleton}`).join('\n');

  const openThreads = db.getOpenThreads(subjectId).slice(0, 3);
  const threadsStr = openThreads.map(t => t.thread_text).join('\n') || 'None yet.';

  const subjectName = profile.name ? profile.name.split(' ')[0] : 'you';

  const prompt = `You are a warm biographical interviewer. You've just been shown an uploaded conversation or voice note that your subject shared.

Subject: ${subjectName}
What was found in the upload: ${summary}

Open threads worth exploring: ${threadsStr}

Top next questions you haven't covered yet:
${nextQsStr}

Write a 2–3 sentence response in your interviewer voice that:
1. Warmly acknowledges that you've read/heard what they shared (don't say "upload" or "file" — say something natural like "what you shared" or "that conversation")
2. Picks out ONE specific detail from the summary and shows you genuinely registered it
3. Ends with ONE natural follow-up question (drawn from the next questions above, personalised with their name or a detail from the summary)

Return JSON: { "message": "...", "questionId": <int or null> }`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a warm, skilled biographical interviewer. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.75,
      max_tokens: 350,
      response_format: { type: 'json_object' },
    });
    const ack = JSON.parse(completion.choices[0].message.content);
    return { agentMessage: ack.message || summary, questionId: ack.questionId || null };
  } catch (e) {
    // Fallback to plain summary if LLM call fails
    return { agentMessage: summary, questionId: null };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Process any uploaded conversation/text and extract biographical data.
 * Writes updates directly to the DB (same functions as live interview).
 *
 * @param {string} subjectId
 * @param {string} rawText — the full uploaded text (WhatsApp export, transcript, notes, etc.)
 * @returns {Object} { summary, agentMessage, questionId, coverageUpdates, threadsFound, profileUpdates, coverageStats, coveragePercent }
 */
async function processUploadedConversation(subjectId, rawText) {
  const subject = db.getSubject(subjectId);
  if (!subject) throw new Error('Subject not found');
  const profile = subject.profile || {};

  // Truncate very long inputs to avoid token limits (~40k chars ~= ~10k tokens, safe for 70b)
  const MAX_CHARS = 40000;
  const text = rawText.length > MAX_CHARS
    ? rawText.slice(0, MAX_CHARS) + '\n\n[... text truncated for length ...]'
    : rawText;

  // Call extraction LLM
  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: UPLOAD_SYSTEM_PROMPT },
      { role: 'user', content: buildUploadContext(profile, text) },
    ],
    temperature: 0.2,  // Low temperature for factual extraction
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content;
  let result;
  try {
    result = JSON.parse(raw);
  } catch (e) {
    throw new Error('Failed to parse extraction result from LLM');
  }

  // ── Write to DB ───────────────────────────────────────────────────────────

  // 1. Profile updates
  if (result.profileUpdates && Object.keys(result.profileUpdates).length > 0) {
    const newProfile = { ...profile, ...result.profileUpdates };
    db.updateProfile(subjectId, newProfile);
  }

  // 2. Coverage updates
  const coverageUpdates = result.coverageUpdates || [];
  for (const cu of coverageUpdates) {
    if (cu.questionId && cu.status) {
      db.markCoverage(subjectId, cu.questionId, cu.status);
    }
  }

  // 3. New threads
  const newThreads = result.newThreads || [];
  for (const thread of newThreads) {
    if (thread && thread.text && thread.text.trim()) {
      const sensitivity = thread.sensitivity === 'sensitive'
        ? 'sensitive'
        : (detectSensitivity(thread.text) ? 'sensitive' : 'normal');
      db.addThread(subjectId, thread.text.trim(), sensitivity);
    }
  }

  // 4. Store the uploaded text as turns (role='upload') so writer agent picks them up
  //    Create a synthetic session for this upload
  const uploadSessionId = uuidv4();
  db.createSession(uploadSessionId, subjectId);
  // Store entire raw text as a single 'upload' turn (split if huge)
  const TURN_MAX = 8000;
  const chunks = [];
  for (let i = 0; i < rawText.length; i += TURN_MAX) {
    chunks.push(rawText.slice(i, i + TURN_MAX));
  }
  for (const chunk of chunks) {
    db.addTurn(uploadSessionId, subjectId, 'upload', chunk, null, null);
  }

  // ── Return stats ──────────────────────────────────────────────────────────

  const stats = db.getCoverageStats(subjectId);
  const coveragePercent = Math.round(((stats.covered + stats.partial * 0.5) / stats.total) * 100);

  // Generate in-character agent acknowledgement for the chat
  const ack = await generateUploadAcknowledgement(subjectId, result.summary || 'Conversation processed.', coverageUpdates);

  // Log the agent acknowledgement as a real turn in the current session (if one exists)
  // so it appears in future session history
  db.addTurn(uploadSessionId, subjectId, 'agent', ack.agentMessage, ack.questionId, 'advance');

  return {
    summary: result.summary || 'Conversation processed.',
    agentMessage: ack.agentMessage,
    questionId: ack.questionId,
    coverageUpdates,
    threadsFound: newThreads.length,
    profileUpdates: result.profileUpdates || {},
    coverageStats: stats,
    coveragePercent,
  };
}

module.exports = { processUploadedConversation };
