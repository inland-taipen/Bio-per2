// coverageMap.js — Coverage map logic: which questions to ask next.
// Selects the best next untouched question, weighted to the subject's profile.

const { QUESTIONS, SECTIONS } = require('./questionnaire');

/**
 * Returns an ordered list of question IDs that haven't been covered yet,
 * weighted toward sections most relevant to this subject's life.
 *
 * @param {Object} coverageMap  - { questionId: 'untouched'|'partial'|'covered' }
 * @param {Object} profile      - subject profile (profession, lifeFocus, etc.)
 * @param {number} currentSection - prefer staying in current section first
 * @returns {Array} question objects in priority order
 */
function getNextQuestions(coverageMap, profile = {}, currentSection = 1) {
  const sectionWeights = computeSectionWeights(profile);

  // Prioritize: partial > untouched. Within each, weight by section relevance.
  const partial = [];
  const untouched = [];

  for (const q of QUESTIONS) {
    const status = coverageMap[q.id] || 'untouched';
    if (status === 'covered') continue;

    const item = {
      ...q,
      priority: sectionWeights[q.section] + (q.section === currentSection ? 10 : 0),
    };

    if (status === 'partial') {
      partial.push(item);
    } else {
      untouched.push(item);
    }
  }

  // Sort each group by priority descending, then by id ascending (natural order)
  const sort = (arr) => arr.sort((a, b) => b.priority - a.priority || a.id - b.id);

  return [...sort(partial), ...sort(untouched)];
}

/**
 * Compute section relevance weights based on the subject's profile.
 * Returns { sectionNumber: weight } where higher = more relevant.
 */
function computeSectionWeights(profile) {
  const base = { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5 };
  const focus = (profile.lifeFocus || '').toLowerCase();
  const profession = (profile.profession || '').toLowerCase();

  // Boost career/professional section for founders, executives, professionals
  if (
    focus.includes('career') || focus.includes('work') || focus.includes('profession') ||
    profession.includes('founder') || profession.includes('ceo') ||
    profession.includes('entrepreneur') || profession.includes('engineer') ||
    profession.includes('doctor') || profession.includes('lawyer') ||
    profession.includes('scientist') || profession.includes('artist')
  ) {
    base[2] += 4; // Education, Career
    base[4] += 2; // Turning Points (often career-linked)
  }

  // Boost relationships section for family-centered lives
  if (
    focus.includes('family') || focus.includes('parent') || focus.includes('children') ||
    focus.includes('community') || focus.includes('relationships')
  ) {
    base[3] += 4; // Personal Life, Relationships
    base[1] += 2; // Early Life (family roots)
  }

  // Boost wisdom/legacy for older subjects
  if (profile.birthDecade && parseInt(profile.birthDecade) <= 1960) {
    base[5] += 3;
  }

  return base;
}

/**
 * Convert a flat coverage DB array to a map { questionId: status }
 */
function buildCoverageMap(coverageRows) {
  const map = {};
  for (const row of coverageRows) {
    map[row.question_id] = row.status;
  }
  return map;
}

/**
 * Returns coverage percentage (0–100)
 */
function getCoveragePercent(coverageMap) {
  const total = QUESTIONS.length;
  const done = Object.values(coverageMap).filter(s => s === 'covered').length;
  return Math.round((done / total) * 100);
}

module.exports = { getNextQuestions, buildCoverageMap, getCoveragePercent, computeSectionWeights };
