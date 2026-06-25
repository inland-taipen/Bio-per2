// writerAgent.js — The biography writer. A completely separate agent from the interviewer.
// Reads the full transcript + subject profile and drafts a full biography in Markdown.

const Groq = require('groq-sdk');
const db = require('./database');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

const WRITER_SYSTEM_PROMPT = `You are a literary biographer of the highest order — think Robert Caro meets Mary Karr. You have been given the full transcript of a biographical interview and must now write a complete, beautifully crafted biography.

Your task:
1. Read the full transcript and subject profile carefully.
2. Find the throughline — the theme or quality that unifies this person's life.
3. Decide the chapter structure (typically 5–8 chapters following the arc of a life).
4. Write the full biography in the subject's authentic voice — not a report, but a story.

WRITING RULES:
- Write in vivid, literary prose. No bullet points. No headers that sound like a report.
- Open each chapter with a specific scene or image from the interview.
- Preserve the subject's actual words and phrases — quote them directly.
- Find patterns and connections the subject may not have stated explicitly.
- Do not moralize or over-interpret. Let the life speak.
- Write in present tense for scenes, past tense for reflection.
- The biography should feel like it was written by someone who spent 100 hours with this person.

STRUCTURE:
- Start with a compelling opening that drops the reader into a defining moment.
- Follow the arc: origins → formation → work → turning points → wisdom/legacy.
- End with the subject's own words wherever possible.

FORMAT:
Return a Markdown document with:
- A title: "# [Subject's Full Name]: [A Short, Evocative Subtitle]"
- A short epigraph (a quote from the interview)
- Chapter sections using ## headers with evocative titles (not generic like "Chapter 1")
- A brief author's note at the end

The biography should be 2,000–4,000 words. Write it all.`;

/**
 * Generate a full biography from the subject's transcript and profile.
 * @param {string} subjectId
 * @returns {string} Markdown biography
 */
async function generateBiography(subjectId) {
  const subject = db.getSubject(subjectId);
  if (!subject) throw new Error('Subject not found');

  const profile = subject.profile;
  const allTurns = db.getTurns(subjectId, 500);
  const openThreads = db.getOpenThreads(subjectId);

  // Build the full transcript
  const transcript = buildTranscript(allTurns, profile);

  // Build context for the writer
  const context = `## SUBJECT PROFILE
Name: ${profile.name || 'Unknown'}
Born: ${profile.birthDecade ? `${profile.birthDecade}s` : 'Unknown decade'}${profile.birthPlace ? `, ${profile.birthPlace}` : ''}
Profession / life focus: ${profile.profession || profile.lifeFocus || 'Not specified'}
Important people: ${profile.importantPeople || profile.spouse || 'Not specified'}

## FULL INTERVIEW TRANSCRIPT
${transcript}

## UNRESOLVED THREADS (for context — these may not have full answers)
${openThreads.map(t => `- ${t.thread_text}`).join('\n') || 'None'}

---
Now write the complete biography. Make it literary, specific, and true to this person's life as they described it.`;

  // Use a two-pass approach for long biographies:
  // First, generate chapter outline, then write each chapter
  const outlineCompletion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a literary biographer. Given this interview transcript and profile, first plan the biography structure.
Return JSON: { "title": "...", "subtitle": "...", "epigraph": "...", "throughline": "...", "chapters": [{ "title": "...", "focus": "..." }] }
Plan 5–7 chapters. Return only valid JSON.`
      },
      { role: 'user', content: context },
    ],
    temperature: 0.7,
    max_tokens: 800,
    response_format: { type: 'json_object' },
  });

  let outline;
  try {
    outline = JSON.parse(outlineCompletion.choices[0].message.content);
  } catch (e) {
    outline = {
      title: profile.name || 'A Life',
      subtitle: 'A Biography',
      epigraph: '',
      throughline: 'A remarkable life lived with purpose',
      chapters: [
        { title: 'Origins', focus: 'Early life and family' },
        { title: 'The Making', focus: 'Education and career beginnings' },
        { title: 'The Work', focus: 'Professional journey and achievements' },
        { title: 'Turning Points', focus: 'Major life changes and crises' },
        { title: 'What Remains', focus: 'Legacy, wisdom, and final reflections' },
      ],
    };
  }

  // Write the full biography in one large call
  const chaptersDesc = outline.chapters.map((c, i) =>
    `Chapter ${i + 1}: "${c.title}" — ${c.focus}`
  ).join('\n');

  const writePrompt = `${context}

## BIOGRAPHY PLAN
Title: ${outline.title}: ${outline.subtitle}
Epigraph: "${outline.epigraph}"
Throughline: ${outline.throughline}

Chapters to write:
${chaptersDesc}

Write the complete biography now. All chapters. Full literary prose. 2,000–4,000 words.`;

  const biographyCompletion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: WRITER_SYSTEM_PROMPT },
      { role: 'user', content: writePrompt },
    ],
    temperature: 0.8,
    max_tokens: 4096,
  });

  const biographyMd = biographyCompletion.choices[0].message.content;

  // Save to database
  db.saveBiography(subjectId, biographyMd);

  return biographyMd;
}

function buildTranscript(turns, profile) {
  const name = profile?.name ? profile.name.split(' ')[0] : 'Subject';

  if (!turns || turns.length === 0) {
    return '(No interview turns recorded yet)';
  }

  return turns.map(turn => {
    const speaker = turn.role === 'agent' ? 'Interviewer' : name;
    return `**${speaker}:** ${turn.content}`;
  }).join('\n\n');
}

module.exports = { generateBiography };
