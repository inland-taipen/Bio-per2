/* app.js — Biography Agent frontend logic */
/* Handles view routing, API calls, chat rendering, voice input, coverage updates */

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  subjectId: null,
  subjectName: null,
  sessionId: null,
  sessionNumber: 1,
  isOnboarding: true,
  lastQuestionId: null,
  isWaiting: false,
  recognition: null,
  isRecording: false,
  coverageStats: { covered: 0, partial: 0, untouched: 80, total: 80 },
};

// ── View Management ───────────────────────────────────────────────────────────

function showView(id) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) {
    target.classList.remove('hidden');
    // Trigger reflow for transition
    void target.offsetWidth;
    target.classList.add('active');
  }
}

function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}
function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// ── Access code ───────────────────────────────────────────────────────────────

const ACCESS_KEY = 'bio_access_code';
let SUBJECT_NAME = null; // populated from /api/config
function getAccessCode() { return localStorage.getItem(ACCESS_KEY) || ''; }
function setAccessCode(c) { localStorage.setItem(ACCESS_KEY, c); }

// Single fetch choke point — injects the access code header on every request,
// so both api() and the FormData upload paths are covered.
async function authedFetch(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const code = getAccessCode();
  if (code) headers['x-access-code'] = code;
  return fetch(path, Object.assign({}, opts, { headers }));
}

// ── API Helpers ───────────────────────────────────────────────────────────────

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await authedFetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    requireUnlock();
    throw new Error('__LOCKED__');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;
function showError(msg) {
  if (msg === '__LOCKED__') return; // unlock overlay handles this case
  const toast = document.getElementById('toast-error');
  const msgEl = document.getElementById('toast-error-msg');
  msgEl.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5000);
}

// ── Coverage Ring ─────────────────────────────────────────────────────────────

function updateCoverageDisplay(percent, stats) {
  const pct = Math.max(0, Math.min(100, percent || 0));
  document.getElementById('coverage-percent').textContent = `${pct}%`;

  // SVG ring: circumference = 2π × 40 ≈ 251.2
  const circ = 251.2;
  const offset = circ - (pct / 100) * circ;
  const ring = document.getElementById('ring-fill');
  if (ring) ring.style.strokeDashoffset = offset;

  if (stats) {
    state.coverageStats = stats;
    document.getElementById('stat-covered').textContent = stats.covered || 0;
    document.getElementById('stat-partial').textContent = stats.partial || 0;
    document.getElementById('stat-untouched').textContent = stats.untouched ?? 80;
    updateSectionBars(stats);
  }
}

function updateSectionBars(stats) {
  // We don't have per-section data from the API yet — derive rough progress
  // by dividing covered/partial across sections proportionally
  // (simplified: assume even distribution for now)
  const total = stats.total || 80;
  const pct = Math.round(((stats.covered + stats.partial * 0.5) / total) * 100);

  for (let i = 1; i <= 5; i++) {
    const bar = document.getElementById(`bar-${i}`);
    if (bar) {
      // Stagger section completion: later sections unlock as earlier ones fill
      const sectionThreshold = (i - 1) * 20;
      const sectionPct = Math.max(0, Math.min(100, ((pct - sectionThreshold) / 20) * 100));
      bar.style.width = `${sectionPct}%`;
    }
  }
}

// ── Move indicator ────────────────────────────────────────────────────────────

function showMoveIndicator(moveType) {
  if (!moveType) return;
  const indicator = document.getElementById('move-indicator');
  const badge = document.getElementById('move-badge');
  indicator.classList.remove('hidden');
  badge.textContent = moveType;
  badge.style.background = moveType === 'deepen'
    ? 'rgba(201,150,42,0.1)'
    : moveType === 'redirect'
    ? 'rgba(90,60,140,0.2)'
    : 'rgba(50,140,90,0.1)';
  badge.style.color = moveType === 'deepen'
    ? 'var(--gold-light)'
    : moveType === 'redirect'
    ? '#c090f0'
    : '#80d0a0';
  badge.style.borderColor = moveType === 'deepen'
    ? 'rgba(201,150,42,0.2)'
    : moveType === 'redirect'
    ? 'rgba(90,60,140,0.3)'
    : 'rgba(50,140,90,0.2)';
}

// ── Sidebar Updates ───────────────────────────────────────────────────────────

function updateSidebar(name, session) {
  document.getElementById('subject-name-sidebar').textContent = name;
  document.getElementById('subject-session-sidebar').textContent = `Session ${session}`;
  const avatar = document.getElementById('subject-avatar-sidebar');
  avatar.textContent = (name || '?').charAt(0).toUpperCase();
}

// ── Chat Rendering ────────────────────────────────────────────────────────────

