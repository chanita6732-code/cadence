/* =========================================================
   Cadence — Habit Tracker & Productivity Dashboard (v2)
   ---------------------------------------------------------
   Sections
     1. Config & utilities
     2. Icons & templates
     3. Validation (every byte from storage, imports and the server passes here)
     4. Local persistence (LocalStorage, one namespace per account)
     5. Store — local-first state + outbox of changes to sync
     6. Sync — Firebase Auth + Firestore
     7. Stats engine
     8. UI helpers
     9. Router & header
    10. Renderers
    11. Charts
    12. Forms (habit / goal / settings / import-export)
    13. Accounts (sign in, sign up, sign out, guest mode)
    14. Events & boot
   ========================================================= */
'use strict';

/* =========================================================
   1. Config & utilities
   ========================================================= */
const CONFIG = window.CADENCE_CONFIG || {};
const cloudConfigured = () => Boolean(CONFIG.firebase && CONFIG.firebase.apiKey && CONFIG.firebase.projectId && window.firebase && typeof window.firebase.initializeApp === 'function');

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const pad = (n) => String(n).padStart(2, '0');
const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n) => (n == null ? null : Math.round(n * 100));
const nowIso = () => new Date().toISOString();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

function uuid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/* Dates are local calendar days, keyed "YYYY-MM-DD". */
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const todayKey = () => toKey(today());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((fromKey(toKey(b)) - fromKey(toKey(a))) / 86400000); // b − a
const startOfWeek = (d, weekStart) => addDays(d, -((d.getDay() - weekStart + 7) % 7));
const fmtDate = (d, opts = { month: 'short', day: 'numeric' }) => d.toLocaleDateString('en-US', opts);
const fmtLong = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const maxKey = (a, b) => (a > b ? a : b);
const minKey = (a, b) => (a < b ? a : b);

const MIN_DATE = '2000-01-01';
const MAX_DATE = '2100-12-31';
/** Earliest start date offered in the habit form (keeps history loops small). */
const minStartKey = () => toKey(addDays(today(), -730));

function isDateKey(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s < MIN_DATE || s > MAX_DATE) return false;
  return toKey(fromKey(s)) === s;
}

function relativeTime(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(new Date(iso));
}

/* =========================================================
   2. Icons & templates
   ========================================================= */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  habits: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  stats: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  skip: '<path d="m5 4 10 8-10 8V4Z"/><path d="M19 5v14"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  device: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  // Habit icons
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  study: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  dumbbell: '<path d="m6.5 6.5 11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7"/>',
  run: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  bed: '<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2M10 2v2M14 2v2"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  money: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
};
const HABIT_ICONS = ['book', 'study', 'dumbbell', 'run', 'code', 'globe', 'droplet', 'bed', 'heart', 'leaf', 'music', 'coffee', 'pen', 'money', 'sun', 'star'];
/* Fixed categorical order, validated for colour-vision deficiencies on dark surfaces. */
const HABIT_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#2f9e44', '#9085e9', '#e66767'];

/** Starting points for new users — they only pre-fill the form; nothing is created until the user saves. */
const TEMPLATES = [
  { name: 'Study', description: 'Focused session, 45 minutes', icon: 'study', days: [1, 2, 3, 4, 5] },
  { name: 'Exercise', description: 'Workout or a 30-minute run', icon: 'dumbbell', days: [1, 3, 5], weeklyTarget: 3 },
  { name: 'Read', description: '20 pages', icon: 'book', days: ALL_DAYS },
  { name: 'Practice English', description: 'Speaking or listening, 15 min', icon: 'globe', days: ALL_DAYS },
  { name: 'Coding', description: 'Build something small', icon: 'code', days: [1, 2, 3, 4, 5] },
  { name: 'Sleep early', description: 'In bed by 11 pm', icon: 'bed', days: ALL_DAYS },
  { name: 'Drink water', description: '8 glasses a day', icon: 'droplet', days: ALL_DAYS },
  { name: 'Meditate', description: '10 quiet minutes', icon: 'leaf', days: ALL_DAYS },
];

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.star}</svg>`;
}
const iconSpan = (name, cls = '') => `<span class="i ${cls}">${icon(name)}</span>`;
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}

/* =========================================================
   3. Validation
   ---------------------------------------------------------
   Nothing is rendered or stored unless it passes these checks.
   Rules mirror the checks in firestore.rules.
   ========================================================= */
const HEX_RE = /^#[0-9a-f]{6}$/i;
const LIMITS = { habits: 200, goals: 200, logs: 200000, backupBytes: 5 * 1024 * 1024 };

const str = (v, max) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const int = (v, min, max, fallback) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? clamp(n, min, max) : fallback; };
const isoOr = (v, fallback) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback);

function sanitizeProfile(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    name: str(p.name, 40),
    weekStart: Number(p.weekStart) === 0 ? 0 : 1,
    streakThreshold: int(p.streakThreshold, 1, 100, 80),
  };
}

function sanitizeHabit(raw) {
  if (!raw || typeof raw !== 'object' || !isUuid(raw.id)) return null;
  const name = str(raw.name, 40);
  if (!name) return null;
  let days = Array.isArray(raw.days) ? [...new Set(raw.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (!days.length) days = [...ALL_DAYS];
  const pausedRanges = (Array.isArray(raw.pausedRanges) ? raw.pausedRanges : [])
    .filter((r) => r && isDateKey(r.from) && (r.to === null || (isDateKey(r.to) && r.to >= r.from)))
    .slice(0, 100)
    .map((r) => ({ from: r.from, to: r.to }));
  return {
    id: raw.id.toLowerCase(),
    name,
    description: str(raw.description, 80),
    icon: HABIT_ICONS.includes(raw.icon) ? raw.icon : 'star',
    color: typeof raw.color === 'string' && HEX_RE.test(raw.color) ? raw.color.toLowerCase() : HABIT_COLORS[0],
    days,
    weeklyTarget: int(raw.weeklyTarget, 1, days.length, days.length),
    startDate: isDateKey(raw.startDate) ? raw.startDate : todayKey(),
    active: raw.active !== false,
    pausedRanges,
    order: int(raw.order, -1e6, 1e6, 0),
    createdAt: isoOr(raw.createdAt, nowIso()),
  };
}

function sanitizeGoal(raw, habitIds) {
  if (!raw || typeof raw !== 'object' || !isUuid(raw.id)) return null;
  const title = str(raw.title, 60);
  if (!title) return null;
  const habitId = isUuid(raw.habitId) && (!habitIds || habitIds.has(raw.habitId.toLowerCase())) ? raw.habitId.toLowerCase() : null;
  const mode = raw.mode === 'habit' && habitId ? 'habit' : 'manual';
  const startDate = isDateKey(raw.startDate) ? raw.startDate : todayKey();
  return {
    id: raw.id.toLowerCase(),
    title,
    mode,
    habitId: mode === 'habit' ? habitId : null,
    current: int(raw.current, 0, 1e9, 0),
    target: int(raw.target, 1, 1e9, 1),
    unit: str(raw.unit, 16),
    startDate,
    deadline: isDateKey(raw.deadline) ? raw.deadline : '',
    createdAt: isoOr(raw.createdAt, nowIso()),
  };
}

const STATUSES = ['done', 'skipped'];

/**
 * Turn any supported shape (local record, v1 or v2 backup) into clean state.
 * Non-UUID ids (v1 data) are remapped to fresh UUIDs, and references follow.
 * Throws if the input doesn't look like Cadence data at all.
 */
function parseData(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.habits)) throw new Error('Not a Cadence backup');
  const idMap = new Map();
  const mapId = (id) => {
    if (typeof id !== 'string' && typeof id !== 'number') return null;
    const k = String(id);
    if (!idMap.has(k)) idMap.set(k, isUuid(k) ? k.toLowerCase() : uuid());
    return idMap.get(k);
  };

  const seen = new Set();
  const habits = [];
  raw.habits.slice(0, LIMITS.habits).forEach((h, i) => {
    if (!h || typeof h !== 'object') return;
    const clean = sanitizeHabit({ ...h, id: mapId(h.id), order: h.order ?? i });
    if (clean && !seen.has(clean.id)) { seen.add(clean.id); habits.push(clean); }
  });
  const habitIds = new Set(habits.map((h) => h.id));

  const logs = {};
  let count = 0;
  const addLog = (date, rawHabitId, status) => {
    if (count >= LIMITS.logs || !isDateKey(date) || !STATUSES.includes(status)) return;
    const hid = rawHabitId == null ? null : idMap.get(String(rawHabitId));
    if (!hid || !habitIds.has(hid)) return;
    (logs[date] ||= {})[hid] = status;
    count++;
  };
  if (Array.isArray(raw.logs)) {
    raw.logs.forEach((l) => { if (l && typeof l === 'object') addLog(l.date, l.habitId, l.status); });
  } else if (raw.logs && typeof raw.logs === 'object') {
    Object.entries(raw.logs).forEach(([date, day]) => {
      if (day && typeof day === 'object') Object.entries(day).forEach(([hid, st]) => addLog(date, hid, st));
    });
  }

  const goalSeen = new Set();
  const goals = [];
  (Array.isArray(raw.goals) ? raw.goals : []).slice(0, LIMITS.goals).forEach((g) => {
    if (!g || typeof g !== 'object') return;
    const linked = g.habitId != null ? idMap.get(String(g.habitId)) || null : null;
    const clean = sanitizeGoal({ ...g, id: mapId(g.id), habitId: linked }, habitIds);
    if (clean && !goalSeen.has(clean.id)) { goalSeen.add(clean.id); goals.push(clean); }
  });

  // v2 stores `profile`; v1 stored `user.name` + `settings`
  const profile = sanitizeProfile(raw.profile || { name: raw.user?.name, ...(raw.settings || {}) });
  return { profile, habits, logs, goals };
}

const emptyData = (profile) => ({ profile: sanitizeProfile(profile), habits: [], logs: {}, goals: [] });

function countLogs(logs) {
  let n = 0;
  Object.values(logs).forEach((day) => { n += Object.keys(day).length; });
  return n;
}

/* =========================================================
   4. Local persistence
   ---------------------------------------------------------
   cadence:v2:prefs        device preferences (theme, last mode/user)
   cadence:v2:ns:<id>      one record per account ("guest" = no account):
                           { data, outbox, cursors, lastSyncAt }
   Each record is written with a single setItem, so it's atomic.
   ========================================================= */
const PREFS_KEY = 'cadence:v2:prefs';
const NS_PREFIX = 'cadence:v2:ns:';
const V1_KEY = 'cadence:data:v1';

const LocalDB = {
  read(key) {
    let raw;
    try { raw = localStorage.getItem(key); } catch (error) { return { status: 'unavailable', error }; }
    if (raw == null) return { status: 'empty' };
    try { return { status: 'ok', value: JSON.parse(raw), raw }; } catch { return { status: 'corrupt', raw }; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (err) { console.error('Save failed', err); return false; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage blocked */ } },
  bytes(key) { try { return new Blob([localStorage.getItem(key) || '']).size; } catch { return 0; } },
};

const Prefs = {
  data: { theme: 'dark', mode: null, lastUser: null, v1Handled: false },
  load() {
    const r = LocalDB.read(PREFS_KEY);
    const v = r.status === 'ok' && r.value && typeof r.value === 'object' ? r.value : {};
    this.data = {
      theme: v.theme === 'light' ? 'light' : 'dark',
      mode: v.mode === 'guest' || v.mode === 'cloud' ? v.mode : null,
      lastUser: v.lastUser && typeof v.lastUser.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v.lastUser.id) ? { id: v.lastUser.id, email: str(v.lastUser.email, 320) } : null,
      v1Handled: v.v1Handled === true,
    };
  },
  set(patch) { Object.assign(this.data, patch); LocalDB.write(PREFS_KEY, this.data); },
};

/* =========================================================
   5. Store — local-first state
   ---------------------------------------------------------
   Every mutation updates memory, persists locally, and (when signed
   in) adds an entry to the outbox. Sync pushes the outbox and pulls
   remote changes. A pending local change always wins over a remote
   one for the same record, so nothing you just did is overwritten.
   ========================================================= */
const OUTBOX_TABLES = ['profiles', 'habits', 'goals', 'logs'];

/* Change builders: local objects → Firestore documents (the `id` becomes the document id) */
const Rows = {
  habit: (h, deleted = false) => ({
    key: `habits:${h.id}`, table: 'habits',
    row: {
      id: h.id, name: h.name, description: h.description, icon: h.icon, color: h.color, days: h.days,
      weeklyTarget: h.weeklyTarget, startDate: h.startDate, active: h.active, pausedRanges: h.pausedRanges,
      order: h.order, createdAt: h.createdAt, deleted,
    },
  }),
  goal: (g, deleted = false) => ({
    key: `goals:${g.id}`, table: 'goals',
    row: {
      id: g.id, title: g.title, mode: g.mode, habitId: g.habitId, current: g.current, target: g.target, unit: g.unit,
      startDate: g.startDate, deadline: g.deadline || '', createdAt: g.createdAt, deleted,
    },
  }),
  log: (date, habitId, status) => ({
    key: `logs:${habitId}|${date}`, table: 'logs',
    row: { habitId, date, status: status || null },
  }),
  profile: (p) => ({
    key: 'profiles:me', table: 'profiles',
    row: { name: p.name, weekStart: p.weekStart, streakThreshold: p.streakThreshold },
  }),
  /** Hard-delete check-ins on the server: one habit's, or all (habitId = null). */
  purgeLogs: (habitId) => ({ key: `purge:${habitId || '*'}`, table: 'logs', op: 'purge', row: { habitId: habitId || null } }),
};

function sanitizeOutbox(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw).forEach(([key, e]) => {
    if (e && typeof e === 'object' && OUTBOX_TABLES.includes(e.table) && e.row && typeof e.row === 'object') {
      out[key] = { table: e.table, op: e.op === 'purge' ? 'purge' : 'upsert', row: e.row, v: String(e.v || uuid()) };
    }
  });
  return out;
}

const Store = {
  ns: null,              // 'guest' or the user's id
  mode: 'guest',         // 'guest' | 'cloud'
  userId: null,
  state: emptyData(),
  outbox: {},
  cursors: {},
  lastSyncAt: null,
  saveFailed: false,
  listeners: new Set(),

  /** Load a namespace. Returns 'ok' | 'empty' | 'corrupt' | 'unavailable'. */
  open(ns, mode, userId = null) {
    this.ns = ns; this.mode = mode; this.userId = userId;
    const res = LocalDB.read(NS_PREFIX + ns);
    let status = res.status;
    this.state = emptyData(); this.outbox = {}; this.cursors = {}; this.lastSyncAt = null;
    if (res.status === 'ok') {
      try {
        this.state = parseData(res.value?.data);
        this.outbox = sanitizeOutbox(res.value?.outbox);
        this.cursors = res.value?.cursors && typeof res.value.cursors === 'object' ? res.value.cursors : {};
        this.lastSyncAt = typeof res.value?.lastSyncAt === 'string' ? res.value.lastSyncAt : null;
      } catch {
        status = 'corrupt';
      }
    }
    if (status === 'corrupt') preserveCorrupt(res.raw, ns);
    Stats.clearCache();
    return status;
  },
  reset() { this.ns = null; this.mode = 'guest'; this.userId = null; this.state = emptyData(); this.outbox = {}; this.cursors = {}; this.lastSyncAt = null; Stats.clearCache(); },

  save() {
    if (!this.ns) return;
    const ok = LocalDB.write(NS_PREFIX + this.ns, { version: 2, data: this.state, outbox: this.outbox, cursors: this.cursors, lastSyncAt: this.lastSyncAt });
    this.saveFailed = !ok;
    $('#saveBanner').hidden = ok;
  },
  emit() { this.listeners.forEach((fn) => fn()); },
  onChange(fn) { this.listeners.add(fn); },

  /** Persist + queue changes for sync. Callers mutate `state` first. */
  commit(changes = []) {
    if (this.mode === 'cloud') changes.forEach((c) => { this.outbox[c.key] = { table: c.table, op: c.op || 'upsert', row: c.row, v: uuid() }; });
    Stats.clearCache();
    this.save();
    this.emit();
    if (this.mode === 'cloud' && changes.length) Sync.schedule();
  },
  pendingCount() { return Object.keys(this.outbox).length; },

  /* ----- Profile ----- */
  get profile() { return this.state.profile; },
  updateProfile(patch) {
    this.state.profile = sanitizeProfile({ ...this.state.profile, ...patch });
    this.commit([Rows.profile(this.state.profile)]);
  },

  /* ----- Habits ----- */
  get habits() { return [...this.state.habits].sort((a, b) => a.order - b.order); },
  getHabit(id) { return this.state.habits.find((h) => h.id === id); },
  addHabit(data) {
    const order = this.state.habits.reduce((m, h) => Math.max(m, h.order), -1) + 1;
    const habit = sanitizeHabit({ ...data, id: uuid(), order, createdAt: nowIso(), pausedRanges: data.active === false ? [{ from: todayKey(), to: null }] : [] });
    if (!habit) return null;
    this.state.habits.push(habit);
    this.commit([Rows.habit(habit)]);
    return habit;
  },
  updateHabit(id, patch) {
    const idx = this.state.habits.findIndex((h) => h.id === id);
    if (idx < 0) return false;
    const prev = this.state.habits[idx];
    const next = { ...prev, ...patch, pausedRanges: [...prev.pausedRanges] };
    if ('active' in patch && patch.active !== prev.active) applyPause(next, patch.active);
    const clean = sanitizeHabit(next);
    if (!clean) return false;
    this.state.habits[idx] = clean;
    this.commit([Rows.habit(clean)]);
    return true;
  },
  deleteHabit(id) {
    const h = this.getHabit(id);
    if (!h) return;
    const changes = [];
    // Linked goals keep their progress as a manual count
    this.state.goals.forEach((g) => {
      if (g.habitId === id) {
        Object.assign(g, { current: Stats.goalProgress(g).current, mode: 'manual', habitId: null });
        changes.push(Rows.goal(g));
      }
    });
    this.state.habits = this.state.habits.filter((x) => x.id !== id);
    Object.keys(this.state.logs).forEach((date) => {
      delete this.state.logs[date][id];
      if (!Object.keys(this.state.logs[date]).length) delete this.state.logs[date];
    });
    Object.keys(this.outbox).forEach((k) => { if (k.startsWith(`logs:${id}|`)) delete this.outbox[k]; });
    changes.push(Rows.habit(h, true), Rows.purgeLogs(id));
    this.commit(changes);
  },

  /* ----- Logs ----- */
  getStatus(dateKey, habitId) {
    const day = this.state.logs[dateKey];
    return day && Object.prototype.hasOwnProperty.call(day, habitId) ? day[habitId] : null;
  },
  setStatus(dateKey, habitId, status) {
    if (!isDateKey(dateKey) || !this.getHabit(habitId)) return;
    const next = STATUSES.includes(status) ? status : null;
    const day = (this.state.logs[dateKey] ||= {});
    if (next) day[habitId] = next; else delete day[habitId];
    if (!Object.keys(day).length) delete this.state.logs[dateKey];
    this.commit([Rows.log(dateKey, habitId, next)]);
  },

  /* ----- Goals ----- */
  get goals() { return [...this.state.goals]; },
  getGoal(id) { return this.state.goals.find((g) => g.id === id); },
  addGoal(data) {
    const g = sanitizeGoal({ ...data, id: uuid(), createdAt: nowIso() }, new Set(this.state.habits.map((h) => h.id)));
    if (!g) return null;
    this.state.goals.push(g);
    this.commit([Rows.goal(g)]);
    return g;
  },
  updateGoal(id, patch) {
    const idx = this.state.goals.findIndex((g) => g.id === id);
    if (idx < 0) return false;
    const clean = sanitizeGoal({ ...this.state.goals[idx], ...patch }, new Set(this.state.habits.map((h) => h.id)));
    if (!clean) return false;
    this.state.goals[idx] = clean;
    this.commit([Rows.goal(clean)]);
    return true;
  },
  deleteGoal(id) {
    const g = this.getGoal(id);
    if (!g) return;
    this.state.goals = this.state.goals.filter((x) => x.id !== id);
    this.commit([Rows.goal(g, true)]);
  },

  /** Replace everything (import / delete all). In cloud mode this propagates to all devices. */
  replaceAll(next) {
    const changes = [];
    if (this.mode === 'cloud') {
      Object.keys(this.outbox).forEach((k) => { if (k.startsWith('logs:') || k.startsWith('purge:')) delete this.outbox[k]; });
      changes.push(Rows.purgeLogs(null));
      const keepH = new Set(next.habits.map((h) => h.id));
      const keepG = new Set(next.goals.map((g) => g.id));
      this.state.habits.filter((h) => !keepH.has(h.id)).forEach((h) => changes.push(Rows.habit(h, true)));
      this.state.goals.filter((g) => !keepG.has(g.id)).forEach((g) => changes.push(Rows.goal(g, true)));
      next.habits.forEach((h) => changes.push(Rows.habit(h)));
      next.goals.forEach((g) => changes.push(Rows.goal(g)));
      Object.entries(next.logs).forEach(([date, day]) => Object.entries(day).forEach(([hid, st]) => changes.push(Rows.log(date, hid, st))));
      changes.push(Rows.profile(next.profile));
    }
    this.state = next;
    this.commit(changes);
  },

  /** Add records from another namespace (guest → account). Existing ids are left alone. */
  mergeIn(data) {
    const changes = [];
    const haveH = new Set(this.state.habits.map((h) => h.id));
    let order = this.state.habits.reduce((m, h) => Math.max(m, h.order), -1) + 1;
    data.habits.forEach((h) => {
      if (haveH.has(h.id)) return;
      const copy = { ...h, order: order++ };
      this.state.habits.push(copy);
      changes.push(Rows.habit(copy));
    });
    Object.entries(data.logs).forEach(([date, day]) => Object.entries(day).forEach(([hid, st]) => {
      if (haveH.has(hid) || this.getStatus(date, hid)) return;
      (this.state.logs[date] ||= {})[hid] = st;
      changes.push(Rows.log(date, hid, st));
    }));
    const haveG = new Set(this.state.goals.map((g) => g.id));
    data.goals.forEach((g) => { if (!haveG.has(g.id)) { this.state.goals.push({ ...g }); changes.push(Rows.goal(g)); } });
    if (!this.state.profile.name && data.profile.name) {
      this.state.profile = sanitizeProfile({ ...this.state.profile, name: data.profile.name });
      changes.push(Rows.profile(this.state.profile));
    }
    this.commit(changes);
  },
};

/** Pausing records a date range so history before the pause still counts. */
function applyPause(h, active) {
  const tk = todayKey();
  if (!active) {
    // If today was already checked off, pause from tomorrow so today's work still counts
    const from = Store.getStatus(tk, h.id) ? toKey(addDays(today(), 1)) : tk;
    h.pausedRanges.push({ from, to: null });
  } else {
    const open = h.pausedRanges.find((r) => r.to === null);
    if (open) {
      if (open.from >= tk) h.pausedRanges = h.pausedRanges.filter((r) => r !== open); // paused & resumed the same day
      else open.to = toKey(addDays(today(), -1));
    }
  }
}

/** Keep unreadable data instead of overwriting it (it can be downloaded from Settings). */
function preserveCorrupt(raw, ns) {
  if (!raw) return;
  const key = `cadence:v2:corrupt:${ns}:${Date.now()}`;
  let ok = true;
  try { localStorage.setItem(key, raw); } catch { ok = false; } // stored verbatim
  UI.corruptKey = ok ? key : null;
  UI.corruptRaw = raw;
}

/* =========================================================
   6. Sync — Firebase (Auth + Firestore)
   ---------------------------------------------------------
   users/{uid}                        profile
   users/{uid}/habits|goals/{id}      soft-deleted with deleted = true
   users/{uid}/logs/{habitId}_{date}  status null = cleared
   Push: the outbox is written in batches. Pull: realtime listeners that
   only ask for documents changed since the last cursor (server time),
   so each device downloads just what changed.
   ========================================================= */
const PULL_OVERLAP_MS = 10000;  // re-read a small window so nothing written around the cursor is missed
const WRITE_TIMEOUT_MS = 15000; // Firestore queues writes while offline; stop waiting after this
const BATCH_SIZE = 400;         // Firestore allows 500 writes per batch

const Cloud = {
  auth: null,
  db: null,
  init() {
    if (!cloudConfigured()) return;
    try {
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(CONFIG.firebase);
      this.auth = app.auth();
      this.db = app.firestore();
      const emu = CONFIG.emulator; // local testing only (see README)
      if (emu) {
        this.auth.useEmulator(`http://${emu.host}:${emu.authPort}`, { disableWarnings: true });
        this.db.useEmulator(emu.host, emu.firestorePort);
      }
    } catch (err) {
      console.error('Firebase init failed', err);
      this.auth = null;
      this.db = null;
    }
  },
  userDoc(uid) { return this.db.collection('users').doc(uid); },
  ref(uid, e) {
    const user = this.userDoc(uid);
    if (e.table === 'profiles') return user;
    if (e.table === 'logs') return user.collection('logs').doc(`${e.row.habitId}_${e.row.date}`);
    return user.collection(e.table).doc(e.row.id);
  },
  data(e) {
    const { id, ...fields } = e.row;
    return { ...fields, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  },
  /** Delete every document matched by a query, in batches (server only). */
  async deleteWhere(query) {
    for (;;) {
      const snap = await withTimeout(query.limit(BATCH_SIZE).get({ source: 'server' }), WRITE_TIMEOUT_MS);
      if (snap.empty) return;
      const batch = this.db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await withTimeout(batch.commit(), WRITE_TIMEOUT_MS);
      if (snap.size < BATCH_SIZE) return;
    }
  },
};

