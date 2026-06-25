// interviewerAgent.js — The core interviewer loop.
// Each turn: receive answer → analyze → update state → decide move → personalize question → respond.

const Groq = require('groq-sdk');
const db = require('./database');
const { QUESTIONS, SECTIONS } = require('./questionnaire');
const { getNextQuestions, buildCoverageMap } = require('./coverageMap');
const { subjectConfig } = require('../subject.config');

const SUBJECT = subjectConfig;
const SUBJECT_FULL = `${SUBJECT.honorific} ${SUBJECT.name}`;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

// ── System prompts ────────────────────────────────────────────────────────────

const INTERVIEWER_SYSTEM_PROMPT = `You are a skilled biographical interviewer with the warmth of a trusted friend and the craft of a seasoned journalist. You are conducting a life-story interview with ${SUBJECT_FULL}.
${SUBJECT.interviewerBackground}

${SUBJECT.referenceMaterial || ''}

HARD RULES — never break these:
1. Ask exactly ONE question per response. Never stack two questions. Never.
2. Before asking your question, write a brief reflection (1–3 sentences) that shows you genuinely heard what was just said. Use specific words or images from their answer.
3. Never push a sensitive thread more than once. If they deflect, note it and move on.
4. Never ask a yes/no question. Every question must invite a story or a scene.
5. Your default move is to go DEEPER — not to advance to the next topic. Move on only when a thread is genuinely exhausted.
6. Use the subject's real name and the names of people, firms, and places they mention. Sound personal and informed.
7. Never ask for information you already know from the background above.
8. Your tone is warm, unhurried, and genuinely curious. You are not conducting a survey — you are listening to a life.

OUTPUT FORMAT:
Return a JSON object with exactly these fields:
{
  "reflection": "Your 1–3 sentence reflection showing you heard them",
  "question": "Your single, personalized follow-up question",
  "moveType": "deepen" | "redirect" | "advance",
  "questionId": <integer id of the coverage-map question being addressed, or null if deepening>,
  "newThreads": ["thread description 1", "thread description 2"],
  "profileUpdates": { "key": "value" },
  "coverageUpdate": { "questionId": <int>, "status": "partial" | "covered" } | null,
  "answerQuality": "vague" | "moderate" | "rich"
}

Explain nothing outside the JSON. Return only valid JSON.`;

const ANALYSIS_SYSTEM_PROMPT = `You are analyzing a biographical interview answer to help an AI interviewer decide what to do next.

Given the subject's latest answer, the subject profile, and the conversation context, analyze and return a JSON object with:
{
  "quality": "vague" | "moderate" | "rich",
  "emotionalWeight": "low" | "medium" | "high",
  "hasNewThread": true | false,
  "newThreads": ["brief description of any new threads worth returning to later"],
  "profileUpdates": { "fieldName": "value extracted" },
  "suggestedMove": "deepen" | "redirect" | "advance",
  "reasoning": "one sentence explaining why"
}

"vague" = short, abstract, avoids specifics. "rich" = concrete, emotionally present, detailed scene.
A "thread" is something the person mentions that deserves its own conversation later (a person, event, or emotion they only hinted at).
Return only valid JSON.`;

const ONBOARDING_SYSTEM_PROMPT = `You are beginning a warm, welcoming biographical interview with ${SUBJECT_FULL}.

${SUBJECT.onboardingBackground}

Your job right now is NOT to ask about his professional career — that will come in depth later. Your goal is to make him feel genuinely welcome and to learn a few things that will make every future question feel personal:
- His birthplace and approximate birth decade
- The 2–3 people who matter most to him personally (spouse, children, parents)
- One sentence on the emotional centre of his life — was it family, a driving idea, service, legacy?

Once you have enough to begin the real interview, end your response with exactly this token on its own line: [ONBOARDING_COMPLETE]

HARD RULES:
- Ask ONE question at a time.
- Be warm and conversational, not clinical.
- Do NOT ask about professional career details you already know.
- Each response: a brief warm acknowledgment, then one natural question.
- Do NOT start the biography interview yet.
- Return a JSON object:
{
  "response": "Your warm conversational message to the subject",
  "profileUpdates": { "fieldName": "extracted value" },
  "onboardingComplete": true | false
}

Return only valid JSON.`;

// ── Onboarding ────────────────────────────────────────────────────────────────

/**
 * Handle onboarding turns (before the real interview starts).
 * Returns { response, profileUpdates, onboardingComplete }
 */
async function handleOnboardingTurn(subjectId, userMessage, conversationHistory) {
  const subject = db.getSubject(subjectId);
  const profile = subject?.profile || {};

  const messages = [
    {
      role: 'user',
      content: buildOnboardingContext(profile, conversationHistory, userMessage),
    },
  ];

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: ONBOARDING_SYSTEM_PROMPT },
      ...messages,
    ],
    temperature: 0.7,
    max_tokens: 600,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content;
  const result = JSON.parse(raw);

  // Update profile with any new data extracted
  if (result.profileUpdates && Object.keys(result.profileUpdates).length > 0) {
    const newProfile = { ...profile, ...result.profileUpdates };
    db.updateProfile(subjectId, newProfile);
  }

  return result;
}