function renderAgentMessage(text, moveType) {
  const container = document.getElementById('chat-messages');

  // Remove typing indicator if present
  const typing = document.getElementById('typing-indicator');
  if (typing) typing.remove();

  const el = document.createElement('div');
  el.className = 'message agent';

  // Split reflection and question if both are present (separated by \n\n)
  let reflection = '';
  let question = text;
  if (text.includes('\n\n')) {
    const parts = text.split('\n\n');
    reflection = parts[0];
    question = parts.slice(1).join('\n\n');
  }

  const bubbleContent = reflection
    ? `<div class="msg-reflection">${escHtml(reflection)}</div><div class="msg-question">${escHtml(question)}</div>`
    : `<div class="msg-question">${escHtml(question)}</div>`;

  el.innerHTML = `
    <div class="msg-avatar">✦</div>
    <div class="msg-body">
      <div class="msg-bubble">${bubbleContent}</div>
    </div>
  `;

  container.appendChild(el);
  scrollToBottom();

  if (moveType) showMoveIndicator(moveType);
}

function renderUserMessage(text) {
  const container = document.getElementById('chat-messages');
  const initial = (state.subjectName || '?').charAt(0).toUpperCase();

  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = `
    <div class="msg-avatar">${escHtml(initial)}</div>
    <div class="msg-body">
      <div class="msg-bubble">${escHtml(text)}</div>
    </div>
  `;

  container.appendChild(el);
  scrollToBottom();
}

