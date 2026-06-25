// transcribeAudio.js — Groq Whisper transcription helper.
// Opens an audio file and returns a plain text transcript.
// Supports: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm

const fs = require('fs');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Transcribe an audio file using Groq Whisper.
 *
 * @param {string} filePath — absolute path to the audio file on disk
 * @param {Object} opts
 * @param {string} [opts.language] — BCP-47 language code (e.g. 'en', 'hi', 'es'). Omit for auto-detect.
 * @param {string} [opts.prompt] — seed prompt to improve accuracy (e.g. subject name, known places).
 *                                  Max ~224 tokens. Helps reduce proper-noun transcription errors.
 * @returns {Promise<string>} — the plain text transcript
 */
async function transcribeAudio(filePath, opts = {}) {
  const params = {
    file: fs.createReadStream(filePath),
    model: 'whisper-large-v3-turbo',
    response_format: 'json',
  };

  // Optional: language hint (improves speed + accuracy when language is known)
  if (opts.language) {
    params.language = opts.language;
  }

  // Optional: seed prompt with subject's name and known proper nouns to reduce mis-transcription
  if (opts.prompt) {
    params.prompt = opts.prompt;
  }

  const transcription = await groq.audio.transcriptions.create(params);
  return transcription.text || '';
}

/**
 * Build a Whisper seed prompt from a subject's profile.
 * This seeds Whisper with the subject's name, birthplace, profession etc.
 * to dramatically reduce mis-transcription of proper nouns.
 *
 * @param {Object} profile — subject profile object from DB
 * @returns {string}
 */
function buildWhisperPrompt(profile) {
  const parts = ['Biographical interview.'];
  if (profile.name) parts.push(`Subject: ${profile.name}.`);
  if (profile.birthPlace) parts.push(`Birthplace: ${profile.birthPlace}.`);
  if (profile.hometown) parts.push(`Hometown: ${profile.hometown}.`);
  if (profile.profession) parts.push(`Profession: ${profile.profession}.`);
  if (profile.importantPeople) parts.push(`People mentioned: ${profile.importantPeople}.`);
  return parts.join(' ').slice(0, 800); // Whisper prompt limit is ~224 tokens ≈ ~800 chars
}

module.exports = { transcribeAudio, buildWhisperPrompt };