function buildOnboardingContext(profile, history, latestMessage) {
  const profileStr = Object.keys(profile).length > 0
    ? `Known so far: ${JSON.stringify(profile)}`
    : 'No profile yet.';

  const historyStr = history.length > 0
    ? history.slice(-8).map(t => `${t.role === 'agent' ? 'Interviewer' : 'Subject'}: ${t.content}`).join('\n')
    : 'This is the very first message.';

  return `${profileStr}

Conversation so far:
${historyStr}

Subject's latest message: "${latestMessage}"

Now generate your response.`;
}

// ── Main Interview Loop ───────────────────────────────────────────────────────

/**
 * Main interview turn.
 * @param {string} subjectId
 * @param {string} sessionId
 * @param {string} userAnswer - the subject's latest answer
 * @param {number|null} lastQuestionId - the question ID the agent last asked
 * @returns {Object} { reflection, question, moveType, questionId, coveragePercent }
 */
async function handleInterviewTurn(subjectId, sessionId, userAnswer, lastQuestionId) {
  const subject = db.getSubject(subjectId);
  const profile = subject.profile;

  // Load state
  const coverageRows = db.getCoverage(subjectId);
  const coverageMap = buildCoverageMap(coverageRows);
  const openThreads = db.getOpenThreads(subjectId);
  const recentTurns = db.getRecentTurns(subjectId, 12);

  // Build context for the LLM
  const context = buildInterviewContext(profile, coverageMap, openThreads, recentTurns, userAnswer, lastQuestionId);

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: INTERVIEWER_SYSTEM_PROMPT },
      { role: 'user', content: context },
    ],
    temperature: 0.75,
    max_tokens: 800,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content;
  let result;
  try {
    result = JSON.parse(raw);
  } catch (e) {
    // Fallback if JSON parse fails
    result = {
      reflection: "Thank you for sharing that.",
      question: getNextQuestions(coverageMap, profile)[0]?.skeleton || "Tell me more.",
      moveType: 'advance',
      questionId: null,
      newThreads: [],
      profileUpdates: {},
      coverageUpdate: null,
    };
  }

  // ── Update State ──────────────────────────────────────────────────────────

  // Update profile
  if (result.profileUpdates && Object.keys(result.profileUpdates).length > 0) {
    const newProfile = { ...profile, ...result.profileUpdates };
    db.updateProfile(subjectId, newProfile);
  }

  // Mark coverage for the last question that was being discussed
  const questionToMark = result.coverageUpdate?.questionId || lastQuestionId;
  if (questionToMark) {
    const status = result.coverageUpdate?.status || 'partial';
    db.markCoverage(subjectId, questionToMark, status);
  }

  // Add new threads
  if (result.newThreads && result.newThreads.length > 0) {
    for (const thread of result.newThreads) {
      if (thread && thread.trim()) {
        const isSensitive = detectSensitivity(thread);
        db.addThread(subjectId, thread.trim(), isSensitive ? 'sensitive' : 'normal');
      }
    }
  }

  // Build the agent's full response text
  const agentMessage = `${result.reflection}\n\n${result.question}`;

  // Log turns to DB
  db.addTurn(sessionId, subjectId, 'user', userAnswer, lastQuestionId, null);
  db.addTurn(sessionId, subjectId, 'agent', agentMessage, result.questionId, result.moveType);

  // Coverage stats for the UI
  const stats = db.getCoverageStats(subjectId);
  const coveragePercent = Math.round(((stats.covered + stats.partial * 0.5) / stats.total) * 100);

  return {
    reflection: result.reflection,
    question: result.question,
    agentMessage,
    moveType: result.moveType || 'deepen',
    questionId: result.questionId,
    coveragePercent,
    coverageStats: stats,
  };
}

/**
 * Build the full context string for the interviewer LLM.
 */
function buildInterviewContext(profile, coverageMap, openThreads, recentTurns, userAnswer, lastQuestionId) {
  // Subject profile
  const profileStr = formatProfile(profile);

  // Coverage summary
  const covered = Object.values(coverageMap).filter(s => s === 'covered').length;
  const partial = Object.values(coverageMap).filter(s => s === 'partial').length;
  const untouched = Object.values(coverageMap).filter(s => s === 'untouched').length;
  const coverageSummary = `Coverage: ${covered} covered, ${partial} partial, ${untouched} untouched out of 80.`;

  // Next best questions (give top 5 options)
  const nextQs = getNextQuestions(coverageMap, profile).slice(0, 5);
  const nextQsStr = nextQs.map(q =>
    `[Q${q.id} S${q.section}] ${q.skeleton} (weight: ${q.weight})`
  ).join('\n');

  // Open threads (give top 5)
  const threadsStr = openThreads.slice(0, 5).map(t =>
    `[Thread #${t.id}${t.sensitivity === 'sensitive' ? ' SENSITIVE' : ''}] ${t.thread_text}`
  ).join('\n') || 'None yet.';

  // Recent conversation
  const historyStr = recentTurns.map(t =>
    `${t.role === 'agent' ? 'Interviewer' : subject_name(profile)}: ${t.content}`
  ).join('\n\n');

  // Last question that was being asked
  const lastQ = lastQuestionId ? QUESTIONS.find(q => q.id === lastQuestionId) : null;
  const lastQStr = lastQ ? `Last question being addressed: [Q${lastQ.id}] "${lastQ.skeleton}"` : 'No specific question was last asked (subject was free-sharing).';

  return `## SUBJECT PROFILE
${profileStr}

## COVERAGE STATUS
${coverageSummary}

## OPEN THREADS (things they mentioned that deserve deeper exploration)
${threadsStr}

## CANDIDATE NEXT QUESTIONS (from coverage map — use these for ADVANCE move)
${nextQsStr}

## RECENT CONVERSATION
${historyStr}

## CURRENT TURN
${lastQStr}
Subject's latest answer: "${userAnswer}"

Now analyze this answer and generate your response. Remember: ONE question only. Default to deepening unless the thread is genuinely exhausted.`;
}