function showTypingIndicator() {
  const container = document.getElementById('chat-messages');
  // Remove existing
  const existing = document.getElementById('typing-indicator');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'message agent typing-indicator';
  el.id = 'typing-indicator';
  el.innerHTML = `
    <div class="msg-avatar">✦</div>
    <div class="msg-body">
      <div class="msg-bubble">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  container.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');
}

// ── Send Message ──────────────────────────────────────────────────────────────

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || state.isWaiting) return;

  input.value = '';
  autoResizeTextarea(input);
  renderUserMessage(text);
  showTypingIndicator();
  setWaiting(true);

  try {
    const result = await api('POST', '/api/interview/turn', {
      subjectId: state.subjectId,
      sessionId: state.sessionId,
      message: text,
      lastQuestionId: state.lastQuestionId,
      isOnboarding: state.isOnboarding,
    });

    renderAgentMessage(result.agentMessage, result.moveType);

    // Update state
    if (result.questionId) state.lastQuestionId = result.questionId;
    if (typeof result.onboardingComplete !== 'undefined') {
      state.isOnboarding = !result.onboardingComplete;
    } else if (typeof result.isOnboarding !== 'undefined') {
      state.isOnboarding = result.isOnboarding;
    }
    if (typeof result.coveragePercent === 'number') {
      updateCoverageDisplay(result.coveragePercent, result.coverageStats);
    }

  } catch (err) {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
    showError(err.message);
  } finally {
    setWaiting(false);
  }
}

function setWaiting(v) {
  state.isWaiting = v;
  const btn = document.getElementById('btn-send');
  const input = document.getElementById('chat-input');
  btn.disabled = v;
  input.disabled = v;
}

// ── Auto-resize textarea ──────────────────────────────────────────────────────

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

// ── Voice Input ───────────────────────────────────────────────────────────────

function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.getElementById('btn-voice').style.opacity = '0.3';
    document.getElementById('btn-voice').title = 'Voice input not supported in this browser';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  state.recognition = recognition;

  const btn = document.getElementById('btn-voice');
  const iconMic = document.getElementById('icon-mic');
  const iconActive = document.getElementById('icon-mic-active');
  const input = document.getElementById('chat-input');

  recognition.onresult = (e) => {
    let interim = '';
    let final = '';
    for (const r of e.results) {
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    input.value = final || interim;
    autoResizeTextarea(input);
  };

  recognition.onend = () => {
    state.isRecording = false;
    btn.classList.remove('recording');
    iconMic.classList.remove('hidden');
    iconActive.classList.add('hidden');
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech') showError('Voice input error: ' + e.error);
    recognition.onend();
  };

  btn.addEventListener('click', () => {
    if (state.isRecording) {
      recognition.stop();
    } else {
      state.isRecording = true;
      btn.classList.add('recording');
      iconMic.classList.add('hidden');
      iconActive.classList.remove('hidden');
      recognition.start();
    }
  });
}

// ── Biography ─────────────────────────────────────────────────────────────────

function renderMarkdown(md) {
  // Simple Markdown renderer (no external deps needed)
  let html = md
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Blockquotes
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // HR
    .replace(/^---$/gm, '<hr/>')
    // Paragraphs: wrap lines not already tagged
    .split('\n\n')
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<hr')) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  return html;
}

async function generateBiography() {
  if (!state.subjectId) return;

  // Show generating overlay
  const overlay = document.getElementById('overlay-generating');
  overlay.classList.remove('hidden');

  // Animate steps
  const steps = ['gen-step-1','gen-step-2','gen-step-3','gen-step-4'];
  let stepIdx = 0;
  const stepInterval = setInterval(() => {
    if (stepIdx > 0) {
      document.getElementById(steps[stepIdx - 1]).classList.add('done');
      document.getElementById(steps[stepIdx - 1]).classList.remove('active');
      document.getElementById(steps[stepIdx - 1]).textContent =
        document.getElementById(steps[stepIdx - 1]).textContent.replace('◎', '✓');
    }
    if (stepIdx < steps.length) {
      const el = document.getElementById(steps[stepIdx]);
      el.classList.add('active');
      el.textContent = el.textContent.replace('○', '◎');
    }
    stepIdx++;
    if (stepIdx >= steps.length + 1) clearInterval(stepInterval);
  }, 1800);

  try {
    const result = await api('POST', `/api/subjects/${state.subjectId}/biography`);
    clearInterval(stepInterval);

    // Render biography
    document.getElementById('bio-subject-name-header').textContent = state.subjectName;
    document.getElementById('bio-content').innerHTML = renderMarkdown(result.biography);

    overlay.classList.add('hidden');
    showView('view-biography');
  } catch (err) {
    clearInterval(stepInterval);
    overlay.classList.add('hidden');
    showError(err.message);
  }
}

async function deleteBiography() {
  if (!state.subjectId) return;
  const confirmed = window.confirm(
    'Delete the generated biography?\n\nYour interview data and transcript will be kept — you can always generate a new biography later.'
  );
  if (!confirmed) return;

  try {
    await api('DELETE', `/api/subjects/${state.subjectId}/biography`);
    showView('view-interview');
    showError('Biography deleted. Your interview data is safe.');
    // Show a success toast instead of error
    const toast = document.getElementById('toast-error');
    toast.style.background = 'rgba(50,140,90,0.15)';
    toast.style.borderColor = 'rgba(50,140,90,0.3)';
    toast.style.color = '#80d0a0';
    toast.querySelector('svg').style.color = '#80d0a0';
    setTimeout(() => {
      toast.style.background = '';
      toast.style.borderColor = '';
      toast.style.color = '';
      toast.querySelector('svg').style.color = '';
    }, 4000);
  } catch (err) {
    showError(err.message);
  }
}

// ── Subject List ──────────────────────────────────────────────────────────────

async function loadSubjectList() {
  const container = document.getElementById('subject-list-container');
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>Loading...</span></div>`;

  try {
    const data = await api('GET', '/api/subjects');
    const subjects = data.subjects || [];

    if (subjects.length === 0) {
      container.innerHTML = `<div class="loading-state"><span style="color:var(--text-muted)">No biographies yet. Start a new one!</span></div>`;
      return;
    }

    container.innerHTML = subjects.map(s => `
      <div class="subject-list-item" data-id="${s.id}" data-name="${escHtml(s.name)}">
        <div class="subject-list-avatar">${s.name.charAt(0).toUpperCase()}</div>
        <div class="subject-list-info">
          <div class="subject-list-name">${escHtml(s.name)}</div>
          <div class="subject-list-meta">Started ${new Date(s.created_at * 1000).toLocaleDateString()}</div>
        </div>
        <svg class="subject-list-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        <button class="subject-list-delete" data-id="${s.id}" data-name="${escHtml(s.name)}" title="Delete subject and all data">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    `).join('');

    container.querySelectorAll('.subject-list-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Don't navigate if the delete button was clicked
        if (e.target.closest('.subject-list-delete')) return;
        const id = item.dataset.id;
        const name = item.dataset.name;
        hideModal('modal-subject-list');
        startSession(id, name);
      });
    });

    container.querySelectorAll('.subject-list-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        const confirmed = window.confirm(
          `Permanently delete "${name}"?\n\nThis will remove their entire interview transcript, all sessions, open threads, and any generated biography. This cannot be undone.`
        );
        if (!confirmed) return;
        try {
          await api('DELETE', `/api/subjects/${id}`);
          // If the deleted subject is currently active, go back to welcome
          if (state.subjectId === id) {
            state.subjectId = null;
            state.subjectName = null;
            state.sessionId = null;
            hideModal('modal-subject-list');
            showView('view-welcome');
          } else {
            // Reload the list
            await loadSubjectList();
          }
        } catch (err) {
          showError(err.message);
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="loading-state"><span style="color:#ff8080">${escHtml(err.message)}</span></div>`;
  }
}

// ── Transcript Rendering ──────────────────────────────────────────────────────

/**
 * Load all previous turns from the DB and render them in the chat.
 * Groups by session number and shows dividers between sessions.
 * Skips raw 'upload' content blobs (shows a compact card instead).
 */
async function renderTranscript(subjectId, subjectName) {
  const container = document.getElementById('chat-messages');
  let lastAgentQuestionId = null;
  try {
    const data = await api('GET', `/api/subjects/${subjectId}/transcript`);
    const turns = data.turns || [];
    if (turns.length === 0) return null;

    // Group turns by session_id to detect session boundaries
    let currentSessionId = null;
    let sessionNum = 0;
    // Track upload sessions so we show one card per upload, not each chunk
    const shownUploadSessions = new Set();

    for (const turn of turns) {
      // Session divider
      if (turn.session_id !== currentSessionId) {
        currentSessionId = turn.session_id;
        sessionNum++;
        if (sessionNum > 1) {
          // Show a divider between sessions
          const div = document.createElement('div');
          div.className = 'session-divider';
          div.innerHTML = `<span>Session ${sessionNum}</span>`;
          container.appendChild(div);
        }
      }

      if (turn.role === 'upload') {
        // Show one compact upload card per session (not every chunk)
        if (!shownUploadSessions.has(turn.session_id)) {
          shownUploadSessions.add(turn.session_id);
          const card = document.createElement('div');
          card.className = 'upload-history-card';
          card.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Conversation uploaded`;
          container.appendChild(card);
        }
        continue;
      }

      if (turn.role === 'agent') {
        renderAgentMessage(turn.content, turn.move_type);
        // Track the most recent question the agent asked. May be null when the
        // last move was a "deepen" (which intentionally maps to no coverage Q).
        lastAgentQuestionId = (turn.question_id != null) ? turn.question_id : null;
      } else if (turn.role === 'user') {
        renderUserMessage(turn.content);
      }
    }

    // Scroll to bottom after rendering history
    scrollToBottom();
    return lastAgentQuestionId;
  } catch (err) {
    // Non-fatal: if transcript fails to load, just continue to new session
    console.warn('Could not load transcript:', err.message);
    return null;
  }
}