const Sync = {
  status: 'local',       // local | synced | syncing | offline | error | auth
  detail: '',
  timer: null,
  running: false,
  rerun: false,
  retryMs: 2000,
  unsubs: [],
  listenNs: null,
  habitsLive: false,     // habits listener has heard from the server at least once
  orphans: new Map(),    // check-ins that arrived before their habit
  deadHabits: new Set(), // habits known to be deleted

  setStatus(status, detail = '') {
    this.status = status; this.detail = detail;
    renderSyncStatus();
  },

  /** Debounced push of the outbox. */
  schedule(delay = 600) {
    if (Store.mode !== 'cloud' || !Cloud.db) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), delay);
  },

  async run() {
    if (Store.mode !== 'cloud' || !Cloud.db) return;
    if (this.running) { this.rerun = true; return; }
    if (!navigator.onLine) { this.setStatus('offline'); return; }
    this.running = true;
    const ns = Store.ns;
    let ok = false;
    try {
      if (Store.pendingCount()) this.setStatus('syncing');
      await this.push(ns);
      if (Store.ns !== ns) return;
      if (this.listenNs !== ns) this.listen(ns);
      ok = true;
      this.retryMs = 2000;
      if (!Store.pendingCount()) { Store.lastSyncAt = nowIso(); Store.save(); this.setStatus('synced'); }
    } catch (err) {
      this.fail(err);
    } finally {
      this.running = false;
      if (this.rerun || (ok && Store.pendingCount())) { this.rerun = false; this.schedule(300); }
    }
  },

  fail(err) {
    const code = String(err?.code || '');
    const msg = String(err?.message || err || '');
    console.warn('Sync failed:', code, msg);
    const network = !navigator.onLine || ['unavailable', 'deadline-exceeded'].includes(code) || /timeout|network|offline/i.test(msg);
    const auth = code === 'unauthenticated' || (code === 'permission-denied' && !Cloud.auth?.currentUser);
    this.setStatus(network ? 'offline' : auth ? 'auth' : 'error', msg);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 60000);
  },

  ack(key, entry) { if (Store.outbox[key]?.v === entry.v) delete Store.outbox[key]; },

  async push(ns) {
    const entries = Object.entries(Store.outbox);
    if (!entries.length) return;
    const uid = Store.userId;
    if (Cloud.auth.currentUser?.uid !== uid) throw Object.assign(new Error('Not signed in'), { code: 'unauthenticated' });
    // Purges first, so re-imported check-ins aren't deleted after being written
    const logs = Cloud.userDoc(uid).collection('logs');
    for (const [key, e] of entries.filter(([, x]) => x.op === 'purge')) {
      await Cloud.deleteWhere(e.row.habitId ? logs.where('habitId', '==', e.row.habitId) : logs);
      if (Store.ns !== ns) return;
      this.ack(key, e);
    }
    const order = ['profiles', 'habits', 'goals', 'logs'];
    const writes = entries.filter(([, x]) => x.op !== 'purge').sort((a, b) => order.indexOf(a[1].table) - order.indexOf(b[1].table));
    for (let i = 0; i < writes.length; i += BATCH_SIZE) {
      await this.commit(writes.slice(i, i + BATCH_SIZE), uid);
      if (Store.ns !== ns) return;
    }
    Store.save();
  },

  /** Write a batch; if the server rejects a document as invalid, isolate and drop it so sync never gets stuck. */
  async commit(chunk, uid) {
    const batch = Cloud.db.batch();
    chunk.forEach(([, e]) => batch.set(Cloud.ref(uid, e), Cloud.data(e)));
    try {
      await withTimeout(batch.commit(), WRITE_TIMEOUT_MS);
      chunk.forEach(([k, e]) => this.ack(k, e));
      return;
    } catch (err) {
      if (!isRejected(err)) throw err;
    }
    for (const [k, e] of chunk) {
      try {
        await withTimeout(Cloud.ref(uid, e).set(Cloud.data(e)), WRITE_TIMEOUT_MS);
      } catch (err) {
        if (!isRejected(err)) throw err;
        console.warn(`Dropped a ${e.table} change the server rejected`, e.row, err.message);
      }
      this.ack(k, e);
    }
  },

  /** Realtime listeners. Habits start first so check-ins always find their habit. */
  listen(ns) {
    this.stopListening();
    if (Store.mode !== 'cloud' || !Cloud.db || Store.ns !== ns) return;
    this.listenNs = ns;
    const uid = Store.userId;
    const user = Cloud.userDoc(uid);
    const onErr = (err) => { if (Store.ns === ns) this.fail(err); };

    this.unsubs.push(user.onSnapshot((snap) => {
      if (Store.ns !== ns || snap.metadata.hasPendingWrites) return;
      if (snap.exists) {
        if (mergeDoc('profiles', uid, snap.data())) this.changed();
      } else if (!snap.metadata.fromCache && !Store.profile.name && Auth.displayName) {
        Store.updateProfile({ name: Auth.displayName }); // brand-new account: use the name given at sign-up
      }
    }, onErr));

    let rest = false;
    this.listenTable(ns, user, 'habits', onErr, () => {
      if (rest) return;
      rest = true;
      this.listenTable(ns, user, 'goals', onErr);
      this.listenTable(ns, user, 'logs', onErr);
    });
  },

  listenTable(ns, user, table, onErr, onFirst) {
    const col = user.collection(table);
    const cursor = Store.cursors[table] ? Date.parse(Store.cursors[table]) : 0;
    const q = cursor
      ? col.where('updatedAt', '>', firebase.firestore.Timestamp.fromMillis(Math.max(0, cursor - PULL_OVERLAP_MS))).orderBy('updatedAt')
      : col.orderBy('updatedAt');
    this.unsubs.push(q.onSnapshot((snap) => {
      if (Store.ns !== ns) return;
      this.apply(table, snap);
      onFirst?.();
    }, onErr));
  },

  apply(table, snap) {
    let changed = false;
    let holdCursor = false;
    let max = Store.cursors[table] ? Date.parse(Store.cursors[table]) : 0;
    snap.docChanges().forEach((ch) => {
      if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites) return; // our own write, already applied
      const data = ch.doc.data();
      const t = data.updatedAt?.toMillis?.() || 0;
      const r = mergeDoc(table, ch.doc.id, data);
      if (r === 'orphan') {
        // Keep it while its habit may still be on the way; otherwise it belongs to a deleted habit
        if (!this.habitsLive || Date.now() - t < 120000) { this.orphans.set(ch.doc.id, data); holdCursor = true; return; }
      } else if (r) changed = true;
      if (t > max) max = t;
    });
    if (table === 'habits') {
      if (!snap.metadata.fromCache) this.habitsLive = true;
      this.orphans.forEach((data, id) => {
        const r = mergeDoc('logs', id, data);
        if (r !== 'orphan') { this.orphans.delete(id); if (r) changed = true; }
      });
    }
    if (max && !(table === 'logs' && (holdCursor || this.orphans.size))) Store.cursors[table] = new Date(max).toISOString();
    if (!snap.metadata.fromCache) {
      Store.lastSyncAt = nowIso();
      if (!Store.pendingCount() && !this.running && navigator.onLine) this.setStatus('synced');
    }
    if (changed) this.changed(); else Store.save();
  },

  changed() { Stats.clearCache(); Store.save(); Store.emit(); },

  stopListening() {
    this.unsubs.forEach((off) => { try { off(); } catch { /* already closed */ } });
    this.unsubs = [];
    this.listenNs = null;
    this.habitsLive = false;
    this.orphans.clear();
    this.deadHabits.clear();
  },
  stop() { clearTimeout(this.timer); this.stopListening(); },
};