function formatProfile(profile) {
  const lines = [];
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.birthDecade) lines.push(`Birth decade: ${profile.birthDecade}s`);
  if (profile.birthPlace) lines.push(`Birthplace: ${profile.birthPlace}`);
  if (profile.profession) lines.push(`Profession / life focus: ${profile.profession}`);
  if (profile.lifeFocus) lines.push(`Life centered on: ${profile.lifeFocus}`);
  if (profile.importantPeople) lines.push(`Important people: ${profile.importantPeople}`);
  if (profile.spouse) lines.push(`Spouse/Partner: ${profile.spouse}`);
  if (profile.children) lines.push(`Children: ${profile.children}`);
  if (profile.hometown) lines.push(`Hometown: ${profile.hometown}`);
  // Add any extra dynamic keys
  const known = new Set(['name','birthDecade','birthPlace','profession','lifeFocus','importantPeople','spouse','children','hometown','onboardingComplete']);
  for (const [k, v] of Object.entries(profile)) {
    if (!known.has(k) && v) lines.push(`${k}: ${v}`);
  }
  return lines.join('\n') || 'Profile not yet built.';
}

function subject_name(profile) {
  return profile?.name ? profile.name.split(' ')[0] : 'Subject';
}

function detectSensitivity(threadText) {
  const sensitiveKeywords = [
    'death', 'died', 'grief', 'loss', 'divorce', 'abuse', 'trauma', 'estrang',
    'mental health', 'depression', 'addiction', 'suicide', 'affair', 'violence',
    'regret', 'shame', 'secret', 'never spoke', 'stopped speaking',
  ];
  const lower = threadText.toLowerCase();
  return sensitiveKeywords.some(kw => lower.includes(kw));
}

// ── Session Opening ───────────────────────────────────────────────────────────

/**
 * Generate the agent's opening message for a new session (not the first).
 * Reviews open threads and coverage gaps, produces a warm reconnection.
 */
async function generateSessionOpener(subjectId) {
  const subject = db.getSubject(subjectId);
  const profile = subject.profile;
  const openThreads = db.getOpenThreads(subjectId);
  const coverageRows = db.getCoverage(subjectId);
  const coverageMap = buildCoverageMap(coverageRows);
  const stats = db.getCoverageStats(subjectId);
  const latestSession = db.getLatestSession(subjectId);

  // Get the last few turns from the previous session
  let lastSessionSummary = '';
  if (latestSession) {
    const turns = db.getSessionTurns(latestSession.id).slice(-4);
    lastSessionSummary = turns.map(t =>
      `${t.role === 'agent' ? 'Interviewer' : profile.name || 'Subject'}: ${t.content}`
    ).join('\n\n');
  }

  const topThread = openThreads.find(t => t.sensitivity !== 'sensitive') || openThreads[0];
  const nextQs = getNextQuestions(coverageMap, profile).slice(0, 3);

  const prompt = `You are a biographical interviewer welcoming back a subject at the start of a new session (session #${(latestSession?.session_number || 0) + 1}).

Subject: ${profile.name || 'the subject'}
Coverage: ${stats.covered} of 80 questions covered.

End of last session:
${lastSessionSummary || '(No previous session yet)'}

Most important open thread: ${topThread ? topThread.thread_text : 'None yet'}

Top next questions to address: ${nextQs.map(q => `[Q${q.id}] ${q.skeleton}`).join('; ')}

Write a warm, personal 2–3 sentence welcome-back message that:
1. Acknowledges you're picking up where you left off
2. Either gently revisits an open thread OR signals you'll continue exploring their story
3. Ends with ONE natural question that feels like a genuine continuation

Return JSON: { "message": "...", "questionId": <int or null> }`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are a warm, skilled biographical interviewer. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 400,
    response_format: { type: 'json_object' },
  });

  const result = JSON.parse(completion.choices[0].message.content);
  return result;
}

module.exports = { handleOnboardingTurn, handleInterviewTurn, generateSessionOpener };