// ── Start Session ─────────────────────────────────────────────────────────────

async function startSession(subjectId, subjectName) {
  state.subjectId = subjectId;
  state.subjectName = subjectName;
  state.lastQuestionId = null;
  state.isOnboarding = true;

  // Clear chat
  document.getElementById('chat-messages').innerHTML = '';
  updateSidebar(subjectName, 1);
  updateCoverageDisplay(0, { covered: 0, partial: 0, untouched: 80, total: 80 });
  showView('view-interview');

  try {
    // Check subject state first
    const subjectData = await api('GET', `/api/subjects/${subjectId}`);
    const isOnboarding = !(subjectData.subject?.profile?.onboardingComplete);
    state.isOnboarding = isOnboarding;

    updateCoverageDisplay(subjectData.coveragePercent || 0, subjectData.coverageStats);

    // Load and render previous sessions before starting a new one
    await renderTranscript(subjectId, subjectName);

    // Show divider for the new session (if there's prior history)
    const hasPriorTurns = document.getElementById('chat-messages').children.length > 0;

    showTypingIndicator();

    const sessionData = await api('POST', `/api/subjects/${subjectId}/sessions`);
    state.sessionId = sessionData.sessionId;
    state.sessionNumber = sessionData.sessionNumber;
    state.isOnboarding = sessionData.isOnboarding;
    if (sessionData.questionId) state.lastQuestionId = sessionData.questionId;

    updateSidebar(subjectName, sessionData.sessionNumber);
    updateCoverageDisplay(subjectData.coveragePercent || 0, subjectData.coverageStats);

    // Add a "new session" divider if we have prior history
    if (hasPriorTurns) {
      const typing = document.getElementById('typing-indicator');
      const container = document.getElementById('chat-messages');
      const div = document.createElement('div');
      div.className = 'session-divider session-divider-new';
      div.innerHTML = `<span>Session ${sessionData.sessionNumber} — Today</span>`;
      if (typing) container.insertBefore(div, typing);
      else container.appendChild(div);
    }

    renderAgentMessage(sessionData.openingMessage, null);
  } catch (err) {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
    showError(err.message);
  }
}

async function resumeSession(subjectId, subjectName) {
  state.subjectId = subjectId;
  state.subjectName = subjectName;
  state.lastQuestionId = null;

  document.getElementById('chat-messages').innerHTML = '';
  showView('view-interview');

  try {
    const subjectData = await api('GET', `/api/subjects/${subjectId}`);
    state.isOnboarding = !(subjectData.subject?.profile?.onboardingComplete);
    state.sessionId = subjectData.latestSessionId;
    state.sessionNumber = subjectData.sessionNumber;

    updateSidebar(subjectName, state.sessionNumber);
    updateCoverageDisplay(subjectData.coveragePercent || 0, subjectData.coverageStats);

    const restoredQuestionId = await renderTranscript(subjectId, subjectName);
    // Restore the in-progress question so the first answer after resuming is
    // attributed to the right coverage-map question (null is valid if the last
    // agent move was a deepen).
    state.lastQuestionId = restoredQuestionId != null ? restoredQuestionId : null;

    if (!state.sessionId) {
      return startSession(subjectId, subjectName);
    }
  } catch (err) {
    showError(err.message);
  }
}