/** The server refused the document itself (rules/validation) — retrying won't help. */
const isRejected = (e) => ['permission-denied', 'invalid-argument'].includes(e?.code) && Boolean(Cloud.auth?.currentUser);

/** Apply one remote document. Pending local changes for the same record win. Returns true if state changed. */
function mergeDoc(table, id, d) {
  const s = Store.state;
  if (!d || typeof d !== 'object') return false;
  if (table === 'profiles') {
    if (Store.outbox['profiles:me']) return false;
    const p = sanitizeProfile(d);
    if (JSON.stringify(p) === JSON.stringify(s.profile)) return false;
    s.profile = p;
    return true;
  }
  if (table === 'habits' || table === 'goals') {
    const key = String(id).toLowerCase();
    if (Store.outbox[`${table}:${key}`]) return false;
    const list = s[table];
    const idx = list.findIndex((x) => x.id === key);
    if (d.deleted === true) {
      if (table === 'habits') Sync.deadHabits.add(key);
      if (idx < 0) return false;
      list.splice(idx, 1);
      if (table === 'habits') {
        Object.keys(s.logs).forEach((date) => { delete s.logs[date][key]; if (!Object.keys(s.logs[date]).length) delete s.logs[date]; });
      }
      return true;
    }
    const clean = table === 'habits'
      ? sanitizeHabit({ ...d, id: key })
      : sanitizeGoal({ ...d, id: key }, new Set(s.habits.map((h) => h.id)));
    if (!clean) return false;
    if (idx >= 0 && JSON.stringify(list[idx]) === JSON.stringify(clean)) return false;
    if (idx >= 0) list[idx] = clean; else list.push(clean);
    return true;
  }
  if (table === 'logs') {
    const hid = typeof d.habitId === 'string' ? d.habitId.toLowerCase() : '';
    if (!isUuid(hid) || !isDateKey(d.date) || Sync.deadHabits.has(hid)) return false;
    if (!s.habits.some((h) => h.id === hid)) return 'orphan';
    if (Store.outbox[`logs:${hid}|${d.date}`]) return false;
    const next = STATUSES.includes(d.status) ? d.status : null;
    if (Store.getStatus(d.date, hid) === next) return false;
    const day = (s.logs[d.date] ||= {});
    if (next) day[hid] = next; else delete day[hid];
    if (!Object.keys(day).length) delete s.logs[d.date];
    return true;
  }
  return false;
}

/* =========================================================
   7. Stats engine
   ---------------------------------------------------------
   One rule everywhere: a check-in counts only on a day the habit is
   scheduled (on/after its start date, on one of its weekdays, and not
   paused).
   - Day rate = done ÷ (scheduled − skipped). Skips don't count against you.
     Days with nothing to do have rate = null and are neutral for streaks.
   - A day is "successful" when its rate ≥ the streak threshold.
   - Today not yet successful doesn't break a streak (the day isn't over).
   ========================================================= */
const Stats = {
  _cache: new Map(),
  clearCache() { this._cache.clear(); },
  memo(key, fn) {
    if (this._cache.has(key)) return this._cache.get(key);
    const v = fn();
    this._cache.set(key, v);
    return v;
  },
  settings() { return Store.state.profile; },

  isPaused(h, key) { return h.pausedRanges.some((r) => key >= r.from && (r.to === null || key <= r.to)); },
  isScheduled(h, date, key = toKey(date)) {
    return key >= h.startDate && h.days.includes(date.getDay()) && !this.isPaused(h, key);
  },
  habitsForDate(date) {
    const key = toKey(date);
    return Store.habits.filter((h) => this.isScheduled(h, date, key));
  },

  day(date) {
    const key = toKey(date);
    return this.memo(`d:${key}`, () => {
      const habits = this.habitsForDate(date);
      let done = 0, skipped = 0;
      habits.forEach((h) => {
        const st = Store.getStatus(key, h.id);
        if (st === 'done') done++; else if (st === 'skipped') skipped++;
      });
      const eligible = habits.length - skipped;
      return { key, date, habits, scheduled: habits.length, done, skipped, eligible, rate: eligible > 0 ? done / eligible : null };
    });
  },

  firstDate() {
    const keys = Store.state.habits.map((h) => h.startDate).sort();
    return keys.length ? fromKey(keys[0]) : null;
  },
  range(start, end) {
    const out = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(this.day(d));
    return out;
  },
  aggregate(days) {
    let done = 0, eligible = 0, skipped = 0, scheduled = 0;
    days.forEach((d) => { done += d.done; eligible += d.eligible; skipped += d.skipped; scheduled += d.scheduled; });
    return { done, eligible, skipped, scheduled, missed: eligible - done, rate: eligible > 0 ? done / eligible : null };
  },
  overall() {
    return this.memo('overall', () => {
      const first = this.firstDate();
      if (!first || first > today()) return { ...this.aggregate([]), since: first };
      return { ...this.aggregate(this.range(first, today())), since: first };
    });
  },

  isSuccess(d) { return d.rate !== null && d.rate * 100 >= this.settings().streakThreshold - 1e-9; },

  streaks() {
    return this.memo('streaks', () => {
      const first = this.firstDate();
      const t = today();
      if (!first || first > t) return { current: 0, longest: 0, successDays: 0 };
      let current = 0;
      for (let d = new Date(t); d >= first; d = addDays(d, -1)) {
        const s = this.day(d);
        if (s.rate === null) continue;
        if (this.isSuccess(s)) { current++; continue; }
        if (+d === +t) continue;
        break;
      }
      let longest = 0, run = 0, successDays = 0;
      for (let d = new Date(first); d <= t; d = addDays(d, 1)) {
        const s = this.day(d);
        if (s.rate === null) continue;
        if (this.isSuccess(s)) { run++; successDays++; longest = Math.max(longest, run); } else if (+d !== +t) run = 0;
      }
      return { current, longest: Math.max(longest, current), successDays };
    });
  },

  /** Per-habit streak over the habit's own scheduled days. */
  habitStreak(h) {
    return this.memo(`hs:${h.id}`, () => {
      const t = today();
      const start = fromKey(h.startDate);
      let current = 0;
      for (let d = new Date(t); d >= start; d = addDays(d, -1)) {
        const key = toKey(d);
        if (!this.isScheduled(h, d, key)) continue;
        const st = Store.getStatus(key, h.id);
        if (st === 'done') current++;
        else if (st === 'skipped' || +d === +t) continue;
        else break;
      }
      let longest = 0, run = 0;
      for (let d = new Date(start); d <= t; d = addDays(d, 1)) {
        const key = toKey(d);
        if (!this.isScheduled(h, d, key)) continue;
        const st = Store.getStatus(key, h.id);
        if (st === 'done') { run++; longest = Math.max(longest, run); } else if (st !== 'skipped' && +d !== +t) run = 0;
      }
      return { current, longest };
    });
  },

  habitRange(h, start, end) {
    const from = maxKey(toKey(start), h.startDate);
    const to = toKey(end);
    return this.memo(`hr:${h.id}:${from}:${to}`, () => {
      let done = 0, skipped = 0, scheduled = 0;
      for (let d = fromKey(from); toKey(d) <= to; d = addDays(d, 1)) {
        const key = toKey(d);
        if (!this.isScheduled(h, d, key)) continue;
        scheduled++;
        const st = Store.getStatus(key, h.id);
        if (st === 'done') done++; else if (st === 'skipped') skipped++;
      }
      const eligible = scheduled - skipped;
      return { done, skipped, scheduled, eligible, rate: eligible > 0 ? done / eligible : null };
    });
  },

  /** Completions on scheduled days this week vs the weekly target. */
  weekProgress(h, ref = today()) {
    const ws = startOfWeek(ref, this.settings().weekStart);
    const end = addDays(ws, 6);
    return { done: this.habitRange(h, ws, end < today() ? end : today()).done, target: h.weeklyTarget };
  },

  totalCompleted() {
    return this.memo('total', () => Store.state.habits.reduce((n, h) => n + this.habitRange(h, fromKey(h.startDate), today()).done, 0));
  },

  goalProgress(g) {
    let current = g.current;
    const habit = g.mode === 'habit' ? Store.getHabit(g.habitId) : null;
    if (habit) {
      const end = g.deadline ? minKey(g.deadline, todayKey()) : todayKey();
      current = g.startDate <= end ? this.habitRange(habit, fromKey(g.startDate), fromKey(end)).done : 0;
    }
    const target = Math.max(1, g.target);
    const completed = current >= target;
    const daysLeft = g.deadline ? diffDays(today(), fromKey(g.deadline)) : null;
    return { current, target, ratio: clamp(current / target, 0, 1), completed, daysLeft, overdue: !completed && daysLeft !== null && daysLeft < 0 };
  },
};

function heatLevel(rate) {
  if (rate === null) return 'none';
  if (rate === 0) return 'l0';
  if (rate < 0.4) return 'l1';
  if (rate < 0.75) return 'l2';
  if (rate < 1) return 'l3';
  return 'l4';
}

/* =========================================================
   8. UI helpers
   ========================================================= */
function toast(message, iconName = 'checkCircle', action) {
  const wrap = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${iconSpan(iconName)}<span>${escapeHtml(message)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.onClick(); dismiss(); });
    el.appendChild(btn);
  }
  wrap.appendChild(el);
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  const timer = setTimeout(dismiss, action ? 6000 : 2800);
  function dismiss() {
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }
}

/** Promise-based confirmation dialog. Resolves true on confirm. */
function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Delete', cancelText = 'Cancel', tone = 'danger' } = {}) {
  const dlg = $('#confirmModal');
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmOk').textContent = confirmText;
  $('#confirmCancel').textContent = cancelText;
  $('#confirmOk').className = `btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`;
  const ic = $('#confirmIcon');
  ic.className = `confirm-icon i ${tone === 'danger' ? '' : 'neutral'}`;
  ic.innerHTML = icon(tone === 'danger' ? 'alert' : 'info');
  if (dlg.open) dlg.close();
  dlg.showModal();
  $('#confirmCancel').focus();
  return new Promise((resolve) => {
    const done = (val) => {
      if (dlg.open) dlg.close();
      $('#confirmOk').removeEventListener('click', ok);
      $('#confirmCancel').removeEventListener('click', cancel);
      dlg.removeEventListener('cancel', cancel);
      resolve(val);
    };
    const ok = () => done(true);
    const cancel = (e) => { e?.preventDefault?.(); done(false); };
    $('#confirmOk').addEventListener('click', ok);
    $('#confirmCancel').addEventListener('click', cancel);
    dlg.addEventListener('cancel', cancel);
  });
}

/** Tween a number in an element to `to`. */
function animateNumber(el, to) {
  if (!el) return;
  const from = Number(el.dataset.value ?? el.textContent) || 0;
  el.dataset.value = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; }
  const start = performance.now();
  const token = (el._tween = (el._tween || 0) + 1);
  const step = (now) => {
    if (el._tween !== token) return; // a newer tween took over
    const p = Math.min(1, (now - start) / 500);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function emptyHtml({ iconName = 'habits', title, text, actionLabel, action }) {
  return `<div class="empty">
    ${iconSpan(iconName, 'empty-icon')}
    <h3>${escapeHtml(title)}</h3>
    ${text ? `<p>${escapeHtml(text)}</p>` : ''}
    ${actionLabel ? `<button class="btn btn-primary" type="button" data-action="${escapeHtml(action)}">${iconSpan('plus')}${escapeHtml(actionLabel)}</button>` : ''}
  </div>`;
}

/* Colour and id are validated on input; escaping here is defence in depth. */
const habitIconHtml = (h) => `<span class="habit-icon" style="--c:${escapeHtml(h.color)}">${iconSpan(h.icon)}</span>`;

function initials(text) {
  const parts = String(text || '?').trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}

/* =========================================================
   9. Router & header
   ========================================================= */
const VIEWS = {
  dashboard: { title: null, subtitle: 'Stay consistent. Small steps every day.' },
  habits: { title: 'Habits', subtitle: 'Create, edit and organise the habits you track.' },
  calendar: { title: 'Calendar', subtitle: 'Review any day and fill in what you missed.' },
  statistics: { title: 'Statistics', subtitle: 'How consistent you have been, in numbers.' },
  goals: { title: 'Goals', subtitle: 'Longer-term targets with deadlines.' },
  settings: { title: 'Settings', subtitle: 'Account, preferences and your data.' },
};

/** Transient UI state (not persisted). */
const UI = {
  view: 'dashboard',
  weekOffset: 0,
  todayFilter: 'all',
  habitFilter: 'all',
  habitQuery: '',
  goalFilter: 'all',
  calMonth: new Date(today().getFullYear(), today().getMonth(), 1),
  calSelected: todayKey(),
  statsRange: 30,
  corruptKey: null,
  corruptRaw: null,
};

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function route() {
  if (!Store.ns) return;
  const name = location.hash.replace('#', '');
  UI.view = VIEWS[name] ? name : 'dashboard';
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== UI.view; });
  $$('a[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === UI.view));
  renderHeader();
  renderView();
  window.scrollTo({ top: 0 });
}

function displayName() { return Store.profile.name || ''; }

function renderHeader() {
  const cfg = VIEWS[UI.view];
  const name = displayName();
  $('#headerDate').textContent = fmtLong(today());
  $('#headerTitle').textContent = cfg.title || (name ? `${greeting()}, ${name}` : greeting());
  $('#headerSubtitle').textContent = cfg.subtitle;
  const account = Store.mode === 'cloud' ? (Auth.email || Prefs.data.lastUser?.email || 'Signed in') : 'This device only';
  $$('[data-bind="name"]').forEach((el) => { el.textContent = name || (Store.mode === 'cloud' ? account : 'You'); });
  $$('[data-bind="account"]').forEach((el) => { el.textContent = account; });
  $$('[data-bind="initials"]').forEach((el) => { el.textContent = initials(name || (Store.mode === 'cloud' ? account : 'You')); });
  document.title = `${cfg.title || 'Dashboard'} · Cadence`;
}

function renderView() {
  $('#renderError')?.remove();
  try {
    switch (UI.view) {
      case 'dashboard': renderDashboard(); break;
      case 'habits': renderHabits(); break;
      case 'calendar': renderCalendar(); break;
      case 'statistics': renderStatistics(); break;
      case 'goals': renderGoals(); break;
      case 'settings': renderSettings(); break;
    }
  } catch (err) {
    // Never leave the user stuck: explain, and offer a way out
    console.error(err);
    const el = document.createElement('div');
    el.id = 'renderError';
    el.className = 'banner';
    el.innerHTML = `${iconSpan('alert')}<span>Something went wrong showing this page. Your data is safe — reload, or export a backup from Settings.</span><button class="btn btn-ghost sm" type="button" data-action="reload">Reload</button>`;
    $('#main').prepend(el);
  }
}

