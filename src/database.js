// database.js — SQLite database setup and query layer using sql.js (pure JS)
// sql.js is a WASM port of SQLite — no native compilation needed.
// We load the database from/to disk manually on each write.

const fs = require('fs');
const path = require('path');

// DB lives in DATA_DIR (set by Railway volume mount) or the project root locally.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_PATH = path.join(DATA_DIR, 'biography.db');

// Ensure the data directory exists (important for Railway volume mounts)
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let SQL;
let db;

/**
 * Initialize sql.js and load (or create) the database.
 * Must be awaited before any queries.
 */
async function initDb() {
  if (db) return db;

  // Lazy-load sql.js
  SQL = await require('sql.js')();

  if (fs.existsSync(DB_PATH)) {
    const filebuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

  // Apply schema
  db.run(`PRAGMA foreign_keys = ON;`);
  initSchema();
  persist(); // Save the initial schema to disk
  return db;
}

/**
 * Persist the in-memory database to disk.
 */
function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      profile TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      started_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      ended_at INTEGER,
      session_number INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      subject_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      question_id INTEGER,
      move_type TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS coverage (
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      question_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'untouched',
      last_asked_at INTEGER,
      PRIMARY KEY (subject_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      thread_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      sensitivity TEXT NOT NULL DEFAULT 'normal',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      explored_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS biographies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      content_md TEXT NOT NULL,
      generated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
}

// ── Helper: run a query and return all rows as objects ────────────────────────

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

// ── Subjects ─────────────────────────────────────────────────────────────────

function createSubject(id, name, profile = {}) {
  run(
    `INSERT INTO subjects (id, name, profile) VALUES (?, ?, ?)`,
    [id, name, JSON.stringify(profile)]
  );
}

function getSubject(id) {
  const row = queryOne(`SELECT * FROM subjects WHERE id = ?`, [id]);
  if (!row) return null;
  return { ...row, profile: JSON.parse(row.profile || '{}') };
}

function updateProfile(subjectId, profile) {
  run(`UPDATE subjects SET profile = ? WHERE id = ?`, [JSON.stringify(profile), subjectId]);
}

function listSubjects() {
  return queryAll(`SELECT id, name, created_at FROM subjects ORDER BY created_at DESC`);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function createSession(id, subjectId) {
  const count = queryOne(`SELECT COUNT(*) as n FROM sessions WHERE subject_id = ?`, [subjectId]);
  const sessionNumber = (count?.n || 0) + 1;
  run(
    `INSERT INTO sessions (id, subject_id, session_number) VALUES (?, ?, ?)`,
    [id, subjectId, sessionNumber]
  );
  return sessionNumber;
}

function endSession(sessionId) {
  run(
    `UPDATE sessions SET ended_at = strftime('%s','now') WHERE id = ?`,
    [sessionId]
  );
}

function getLatestSession(subjectId) {
  return queryOne(
    `SELECT * FROM sessions WHERE subject_id = ? ORDER BY started_at DESC LIMIT 1`,
    [subjectId]
  );
}

// ── Turns ─────────────────────────────────────────────────────────────────────

function addTurn(sessionId, subjectId, role, content, questionId = null, moveType = null) {
  run(
    `INSERT INTO turns (session_id, subject_id, role, content, question_id, move_type)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, subjectId, role, content, questionId, moveType]
  );
}

function getTurns(subjectId, limit = 200) {
  return queryAll(
    `SELECT * FROM turns WHERE subject_id = ? ORDER BY created_at ASC LIMIT ?`,
    [subjectId, limit]
  );
}

function getRecentTurns(subjectId, n = 10) {
  const rows = queryAll(
    `SELECT * FROM turns WHERE subject_id = ? ORDER BY created_at DESC LIMIT ?`,
    [subjectId, n]
  );
  return rows.reverse();
}

function getSessionTurns(sessionId) {
  return queryAll(
    `SELECT * FROM turns WHERE session_id = ? ORDER BY created_at ASC`,
    [sessionId]
  );
}

// ── Coverage ──────────────────────────────────────────────────────────────────

function initCoverage(subjectId, questionIds) {
  for (const qid of questionIds) {
    run(
      `INSERT OR IGNORE INTO coverage (subject_id, question_id, status) VALUES (?, ?, 'untouched')`,
      [subjectId, qid]
    );
  }
}

function markCoverage(subjectId, questionId, status) {
  run(
    `INSERT INTO coverage (subject_id, question_id, status, last_asked_at)
     VALUES (?, ?, ?, strftime('%s','now'))
     ON CONFLICT(subject_id, question_id) DO UPDATE SET status = excluded.status, last_asked_at = excluded.last_asked_at`,
    [subjectId, questionId, status]
  );
}

function getCoverage(subjectId) {
  return queryAll(`SELECT question_id, status FROM coverage WHERE subject_id = ?`, [subjectId]);
}

function getCoverageStats(subjectId) {
  const rows = getCoverage(subjectId);
  const covered = rows.filter(r => r.status === 'covered').length;
  const partial = rows.filter(r => r.status === 'partial').length;
  const untouched = rows.filter(r => r.status === 'untouched').length;
  return { covered, partial, untouched, total: rows.length };
}

// ── Threads ───────────────────────────────────────────────────────────────────

function addThread(subjectId, threadText, sensitivity = 'normal') {
  run(
    `INSERT INTO threads (subject_id, thread_text, sensitivity) VALUES (?, ?, ?)`,
    [subjectId, threadText, sensitivity]
  );
}

function getOpenThreads(subjectId) {
  return queryAll(
    `SELECT * FROM threads WHERE subject_id = ? AND status = 'open' ORDER BY created_at ASC`,
    [subjectId]
  );
}

function updateThreadStatus(threadId, status) {
  run(
    `UPDATE threads SET status = ?, explored_at = strftime('%s','now') WHERE id = ?`,
    [status, threadId]
  );
}

// ── Biography ─────────────────────────────────────────────────────────────────

function saveBiography(subjectId, contentMd) {
  run(
    `INSERT INTO biographies (subject_id, content_md) VALUES (?, ?)`,
    [subjectId, contentMd]
  );
}

function getLatestBiography(subjectId) {
  return queryOne(
    `SELECT * FROM biographies WHERE subject_id = ? ORDER BY generated_at DESC LIMIT 1`,
    [subjectId]
  );
}

/**
 * Delete all generated biographies for a subject (keeps interview data intact).
 */
function deleteBiographies(subjectId) {
  run(`DELETE FROM biographies WHERE subject_id = ?`, [subjectId]);
}

/**
 * Delete a subject and ALL associated data: sessions, turns, coverage, threads, biographies.
 */
function deleteSubject(subjectId) {
  // Delete child rows first (no CASCADE in sql.js pragma mode)
  run(`DELETE FROM biographies WHERE subject_id = ?`, [subjectId]);
  run(`DELETE FROM threads WHERE subject_id = ?`, [subjectId]);
  run(`DELETE FROM coverage WHERE subject_id = ?`, [subjectId]);
  run(`DELETE FROM turns WHERE subject_id = ?`, [subjectId]);
  run(`DELETE FROM sessions WHERE subject_id = ?`, [subjectId]);
  run(`DELETE FROM subjects WHERE id = ?`, [subjectId]);
}

module.exports = {
  initDb, persist,
  // subjects
  createSubject, getSubject, updateProfile, listSubjects, deleteSubject,
  // sessions
  createSession, endSession, getLatestSession,
  // turns
  addTurn, getTurns, getRecentTurns, getSessionTurns,
  // coverage
  initCoverage, markCoverage, getCoverage, getCoverageStats,
  // threads
  addThread, getOpenThreads, updateThreadStatus,
  // biography
  saveBiography, getLatestBiography, deleteBiographies,
};