// ── Upload Feature ────────────────────────────────────────────────────────────

const uploadState = {
  selectedFile: null,      // File object from file input or drag-drop
  recordedBlob: null,      // Blob from MediaRecorder
  mediaRecorder: null,
  recordingChunks: [],
  recordTimerInterval: null,
  recordStartTime: null,
};

// Switch between upload tabs (text / file / record)
function switchUploadTab(tabName) {
  document.querySelectorAll('.upload-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.upload-panel').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  document.getElementById(`tab-${tabName}`).classList.add('active');
  const activePanel = document.getElementById(`panel-${tabName}`);
  activePanel.classList.remove('hidden');
  activePanel.classList.add('active');
  hideUploadResults();
}

function showUploadLoading(msg = 'Processing...') {
  document.getElementById('upload-loading').classList.remove('hidden');
  document.getElementById('upload-loading-text').textContent = msg;
  document.querySelectorAll('.upload-panel').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  document.getElementById('upload-results').classList.add('hidden');
}

function hideUploadLoading() {
  document.getElementById('upload-loading').classList.add('hidden');
  // Restore active tab panel by switching to it
  const activeTab = document.querySelector('.upload-tab.active')?.dataset.tab;
  if (activeTab) switchUploadTab(activeTab);
}

function hideUploadResults() {
  document.getElementById('upload-results').classList.add('hidden');
}

function showUploadResults(data) {
  const resultsEl = document.getElementById('upload-results');
  const summaryEl = document.getElementById('upload-results-summary');
  const statsEl = document.getElementById('upload-results-stats');
  const transcriptDetails = document.getElementById('upload-transcript-details');
  const transcriptPre = document.getElementById('upload-transcript-text');

  summaryEl.textContent = data.summary || 'Processing complete.';

  const cu = data.coverageUpdates || [];
  const threads = data.threadsFound || 0;
  const profile = data.profileUpdates || {};
  const profileCount = Object.keys(profile).length;

  let statsHtml = '';
  if (cu.length > 0) statsHtml += `<span class="upload-stat-chip upload-stat-green">+${cu.length} coverage update${cu.length !== 1 ? 's' : ''}</span>`;
  if (threads > 0) statsHtml += `<span class="upload-stat-chip upload-stat-amber">${threads} thread${threads !== 1 ? 's' : ''} found</span>`;
  if (profileCount > 0) statsHtml += `<span class="upload-stat-chip upload-stat-blue">${profileCount} profile field${profileCount !== 1 ? 's' : ''}</span>`;
  if (!statsHtml) statsHtml = `<span class="upload-stat-chip">No new data extracted</span>`;
  statsEl.innerHTML = statsHtml;

  // Show transcript if available (audio upload)
  if (data.transcript) {
    transcriptDetails.classList.remove('hidden');
    transcriptPre.textContent = data.transcript;
  } else {
    transcriptDetails.classList.add('hidden');
  }

  resultsEl.classList.remove('hidden');
}

// Submit text conversation
async function submitUploadText() {
  const text = document.getElementById('upload-text-input').value.trim();
  if (!text) return;
  if (!state.subjectId) return;

  showUploadLoading('Extracting biographical data...');
  try {
    const data = await api('POST', `/api/subjects/${state.subjectId}/upload-conversation`, { text });
    hideUploadLoading();
    showUploadResults(data);
    updateCoverageDisplay(data.coveragePercent, data.coverageStats);
    // Show agent message in the chat after a short pause then close modal
    if (data.agentMessage) {
      setTimeout(() => {
        hideModal('modal-upload');
        renderAgentMessage(data.agentMessage, 'advance');
        if (data.questionId) state.lastQuestionId = data.questionId;
      }, 1800);
    }
  } catch (err) {
    hideUploadLoading();
    showError(err.message);
  }
}