const SYNC_TEXT = {
  local: 'This device only',
  synced: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — saved on device',
  error: 'Sync problem — retrying',
  auth: 'Sign in again to sync',
};
function renderSyncStatus() {
  const status = Store.mode === 'cloud' ? Sync.status : 'local';
  const pending = Store.pendingCount();
  let text = SYNC_TEXT[status];
  if (status === 'offline' && pending) text = `Offline — ${plural(pending, 'change')} waiting`;
  const title = status === 'local' ? 'Data is stored in this browser only' : `${text}${Store.lastSyncAt ? ` · last synced ${relativeTime(Store.lastSyncAt)}` : ''}`;
  $$('[data-sync-pill]').forEach((el) => {
    el.dataset.sync = status;
    el.title = title;
    el.setAttribute('aria-label', `Sync status: ${text}`);
    const label = $('.sync-text', el);
    if (label) label.textContent = text;
  });
  if (UI.view === 'settings' && !$('#app').hidden) renderAccountCard();
}

/* =========================================================
   10. Renderers
   ========================================================= */

/* ---------- Dashboard ---------- */
function renderDashboard(opts = {}) {
  const hasHabits = Store.state.habits.length > 0;
  $('#welcome').hidden = hasHabits;
  $('#dashContent').hidden = !hasHabits;
  if (!hasHabits) { renderTemplates(); return; }
  renderSummary();
  if (!opts.skipToday) renderToday();
  if (!opts.skipWeek) renderWeekTracker();
  renderWeekChart();
  renderStreaks();
  renderGoalsPreview();
}

function renderTemplates() {
  $('#templateGrid').innerHTML = TEMPLATES.map((t, i) => `
    <button type="button" class="template" data-action="use-template" data-index="${i}">
      <span class="habit-icon" style="--c:${HABIT_COLORS[i % HABIT_COLORS.length]}">${iconSpan(t.icon)}</span>
      <span>${escapeHtml(t.name)}</span>
    </button>`).join('');
}

function renderSummary() {
  const td = Stats.day(today());
  const todayPct = pct(td.rate) ?? 0;
  $('#todayRing').style.setProperty('--p', todayPct);
  animateNumber($('#statToday'), todayPct);
  $('#statTodayMeta').textContent = td.scheduled
    ? `${td.done} of ${td.eligible} done${td.skipped ? ` · ${td.skipped} skipped` : ''}`
    : 'Nothing scheduled today';

  const st = Stats.streaks();
  animateNumber($('#statStreak'), st.current);
  $('#statStreakUnit').textContent = st.current === 1 ? 'day' : 'days';
  $('#statStreakMeta').textContent = st.longest ? `Best: ${plural(st.longest, 'day')}` : 'Complete today to start one';

  animateNumber($('#statDone'), td.done);
  $('#statTotal').textContent = td.eligible;
  $('#statSegments').innerHTML = td.eligible
    ? Array.from({ length: Math.min(td.eligible, 30) }, (_, i) => `<i class="${i < td.done ? 'on' : ''}"></i>`).join('')
    : '<i></i>';

  const ov = Stats.overall();
  const ovPct = pct(ov.rate) ?? 0;
  animateNumber($('#statOverall'), ovPct);
  $('#statOverallBar').style.width = `${ovPct}%`;
  $('#statOverallMeta').textContent = ov.since && ov.eligible
    ? `${ov.done} of ${ov.eligible} check-ins since ${fmtDate(ov.since)}`
    : 'Starts with your first check-in';
}

function todayCaption() {
  const td = Stats.day(today());
  const wd = fmtDate(today(), { weekday: 'long' });
  return td.scheduled ? `${td.done} of ${td.eligible} completed · ${wd}` : wd;
}

function renderToday() {
  const list = $('#todayList');
  const tk = todayKey();
  const habits = Stats.habitsForDate(today());
  $('#todayCaption').textContent = todayCaption();
  if (!habits.length) {
    list.innerHTML = `<li>${emptyHtml({ iconName: 'sun', title: 'Nothing scheduled today', text: 'Enjoy the rest day, or change which days a habit repeats on in Habits.' })}</li>`;
    return;
  }
  const filtered = habits.filter((h) => {
    const st = Store.getStatus(tk, h.id);
    if (UI.todayFilter === 'done') return st === 'done';
    if (UI.todayFilter === 'pending') return !st;
    return true;
  });
  if (!filtered.length) {
    list.innerHTML = `<li>${UI.todayFilter === 'pending'
      ? emptyHtml({ iconName: 'checkCircle', title: 'All caught up', text: 'Every habit for today is checked off. Nice work.' })
      : emptyHtml({ iconName: 'clock', title: 'Nothing completed yet', text: 'Tick a habit to see it here.' })}</li>`;
    return;
  }
  list.innerHTML = filtered.map((h) => todayItemHtml(h, tk)).join('');
}

function todayItemHtml(h, tk) {
  const st = Store.getStatus(tk, h.id);
  const wp = Stats.weekProgress(h);
  const streak = Stats.habitStreak(h).current;
  const label = st === 'done' ? 'Done' : st === 'skipped' ? 'Skipped' : 'To do';
  const name = escapeHtml(h.name);
  return `<li class="habit-item ${st ? `is-${st}` : ''}" data-habit="${escapeHtml(h.id)}" style="--c:${escapeHtml(h.color)}">
    <button type="button" class="check ${st === 'done' ? 'checked' : ''}" data-action="toggle-today" data-id="${escapeHtml(h.id)}"
      role="checkbox" aria-checked="${st === 'done'}" aria-label="Mark ${name} as done">${iconSpan('check')}</button>
    ${habitIconHtml(h)}
    <div class="habit-info">
      <div class="habit-name">${name}</div>
      ${h.description ? `<div class="habit-desc">${escapeHtml(h.description)}</div>` : ''}
      <div class="habit-progress">
        <div class="bar"><span style="width:${clamp(wp.done / wp.target, 0, 1) * 100}%"></span></div>
        <span>${wp.done}/${wp.target} this week</span>
        ${streak ? `<span class="flame" title="${plural(streak, 'day')} in a row">${iconSpan('flame')}${streak}</span>` : ''}
      </div>
    </div>
    <span class="status-pill ${st === 'done' ? 'done' : ''}">${label}</span>
    <button type="button" class="icon-btn skip-btn ${st === 'skipped' ? 'active' : ''}" data-action="skip-today" data-id="${escapeHtml(h.id)}"
      title="${st === 'skipped' ? 'Undo skip' : 'Skip today'}" aria-label="${st === 'skipped' ? `Undo skip for ${name}` : `Skip ${name} today`}">${iconSpan('skip')}</button>
  </li>`;
}

/** Patch one row in place so the checkbox animation isn't interrupted by a re-render. */
function patchTodayItem(id, pop) {
  const li = $$('#todayList [data-habit]').find((el) => el.dataset.habit === id);
  const h = Store.getHabit(id);
  if (!li || !h) { renderToday(); return; }
  const tmp = document.createElement('ul');
  tmp.innerHTML = todayItemHtml(h, todayKey());
  const fresh = tmp.firstElementChild;
  const check = li.querySelector('.check');
  const freshCheck = fresh.querySelector('.check');
  check.className = freshCheck.className; // keep the same node so its transition plays
  check.setAttribute('aria-checked', freshCheck.getAttribute('aria-checked'));
  if (pop) { void check.offsetWidth; check.classList.add('pop'); }
  li.className = fresh.className;
  li.querySelector('.habit-info').replaceWith(fresh.querySelector('.habit-info'));
  li.querySelector('.status-pill').replaceWith(fresh.querySelector('.status-pill'));
  li.querySelector('.skip-btn').replaceWith(fresh.querySelector('.skip-btn'));
  $('#todayCaption').textContent = todayCaption();
}

function weekCellHtml(h, d, tk) {
  const key = toKey(d);
  if (key > tk) return '<td><span class="cell locked" title="Future"></span></td>';
  if (!Stats.isScheduled(h, d, key)) return '<td><span class="cell off" title="Not scheduled"></span></td>';
  const st = Store.getStatus(key, h.id);
  const cls = ['cell', st || '', key === tk ? 'today' : ''].join(' ');
  const label = escapeHtml(`${h.name}, ${fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' })}: ${st || 'not done'}`);
  return `<td><button type="button" class="${cls}" data-action="cycle" data-id="${escapeHtml(h.id)}" data-date="${key}" aria-label="${label}" title="${label}">${st === 'skipped' ? iconSpan('minus') : iconSpan('check')}</button></td>`;
}

function renderWeekTracker() {
  const wrap = $('#weekTracker');
  const ws = addDays(startOfWeek(today(), Stats.settings().weekStart), UI.weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const tk = todayKey();
  $('#weekRange').textContent = `${fmtDate(days[0])} – ${fmtDate(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  $('#weekNextBtn').disabled = UI.weekOffset >= 0;

  const habits = Store.habits.filter((h) => h.active || days.some((d) => Stats.isScheduled(h, d)));
  if (!habits.length) {
    wrap.innerHTML = emptyHtml({ iconName: 'calendar', title: 'No active habits this week', text: 'Resume a paused habit or create a new one.' });
    return;
  }
  const head = days.map((d) => `<th class="${toKey(d) === tk ? 'is-today' : ''}">${DAY_SHORT[d.getDay()]}<span class="dnum">${d.getDate()}</span></th>`).join('');
  const rows = habits.map((h) => {
    const wp = Stats.weekProgress(h, days[0]);
    return `<tr class="${h.active ? '' : 'row-paused'}">
      <td><div class="row-habit">${habitIconHtml(h)}<div style="min-width:0"><div class="name">${escapeHtml(h.name)}</div><div class="sub">${h.active ? `${wp.done}/${wp.target} this week` : 'Paused'}</div></div></div></td>
      ${days.map((d) => weekCellHtml(h, d, tk)).join('')}
    </tr>`;
  }).join('');
  const foot = days.map((d) => {
    const s = Stats.day(d);
    return `<td><span class="day-rate">${toKey(d) > tk || s.rate === null ? '—' : `${pct(s.rate)}%`}</span></td>`;
  }).join('');
  wrap.innerHTML = `<table class="week-table">
    <thead><tr><th>Habit</th>${head}</tr></thead>
    <tbody>${rows}<tr><td><span class="day-rate">Daily completion</span></td>${foot}</tr></tbody>
  </table>`;
}

function renderStreaks() {
  const st = Stats.streaks();
  animateNumber($('#streakCurrent'), st.current);
  animateNumber($('#streakLongest'), st.longest);
  animateNumber($('#streakDays'), st.successDays);
  $('#streakCurrent').nextElementSibling.textContent = st.current === 1 ? 'day' : 'days';
  $('#streakLongest').nextElementSibling.textContent = st.longest === 1 ? 'day' : 'days';
  const thr = Stats.settings().streakThreshold;
  $('#streakRule').textContent = thr >= 100 ? 'A day counts when all its habits are done' : `A day counts when at least ${thr}% of its habits are done`;
  // Show real history only: from the first habit's week, at least 12 and at most 26 weeks
  const first = Stats.firstDate() || today();
  renderHeatmap($('#heatmap'), clamp(Math.ceil((diffDays(first, today()) + 1) / 7) + 1, 12, 26));
}

/** GitHub-style heatmap: columns are weeks, rows are weekdays. Keyboard: arrows move, Enter opens the day. */
function renderHeatmap(container, weeks) {
  const ws = Stats.settings().weekStart;
  const t = today();
  const tk = toKey(t);
  const start = addDays(startOfWeek(t, ws), -(weeks - 1) * 7);
  const cells = [];
  const months = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const weekStart = addDays(start, w * 7);
    const m = weekStart.getMonth();
    months.push(m !== lastMonth ? `<span>${MONTH_SHORT[m]}</span>` : '<span></span>');
    lastMonth = m;
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const key = toKey(d);
      if (key > tk) { cells.push('<i class="hm future" aria-hidden="true"></i>'); continue; }
      const s = Stats.day(d);
      const tip = s.rate === null ? `${fmtDate(d)}: nothing scheduled` : `${fmtDate(d)}: ${s.done} of ${s.eligible} done (${pct(s.rate)}%)`;
      cells.push(`<i class="hm ${heatLevel(s.rate)} ${key === tk ? 'is-today' : ''}" data-date="${key}" role="button" tabindex="${key === tk ? 0 : -1}" title="${tip}" aria-label="${tip}"></i>`);
    }
  }
  const dayLabels = Array.from({ length: 7 }, (_, i) => `<span>${i % 2 === 0 ? DAY_SHORT[(ws + i) % 7] : ''}</span>`).join('');
  container.innerHTML = `<div class="heatmap"><div class="hm-months" aria-hidden="true">${months.join('')}</div><div class="hm-days" aria-hidden="true">${dayLabels}</div><div class="hm-grid" role="group" aria-label="Daily completion heatmap">${cells.join('')}</div></div>`;
  container.scrollLeft = container.scrollWidth;
}

function renderGoalsPreview() {
  const wrap = $('#goalsPreview');
  const goals = Store.goals.map((g) => ({ g, p: Stats.goalProgress(g) }))
    .sort((a, b) => Number(a.p.completed) - Number(b.p.completed) || (a.p.daysLeft ?? 9999) - (b.p.daysLeft ?? 9999));
  const active = goals.filter((x) => !x.p.completed).length;
  $('#goalsCaption').textContent = goals.length ? `${active} in progress · ${goals.length - active} completed` : 'Long-term targets';
  if (!goals.length) {
    wrap.innerHTML = emptyHtml({ iconName: 'target', title: 'No goals yet', text: 'Set a target with a deadline, like "Read 10 books".', actionLabel: 'Add a goal', action: 'add-goal' });
    return;
  }
  wrap.innerHTML = goals.slice(0, 4).map(({ g, p }) => `
    <div class="goal-mini">
      <div class="top"><strong>${escapeHtml(g.title)}</strong><span>${p.current} / ${p.target}${g.unit ? ` ${escapeHtml(g.unit)}` : ''}</span></div>
      <div class="bar"><span style="width:${p.ratio * 100}%"></span></div>
      <div class="meta">${goalDeadlineText(p)}</div>
    </div>`).join('');
}

function goalDeadlineText(p) {
  if (p.completed) return 'Completed';
  if (p.daysLeft === null) return 'No deadline';
  if (p.daysLeft < 0) return `Overdue by ${plural(-p.daysLeft, 'day')}`;
  if (p.daysLeft === 0) return 'Due today';
  return `${plural(p.daysLeft, 'day')} left`;
}

/* ---------- Habits page ---------- */
function renderHabits() {
  const grid = $('#habitGrid');
  const q = UI.habitQuery.trim().toLowerCase();
  const all = Store.habits;
  if (!all.length) {
    grid.innerHTML = `<div class="grid-empty card">${emptyHtml({ title: 'No habits yet', text: 'Start small — one habit you can do every day is plenty.', actionLabel: 'Create your first habit', action: 'add-habit' })}</div>`;
    return;
  }
  const habits = all.filter((h) => {
    if (UI.habitFilter === 'active' && !h.active) return false;
    if (UI.habitFilter === 'paused' && h.active) return false;
    return !q || h.name.toLowerCase().includes(q) || h.description.toLowerCase().includes(q);
  });
  if (!habits.length) {
    grid.innerHTML = `<div class="grid-empty card">${emptyHtml({ iconName: 'search', title: 'No matching habits', text: 'Try a different search or filter.' })}</div>`;
    return;
  }
  const t = today();
  const from30 = addDays(t, -29);
  const order = ALL_DAYS.map((i) => (Stats.settings().weekStart + i) % 7);
  grid.innerHTML = habits.map((h) => {
    const streak = Stats.habitStreak(h);
    const r = Stats.habitRange(h, from30, t);
    const wp = Stats.weekProgress(h);
    const id = escapeHtml(h.id);
    const name = escapeHtml(h.name);
    return `<article class="card habit-card ${h.active ? '' : 'paused'}" style="--c:${escapeHtml(h.color)}">
      <div class="top">
        ${habitIconHtml(h)}
        <div class="habit-info">
          <h3>${name}</h3>
          <div class="habit-desc">${escapeHtml(h.description || freqLabel(h.days))}</div>
        </div>
        <div class="card-menu">
          <button class="icon-btn" type="button" data-action="edit-habit" data-id="${id}" aria-label="Edit ${name}">${iconSpan('edit')}</button>
          <button class="icon-btn danger" type="button" data-action="delete-habit" data-id="${id}" aria-label="Delete ${name}">${iconSpan('trash')}</button>
        </div>
      </div>
      <div class="days" aria-label="Repeats on ${freqLabel(h.days)}">${order.map((d) => `<span class="${h.days.includes(d) ? 'on' : ''}">${DAY_LETTER[d]}</span>`).join('')}</div>
      <div class="mini-stats">
        <div><span>Streak</span><strong>${streak.current}</strong></div>
        <div><span>30-day rate</span><strong>${r.rate === null ? '—' : `${pct(r.rate)}%`}</strong></div>
        <div><span>This week</span><strong>${wp.done}/${wp.target}</strong></div>
      </div>
      <div class="foot">
        <label class="switch-label"><input type="checkbox" class="switch-input" data-action="toggle-active" data-id="${id}" ${h.active ? 'checked' : ''} />${h.active ? 'Active' : 'Paused'}</label>
        <span class="muted small">Best streak ${streak.longest}</span>
      </div>
    </article>`;
  }).join('');
}

function freqLabel(days) {
  const s = days.join(',');
  if (s === '0,1,2,3,4,5,6') return 'Every day';
  if (s === '1,2,3,4,5') return 'Weekdays';
  if (s === '0,6') return 'Weekends';
  return days.map((d) => DAY_SHORT[d]).join(', ');
}

/* ---------- Calendar ---------- */
function renderCalendar() {
  const ws = Stats.settings().weekStart;
  const m = UI.calMonth;
  $('#calTitle').textContent = `${MONTH_LONG[m.getMonth()]} ${m.getFullYear()}`;
  $('#calWeekdays').innerHTML = ALL_DAYS.map((i) => `<span>${DAY_SHORT[(ws + i) % 7]}</span>`).join('');

  const first = startOfWeek(m, ws);
  const lastOfMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0);
  const weeks = Math.ceil((diffDays(first, lastOfMonth) + 1) / 7);
  const tk = todayKey();
  let html = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(first, i);
    const key = toKey(d);
    const outside = d.getMonth() !== m.getMonth();
    const future = key > tk;
    const s = Stats.day(d);
    const doneHabits = future ? [] : s.habits.filter((h) => Store.getStatus(key, h.id) === 'done');
    const lvl = future ? 'none' : heatLevel(s.rate);
    const cls = ['cal-day', outside ? 'outside' : '', future ? 'future' : '', key === tk ? 'is-today' : '', key === UI.calSelected ? 'selected' : ''].join(' ');
    html += `<button type="button" class="${cls}" data-action="cal-select" data-date="${key}" aria-pressed="${key === UI.calSelected}" aria-label="${fmtLong(d)}${s.rate !== null && !future ? `, ${pct(s.rate)}% complete` : ''}">
      <span class="num"><b>${d.getDate()}</b>${!future && s.rate !== null ? `<span class="rate">${pct(s.rate)}%</span>` : ''}</span>
      <span>
        <span class="dots">${doneHabits.slice(0, 8).map((h) => `<i style="--c:${escapeHtml(h.color)}"></i>`).join('')}</span>
        <span class="heat ${lvl}"></span>
      </span>
    </button>`;
  }
  $('#calGrid').innerHTML = html;
  renderDayPanel();
}

function renderDayPanel() {
  const panel = $('#dayPanel');
  const key = UI.calSelected;
  const d = fromKey(key);
  const future = key > todayKey();
  const s = Stats.day(d);
  const r = pct(s.rate);
  const byStatus = (st) => s.habits.filter((h) => Store.getStatus(key, h.id) === st);
  const done = byStatus('done');
  const skipped = byStatus('skipped');
  const pending = s.habits.filter((h) => !Store.getStatus(key, h.id));

  const item = (h) => {
    const st = Store.getStatus(key, h.id);
    const name = escapeHtml(h.name);
    const id = escapeHtml(h.id);
    return `<li>${habitIconHtml(h)}<span class="name">${name}</span>
      ${future ? '' : `<button type="button" class="icon-btn skip-btn ${st === 'skipped' ? 'active' : ''}" data-action="day-skip" data-id="${id}" aria-label="${st === 'skipped' ? `Undo skip for ${name}` : `Skip ${name}`}" title="${st === 'skipped' ? 'Undo skip' : 'Skip'}">${iconSpan('skip')}</button>
      <button type="button" class="check ${st === 'done' ? 'checked' : ''}" data-action="day-toggle" data-id="${id}" role="checkbox" aria-checked="${st === 'done'}" aria-label="Mark ${name} done">${iconSpan('check')}</button>`}
    </li>`;
  };
  const section = (title, list) => (list.length ? `<div class="day-section"><h3>${title} · ${list.length}</h3><ul class="day-list">${list.map(item).join('')}</ul></div>` : '');

  let body;
  if (!s.scheduled) {
    body = emptyHtml({ iconName: 'sun', title: future ? 'Nothing planned' : 'Nothing scheduled', text: 'No habits were scheduled for this day.' });
  } else if (future) {
    body = `<div class="day-section"><h3>Planned · ${s.scheduled}</h3><ul class="day-list">${s.habits.map(item).join('')}</ul></div><p class="muted small" style="margin-top:12px">Future days can't be checked off yet.</p>`;
  } else {
    body = section('Completed', done) + section('Not done', pending) + section('Skipped', skipped);
  }

  panel.innerHTML = `
    <div class="head">
      <div class="ring" style="--p:${future ? 0 : r ?? 0}">
        <svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-track" cx="18" cy="18" r="15.9"/><circle class="ring-fill" cx="18" cy="18" r="15.9"/></svg>
        <b>${future || r === null ? '—' : `${r}%`}</b>
      </div>
      <div>
        <h2>${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <p class="muted small">${s.scheduled ? `${s.done} of ${s.eligible} completed${s.skipped ? ` · ${s.skipped} skipped` : ''}` : 'No habits scheduled'}</p>
      </div>
    </div>
    ${body}`;
}