// Submit file (text or audio)
async function submitUploadFile() {
  const file = uploadState.selectedFile;
  if (!file || !state.subjectId) return;

  const isAudio = file.type.startsWith('audio/') ||
    /\.(mp3|m4a|ogg|wav|webm|flac|aac|mpeg|mpga|mp4)$/i.test(file.name);

  if (isAudio) {
    showUploadLoading('Transcribing audio... this may take a moment.');
    try {
      const fd = new FormData();
      fd.append('audio', file);
      const res = await authedFetch(`/api/subjects/${state.subjectId}/upload-audio`, {
        method: 'POST',
        body: fd,
      });
      if (res.status === 401) { requireUnlock(); throw new Error('__LOCKED__'); }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      hideUploadLoading();
      showUploadResults(data);
      updateCoverageDisplay(data.coveragePercent, data.coverageStats);
      if (data.agentMessage) {
        setTimeout(() => {
          hideModal('modal-upload');
          renderAgentMessage(data.agentMessage, 'advance');
          if (data.questionId) state.lastQuestionId = data.questionId;
        }, 1800);
      }
    } catch (err) {
      hideUploadLoading();
      showError(err.message);
    }
  } else {
    // Text file: read it, then POST as text
    showUploadLoading('Reading file...');
    try {
      const text = await file.text();
      const data = await api('POST', `/api/subjects/${state.subjectId}/upload-conversation`, { text });
      hideUploadLoading();
      showUploadResults(data);
      updateCoverageDisplay(data.coveragePercent, data.coverageStats);
      if (data.agentMessage) {
        setTimeout(() => {
          hideModal('modal-upload');
          renderAgentMessage(data.agentMessage, 'advance');
          if (data.questionId) state.lastQuestionId = data.questionId;
        }, 1800);
      }
    } catch (err) {
      hideUploadLoading();
      showError(err.message);
    }
  }
}

// Submit in-browser recording blob
async function submitRecording() {
  const blob = uploadState.recordedBlob;
  if (!blob || !state.subjectId) return;

  showUploadLoading('Transcribing recording...');
  try {
    const fd = new FormData();
    fd.append('audio', blob, 'recording.webm');
    const res = await authedFetch(`/api/subjects/${state.subjectId}/upload-audio`, {
      method: 'POST',
      body: fd,
    });
    if (res.status === 401) { requireUnlock(); throw new Error('__LOCKED__'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    hideUploadLoading();
    showUploadResults(data);
    updateCoverageDisplay(data.coveragePercent, data.coverageStats);
    if (data.agentMessage) {
      setTimeout(() => {
        hideModal('modal-upload');
        renderAgentMessage(data.agentMessage, 'advance');
        if (data.questionId) state.lastQuestionId = data.questionId;
      }, 1800);
    }
  } catch (err) {
    hideUploadLoading();
    showError(err.message);
  }
}

// MediaRecorder — in-browser recording
async function toggleRecording() {
  if (uploadState.mediaRecorder && uploadState.mediaRecorder.state === 'recording') {
    // Stop
    uploadState.mediaRecorder.stop();
    clearInterval(uploadState.recordTimerInterval);
    document.getElementById('record-btn-label').textContent = 'Start Recording';
    document.getElementById('icon-record-start').classList.remove('hidden');
    document.getElementById('icon-record-stop').classList.add('hidden');
    document.getElementById('record-status').textContent = 'Recording stopped. Click "Use recording" to process.';
    document.getElementById('record-wave').classList.remove('active');
    document.getElementById('record-idle-icon').classList.remove('hidden');
    document.getElementById('btn-record-toggle').classList.remove('recording');
  } else {
    // Start
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      uploadState.recordingChunks = [];
      uploadState.recordedBlob = null;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      uploadState.mediaRecorder = new MediaRecorder(stream, { mimeType });

      uploadState.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) uploadState.recordingChunks.push(e.data);
      };

      uploadState.mediaRecorder.onstop = () => {
        uploadState.recordedBlob = new Blob(uploadState.recordingChunks, { type: mimeType });
        stream.getTracks().forEach(t => t.stop());
        document.getElementById('btn-submit-recording').disabled = false;
      };

      uploadState.mediaRecorder.start();
      uploadState.recordStartTime = Date.now();

      // Timer
      uploadState.recordTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - uploadState.recordStartTime) / 1000);
        const m = Math.floor(elapsed / 60);
        const s = elapsed % 60;
        document.getElementById('record-timer').textContent = `${m}:${s.toString().padStart(2, '0')}`;
      }, 500);

      document.getElementById('record-btn-label').textContent = 'Stop Recording';
      document.getElementById('icon-record-start').classList.add('hidden');
      document.getElementById('icon-record-stop').classList.remove('hidden');
      document.getElementById('record-status').textContent = 'Recording in progress...';
      document.getElementById('record-wave').classList.add('active');
      document.getElementById('record-idle-icon').classList.add('hidden');
      document.getElementById('btn-record-toggle').classList.add('recording');
      document.getElementById('btn-submit-recording').disabled = true;
    } catch (err) {
      showError('Microphone access denied: ' + err.message);
    }
  }
}