/* ---------- Statistics ---------- */
const BEST_HABIT_MIN = 5; // check-ins needed before a habit can be "best"

function renderStatistics() {
  const t = today();
  const n = UI.statsRange;
  const start = addDays(t, -(n - 1));
  $('#statsRangeLabel').textContent = `${fmtDate(start)} – ${fmtDate(t)}`;
  $$('#statsRange button').forEach((b) => b.classList.toggle('active', Number(b.dataset.range) === n));

  const ws = startOfWeek(t, Stats.settings().weekStart);
  const weekAgg = Stats.aggregate(Stats.range(ws, t));
  const monthAgg = Stats.aggregate(Stats.range(new Date(t.getFullYear(), t.getMonth(), 1), t));
  const streaks = Stats.streaks();
  const habits = Store.habits;

  const perHabit = habits.map((h) => ({ h, r: Stats.habitRange(h, start, t), s: Stats.habitStreak(h) }));
  const best = perHabit.filter((x) => x.r.rate !== null && x.r.eligible >= BEST_HABIT_MIN)
    .sort((a, b) => b.r.rate - a.r.rate || b.r.done - a.r.done)[0];
  const consistent = perHabit.filter((x) => x.s.current > 0 || x.s.longest > 0)
    .sort((a, b) => b.s.current - a.s.current || b.s.longest - a.s.longest)[0];

  const kpi = (k, v, m) => `<article class="card kpi"><span class="k">${k}</span>${v}<span class="m">${m}</span></article>`;
  const num = (value, unit = '') => `<span class="v">${value}${unit ? `<small>${unit}</small>` : ''}</span>`;
  const rateNum = (agg) => (agg.rate === null ? num('—') : num(pct(agg.rate), '%'));
  const habitV = (x) => (x ? `<span class="v text">${habitIconHtml(x.h)}<span>${escapeHtml(x.h.name)}</span></span>` : '<span class="v text"><span>—</span></span>');

  $('#kpiGrid').innerHTML = [
    kpi('Weekly completion', rateNum(weekAgg), `${weekAgg.done} of ${weekAgg.eligible} this week`),
    kpi('Monthly completion', rateNum(monthAgg), `${monthAgg.done} of ${monthAgg.eligible} in ${MONTH_LONG[t.getMonth()]}`),
    kpi('Current streak', num(streaks.current, streaks.current === 1 ? 'day' : 'days'), `Longest: ${plural(streaks.longest, 'day')}`),
    kpi('Total completed', num(Stats.totalCompleted()), 'All-time check-ins'),
    kpi('Best habit', habitV(best), best ? `${pct(best.r.rate)}% completion, last ${n} days` : `Needs ${BEST_HABIT_MIN}+ check-ins in this range`),
    kpi('Most consistent', habitV(consistent), consistent ? `${plural(consistent.s.current, 'day')} streak · best ${consistent.s.longest}` : 'Build a streak to see this'),
    kpi('Longest streak', num(streaks.longest, streaks.longest === 1 ? 'day' : 'days'), `${plural(streaks.successDays, 'successful day')} total`),
    kpi('Active habits', num(habits.filter((h) => h.active).length, `/ ${habits.length}`), `${habits.filter((h) => !h.active).length} paused`),
  ].join('');

  const days = Stats.range(start, t);
  renderTrendChart(days);
  renderHabitChart(perHabit);
  renderDonutChart(Stats.aggregate(days));
}

/* ---------- Goals page ---------- */
function renderGoals() {
  const grid = $('#goalGrid');
  const all = Store.goals.map((g) => ({ g, p: Stats.goalProgress(g) }));
  if (!all.length) {
    grid.innerHTML = `<div class="grid-empty card">${emptyHtml({ iconName: 'target', title: 'No goals yet', text: 'Goals give your habits a direction. Try "Read 10 books" with a deadline.', actionLabel: 'Create your first goal', action: 'add-goal' })}</div>`;
    return;
  }
  const list = all.filter(({ p }) => UI.goalFilter === 'all' || (UI.goalFilter === 'done' ? p.completed : !p.completed))
    .sort((a, b) => Number(a.p.completed) - Number(b.p.completed) || (a.p.daysLeft ?? 9999) - (b.p.daysLeft ?? 9999));
  if (!list.length) {
    grid.innerHTML = `<div class="grid-empty card">${emptyHtml({ iconName: 'target', title: UI.goalFilter === 'done' ? 'No completed goals yet' : 'Nothing in progress', text: UI.goalFilter === 'done' ? 'Finished goals will be collected here.' : 'All your goals are complete.' })}</div>`;
    return;
  }
  grid.innerHTML = list.map(({ g, p }) => {
    const habit = g.mode === 'habit' ? Store.getHabit(g.habitId) : null;
    const id = escapeHtml(g.id);
    const statusTag = p.completed ? `<span class="tag good">${iconSpan('check')}Completed</span>`
      : p.overdue ? `<span class="tag bad">${iconSpan('clock')}${goalDeadlineText(p)}</span>`
      : p.daysLeft !== null ? `<span class="tag ${p.daysLeft <= 7 ? 'warn' : ''}">${iconSpan('clock')}${goalDeadlineText(p)}</span>`
      : '<span class="tag">No deadline</span>';
    return `<article class="card goal-card">
      <div class="row">
        <div style="min-width:0">
          <h3>${escapeHtml(g.title)}</h3>
          <div class="tags">${statusTag}${habit ? `<span class="tag">${iconSpan('link')}${escapeHtml(habit.name)}</span>` : ''}${g.deadline ? `<span class="tag">${fmtDate(fromKey(g.deadline), { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : ''}</div>
        </div>
        <div class="card-menu">
          <button class="icon-btn" type="button" data-action="edit-goal" data-id="${id}" aria-label="Edit goal ${escapeHtml(g.title)}">${iconSpan('edit')}</button>
          <button class="icon-btn danger" type="button" data-action="delete-goal" data-id="${id}" aria-label="Delete goal ${escapeHtml(g.title)}">${iconSpan('trash')}</button>
        </div>
      </div>
      <div class="goal-num"><strong>${p.current} <small>/ ${p.target}${g.unit ? ` ${escapeHtml(g.unit)}` : ''}</small></strong><span class="pct">${Math.round(p.ratio * 100)}%</span></div>
      <div class="bar"><span style="width:${p.ratio * 100}%"></span></div>
      <div class="goal-actions">
        ${g.mode === 'habit'
          ? `<span class="muted small">Updates automatically when you complete ${habit ? escapeHtml(habit.name) : 'the habit'}</span>`
          : `<button class="btn btn-ghost sm" type="button" data-action="goal-dec" data-id="${id}" aria-label="Decrease progress" ${p.current <= 0 ? 'disabled' : ''}>${iconSpan('minus')}</button>
             <button class="btn btn-ghost sm" type="button" data-action="goal-inc" data-id="${id}">${iconSpan('plus')}Add 1</button>`}
      </div>
    </article>`;
  }).join('');
}

/* ---------- Settings ---------- */
function renderSettings() {
  const p = Store.profile;
  const nameInput = $('#profileName');
  if (document.activeElement !== nameInput) nameInput.value = p.name;
  $('#weekStart').value = String(p.weekStart);
  const thr = $('#streakThreshold');
  if (![...thr.options].some((o) => o.value === String(p.streakThreshold))) thr.add(new Option(`at least ${p.streakThreshold}% of its habits are done`, p.streakThreshold));
  thr.value = String(p.streakThreshold);
  $$('#themeChoice button').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === Prefs.data.theme));
  $('#dataLead').textContent = Store.mode === 'cloud'
    ? 'Saved on this device and synced to your account. A backup file is still handy to keep.'
    : 'Stored in this browser only. Export a backup to move it elsewhere, or sign in to sync across devices.';
  const kb = (LocalDB.bytes(NS_PREFIX + Store.ns) / 1024).toFixed(1);
  const s = Store.state;
  $('#storageInfo').textContent = `${plural(s.habits.length, 'habit')}, ${plural(s.goals.length, 'goal')}, ${plural(countLogs(s.logs), 'check-in')} · ${kb} KB on this device`;
  renderAccountCard();
}

function renderAccountCard() {
  const card = $('#accountCard');
  if (!card) return;
  const configured = Boolean(Cloud.auth);
  if (Store.mode === 'cloud') {
    const email = escapeHtml(Auth.email || Prefs.data.lastUser?.email || '');
    const pending = Store.pendingCount();
    card.innerHTML = `
      <div class="card-head"><h2>Account</h2></div>
      <div class="account-row"><span class="avatar">${escapeHtml(initials(Store.profile.name || email))}</span><div class="who"><strong>${email}</strong><span class="muted small">Signed in · syncs across devices</span></div></div>
      <div class="sync-line" data-sync-pill data-sync="${Sync.status}"><span class="sync-dot"></span><span>${escapeHtml(SYNC_TEXT[Sync.status] || '')}${pending ? ` · ${plural(pending, 'change')} waiting` : ''} · last synced ${escapeHtml(relativeTime(Store.lastSyncAt))}</span></div>
      <div class="account-actions">
        <button class="btn btn-ghost" type="button" data-action="sync-now">${iconSpan('refresh')}Sync now</button>
        <button class="btn btn-ghost" type="button" data-action="sign-out">${iconSpan('logout')}Sign out</button>
      </div>
      <div class="danger-zone">
        <button class="btn btn-danger-ghost" type="button" data-action="delete-account">${iconSpan('trash')}Delete account</button>
      </div>`;
  } else if (configured) {
    card.innerHTML = `
      <div class="card-head"><h2>Account</h2></div>
      <div class="account-row"><span class="avatar">${iconSpan('device')}</span><div class="who"><strong>This device only</strong><span class="muted small">Your data is stored in this browser</span></div></div>
      <p class="muted">Create a free account to back up your habits and use them on your phone, tablet and computer. Your current data comes with you.</p>
      <div class="account-actions"><button class="btn btn-primary" type="button" data-action="show-auth">${iconSpan('cloud')}Sign in or create account</button></div>`;
  } else {
    card.innerHTML = `
      <div class="card-head"><h2>Account</h2></div>
      <div class="notice">${iconSpan('info')}<p>Accounts and sync aren't set up on this site yet, so data stays in this browser. To enable them, follow <code>README.md</code> (Firebase setup).</p></div>`;
  }
  if (UI.corruptKey || UI.corruptRaw) {
    card.insertAdjacentHTML('beforeend', `<div class="notice subtle" style="margin-top:14px">${iconSpan('alert')}<p>Some saved data on this device couldn't be read and was set aside instead of being overwritten. <button class="link-btn" type="button" data-action="download-corrupt">Download it</button></p></div>`);
  }
}

/* =========================================================
   11. Charts (Chart.js, loaded locally)
   ========================================================= */
const charts = {};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function chartTheme() {
  return {
    text: cssVar('--muted'), grid: cssVar('--border'), accent: cssVar('--accent'),
    a: cssVar('--grad-a'), b: cssVar('--grad-b'), surface: cssVar('--surface'), ink: cssVar('--text'),
    track: cssVar('--surface-3'), low: cssVar('--hm-2'), gray: cssVar('--muted'),
  };
}

/** Vertical gradient for bar/area fills, computed per chart area. */
function gradientFill(th, alphaTop = 'ff', alphaBottom = 'ff', horizontal = false) {
  return (ctx) => {
    const { chart } = ctx;
    const area = chart.chartArea;
    if (!area) return th.accent;
    const g = horizontal
      ? chart.ctx.createLinearGradient(area.left, 0, area.right, 0)
      : chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
    g.addColorStop(0, th.b + alphaBottom);
    g.addColorStop(1, th.a + alphaTop);
    return g;
  };
}

/** Swap the canvas for a message when there's nothing real to show. Returns false if no chart should be drawn. */
function prepareChartBox(boxId, key, emptyMsg) {
  const box = $(`#${boxId}`);
  box.querySelector('.chart-empty')?.remove();
  const canvas = box.querySelector('canvas');
  const msg = typeof window.Chart === 'undefined' ? 'Charts are unavailable in this browser.' : emptyMsg;
  if (msg) {
    charts[key]?.destroy();
    delete charts[key];
    canvas.hidden = true;
    box.insertAdjacentHTML('beforeend', `<div class="chart-empty">${escapeHtml(msg)}</div>`);
    return false;
  }
  canvas.hidden = false;
  return true;
}

function upsertChart(key, canvas, config) {
  const existing = charts[key];
  if (existing && existing.canvas === canvas && existing.config.type === config.type) {
    existing.data.labels = config.data.labels;
    config.data.datasets.forEach((ds, i) => {
      if (existing.data.datasets[i]) Object.assign(existing.data.datasets[i], ds);
      else existing.data.datasets.push(ds);
    });
    existing.data.datasets.length = config.data.datasets.length;
    existing.options = config.options;
    existing.update();
    return;
  }
  existing?.destroy();
  charts[key] = new Chart(canvas, config);
}
function destroyCharts() { Object.keys(charts).forEach((k) => { charts[k].destroy(); delete charts[k]; }); }

function baseOptions(th) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 550, easing: 'easeOutCubic' },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: th.ink, titleColor: th.surface, bodyColor: th.surface,
        padding: 10, cornerRadius: 8, displayColors: false,
        titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: th.text, font: { family: 'Inter', size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
      y: { min: 0, max: 100, grid: { color: th.grid }, border: { display: false }, ticks: { color: th.text, font: { family: 'Inter', size: 11 }, stepSize: 25, callback: (v) => `${v}%` } },
    },
  };
}

function dayTooltip(days) {
  return {
    title: (items) => fmtLong(days[items[0].dataIndex].date),
    label: (item) => { const d = days[item.dataIndex]; return d.rate === null ? 'Nothing scheduled' : `${pct(d.rate)}% · ${d.done} of ${d.eligible} done`; },
  };
}

function renderWeekChart() {
  const t = today();
  const days = Stats.range(addDays(t, -6), t);
  const avg = Stats.aggregate(days).rate;
  $('#weekAvg').textContent = avg === null ? 'no data yet' : `average ${pct(avg)}%`;
  const hasData = days.some((d) => d.rate !== null && (d.done > 0 || d.key < todayKey()));
  if (!prepareChartBox('weekChartBox', 'week', hasData ? null : 'Your last 7 days will appear here once you start checking off habits.')) return;
  const th = chartTheme();
  const opts = baseOptions(th);
  opts.plugins.tooltip.callbacks = dayTooltip(days);
  upsertChart('week', $('#weekChart'), {
    type: 'bar',
    data: {
      labels: days.map((d, i) => (i === 6 ? 'Today' : DAY_SHORT[d.date.getDay()])),
      datasets: [{
        label: 'Completion',
        data: days.map((d) => (d.rate === null ? null : pct(d.rate))),
        backgroundColor: gradientFill(th, 'ff', 'cc'),
        borderRadius: 6, borderSkipped: 'bottom', maxBarThickness: 36,
      }],
    },
    options: opts,
  });
}

function renderTrendChart(days) {
  const hasData = days.some((d) => d.rate !== null && d.key < todayKey()) || days.some((d) => d.done > 0);
  if (!prepareChartBox('trendChartBox', 'trend', hasData ? null : 'No check-ins in this range yet.')) return;
  const th = chartTheme();
  const opts = baseOptions(th);
  opts.plugins.tooltip.callbacks = dayTooltip(days);
  opts.scales.x.ticks.maxTicksLimit = 8;
  upsertChart('trend', $('#trendChart'), {
    type: 'line',
    data: {
      labels: days.map((d) => fmtDate(d.date)),
      datasets: [{
        label: 'Completion rate',
        data: days.map((d) => (d.rate === null ? null : pct(d.rate))),
        borderColor: th.accent,
        backgroundColor: gradientFill(th, '40', '00'),
        fill: true, tension: 0.3, cubicInterpolationMode: 'monotone', borderWidth: 2, spanGaps: true,
        pointRadius: days.length > 31 ? 0 : 2.5, pointHoverRadius: 5,
        pointBackgroundColor: th.accent, pointBorderColor: th.surface, pointBorderWidth: 2,
      }],
    },
    options: opts,
  });
}

function renderHabitChart(perHabit) {
  const rows = perHabit.filter((x) => x.r.rate !== null).sort((a, b) => b.r.rate - a.r.rate);
  if (!prepareChartBox('habitChartBox', 'habit', rows.length ? null : 'No habits were scheduled in this range.')) return;
  const th = chartTheme();
  const opts = baseOptions(th);
  opts.indexAxis = 'y';
  opts.interaction = { mode: 'nearest', axis: 'y', intersect: false };
  opts.scales = {
    x: { min: 0, max: 100, grid: { color: th.grid }, border: { display: false }, ticks: { color: th.text, font: { family: 'Inter', size: 11 }, stepSize: 25, callback: (v) => `${v}%` } },
    y: { grid: { display: false }, border: { display: false }, ticks: { color: th.ink, font: { family: 'Inter', size: 12, weight: '500' } } },
  };
  opts.plugins.tooltip.callbacks = { label: (item) => { const r = rows[item.dataIndex].r; return `${pct(r.rate)}% · ${r.done} of ${r.eligible} done`; } };
  upsertChart('habit', $('#habitChart'), {
    type: 'bar',
    data: {
      labels: rows.map((x) => x.h.name),
      datasets: [{
        label: 'Completion',
        data: rows.map((x) => pct(x.r.rate)),
        backgroundColor: rows.map((x) => x.h.color), // colour follows the habit, not its rank
        borderRadius: 5, borderSkipped: 'start', maxBarThickness: 22,
      }],
    },
    options: opts,
  });
}

function renderDonutChart(agg) {
  const total = agg.done + agg.skipped + agg.missed;
  if (!prepareChartBox('donutChartBox', 'donut', agg.done + agg.skipped > 0 ? null : 'No check-ins in this range yet.')) return;
  const th = chartTheme();
  const share = (v) => Math.round((v / total) * 100);
  upsertChart('donut', $('#donutChart'), {
    type: 'doughnut',
    data: {
      labels: ['Done', 'Missed', 'Skipped'],
      datasets: [{ data: [agg.done, agg.missed, agg.skipped], backgroundColor: [th.accent, th.low, th.gray], borderColor: th.surface, borderWidth: 2, hoverOffset: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%', animation: { duration: 550 },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: th.ink, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 16, font: { family: 'Inter', size: 12 },
            generateLabels: (chart) => chart.data.labels.map((l, i) => {
              const v = chart.data.datasets[0].data[i];
              return { text: `${l}  ${v} (${share(v)}%)`, fillStyle: chart.data.datasets[0].backgroundColor[i], strokeStyle: 'transparent', fontColor: th.ink, index: i, hidden: false };
            }),
          },
        },
        tooltip: { backgroundColor: th.ink, titleColor: th.surface, bodyColor: th.surface, padding: 10, cornerRadius: 8, callbacks: { label: (item) => ` ${item.label}: ${item.raw} (${share(item.raw)}%)` } },
      },
    },
  });
}

/* =========================================================
   12. Forms
   ========================================================= */

/* ---------- Habit form ---------- */
const habitForm = { editingId: null, icon: 'book', color: HABIT_COLORS[0], days: [...ALL_DAYS], minStart: minStartKey() };

function clearErrors(form) {
  $$('.field-error', form).forEach((e) => { e.textContent = ''; });
  $$('.invalid', form).forEach((e) => e.classList.remove('invalid'));
}

function openHabitModal(id = null, template = null) {
  const h = id ? Store.getHabit(id) : null;
  const src = h || template || {};
  const f = $('#habitForm');
  f.reset();
  clearErrors(f);
  const n = Store.state.habits.length;
  habitForm.editingId = h ? h.id : null;
  habitForm.icon = src.icon || HABIT_ICONS[n % HABIT_ICONS.length];
  habitForm.color = src.color || HABIT_COLORS[n % HABIT_COLORS.length];
  habitForm.days = src.days ? [...src.days] : [...ALL_DAYS];
  habitForm.minStart = h ? minKey(h.startDate, minStartKey()) : minStartKey();
  f.elements.habitName.value = src.name || '';
  f.elements.description.value = src.description || '';
  f.elements.weeklyTarget.value = src.weeklyTarget ?? habitForm.days.length;
  f.elements.startDate.value = h?.startDate || todayKey();
  f.elements.startDate.min = habitForm.minStart;
  f.elements.startDate.max = todayKey();
  f.elements.active.checked = h ? h.active : true;
  $('#habitModalTitle').textContent = h ? 'Edit habit' : 'New habit';
  $('#habitSubmit').textContent = h ? 'Save changes' : 'Create habit';
  $('#habitDeleteBtn').hidden = !h;
  $('#habitHistoryNote').hidden = !h;
  renderHabitPickers();
  $('#habitModal').showModal();
  if (!matchMedia('(max-width: 760px)').matches) f.elements.habitName.focus();
}

function renderHabitPickers() {
  $('#iconPicker').innerHTML = HABIT_ICONS.map((n) => `<button type="button" class="${n === habitForm.icon ? 'active' : ''}" data-icon-choice="${n}" style="--pc:${habitForm.color}" aria-label="Icon: ${n}" aria-pressed="${n === habitForm.icon}">${iconSpan(n)}</button>`).join('');
  $('#colorPicker').innerHTML = HABIT_COLORS.map((c, i) => `<button type="button" class="${c === habitForm.color ? 'active' : ''}" data-color-choice="${c}" style="--c:${c}" aria-label="Colour ${i + 1}" aria-pressed="${c === habitForm.color}"></button>`).join('');
  const ws = Stats.settings().weekStart;
  $('#dayPicker').innerHTML = ALL_DAYS.map((i) => (ws + i) % 7)
    .map((d) => `<button type="button" class="${habitForm.days.includes(d) ? 'on' : ''}" data-day="${d}" aria-pressed="${habitForm.days.includes(d)}">${DAY_SHORT[d]}</button>`).join('');
  const s = [...habitForm.days].sort().join(',');
  $$('#freqPresets .chip').forEach((c) => c.classList.toggle('active',
    (c.dataset.preset === 'daily' && s === '0,1,2,3,4,5,6') || (c.dataset.preset === 'weekdays' && s === '1,2,3,4,5') || (c.dataset.preset === 'weekends' && s === '0,6')));
  syncTargetMax();
}

/** Weekly target can't exceed the number of scheduled days per week. */
function syncTargetMax(prevCount) {
  const input = $('#habitTarget');
  const max = Math.max(1, habitForm.days.length);
  input.max = max;
  let v = Number(input.value) || max;
  if (prevCount !== undefined && v === prevCount) v = max; // target tracked "all days", keep it that way
  input.value = clamp(v, 1, max);
}

function submitHabitForm(e) {
  e.preventDefault();
  const f = e.target;
  const el = f.elements;
  const name = el.habitName.value.trim();
  let valid = true;
  const setErr = (field, msg, input) => { $(`[data-error-for="${field}"]`, f).textContent = msg; input?.classList.toggle('invalid', Boolean(msg)); if (msg) valid = false; };
  const dup = name && Store.state.habits.find((h) => h.name.toLowerCase() === name.toLowerCase() && h.id !== habitForm.editingId);
  setErr('habitName', !name ? 'Give your habit a name.' : dup ? 'You already have a habit with this name.' : '', el.habitName);
  setErr('days', habitForm.days.length ? '' : 'Pick at least one day.');
  const start = el.startDate.value;
  setErr('startDate', !isDateKey(start) ? 'Choose a start date.' : start > todayKey() ? "Start date can't be in the future." : start < habitForm.minStart ? `Choose a date on or after ${fmtDate(fromKey(habitForm.minStart), { month: 'short', day: 'numeric', year: 'numeric' })}.` : '', el.startDate);
  if (!valid) return;

  const data = {
    name,
    description: el.description.value.trim(),
    icon: habitForm.icon,
    color: habitForm.color,
    days: [...habitForm.days].sort(),
    weeklyTarget: clamp(Number(el.weeklyTarget.value) || 1, 1, habitForm.days.length),
    startDate: start,
    active: el.active.checked,
  };
  if (habitForm.editingId) {
    if (!Store.updateHabit(habitForm.editingId, data)) toast('This habit was deleted on another device', 'alert');
    else toast('Habit updated');
  } else if (Store.addHabit(data)) {
    toast(`"${name}" added`);
  }
  $('#habitModal').close();
}

async function deleteHabit(id) {
  const h = Store.getHabit(id);
  if (!h) return;
  const ok = await confirmDialog({
    title: `Delete "${h.name}"?`,
    message: 'This removes the habit and all of its check-in history on every device. This can\'t be undone.',
    confirmText: 'Delete habit',
  });
  if (!ok) return;
  if ($('#habitModal').open) $('#habitModal').close();
  Store.deleteHabit(id);
  toast('Habit deleted', 'trash');
}

/* ---------- Goal form ---------- */
const goalForm = { editingId: null, mode: 'manual' };

function openGoalModal(id = null) {
  const g = id ? Store.getGoal(id) : null;
  const f = $('#goalForm');
  const el = f.elements;
  f.reset();
  clearErrors(f);
  goalForm.editingId = g ? g.id : null;
  goalForm.mode = g?.mode || 'manual';
  el.goalTitle.value = g?.title || '';
  el.current.value = g ? Stats.goalProgress(g).current : 0;
  el.goalTarget.value = g?.target ?? 10;
  el.unit.value = g?.unit || '';
  el.startDate.value = g?.startDate || todayKey();
  el.deadline.value = g?.deadline || '';
  const habits = Store.habits;
  el.habitId.innerHTML = habits.map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('');
  if (g?.habitId) el.habitId.value = g.habitId;
  $('#goalModalTitle').textContent = g ? 'Edit goal' : 'New goal';
  $('#goalSubmit').textContent = g ? 'Save changes' : 'Create goal';
  $('#goalDeleteBtn').hidden = !g;
  syncGoalMode();
  $('#goalModal').showModal();
  if (!matchMedia('(max-width: 760px)').matches) el.goalTitle.focus();
}