// Reset upload modal state
function resetUploadModal() {
  document.getElementById('upload-text-input').value = '';
  uploadState.selectedFile = null;
  uploadState.recordedBlob = null;
  uploadState.recordingChunks = [];
  document.getElementById('upload-file-input').value = '';
  document.getElementById('file-selected-name').classList.add('hidden');
  document.getElementById('btn-submit-file').disabled = true;
  document.getElementById('btn-submit-recording').disabled = true;
  document.getElementById('record-timer').textContent = '0:00';
  document.getElementById('record-status').textContent = 'Click to start recording a memory';
  document.getElementById('record-btn-label').textContent = 'Start Recording';
  document.getElementById('icon-record-start').classList.remove('hidden');
  document.getElementById('icon-record-stop').classList.add('hidden');
  document.getElementById('record-wave').classList.remove('active');
  document.getElementById('record-idle-icon').classList.remove('hidden');
  document.getElementById('btn-record-toggle').classList.remove('recording');
  hideUploadResults();
  document.getElementById('upload-loading').classList.add('hidden');
  // Clear any hidden state left on panels from a previous loading cycle
  document.querySelectorAll('.upload-panel').forEach(p => p.classList.remove('hidden'));
  switchUploadTab('text');
}

function setupUpload() {
  // Open / close modal
  document.getElementById('btn-open-upload').addEventListener('click', () => {
    resetUploadModal();
    showModal('modal-upload');
  });
  document.getElementById('btn-close-upload').addEventListener('click', () => {
    hideModal('modal-upload');
  });
  document.getElementById('modal-upload').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal('modal-upload');
  });

  // Tabs
  document.querySelectorAll('.upload-tab').forEach(tab => {
    tab.addEventListener('click', () => switchUploadTab(tab.dataset.tab));
  });

  // Text tab submit
  document.getElementById('btn-submit-text').addEventListener('click', submitUploadText);

  // File tab — input change
  const fileInput = document.getElementById('upload-file-input');
  const dropzone = document.getElementById('upload-dropzone');

  function handleFileSelected(file) {
    if (!file) return;
    uploadState.selectedFile = file;
    const nameEl = document.getElementById('file-selected-name');
    nameEl.textContent = `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    nameEl.classList.remove('hidden');
    document.getElementById('btn-submit-file').disabled = false;
  }

  fileInput.addEventListener('change', () => handleFileSelected(fileInput.files[0]));

  // Dropzone click → trigger file input
  dropzone.addEventListener('click', () => fileInput.click());
  document.querySelector('.dropzone-link')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  // Drag-and-drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });

  document.getElementById('btn-submit-file').addEventListener('click', submitUploadFile);

  // Record tab
  document.getElementById('btn-record-toggle').addEventListener('click', toggleRecording);
  document.getElementById('btn-submit-recording').addEventListener('click', submitRecording);
}

// ── Init ──────────────────────────────────────────────────────────────────────

// ── Config & Unlock ───────────────────────────────────────────────────────────

// Fetch the public config and paint the welcome screen from it.
async function loadConfig() {
  try {
    const res = await fetch('/api/config'); // public endpoint, no auth needed
    if (!res.ok) return;
    const cfg = await res.json();
    applyConfig(cfg);
  } catch (err) {
    console.warn('Config load failed:', err.message);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el && value != null) el.textContent = value;
}

function applyConfig(cfg) {
  if (!cfg) return;
  if (cfg.name) SUBJECT_NAME = cfg.name;
  if (cfg.pageTitle) document.title = cfg.pageTitle;
  const ui = cfg.ui || {};

  setText('cfg-logo-text', ui.logoText);
  setText('cfg-nameplate-name', ui.nameplateName);
  setText('cfg-nameplate-title', ui.nameplateTitle);
  setText('cfg-subtitle', ui.subtitle);
  setText('cfg-quote', ui.pullQuote);

  // Title = plain line + emphasised (italic) line
  const titleEl = document.getElementById('cfg-title');
  if (titleEl && (ui.titleLine1 || ui.titleEmphasis)) {
    titleEl.innerHTML = `${escHtml(ui.titleLine1 || '')}<br/><em>${escHtml(ui.titleEmphasis || '')}</em>`;
  }

  // Milestone timeline
  const tl = document.getElementById('cfg-timeline');
  if (tl && Array.isArray(ui.timeline)) {
    tl.innerHTML = ui.timeline.map((m, i) => `
      <div class="milestone" style="--d:${(i * 0.15).toFixed(2)}s">
        <div class="milestone-year">${escHtml(m.year)}</div>
        <div class="milestone-dot"></div>
        <div class="milestone-label">${escHtml(m.label)}</div>
      </div>`).join('');
  }

  // Bio fact cards
  const bf = document.getElementById('cfg-bio-facts');
  if (bf && Array.isArray(ui.bioFacts)) {
    bf.innerHTML = ui.bioFacts.map(f => `
      <div class="bio-fact-card">
        <div class="bio-fact-icon">${escHtml(f.icon || '')}</div>
        <div class="bio-fact-body">
          <div class="bio-fact-label">${escHtml(f.label || '')}</div>
          <div class="bio-fact-value">${escHtml(f.value || '')}</div>
        </div>
      </div>`).join('');
  }
}

// Show the unlock overlay (called on any 401 from a gated call).
function requireUnlock() {
  const overlay = document.getElementById('overlay-unlock');
  if (!overlay || !overlay.classList.contains('hidden')) {
    // already visible (or missing) — nothing more to do
    if (overlay) {
      const input = document.getElementById('unlock-input');
      if (input) input.focus();
    }
    return;
  }
  overlay.classList.remove('hidden');
  const input = document.getElementById('unlock-input');
  if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
}

async function attemptUnlock() {
  const input = document.getElementById('unlock-input');
  const errEl = document.getElementById('unlock-error');
  const code = (input?.value || '').trim();
  if (!code) return;
  setAccessCode(code);
  // Verify against a gated endpoint.
  try {
    const res = await authedFetch('/api/subjects');
    if (res.ok) {
      if (errEl) errEl.classList.add('hidden');
      document.getElementById('overlay-unlock').classList.add('hidden');
      const data = await res.json().catch(() => ({}));
      reflectSubjectExistence((data.subjects || []).length);
    } else {
      if (errEl) errEl.classList.remove('hidden');
    }
  } catch (err) {
    if (errEl) errEl.classList.remove('hidden');
  }
}

// Once we know a subject exists, hide the "Begin" button to avoid confusion —
// only "Resume" makes sense from then on. (Pre-unlock we can't know, so both
// show on first paint by design.)
function reflectSubjectExistence(count) {
  const beginBtn = document.getElementById('btn-new-subject');
  if (beginBtn) beginBtn.classList.toggle('hidden', count > 0);
}

function init() {
  // Inject SVG gradient into page
  const svgDefs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgDefs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  svgDefs.innerHTML = `
    <defs>
      <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#c9962a"/>
        <stop offset="100%" stop-color="#d4853a"/>
      </linearGradient>
    </defs>
  `;
  document.body.prepend(svgDefs);

  // ── Welcome screen ──
  document.getElementById('btn-new-subject').addEventListener('click', async () => {
    const btn = document.getElementById('btn-new-subject');
    btn.disabled = true;
    try {
      const data = await api('GET', '/api/subjects');
      const subjects = data.subjects || [];
      reflectSubjectExistence(subjects.length);
      if (subjects.length > 0) {
        await resumeSession(subjects[0].id, subjects[0].name);
      } else {
        const res = await api('POST', '/api/subjects', { name: SUBJECT_NAME || 'Elizabeth Orlando' });
        await startSession(res.id, res.name);
      }
    } catch(err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-continue').addEventListener('click', async () => {
    const btn = document.getElementById('btn-continue');
    btn.disabled = true;
    try {
      const data = await api('GET', '/api/subjects');
      const subjects = data.subjects || [];
      reflectSubjectExistence(subjects.length);
      if (subjects.length > 0) {
        await resumeSession(subjects[0].id, subjects[0].name);
      } else {
        showError("No interview exists yet. Please click 'Begin the interview'.");
      }
    } catch(err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ── Interview view ──
  document.getElementById('btn-back-to-welcome').addEventListener('click', () => {
    showView('view-welcome');
  });

  document.getElementById('btn-generate-biography').addEventListener('click', generateBiography);

  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // M shortcut for mic
    if (e.key === 'm' && e.altKey) {
      document.getElementById('btn-voice').click();
    }
  });
  chatInput.addEventListener('input', () => autoResizeTextarea(chatInput));

  document.getElementById('btn-send').addEventListener('click', sendMessage);

  // ── Biography view ──
  document.getElementById('btn-back-to-interview').addEventListener('click', () => {
    showView('view-interview');
  });

  document.getElementById('btn-print-bio').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btn-regenerate-bio').addEventListener('click', generateBiography);

  document.getElementById('btn-delete-bio').addEventListener('click', deleteBiography);

  // ── Voice ──
  setupVoice();

  // ── Upload ──
  setupUpload();

  // ── Keyboard shortcut M for voice ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'm' && e.altKey && !e.ctrlKey && !e.metaKey) {
      const viewInterview = document.getElementById('view-interview');
      if (viewInterview.classList.contains('active')) {
        document.getElementById('btn-voice').click();
      }
    }
  });

  // ── Unlock overlay ──
  const unlockBtn = document.getElementById('btn-unlock');
  if (unlockBtn) unlockBtn.addEventListener('click', attemptUnlock);
  const unlockInput = document.getElementById('unlock-input');
  if (unlockInput) {
    unlockInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); attemptUnlock(); }
    });
  }

  // ── Load public config + paint welcome ──
  loadConfig();

  // ── Start at welcome ──
  showView('view-welcome');
}

document.addEventListener('DOMContentLoaded', init);