function syncGoalMode() {
  const hasHabits = Store.state.habits.length > 0;
  if (!hasHabits) goalForm.mode = 'manual';
  $$('#goalModeChoice button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === goalForm.mode);
    if (b.dataset.mode === 'habit') { b.disabled = !hasHabits; b.title = hasHabits ? '' : 'Create a habit first'; }
  });
  $('#goalHabitField').hidden = goalForm.mode !== 'habit';
  $('#goalCurrentField').hidden = goalForm.mode === 'habit';
}

function submitGoalForm(e) {
  e.preventDefault();
  const f = e.target;
  const el = f.elements;
  const title = el.goalTitle.value.trim();
  const target = Math.floor(Number(el.goalTarget.value));
  let valid = true;
  const setErr = (field, msg, input) => { $(`[data-error-for="${field}"]`, f).textContent = msg; input?.classList.toggle('invalid', Boolean(msg)); if (msg) valid = false; };
  setErr('goalTitle', title ? '' : 'Describe your goal.', el.goalTitle);
  setErr('goalTarget', target >= 1 && target <= 1e9 ? '' : 'Target must be a whole number of at least 1.', el.goalTarget);
  const start = isDateKey(el.startDate.value) ? el.startDate.value : todayKey();
  setErr('deadline', el.deadline.value && el.deadline.value < start ? 'Deadline must be after the start date.' : '', el.deadline);
  if (!valid) return;

  const data = {
    title,
    mode: goalForm.mode,
    habitId: goalForm.mode === 'habit' ? el.habitId.value || null : null,
    current: goalForm.mode === 'manual' ? Math.max(0, Math.floor(Number(el.current.value) || 0)) : 0,
    target,
    unit: el.unit.value.trim(),
    startDate: start,
    deadline: el.deadline.value || '',
  };
  if (goalForm.editingId) {
    if (Store.updateGoal(goalForm.editingId, data)) toast('Goal updated');
    else toast('This goal was deleted on another device', 'alert');
  } else if (Store.addGoal(data)) {
    toast('Goal created');
  }
  $('#goalModal').close();
}

async function deleteGoal(id) {
  const g = Store.getGoal(id);
  if (!g) return;
  const ok = await confirmDialog({ title: `Delete "${g.title}"?`, message: 'The goal and its progress will be removed.', confirmText: 'Delete goal' });
  if (!ok) return;
  if ($('#goalModal').open) $('#goalModal').close();
  Store.deleteGoal(id);
  toast('Goal deleted', 'trash');
}

function adjustGoal(id, delta) {
  const g = Store.getGoal(id);
  if (!g || g.mode !== 'manual') return;
  const before = Stats.goalProgress(g).completed;
  Store.updateGoal(id, { current: Math.max(0, g.current + delta) });
  const after = Store.getGoal(id);
  if (after && !before && Stats.goalProgress(after).completed) toast(`Goal reached: ${g.title}`, 'award');
}

/* ---------- Theme (per device) ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark';
  $$('.theme-label').forEach((el) => { el.textContent = dark ? 'Dark mode' : 'Light mode'; });
  $$('.theme-icon').forEach((el) => { el.innerHTML = icon(dark ? 'moon' : 'sun'); });
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#0a0e1f' : '#f4f4fb');
}

function setTheme(theme) {
  Prefs.set({ theme: theme === 'light' ? 'light' : 'dark' });
  applyTheme(Prefs.data.theme);
  destroyCharts(); // charts read colours from CSS variables
  if (Store.ns) renderView();
}

/* ---------- Import / export ---------- */
function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportData() {
  const s = Store.state;
  const logs = [];
  Object.entries(s.logs).forEach(([date, day]) => Object.entries(day).forEach(([habitId, status]) => logs.push({ habitId, date, status })));
  const payload = { app: 'cadence', version: 2, exportedAt: nowIso(), profile: s.profile, habits: s.habits, goals: s.goals, logs };
  download(`cadence-backup-${todayKey()}.json`, JSON.stringify(payload, null, 2));
  toast('Backup downloaded', 'download');
}

async function importData(file) {
  if (!file) return;
  try {
    if (file.size > LIMITS.backupBytes) throw new Error('File too large');
    const parsed = parseData(JSON.parse(await file.text()));
    const ok = await confirmDialog({
      title: 'Replace your data with this backup?',
      message: `The backup has ${plural(parsed.habits.length, 'habit')}, ${plural(countLogs(parsed.logs), 'check-in')} and ${plural(parsed.goals.length, 'goal')}. Your current data will be replaced${Store.mode === 'cloud' ? ' on all your devices' : ''}.`,
      confirmText: 'Replace data',
    });
    if (!ok) return;
    Store.replaceAll(parsed);
    toast('Backup imported', 'upload');
  } catch (err) {
    console.error(err);
    toast(err.message === 'File too large' ? 'That file is too large to be a Cadence backup' : 'That file isn\'t a valid Cadence backup', 'alert');
  } finally {
    $('#importFile').value = '';
  }
}

/* =========================================================
   13. Accounts (Firebase Authentication)
   ========================================================= */
const Auth = {
  email: null,
  displayName: '',
  tab: 'signin',
  initiated: false, // the user signed in during this visit (vs. an existing session)

  friendlyError(err) {
    const code = String(err?.code || '');
    const map = {
      'auth/invalid-credential': 'Email or password is incorrect.',
      'auth/invalid-login-credentials': 'Email or password is incorrect.',
      'auth/wrong-password': 'Email or password is incorrect.',
      'auth/user-not-found': 'Email or password is incorrect.',
      'auth/email-already-in-use': 'An account with this email already exists. Try signing in.',
      'auth/account-exists-with-different-credential': 'This email is already used with another sign-in method. Try the other method.',
      'auth/weak-password': 'Please choose a stronger password (at least 8 characters).',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
      'auth/user-disabled': 'This account has been disabled.',
      'auth/network-request-failed': 'Can\'t reach the server. Check your internet connection.',
      'auth/unauthorized-domain': 'This website\'s address isn\'t allowed to sign in yet. The site owner needs to add it in Firebase → Authentication → Settings → Authorized domains.',
      'auth/operation-not-allowed': 'This sign-in method isn\'t turned on yet. The site owner can enable it in Firebase → Authentication → Sign-in method.',
      'auth/operation-not-supported-in-this-environment': 'Google sign-in needs the site to be opened from its web address (http/https), not as a file.',
      'auth/requires-recent-login': 'For your security, please sign out and sign in again, then try once more.',
      'auth/popup-closed-by-user': '',
      'auth/cancelled-popup-request': '',
      'auth/user-cancelled': '',
    };
    if (code in map) return map[code];
    if (!navigator.onLine) return map['auth/network-request-failed'];
    return 'Something went wrong. Please try again.';
  },
};

function setAuthTab(tab) {
  Auth.tab = tab;
  const signup = tab === 'signup';
  $$('#authTabs button').forEach((b) => b.classList.toggle('active', b.dataset.authTab === tab));
  $('#authTitle').textContent = signup ? 'Create your account' : 'Welcome back';
  $('#authLead').textContent = signup ? 'Free, and your habits sync across your phone, tablet and computer.' : 'Sign in to keep your habits in sync on every device.';
  $('#authNameField').hidden = !signup;
  $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
  $('#authSubmit').textContent = signup ? 'Create account' : 'Sign in';
  $('#forgotLink').hidden = signup;
  setMsg('#authMsg', '');
}

function setMsg(sel, text, ok = false) { const el = $(sel); el.textContent = text; el.classList.toggle('ok', ok); }
function setLoading(btn, on) { btn.classList.toggle('loading', on); btn.disabled = on; }
function hideBoot() { $('#boot').classList.add('hide'); }

function showAuth() {
  const configured = Boolean(Cloud.auth);
  hideBoot();
  $('#app').hidden = true;
  $('#bottomNav').hidden = true;
  $('#auth').hidden = false;
  $('#authMain').hidden = !configured;
  $('#authReset').hidden = true;
  $('#authDivider').hidden = !configured;
  $('#authNotConfigured').hidden = configured;
  $('[data-action="use-guest"]').className = `btn ${configured ? 'btn-ghost' : 'btn-primary'} btn-block`;
  setAuthTab(Auth.tab);
}

function showApp() {
  hideBoot();
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#bottomNav').hidden = false;
  route();
  renderSyncStatus();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function submitAuth(e) {
  e.preventDefault();
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  const name = str($('#authName').value, 40);
  const signup = Auth.tab === 'signup';
  if (!EMAIL_RE.test(email)) return setMsg('#authMsg', 'Enter a valid email address.');
  if (password.length < (signup ? 8 : 1)) return setMsg('#authMsg', signup ? 'Password must be at least 8 characters.' : 'Enter your password.');
  const btn = $('#authSubmit');
  setLoading(btn, true);
  setMsg('#authMsg', '');
  Auth.initiated = true;
  try {
    const cred = signup
      ? await Cloud.auth.createUserWithEmailAndPassword(email, password)
      : await Cloud.auth.signInWithEmailAndPassword(email, password);
    if (signup && name) {
      Auth.displayName = name;
      await cred.user.updateProfile({ displayName: name }).catch(() => {});
    }
    $('#authPassword').value = '';
    await enterCloud(cred.user);
  } catch (err) {
    setMsg('#authMsg', Auth.friendlyError(err));
  } finally {
    setLoading(btn, false);
  }
}

async function signInWithGoogle(btn) {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  setLoading(btn, true);
  setMsg('#authMsg', '');
  Auth.initiated = true;
  try {
    const cred = await Cloud.auth.signInWithPopup(provider);
    await enterCloud(cred.user);
  } catch (err) {
    if (err?.code === 'auth/popup-blocked' && /^https?:$/.test(location.protocol)) {
      // Popups blocked (some in-app browsers): fall back to a full-page redirect
      try { sessionStorage.setItem('cadence:redirect', '1'); } catch { /* ignore */ }
      await Cloud.auth.signInWithRedirect(provider);
      return;
    }
    setMsg('#authMsg', Auth.friendlyError(err));
  } finally {
    setLoading(btn, false);
  }
}

async function submitReset(e) {
  e.preventDefault();
  const email = $('#resetEmail').value.trim();
  if (!EMAIL_RE.test(email)) return setMsg('#resetMsg', 'Enter a valid email address.');
  const btn = $('#resetForm [type="submit"]');
  setLoading(btn, true);
  try {
    await Cloud.auth.sendPasswordResetEmail(email);
    setMsg('#resetMsg', 'If an account exists for this email, a reset link is on its way. Check your spam folder too.', true);
  } catch (err) {
    setMsg('#resetMsg', err?.code === 'auth/user-not-found' ? 'If an account exists for this email, a reset link is on its way.' : Auth.friendlyError(err));
  } finally {
    setLoading(btn, false);
  }
}

const isUid = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);

/** Open the local copy for a signed-in user and start syncing. */
async function enterCloud(user) {
  if (!user || !isUid(user.uid)) return;
  const fresh = Auth.initiated;
  Auth.initiated = false;
  Auth.email = user.email || Prefs.data.lastUser?.email || null;
  Auth.displayName = str(Auth.displayName || user.displayName, 40);
  Prefs.set({ mode: 'cloud', lastUser: { id: user.uid, email: Auth.email || '' } });
  if (Store.ns !== user.uid) {
    Sync.stop();
    destroyCharts();
    const status = Store.open(user.uid, 'cloud', user.uid);
    if (status === 'corrupt') toast('Some saved data couldn\'t be read — it was set aside and your account data will be restored from the cloud', 'alert');
  }
  showApp();
  Sync.setStatus(navigator.onLine ? 'syncing' : 'offline');
  Sync.listen(Store.ns);
  Sync.schedule(0);
  if (fresh) await offerGuestMerge(); // only right after signing in, not on every app start
  await offerV1Import();
}

/** Open "this device only" mode. */
async function enterGuest() {
  Sync.stop();
  destroyCharts();
  Prefs.set({ mode: 'guest' });
  const status = Store.open('guest', 'guest');
  if (status === 'corrupt') toast('Some saved data couldn\'t be read — it was set aside (see Settings)', 'alert');
  Sync.setStatus('local');
  showApp();
  await offerV1Import();
}

/** After signing in, offer to bring this device's guest data into the account. */
async function offerGuestMerge() {
  const res = LocalDB.read(NS_PREFIX + 'guest');
  if (res.status !== 'ok') return;
  let data;
  try { data = parseData(res.value?.data); } catch { return; }
  if (!data.habits.length && !data.goals.length) return;
  const ok = await confirmDialog({
    title: 'Add this device\'s data to your account?',
    message: `You have ${plural(data.habits.length, 'habit')} and ${plural(data.goals.length, 'goal')} saved on this device without an account. Add them to your account so they sync everywhere?`,
    confirmText: 'Add to account', cancelText: 'Not now', tone: 'neutral',
  });
  if (!ok) return;
  Store.mergeIn(data);
  LocalDB.remove(NS_PREFIX + 'guest');
  toast('Your habits are now in your account', 'cloud');
}

/** Data from the first version of the app (single LocalStorage key). Offered once, never deleted automatically. */
async function offerV1Import() {
  if (Prefs.data.v1Handled) return;
  const res = LocalDB.read(V1_KEY);
  if (res.status !== 'ok') { Prefs.set({ v1Handled: true }); return; }
  let data;
  try { data = parseData(res.value); } catch { Prefs.set({ v1Handled: true }); return; }
  if (!data.habits.length) { Prefs.set({ v1Handled: true }); return; }
  const ok = await confirmDialog({
    title: 'Import data from the previous version?',
    message: `Found ${plural(data.habits.length, 'habit')} and ${plural(countLogs(data.logs), 'check-in')} saved by an earlier version of Cadence in this browser. Note: early versions created example data automatically — only import if it's yours.`,
    confirmText: 'Import', cancelText: 'Don\'t import', tone: 'neutral',
  });
  Prefs.set({ v1Handled: true });
  if (!ok) return;
  Store.mergeIn(data);
  toast('Previous data imported', 'upload');
}

async function signOut() {
  if (!Cloud.auth) return;
  if (Store.pendingCount()) await Sync.run();
  const pending = Store.pendingCount();
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: pending
      ? `${plural(pending, 'change')} haven't synced yet and will be lost if you sign out now. Connect to the internet first to keep them.`
      : 'Your data stays safe in your account. This device\'s copy will be removed.',
    confirmText: 'Sign out', tone: pending ? 'danger' : 'neutral',
  });
  if (!ok) return;
  Sync.stop();
  finishSignOut(true);
  try { await Cloud.auth.signOut(); } catch (err) { console.warn(err); }
}

/** Clear this device's copy of the account (privacy on shared devices). */
function finishSignOut(removeLocal) {
  const ns = Store.ns;
  Sync.stop();
  destroyCharts();
  if (ns && ns !== 'guest' && (removeLocal || !Store.pendingCount())) LocalDB.remove(NS_PREFIX + ns);
  Prefs.set({ mode: null, lastUser: null });
  Auth.email = null;
  Auth.displayName = '';
  Store.reset();
  Sync.setStatus('local');
  showAuth();
}

async function deleteAccount() {
  const user = Cloud.auth?.currentUser;
  if (!user) { toast('Sign in again to manage your account', 'alert'); return; }
  if (!navigator.onLine) { toast('You need to be online to delete your account', 'alert'); return; }
  // Firebase only deletes accounts that signed in recently; check first so we never delete data but keep the account
  const lastSignIn = Date.parse(user.metadata?.lastSignInTime || 0);
  if (Date.now() - lastSignIn > 4 * 60 * 1000) {
    const again = await confirmDialog({
      title: 'Please sign in again first',
      message: 'For your security, deleting an account needs a recent sign-in. Sign out, sign back in, then delete your account within a few minutes.',
      confirmText: 'Sign out now', tone: 'neutral',
    });
    if (again) { Sync.stop(); finishSignOut(true); await Cloud.auth.signOut().catch(() => {}); }
    return;
  }
  const ok = await confirmDialog({
    title: 'Delete your account?',
    message: 'This permanently deletes your account and all habits, check-ins and goals on every device. Export a backup first if you might want them later.',
    confirmText: 'Delete account',
  });
  if (!ok) return;
  const uid = user.uid;
  try {
    Sync.stop();
    const root = Cloud.userDoc(uid);
    for (const table of ['logs', 'habits', 'goals']) await Cloud.deleteWhere(root.collection(table));
    await withTimeout(root.delete(), WRITE_TIMEOUT_MS);
    await user.delete();
  } catch (err) {
    console.error(err);
    toast(Auth.friendlyError(err), 'alert');
    Sync.listen(Store.ns);
    return;
  }
  finishSignOut(true);
  toast('Your account was deleted', 'trash');
}

/** Auth state from Firebase (sign-in on another tab, token revoked, etc.). */
function onAuthChange(user) {
  if (user) {
    Auth.email = user.email || Auth.email;
    if (Store.mode !== 'cloud' || Store.userId !== user.uid) enterCloud(user);
    else if (Store.ns) renderHeader();
  } else if (Store.mode === 'cloud' && Store.ns) {
    finishSignOut(false);
  }
}

/* =========================================================
   14. Events & boot
   ========================================================= */

/** Change a check-in, with feedback when the streak grows or the day is complete. */
function setHabitStatus(dateKey, habitId, status) {
  const beforeStreak = Stats.streaks().current;
  const beforeRate = Stats.day(fromKey(dateKey)).rate;
  Store.setStatus(dateKey, habitId, status);
  const afterStreak = Stats.streaks().current;
  const after = Stats.day(fromKey(dateKey));
  if (afterStreak > beforeStreak) {
    toast(`Streak up — ${plural(afterStreak, 'day')}`, 'flame');
    const card = $('#streakCard');
    if (card && UI.view === 'dashboard') { card.classList.remove('pulse'); void card.offsetWidth; card.classList.add('pulse'); }
  } else if (dateKey === todayKey() && after.rate === 1 && beforeRate !== 1 && after.done > 0) {
    toast('Everything done for today. Great work!', 'award');
  }
}

/** Run a store mutation without the global re-render (the caller renders selectively). */
let suppressRender = false;
function quietly(fn) { suppressRender = true; try { fn(); } finally { suppressRender = false; } }

const actions = {
  'add-habit': () => openHabitModal(),
  'use-template': (el) => { const t = TEMPLATES[Number(el.dataset.index)]; if (t) openHabitModal(null, { ...t, color: HABIT_COLORS[Number(el.dataset.index) % HABIT_COLORS.length] }); },
  'edit-habit': (el) => openHabitModal(el.dataset.id),
  'delete-habit': (el) => deleteHabit(el.dataset.id),
  'add-goal': () => openGoalModal(),
  'edit-goal': (el) => openGoalModal(el.dataset.id),
  'delete-goal': (el) => deleteGoal(el.dataset.id),
  'goal-inc': (el) => adjustGoal(el.dataset.id, 1),
  'goal-dec': (el) => adjustGoal(el.dataset.id, -1),
  'toggle-theme': () => setTheme(Prefs.data.theme === 'dark' ? 'light' : 'dark'),
  reload: () => location.reload(),

  'toggle-today': (el) => {
    const id = el.dataset.id;
    const tk = todayKey();
    const next = Store.getStatus(tk, id) === 'done' ? null : 'done';
    quietly(() => setHabitStatus(tk, id, next));
    if (UI.todayFilter === 'all') patchTodayItem(id, Boolean(next));
    else { el.classList.toggle('checked', Boolean(next)); if (next) el.classList.add('pop'); setTimeout(renderToday, 350); } // let the tick play before the row filters out
    renderDashboard({ skipToday: true });
  },
  'skip-today': (el) => {
    const id = el.dataset.id;
    const tk = todayKey();
    const next = Store.getStatus(tk, id) === 'skipped' ? null : 'skipped';
    quietly(() => setHabitStatus(tk, id, next));
    renderDashboard();
    if (next) toast('Skipped for today — it won\'t count against you', 'skip');
  },
  cycle: (el) => {
    const { id, date } = el.dataset;
    const cur = Store.getStatus(date, id);
    const next = cur === null ? 'done' : cur === 'done' ? 'skipped' : null;
    quietly(() => setHabitStatus(date, id, next));
    el.className = ['cell', next || '', date === todayKey() ? 'today' : ''].join(' ');
    el.innerHTML = next === 'skipped' ? iconSpan('minus') : iconSpan('check');
    if (next) { void el.offsetWidth; el.classList.add('pop'); }
    renderDashboard({ skipWeek: true });
    clearTimeout(actions._weekTimer);
    actions._weekTimer = setTimeout(() => { if (UI.view === 'dashboard' && Store.state.habits.length) renderWeekTracker(); }, 400);
  },

  'week-prev': () => { UI.weekOffset--; renderWeekTracker(); },
  'week-next': () => { if (UI.weekOffset < 0) { UI.weekOffset++; renderWeekTracker(); } },
  'week-today': () => { UI.weekOffset = 0; renderWeekTracker(); },

  'cal-prev': () => { UI.calMonth = new Date(UI.calMonth.getFullYear(), UI.calMonth.getMonth() - 1, 1); renderCalendar(); },
  'cal-next': () => { UI.calMonth = new Date(UI.calMonth.getFullYear(), UI.calMonth.getMonth() + 1, 1); renderCalendar(); },
  'cal-today': () => { const t = today(); UI.calMonth = new Date(t.getFullYear(), t.getMonth(), 1); UI.calSelected = toKey(t); renderCalendar(); },
  'cal-select': (el) => {
    UI.calSelected = el.dataset.date;
    const d = fromKey(el.dataset.date);
    if (d.getMonth() !== UI.calMonth.getMonth() || d.getFullYear() !== UI.calMonth.getFullYear()) {
      UI.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      renderCalendar();
    } else {
      $$('#calGrid .cal-day').forEach((c) => { const on = c.dataset.date === UI.calSelected; c.classList.toggle('selected', on); c.setAttribute('aria-pressed', on); });
      renderDayPanel();
    }
    if (matchMedia('(max-width: 1080px)').matches) $('#dayPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },
  'day-toggle': (el) => setHabitStatus(UI.calSelected, el.dataset.id, Store.getStatus(UI.calSelected, el.dataset.id) === 'done' ? null : 'done'),
  'day-skip': (el) => setHabitStatus(UI.calSelected, el.dataset.id, Store.getStatus(UI.calSelected, el.dataset.id) === 'skipped' ? null : 'skipped'),

  export: exportData,
  'clear-all': async () => {
    const ok = await confirmDialog({
      title: 'Delete all habits & goals?',
      message: `Every habit, check-in and goal will be permanently removed${Store.mode === 'cloud' ? ' from your account on all devices' : ' from this browser'}. Consider exporting a backup first.`,
      confirmText: 'Delete everything',
    });
    if (!ok) return;
    Store.replaceAll(emptyData(Store.profile));
    toast('All habits and goals deleted', 'trash');
    location.hash = '#dashboard';
  },
  'download-corrupt': () => {
    if (!UI.corruptRaw) return;
    download(`cadence-unreadable-data-${todayKey()}.json`, UI.corruptRaw);
  },

  // Accounts
  'sync-now': () => {
    if (Store.mode !== 'cloud') { location.hash = '#settings'; return; }
    if (Sync.status === 'auth') { showAuth(); return; }
    if (!navigator.onLine) { toast('You\'re offline — changes are saved and will sync when you reconnect', 'cloud'); return; }
    Sync.schedule(0);
  },
  'sign-out': signOut,
  'delete-account': deleteAccount,
  'show-auth': () => { Auth.tab = 'signin'; showAuth(); },
  'use-guest': () => enterGuest(),
  'google-sign-in': (el) => signInWithGoogle(el),
  'show-reset': () => { $('#authMain').hidden = true; $('#authReset').hidden = false; $('#resetEmail').value = $('#authEmail').value; setMsg('#resetMsg', ''); },
  'show-signin': () => { $('#authReset').hidden = true; $('#authMain').hidden = false; },
  'toggle-password': (el) => {
    const input = $('#authPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    el.querySelector('.i').innerHTML = icon(show ? 'eyeOff' : 'eye');
  },
};

function bindEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-action="toggle-active"]')) {
      Store.updateHabit(el.dataset.id, { active: el.checked });
      toast(el.checked ? 'Habit resumed' : 'Habit paused — history is kept', el.checked ? 'refresh' : 'clock');
    }
  });

  window.addEventListener('hashchange', route);

  const segmented = (sel, key, render, attr = 'filter') => {
    $(sel).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      UI[key] = attr === 'range' ? Number(b.dataset.range) : b.dataset[attr];
      $$(`${sel} button`).forEach((x) => x.classList.toggle('active', x === b));
      render();
    });
  };
  segmented('#todayFilter', 'todayFilter', renderToday);
  segmented('#habitFilter', 'habitFilter', renderHabits);
  segmented('#goalFilter', 'goalFilter', renderGoals);
  segmented('#statsRange', 'statsRange', renderStatistics, 'range');

  let searchTimer;
  $('#habitSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { UI.habitQuery = e.target.value; renderHabits(); }, 120);
  });

  // Heatmap: click or keyboard opens that day in the calendar
  const openDay = (key) => {
    const d = fromKey(key);
    UI.calSelected = key;
    UI.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    location.hash = '#calendar';
  };
  $('#heatmap').addEventListener('click', (e) => { const c = e.target.closest('.hm[data-date]'); if (c) openDay(c.dataset.date); });
  $('#heatmap').addEventListener('keydown', (e) => {
    const c = e.target.closest('.hm[data-date]');
    if (!c) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(c.dataset.date); return; }
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const cells = $$('.hm-grid .hm', e.currentTarget);
    const target = cells[cells.indexOf(c) + step];
    if (target?.dataset.date) { c.tabIndex = -1; target.tabIndex = 0; target.focus(); }
  });

  // Habit modal
  const hf = $('#habitForm');
  hf.addEventListener('submit', submitHabitForm);
  $('#iconPicker').addEventListener('click', (e) => { const b = e.target.closest('[data-icon-choice]'); if (b) { habitForm.icon = b.dataset.iconChoice; renderHabitPickers(); } });
  $('#colorPicker').addEventListener('click', (e) => { const b = e.target.closest('[data-color-choice]'); if (b) { habitForm.color = b.dataset.colorChoice; renderHabitPickers(); } });
  $('#dayPicker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]'); if (!b) return;
    const d = Number(b.dataset.day);
    const prev = habitForm.days.length;
    habitForm.days = habitForm.days.includes(d) ? habitForm.days.filter((x) => x !== d) : [...habitForm.days, d];
    renderHabitPickers(); syncTargetMax(prev);
    $('[data-error-for="days"]', hf).textContent = '';
  });
  $('#freqPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    const prev = habitForm.days.length;
    habitForm.days = { daily: [...ALL_DAYS], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] }[b.dataset.preset];
    renderHabitPickers(); syncTargetMax(prev);
  });
  $$('[data-step]', hf).forEach((b) => b.addEventListener('click', () => {
    const input = $('#habitTarget');
    input.value = clamp((Number(input.value) || 1) + Number(b.dataset.step), 1, Number(input.max) || 7);
  }));
  $('#habitTarget').addEventListener('change', () => syncTargetMax());
  $('#habitDeleteBtn').addEventListener('click', () => deleteHabit(habitForm.editingId));
  hf.elements.habitName.addEventListener('input', () => { hf.elements.habitName.classList.remove('invalid'); $('[data-error-for="habitName"]', hf).textContent = ''; });

  // Goal modal
  $('#goalForm').addEventListener('submit', submitGoalForm);
  $('#goalModeChoice').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && !b.disabled) { goalForm.mode = b.dataset.mode; syncGoalMode(); } });
  $('#goalDeleteBtn').addEventListener('click', () => deleteGoal(goalForm.editingId));

  // Close buttons; backdrop click closes editors (not confirmations)
  $$('dialog.modal').forEach((dlg) => {
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('click', (e) => { if (e.target === dlg && (dlg.id === 'habitModal' || dlg.id === 'goalModal')) dlg.close(); });
  });

  // Settings
  $('#profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#profileName');
    const name = str(input.value, 40);
    input.classList.toggle('invalid', !name);
    if (!name) return;
    Store.updateProfile({ name });
    toast('Profile saved');
  });
  $('#prefsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    Store.updateProfile({ weekStart: Number($('#weekStart').value), streakThreshold: Number($('#streakThreshold').value) });
    toast('Preferences saved');
  });
  $('#themeChoice').addEventListener('click', (e) => { const b = e.target.closest('[data-theme-choice]'); if (b) setTheme(b.dataset.themeChoice); });
  $('#importFile').addEventListener('change', (e) => importData(e.target.files[0]));
  $('.file-btn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#importFile').click(); } });

  // Accounts
  $('#authTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-auth-tab]'); if (b) setAuthTab(b.dataset.authTab); });
  $('#authForm').addEventListener('submit', submitAuth);
  $('#resetForm').addEventListener('submit', submitReset);

  // Re-render on data changes (unless a caller is rendering selectively)
  Store.onChange(() => {
    if (suppressRender || !Store.ns || $('#app').hidden) return;
    renderHeader();
    renderView();
    renderSyncStatus();
  });

  // Connectivity + focus: sync when it makes sense
  window.addEventListener('online', () => Sync.schedule(0));
  window.addEventListener('offline', () => { if (Store.mode === 'cloud') Sync.setStatus('offline'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.schedule(0); });

  // Keep "today" correct if the app stays open past midnight
  let lastDay = todayKey();
  setInterval(() => {
    if (todayKey() !== lastDay) { lastDay = todayKey(); Stats.clearCache(); if (Store.ns) { renderHeader(); renderView(); } }
    if (Store.mode === 'cloud') renderSyncStatus(); // refresh "last synced x ago"
  }, 30 * 1000);

  // Keep tabs of the same browser in step
  window.addEventListener('storage', (e) => {
    if (e.key === PREFS_KEY) { Prefs.load(); applyTheme(Prefs.data.theme); destroyCharts(); if (Store.ns) renderView(); return; }
    if (!Store.ns || e.key !== NS_PREFIX + Store.ns) return;
    if (e.newValue === null) return; // signed out elsewhere — auth events handle it
    Store.open(Store.ns, Store.mode, Store.userId);
    renderHeader(); renderView(); renderSyncStatus();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
}

async function boot() {
  hydrateIcons();
  Prefs.load();
  applyTheme(Prefs.data.theme);
  bindEvents();
  Cloud.init();

  let user = null;
  let unknown = false; // couldn't determine the session (e.g. offline)
  if (Cloud.auth) {
    let redirected = false;
    try { redirected = sessionStorage.getItem('cadence:redirect') === '1'; sessionStorage.removeItem('cadence:redirect'); } catch { /* ignore */ }
    if (redirected) {
      Auth.initiated = true;
      try {
        const res = await withTimeout(Cloud.auth.getRedirectResult(), 10000);
        user = res?.user || null;
      } catch (err) {
        Auth.initiated = false;
        Auth.bootError = Auth.friendlyError(err);
      }
    }
    if (!user) {
      try {
        user = await withTimeout(new Promise((resolve) => { const off = Cloud.auth.onAuthStateChanged((u) => { off(); resolve(u); }); }), 8000);
      } catch {
        unknown = true;
      }
    }
    Cloud.auth.onAuthStateChanged((u) => setTimeout(() => onAuthChange(u), 0));
  }

  if (user) await enterCloud(user);
  else if (unknown && Prefs.data.mode === 'cloud' && Prefs.data.lastUser) {
    // Couldn't confirm the session (offline): open the local copy; sync resumes when back online
    Auth.email = Prefs.data.lastUser.email;
    Store.open(Prefs.data.lastUser.id, 'cloud', Prefs.data.lastUser.id);
    showApp();
    Sync.setStatus('offline');
  } else if (Prefs.data.mode === 'guest' || !Cloud.auth) await enterGuest(); // no accounts configured → this device only
  else {
    showAuth();
    if (Auth.bootError) setMsg('#authMsg', Auth.bootError);
  }

  hideBoot();
  registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch((err) => {
    // Last-resort fallback: never leave the loading screen up
    console.error(err);
    $('#boot').classList.add('hide');
    document.body.insertAdjacentHTML('afterbegin', '<div class="banner" style="margin:16px">Cadence couldn\'t start. Try reloading the page.</div>');
  });
});
