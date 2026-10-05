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

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/* ---------- Language (strings live in i18n.js) ---------- */
const LANGS = ['en', 'th'];
const Lang = {
  current: 'en',
  locale() { return this.current === 'th' ? 'th-TH' : 'en-US'; },
  dict() { return (window.I18N && window.I18N[this.current]) || {}; },
};
/** Translate a key; {placeholders} are filled from vars. Counted phrases pick one/other by vars.n. */
function t(key, vars = {}) {
  const en = (window.I18N && window.I18N.en) || {};
  let v = Lang.dict()[key] ?? en[key] ?? key;
  if (v && typeof v === 'object' && !Array.isArray(v)) v = vars.n === 1 && v.one ? v.one : v.other;
  return String(v).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
const tn = (key, n) => t(key, { n });
const dayShort = (d) => (Lang.dict().days || window.I18N.en.days)[d];
const dayLetter = (d) => (Lang.dict().dayLetters || window.I18N.en.dayLetters)[d];
const monthShort = (m) => new Date(2000, m, 1).toLocaleDateString(Lang.locale(), { month: 'short' });
const monthLong = (m) => new Date(2000, m, 1).toLocaleDateString(Lang.locale(), { month: 'long' });

/* Dates are local calendar days, keyed "YYYY-MM-DD". */
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const todayKey = () => toKey(today());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((fromKey(toKey(b)) - fromKey(toKey(a))) / 86400000); // b − a
const startOfWeek = (d, weekStart) => addDays(d, -((d.getDay() - weekStart + 7) % 7));
const fmtDate = (d, opts = { month: 'short', day: 'numeric' }) => d.toLocaleDateString(Lang.locale(), opts);
const fmtLong = (d) => d.toLocaleDateString(Lang.locale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
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
  if (!iso) return t('never');
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 10) return t('justNow');
  if (s < 60) return t('secondsAgo', { n: s });
  if (s < 3600) return t('minutesAgo', { n: Math.round(s / 60) });
  if (s < 86400) return t('hoursAgo', { n: Math.round(s / 3600) });
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

/** Starting points for new users — they only pre-fill the form; nothing is created until the user saves.
    Names come from i18n.js (tplStudy, tplStudyDesc, …) so they follow the chosen language. */
const TEMPLATES = [
  { key: 'tplStudy', icon: 'study', days: [1, 2, 3, 4, 5], tracking: 'duration', target: 2, unit: 'h' },
  { key: 'tplExercise', icon: 'dumbbell', days: [1, 3, 5], weeklyTarget: 3, tracking: 'duration', target: 30, unit: 'min' },
  { key: 'tplRead', icon: 'book', days: ALL_DAYS, tracking: 'count', target: 20, unit: 'pages' },
  { key: 'tplEnglish', icon: 'globe', days: ALL_DAYS, tracking: 'duration', target: 15, unit: 'min' },
  { key: 'tplCoding', icon: 'code', days: [1, 2, 3, 4, 5], tracking: 'duration', target: 60, unit: 'min' },
  { key: 'tplSleep', icon: 'bed', days: ALL_DAYS, tracking: 'duration', target: 8, unit: 'h', rule: 'sleep' },
  { key: 'tplWater', icon: 'droplet', days: ALL_DAYS, tracking: 'count', target: 8, unit: 'glasses' },
  { key: 'tplMeditate', icon: 'leaf', days: ALL_DAYS, tracking: 'duration', target: 10, unit: 'min' },
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

/* ---------- Tracking types ----------
   boolean  : done / not done (the original checklist behaviour)
   duration : time spent        (h, min)
   count    : how many          (times, pages, glasses, … or a custom unit)
   distance : how far           (km, m)
   Measured habits have a daily `target`; each day's check-in stores the
   actual value and the target it was measured against. */
const TRACKING = ['boolean', 'duration', 'count', 'distance'];
const UNITS = { duration: ['h', 'min'], count: ['times', 'pages', 'glasses', 'items'], distance: ['km', 'm'] };
const RULES = ['', 'sleep']; // per-habit evaluation rule; '' = percentage of target
const MAX_VALUE = 100000;
const num = (v, min, max, fallback) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v); return Number.isFinite(n) ? clamp(Math.round(n * 100) / 100, min, max) : fallback; };
const isMeasured = (h) => h.tracking !== 'boolean';

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
  const tracking = TRACKING.includes(raw.tracking) ? raw.tracking : 'boolean'; // older habits have no type → checklist
  const measured = tracking !== 'boolean';
  return {
    id: raw.id.toLowerCase(),
    name,
    description: str(raw.description, 80),
    tracking,
    target: measured ? num(raw.target, 0.01, MAX_VALUE, 1) : 1,
    unit: measured ? (str(raw.unit, 12) || UNITS[tracking][0]) : '',
    rule: tracking === 'duration' && RULES.includes(raw.rule) ? raw.rule : '',
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

/* A check-in ("entry") is either a status string — 'done' | 'skipped' — or,
   for measured habits, { v: actual value, t: target on that day }. */
function sanitizeEntry(e) {
  if (STATUSES.includes(e)) return e;
  if (e && typeof e === 'object') {
    const v = num(e.v, 0, MAX_VALUE, null);
    if (v === null) return null;
    return { v, t: num(e.t, 0.01, MAX_VALUE, 1) };
  }
  return null;
}
const entryStatus = (e) => (e == null ? null : typeof e === 'string' ? e : e.v >= e.t ? 'done' : 'partial');
/** Share of the day's target reached, capped at 1 (the real value is kept in the entry). */
const entryCredit = (e) => (e === 'done' ? 1 : e && typeof e === 'object' ? clamp(e.v / e.t, 0, 1) : 0);
const sameEntry = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const LEVEL_KEYS = ['lvVeryLow', 'lvLow', 'lvNear', 'lvAlmost', 'lvAchieved'];
const SLEEP_KEYS = ['slVeryLittle', 'slLittle', 'slFair', 'slGood', 'slVeryGood'];

/**
 * Rate a measured check-in. Returns { value, target, pct, bar, level 0–4, label } or null.
 * Default rule: percentage of target (0–39 very low, 40–69 low, 70–89 near, 90–99 almost, 100+ achieved).
 * A habit can carry its own rule in `habit.rule`; add new ones here.
 */
function evaluate(h, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const target = entry.t || h.target || 1;
  const pct = Math.floor((entry.v / target) * 100 + 1e-9); // rounded down, so 100% only shows once the target is really reached
  let level, label;
  if (h.rule === 'sleep') {
    // By hours relative to the target: 2+ short → very little, 2 short → little, 1 short → fair, on target → good, 1+ over → very good
    const diff = (entry.v - target) / (h.unit === 'min' ? 60 : 1);
    level = diff >= 1 ? 4 : diff >= 0 ? 3 : diff >= -1 ? 2 : diff >= -2 ? 1 : 0;
    label = t(SLEEP_KEYS[level]);
  } else {
    level = pct >= 100 ? 4 : pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 40 ? 1 : 0;
    label = t(LEVEL_KEYS[level]);
  }
  return { value: entry.v, target, pct, bar: clamp(pct, 0, 100), level, label };
}

const fmtValue = (v) => String(Math.round(v * 100) / 100);
/** Known units are translated (unit_h, unit_km, …); custom units are shown as typed. */
function unitLabel(u) {
  const key = `unit_${u}`;
  const en = (window.I18N && window.I18N.en) || {};
  return Object.prototype.hasOwnProperty.call(en, key) ? t(key) : u;
}
const fmtAmount = (v, unit) => `${fmtValue(v)} ${unitLabel(unit)}`.trim();

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
  const addLog = (date, rawHabitId, rawEntry) => {
    const entry = sanitizeEntry(rawEntry);
    if (count >= LIMITS.logs || !isDateKey(date) || entry === null) return;
    const hid = rawHabitId == null ? null : idMap.get(String(rawHabitId));
    if (!hid || !habitIds.has(hid)) return;
    (logs[date] ||= {})[hid] = entry;
    count++;
  };
  if (Array.isArray(raw.logs)) {
    // Backup format: { habitId, date, status } or, for measured habits, { habitId, date, value, target }
    raw.logs.forEach((l) => { if (l && typeof l === 'object') addLog(l.date, l.habitId, typeof l.value === 'number' ? { v: l.value, t: l.target } : l.status); });
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
  data: { theme: 'dark', lang: null, mode: null, lastUser: null, v1Handled: false },
  load() {
    const r = LocalDB.read(PREFS_KEY);
    const v = r.status === 'ok' && r.value && typeof r.value === 'object' ? r.value : {};
    this.data = {
      theme: v.theme === 'light' ? 'light' : 'dark',
      lang: LANGS.includes(v.lang) ? v.lang : null,
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
      tracking: h.tracking, target: h.target, unit: h.unit, rule: h.rule,
    },
  }),
  goal: (g, deleted = false) => ({
    key: `goals:${g.id}`, table: 'goals',
    row: {
      id: g.id, title: g.title, mode: g.mode, habitId: g.habitId, current: g.current, target: g.target, unit: g.unit,
      startDate: g.startDate, deadline: g.deadline || '', createdAt: g.createdAt, deleted,
    },
  }),
  log: (date, habitId, entry) => {
    const measured = entry && typeof entry === 'object';
    // `status` stays meaningful for measured check-ins too, so older app versions still read them
    const status = measured ? (entry.v >= entry.t ? 'done' : null) : (entry || null);
    return {
      key: `logs:${habitId}|${date}`, table: 'logs',
      row: { habitId, date, status, value: measured ? entry.v : null, target: measured ? entry.t : null },
    };
  },
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
  /** The raw check-in: 'done' | 'skipped' | { v, t } | null. */
  getEntry(dateKey, habitId) {
    const day = this.state.logs[dateKey];
    return day && Object.prototype.hasOwnProperty.call(day, habitId) ? day[habitId] : null;
  },
  /** 'done' | 'partial' (some progress, below target) | 'skipped' | null. */
  getStatus(dateKey, habitId) { return entryStatus(this.getEntry(dateKey, habitId)); },
  setEntry(dateKey, habitId, entry) {
    if (!isDateKey(dateKey) || !this.getHabit(habitId)) return;
    const next = sanitizeEntry(entry);
    const day = (this.state.logs[dateKey] ||= {});
    if (next) day[habitId] = next; else delete day[habitId];
    if (!Object.keys(day).length) delete this.state.logs[dateKey];
    this.commit([Rows.log(dateKey, habitId, next)]);
  },
  setStatus(dateKey, habitId, status) { this.setEntry(dateKey, habitId, STATUSES.includes(status) ? status : null); },
  /** Record the actual amount for a measured habit (null clears it). The day's target is stored with it. */
  setValue(dateKey, habitId, value) {
    const h = this.getHabit(habitId);
    if (!h) return;
    this.setEntry(dateKey, habitId, value == null ? null : { v: value, t: h.target });
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
    const next = typeof d.value === 'number' ? sanitizeEntry({ v: d.value, t: d.target }) : (STATUSES.includes(d.status) ? d.status : null);
    if (sameEntry(Store.getEntry(d.date, hid), next)) return false;
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
   - Each habit earns credit for the day: 1 when done, or actual ÷ target
     (capped at 1) for measured habits. "Done" means the target was reached.
   - Day rate = total credit ÷ (scheduled − skipped). Skips don't count against you.
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
      let done = 0, skipped = 0, partial = 0, credit = 0;
      habits.forEach((h) => {
        const e = Store.getEntry(key, h.id);
        const st = entryStatus(e);
        if (st === 'skipped') { skipped++; return; }
        credit += entryCredit(e);
        if (st === 'done') done++; else if (st === 'partial') partial++;
      });
      const eligible = habits.length - skipped;
      return { key, date, habits, scheduled: habits.length, done, partial, skipped, eligible, credit, rate: eligible > 0 ? credit / eligible : null };
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
    let done = 0, partial = 0, eligible = 0, skipped = 0, scheduled = 0, credit = 0;
    days.forEach((d) => { done += d.done; partial += d.partial; eligible += d.eligible; skipped += d.skipped; scheduled += d.scheduled; credit += d.credit; });
    return { done, partial, eligible, skipped, scheduled, credit, missed: eligible - done - partial, rate: eligible > 0 ? credit / eligible : null };
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
      let done = 0, partial = 0, skipped = 0, scheduled = 0, credit = 0, valueSum = 0, valueDays = 0;
      for (let d = fromKey(from); toKey(d) <= to; d = addDays(d, 1)) {
        const key = toKey(d);
        if (!this.isScheduled(h, d, key)) continue;
        scheduled++;
        const e = Store.getEntry(key, h.id);
        const st = entryStatus(e);
        if (st === 'skipped') { skipped++; continue; }
        credit += entryCredit(e);
        if (st === 'done') done++; else if (st === 'partial') partial++;
        if (e && typeof e === 'object') { valueSum += e.v; valueDays++; }
      }
      const eligible = scheduled - skipped;
      // avg = average actual amount on the days a value was recorded
      return { done, partial, skipped, scheduled, eligible, credit, rate: eligible > 0 ? credit / eligible : null, avg: valueDays ? valueSum / valueDays : null, valueDays };
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
function confirmDialog({ title = t('areYouSure'), message = '', confirmText = t('delete'), cancelText = t('cancel'), tone = 'danger' } = {}) {
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
  const first = (s) => Array.from(s)[0] || '';
  return (first(parts[0] || '?') + (parts.length > 1 ? first(parts[1]) : '')).toUpperCase();
}

/* =========================================================
   9. Router & header
   ========================================================= */
const VIEWS = {
  dashboard: { title: null, sub: 'subDashboard' },
  habits: { title: 'navHabits', sub: 'subHabits' },
  calendar: { title: 'navCalendar', sub: 'subCalendar' },
  statistics: { title: 'navStatistics', sub: 'subStatistics' },
  goals: { title: 'navGoals', sub: 'subGoals' },
  settings: { title: 'navSettings', sub: 'subSettings' },
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
  if (h < 5) return t('greetNight');
  if (h < 12) return t('greetMorning');
  if (h < 18) return t('greetAfternoon');
  return t('greetEvening');
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
  $('#headerTitle').textContent = cfg.title ? t(cfg.title) : (name ? t('greetName', { greeting: greeting(), name }) : greeting());
  $('#headerSubtitle').textContent = t(cfg.sub);
  const account = Store.mode === 'cloud' ? (Auth.email || Prefs.data.lastUser?.email || t('signedIn')) : t('deviceOnly');
  $$('[data-bind="name"]').forEach((el) => { el.textContent = name || (Store.mode === 'cloud' ? account : t('you')); });
  $$('[data-bind="account"]').forEach((el) => { el.textContent = account; });
  $$('[data-bind="initials"]').forEach((el) => { el.textContent = initials(name || (Store.mode === 'cloud' ? account : t('you'))); });
  document.title = `${cfg.title ? t(cfg.title) : t('navDashboard')} · Cadence`;
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
    el.innerHTML = `${iconSpan('alert')}<span>${escapeHtml(t('renderError'))}</span><button class="btn btn-ghost sm" type="button" data-action="reload">${escapeHtml(t('reload'))}</button>`;
    $('#main').prepend(el);
  }
}

const SYNC_KEYS = { local: 'syncLocal', synced: 'syncSynced', syncing: 'syncSyncing', offline: 'syncOffline', error: 'syncError', auth: 'syncAuth' };
const syncText = (status) => t(SYNC_KEYS[status] || 'syncLocal');

function renderSyncStatus() {
  const status = Store.mode === 'cloud' ? Sync.status : 'local';
  const pending = Store.pendingCount();
  let text = syncText(status);
  if (status === 'offline' && pending) text = t('syncOfflineWaiting', { changes: tn('nChanges', pending) });
  const title = status === 'local' ? t('syncLocalTitle') : `${text}${Store.lastSyncAt ? ` · ${t('lastSynced', { time: relativeTime(Store.lastSyncAt) })}` : ''}`;
  $$('[data-sync-pill]').forEach((el) => {
    el.dataset.sync = status;
    el.title = title;
    el.setAttribute('aria-label', t('syncStatusIs', { text }));
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
  $('#templateGrid').innerHTML = TEMPLATES.map((tp, i) => `
    <button type="button" class="template" data-action="use-template" data-index="${i}">
      <span class="habit-icon" style="--c:${HABIT_COLORS[i % HABIT_COLORS.length]}">${iconSpan(tp.icon)}</span>
      <span>${escapeHtml(t(tp.key))}</span>
    </button>`).join('');
}

function renderSummary() {
  const td = Stats.day(today());
  const todayPct = pct(td.rate) ?? 0;
  $('#todayRing').style.setProperty('--p', todayPct);
  animateNumber($('#statToday'), todayPct);
  $('#statTodayMeta').textContent = td.scheduled
    ? `${t('doneOf', { done: td.done, total: td.eligible })}${td.skipped ? ` · ${t('nSkipped', { n: td.skipped })}` : ''}`
    : t('nothingScheduledToday');

  const st = Stats.streaks();
  animateNumber($('#statStreak'), st.current);
  $('#statStreakUnit').textContent = tn('dayUnit', st.current);
  $('#statStreakMeta').textContent = st.longest ? t('bestDays', { days: tn('nDays', st.longest) }) : t('startStreak');

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
    ? t('checkinsSince', { done: ov.done, total: ov.eligible, date: fmtDate(ov.since) })
    : t('firstCheckin');
}

function todayCaption() {
  const td = Stats.day(today());
  const wd = fmtDate(today(), { weekday: 'long' });
  return td.scheduled ? `${t('completedOf', { done: td.done, total: td.eligible })} · ${wd}` : wd;
}

function renderToday() {
  const list = $('#todayList');
  const tk = todayKey();
  const habits = Stats.habitsForDate(today());
  $('#todayCaption').textContent = todayCaption();
  if (!habits.length) {
    list.innerHTML = `<li>${emptyHtml({ iconName: 'sun', title: t('restTitle'), text: t('restText') })}</li>`;
    return;
  }
  const filtered = habits.filter((h) => {
    const st = Store.getStatus(tk, h.id);
    if (UI.todayFilter === 'done') return st === 'done';
    if (UI.todayFilter === 'pending') return st !== 'done' && st !== 'skipped';
    return true;
  });
  if (!filtered.length) {
    list.innerHTML = `<li>${UI.todayFilter === 'pending'
      ? emptyHtml({ iconName: 'checkCircle', title: t('caughtUpTitle'), text: t('caughtUpText') })
      : emptyHtml({ iconName: 'clock', title: t('noneDoneTitle'), text: t('noneDoneText') })}</li>`;
    return;
  }
  list.innerHTML = filtered.map((h) => todayItemHtml(h, tk)).join('');
}

function todayItemHtml(h, tk) {
  const entry = Store.getEntry(tk, h.id);
  const st = entryStatus(entry);
  const wp = Stats.weekProgress(h);
  const streak = Stats.habitStreak(h).current;
  const id = escapeHtml(h.id);
  const name = escapeHtml(h.name);
  const a = (key) => escapeHtml(t(key, { name: h.name }));
  const flame = streak ? `<span class="flame" title="${escapeHtml(t('inARow', { days: tn('nDays', streak) }))}">${iconSpan('flame')}${streak}</span>` : '';
  const skipBtn = `<button type="button" class="icon-btn skip-btn ${st === 'skipped' ? 'active' : ''}" data-action="skip-today" data-id="${id}"
      title="${escapeHtml(st === 'skipped' ? t('undoSkip') : t('skipToday'))}" aria-label="${st === 'skipped' ? a('undoSkipFor') : a('skipNameToday')}">${iconSpan('skip')}</button>`;

  if (isMeasured(h)) {
    // Target, actual amount, progress and level for today
    const ev = evaluate(h, entry);
    const desc = [t('targetAmount', { amount: fmtAmount(h.target, h.unit) }), h.description].filter(Boolean).join(' · ');
    const progress = st === 'skipped' ? `<span>${escapeHtml(t('statusSkipped'))}</span>`
      : ev ? `<div class="bar lv${ev.level}"><span style="width:${ev.bar}%"></span></div><span class="pct">${ev.pct}%</span><span class="level lv${ev.level}">${escapeHtml(ev.label)}</span>`
      : st === 'done' ? `<div class="bar lv4"><span style="width:100%"></span></div><span class="level lv4">${escapeHtml(t('lvAchieved'))}</span>`
      : `<div class="bar"><span style="width:0%"></span></div><span>${escapeHtml(t('notRecorded'))}</span>`;
    return `<li class="habit-item measured ${st ? `is-${st}` : ''}" data-habit="${id}" style="--c:${escapeHtml(h.color)}">
    <button type="button" class="check ${st === 'done' ? 'checked' : ''}" data-action="toggle-today" data-id="${id}"
      role="checkbox" aria-checked="${st === 'done'}" aria-label="${a('markReached')}">${iconSpan('check')}</button>
    ${habitIconHtml(h)}
    <div class="habit-info">
      <div class="habit-name">${name}</div>
      <div class="habit-desc">${escapeHtml(desc)}</div>
      <div class="habit-progress">${progress}${flame}</div>
    </div>
    <label class="amount"><input type="number" class="amount-input" data-amount data-id="${id}" data-date="${tk}" min="0" step="any" inputmode="decimal"
      value="${ev ? fmtValue(ev.value) : ''}" placeholder="0" aria-label="${a('actualFor')}" /><span>${escapeHtml(unitLabel(h.unit))}</span></label>
    ${skipBtn}
  </li>`;
  }

  const label = st === 'done' ? t('statusDone') : st === 'skipped' ? t('statusSkipped') : t('statusTodo');
  return `<li class="habit-item ${st ? `is-${st}` : ''}" data-habit="${id}" style="--c:${escapeHtml(h.color)}">
    <button type="button" class="check ${st === 'done' ? 'checked' : ''}" data-action="toggle-today" data-id="${id}"
      role="checkbox" aria-checked="${st === 'done'}" aria-label="${a('markDone')}">${iconSpan('check')}</button>
    ${habitIconHtml(h)}
    <div class="habit-info">
      <div class="habit-name">${name}</div>
      ${h.description ? `<div class="habit-desc">${escapeHtml(h.description)}</div>` : ''}
      <div class="habit-progress">
        <div class="bar"><span style="width:${clamp(wp.done / wp.target, 0, 1) * 100}%"></span></div>
        <span>${escapeHtml(t('weekProgress', { done: wp.done, target: wp.target }))}</span>
        ${flame}
      </div>
    </div>
    <span class="status-pill ${st === 'done' ? 'done' : ''}">${escapeHtml(label)}</span>
    ${skipBtn}
  </li>`;
}

/** Patch one row in place so the checkbox animation (and a focused amount field) isn't interrupted by a re-render. */
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
  ['.habit-info', '.status-pill', '.skip-btn'].forEach((sel) => {
    const cur = li.querySelector(sel);
    const next = fresh.querySelector(sel);
    if (cur && next) cur.replaceWith(next);
  });
  const input = li.querySelector('.amount-input');
  const freshInput = fresh.querySelector('.amount-input');
  if (input && freshInput && document.activeElement !== input) input.value = freshInput.value;
  $('#todayCaption').textContent = todayCaption();
}

/** Short form of a value for a small cell (1250 → 1.3k). */
const compactValue = (v) => (v >= 1000 ? `${String(Math.round(v / 100) / 10)}k` : fmtValue(v));

function weekCellHtml(h, d, tk) {
  const key = toKey(d);
  if (key > tk) return `<td><span class="cell locked" title="${escapeHtml(t('future'))}"></span></td>`;
  if (!Stats.isScheduled(h, d, key)) return `<td><span class="cell off" title="${escapeHtml(t('notScheduled'))}"></span></td>`;
  const entry = Store.getEntry(key, h.id);
  const st = entryStatus(entry);
  const dateText = fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' });
  const id = escapeHtml(h.id);

  if (isMeasured(h)) {
    // Shows the recorded amount; tapping opens the record dialog
    const ev = evaluate(h, entry);
    const cls = ['cell', 'measured', st === 'skipped' ? 'skipped' : '', st === 'done' ? 'done' : '', ev ? `lv${ev.level}` : '', key === tk ? 'today' : ''].join(' ');
    const inner = st === 'skipped' ? iconSpan('minus') : ev ? escapeHtml(compactValue(ev.value)) : st === 'done' ? iconSpan('check') : '';
    const valueText = st === 'skipped' ? t('statusSkipped')
      : ev ? `${fmtAmount(ev.value, h.unit)} / ${fmtAmount(ev.target, h.unit)} · ${ev.pct}% · ${ev.label}`
      : st === 'done' ? t('statusDone') : t('notRecorded');
    const label = escapeHtml(t('cellValue', { name: h.name, date: dateText, value: valueText }));
    return `<td><button type="button" class="${cls}" data-action="record" data-id="${id}" data-date="${key}" aria-label="${label}" title="${label}">${inner}</button></td>`;
  }

  const cls = ['cell', st || '', key === tk ? 'today' : ''].join(' ');
  const stText = st === 'done' ? t('statusDone') : st === 'skipped' ? t('statusSkipped') : t('statusNotDone');
  const label = escapeHtml(`${h.name}, ${dateText}: ${stText}`);
  return `<td><button type="button" class="${cls}" data-action="cycle" data-id="${id}" data-date="${key}" aria-label="${label}" title="${label}">${st === 'skipped' ? iconSpan('minus') : iconSpan('check')}</button></td>`;
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
    wrap.innerHTML = emptyHtml({ iconName: 'calendar', title: t('noActiveWeek'), text: t('noActiveWeekText') });
    return;
  }
  const head = days.map((d) => `<th class="${toKey(d) === tk ? 'is-today' : ''}">${dayShort(d.getDay())}<span class="dnum">${d.getDate()}</span></th>`).join('');
  const rows = habits.map((h) => {
    const wp = Stats.weekProgress(h, days[0]);
    return `<tr class="${h.active ? '' : 'row-paused'}">
      <td><div class="row-habit">${habitIconHtml(h)}<div style="min-width:0"><div class="name">${escapeHtml(h.name)}</div><div class="sub">${escapeHtml(h.active ? t('weekProgress', { done: wp.done, target: wp.target }) : t('paused'))}</div></div></div></td>
      ${days.map((d) => weekCellHtml(h, d, tk)).join('')}
    </tr>`;
  }).join('');
  const foot = days.map((d) => {
    const s = Stats.day(d);
    return `<td><span class="day-rate">${toKey(d) > tk || s.rate === null ? '—' : `${pct(s.rate)}%`}</span></td>`;
  }).join('');
  wrap.innerHTML = `<table class="week-table">
    <thead><tr><th>${escapeHtml(t('habit'))}</th>${head}</tr></thead>
    <tbody>${rows}<tr><td><span class="day-rate">${escapeHtml(t('dailyCompletion'))}</span></td>${foot}</tr></tbody>
  </table>`;
}

function renderStreaks() {
  const st = Stats.streaks();
  animateNumber($('#streakCurrent'), st.current);
  animateNumber($('#streakLongest'), st.longest);
  animateNumber($('#streakDays'), st.successDays);
  $('#streakCurrent').nextElementSibling.textContent = tn('dayUnit', st.current);
  $('#streakLongest').nextElementSibling.textContent = tn('dayUnit', st.longest);
  const thr = Stats.settings().streakThreshold;
  $('#streakRule').textContent = thr >= 100 ? t('ruleAll') : t('ruleAtLeast', { n: thr });
  // Show real history only: from the first habit's week, at least 12 and at most 26 weeks
  const first = Stats.firstDate() || today();
  renderHeatmap($('#heatmap'), clamp(Math.ceil((diffDays(first, today()) + 1) / 7) + 1, 12, 26));
}

/** GitHub-style heatmap: columns are weeks, rows are weekdays. Keyboard: arrows move, Enter opens the day. */
function renderHeatmap(container, weeks) {
  const ws = Stats.settings().weekStart;
  const tday = today();
  const tk = toKey(tday);
  const start = addDays(startOfWeek(tday, ws), -(weeks - 1) * 7);
  const cells = [];
  const months = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const weekStart = addDays(start, w * 7);
    const m = weekStart.getMonth();
    months.push(m !== lastMonth ? `<span>${monthShort(m)}</span>` : '<span></span>');
    lastMonth = m;
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const key = toKey(d);
      if (key > tk) { cells.push('<i class="hm future" aria-hidden="true"></i>'); continue; }
      const s = Stats.day(d);
      const tip = escapeHtml(s.rate === null
        ? t('heatNothing', { date: fmtDate(d) })
        : t('heatTip', { date: fmtDate(d), done: s.done, total: s.eligible, pct: pct(s.rate) }));
      cells.push(`<i class="hm ${heatLevel(s.rate)} ${key === tk ? 'is-today' : ''}" data-date="${key}" role="button" tabindex="${key === tk ? 0 : -1}" title="${tip}" aria-label="${tip}"></i>`);
    }
  }
  const dayLabels = Array.from({ length: 7 }, (_, i) => `<span>${i % 2 === 0 ? dayShort((ws + i) % 7) : ''}</span>`).join('');
  container.innerHTML = `<div class="heatmap"><div class="hm-months" aria-hidden="true">${months.join('')}</div><div class="hm-days" aria-hidden="true">${dayLabels}</div><div class="hm-grid" role="group" aria-label="${escapeHtml(t('heatmapAria'))}">${cells.join('')}</div></div>`;
  container.scrollLeft = container.scrollWidth;
}

function renderGoalsPreview() {
  const wrap = $('#goalsPreview');
  const goals = Store.goals.map((g) => ({ g, p: Stats.goalProgress(g) }))
    .sort((a, b) => Number(a.p.completed) - Number(b.p.completed) || (a.p.daysLeft ?? 9999) - (b.p.daysLeft ?? 9999));
  const active = goals.filter((x) => !x.p.completed).length;
  $('#goalsCaption').textContent = goals.length ? t('goalsCaption', { active, done: goals.length - active }) : t('longTermTargets');
  if (!goals.length) {
    wrap.innerHTML = emptyHtml({ iconName: 'target', title: t('noGoals'), text: t('noGoalsText'), actionLabel: t('addGoal'), action: 'add-goal' });
    return;
  }
  wrap.innerHTML = goals.slice(0, 4).map(({ g, p }) => `
    <div class="goal-mini">
      <div class="top"><strong>${escapeHtml(g.title)}</strong><span>${p.current} / ${p.target}${g.unit ? ` ${escapeHtml(g.unit)}` : ''}</span></div>
      <div class="bar"><span style="width:${p.ratio * 100}%"></span></div>
      <div class="meta">${escapeHtml(goalDeadlineText(p))}</div>
    </div>`).join('');
}

function goalDeadlineText(p) {
  if (p.completed) return t('goalCompleted');
  if (p.daysLeft === null) return t('noDeadline');
  if (p.daysLeft < 0) return t('overdueBy', { days: tn('nDays', -p.daysLeft) });
  if (p.daysLeft === 0) return t('dueToday');
  return t('daysLeft', { days: tn('nDays', p.daysLeft) });
}

/* ---------- Habits page ---------- */
function renderHabits() {
  const grid = $('#habitGrid');
  const q = UI.habitQuery.trim().toLowerCase();
  const all = Store.habits;
  if (!all.length) {
    grid.innerHTML = `<div class="grid-empty card">${emptyHtml({ title: t('noHabits'), text: t('noHabitsText'), actionLabel: t('createFirstHabit'), action: 'add-habit' })}</div>`;
    return;
  }
  const habits = all.filter((h) => {
    if (UI.habitFilter === 'active' && !h.active) return false;
    if (UI.habitFilter === 'paused' && h.active) return false;
    return !q || h.name.toLowerCase().includes(q) || h.description.toLowerCase().includes(q);
  });
  if (!habits.length) {
    grid.innerHTML = `<div class="grid-empty card">${emptyHtml({ iconName: 'search', title: t('noMatch'), text: t('noMatchText') })}</div>`;
    return;
  }
  const tday = today();
  const from30 = addDays(tday, -29);
  const order = ALL_DAYS.map((i) => (Stats.settings().weekStart + i) % 7);
  grid.innerHTML = habits.map((h) => {
    const streak = Stats.habitStreak(h);
    const r = Stats.habitRange(h, from30, tday);
    const wp = Stats.weekProgress(h);
    const id = escapeHtml(h.id);
    const a = (key) => escapeHtml(t(key, { name: h.name }));
    return `<article class="card habit-card ${h.active ? '' : 'paused'}" style="--c:${escapeHtml(h.color)}">
      <div class="top">
        ${habitIconHtml(h)}
        <div class="habit-info">
          <h3>${escapeHtml(h.name)}</h3>
          <div class="habit-desc">${escapeHtml(h.description || freqLabel(h.days))}</div>
          ${isMeasured(h) ? `<div class="habit-target">${escapeHtml(t('targetPerDay', { amount: fmtAmount(h.target, h.unit) }))}${r.avg !== null ? ` · ${escapeHtml(t('avgAmount', { amount: fmtAmount(r.avg, h.unit) }))}` : ''}</div>` : ''}
        </div>
        <div class="card-menu">
          <button class="icon-btn" type="button" data-action="edit-habit" data-id="${id}" aria-label="${a('editName')}">${iconSpan('edit')}</button>
          <button class="icon-btn danger" type="button" data-action="delete-habit" data-id="${id}" aria-label="${a('deleteName')}">${iconSpan('trash')}</button>
        </div>
      </div>
      <div class="days" aria-label="${escapeHtml(t('repeatsOn', { days: freqLabel(h.days) }))}">${order.map((d) => `<span class="${h.days.includes(d) ? 'on' : ''}">${dayLetter(d)}</span>`).join('')}</div>
      <div class="mini-stats">
        <div><span>${escapeHtml(t('streak'))}</span><strong>${streak.current}</strong></div>
        <div><span>${escapeHtml(t('rate30'))}</span><strong>${r.rate === null ? '—' : `${pct(r.rate)}%`}</strong></div>
        <div><span>${escapeHtml(t('thisWeek'))}</span><strong>${wp.done}/${wp.target}</strong></div>
      </div>
      <div class="foot">
        <label class="switch-label"><input type="checkbox" class="switch-input" data-action="toggle-active" data-id="${id}" ${h.active ? 'checked' : ''} />${escapeHtml(h.active ? t('active') : t('paused'))}</label>
        <span class="muted small">${escapeHtml(t('bestStreakN', { n: streak.longest }))}</span>
      </div>
    </article>`;
  }).join('');
}

function freqLabel(days) {
  const s = days.join(',');
  if (s === '0,1,2,3,4,5,6') return t('everyDay');
  if (s === '1,2,3,4,5') return t('weekdays');
  if (s === '0,6') return t('weekends');
  return days.map((d) => dayShort(d)).join(', ');
}

/* ---------- Calendar ---------- */
function renderCalendar() {
  const ws = Stats.settings().weekStart;
  const m = UI.calMonth;
  $('#calTitle').textContent = m.toLocaleDateString(Lang.locale(), { month: 'long', year: 'numeric' });
  $('#calWeekdays').innerHTML = ALL_DAYS.map((i) => `<span>${dayShort((ws + i) % 7)}</span>`).join('');

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
    const aria = escapeHtml(`${fmtLong(d)}${s.rate !== null && !future ? `, ${t('pctComplete', { pct: pct(s.rate) })}` : ''}`);
    html += `<button type="button" class="${cls}" data-action="cal-select" data-date="${key}" aria-pressed="${key === UI.calSelected}" aria-label="${aria}">
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
  const pending = s.habits.filter((h) => { const st = Store.getStatus(key, h.id); return st !== 'done' && st !== 'skipped'; });

  const item = (h) => {
    const st = Store.getStatus(key, h.id);
    const id = escapeHtml(h.id);
    const a = (k) => escapeHtml(t(k, { name: h.name }));
    return `<li>${habitIconHtml(h)}<span class="name">${escapeHtml(h.name)}</span>
      ${future ? '' : `<button type="button" class="icon-btn skip-btn ${st === 'skipped' ? 'active' : ''}" data-action="day-skip" data-id="${id}" aria-label="${st === 'skipped' ? a('undoSkipFor') : a('skipName')}" title="${escapeHtml(st === 'skipped' ? t('undoSkip') : t('skip'))}">${iconSpan('skip')}</button>
      ${isMeasured(h)
        ? (() => { const ev = evaluate(h, Store.getEntry(key, h.id)); return `<button type="button" class="amount-btn ${ev ? `lv${ev.level}` : ''}" data-action="record" data-id="${id}" data-date="${key}" aria-label="${a('recordName')}" title="${escapeHtml(ev ? `${ev.pct}% · ${ev.label}` : t('record'))}">${escapeHtml(ev ? fmtAmount(ev.value, h.unit) : st === 'done' ? t('statusDone') : t('record'))}</button>`; })()
        : `<button type="button" class="check ${st === 'done' ? 'checked' : ''}" data-action="day-toggle" data-id="${id}" role="checkbox" aria-checked="${st === 'done'}" aria-label="${a('markNameDone')}">${iconSpan('check')}</button>`}`}
    </li>`;
  };
  const section = (titleKey, list) => (list.length ? `<div class="day-section"><h3>${escapeHtml(t(titleKey))} · ${list.length}</h3><ul class="day-list">${list.map(item).join('')}</ul></div>` : '');

  let body;
  if (!s.scheduled) {
    body = emptyHtml({ iconName: 'sun', title: future ? t('nothingPlanned') : t('nothingScheduled'), text: t('noHabitsThisDay') });
  } else if (future) {
    body = `<div class="day-section"><h3>${escapeHtml(t('planned'))} · ${s.scheduled}</h3><ul class="day-list">${s.habits.map(item).join('')}</ul></div><p class="muted small" style="margin-top:12px">${escapeHtml(t('futureNote'))}</p>`;
  } else {
    body = section('secCompleted', done) + section('secNotDone', pending) + section('secSkipped', skipped);
  }

  const summary = s.scheduled
    ? `${t('completedOf', { done: s.done, total: s.eligible })}${s.skipped ? ` · ${t('nSkipped', { n: s.skipped })}` : ''}`
    : t('noHabitsScheduled');
  panel.innerHTML = `
    <div class="head">
      <div class="ring" style="--p:${future ? 0 : r ?? 0}">
        <svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-track" cx="18" cy="18" r="15.9"/><circle class="ring-fill" cx="18" cy="18" r="15.9"/></svg>
        <b>${future || r === null ? '—' : `${r}%`}</b>
      </div>
      <div>
        <h2>${escapeHtml(fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' }))}</h2>
        <p class="muted small">${escapeHtml(summary)}</p>
      </div>
    </div>
    ${body}`;
}

/* ---------- Statistics ---------- */
const BEST_HABIT_MIN = 5; // check-ins needed before a habit can be "best"

function renderStatistics() {
  const tday = today();
  const n = UI.statsRange;
  const start = addDays(tday, -(n - 1));
  $('#statsRangeLabel').textContent = `${fmtDate(start)} – ${fmtDate(tday)}`;
  $$('#statsRange button').forEach((b) => b.classList.toggle('active', Number(b.dataset.range) === n));

  const ws = startOfWeek(tday, Stats.settings().weekStart);
  const weekAgg = Stats.aggregate(Stats.range(ws, tday));
  const monthAgg = Stats.aggregate(Stats.range(new Date(tday.getFullYear(), tday.getMonth(), 1), tday));
  const streaks = Stats.streaks();
  const habits = Store.habits;

  const perHabit = habits.map((h) => ({ h, r: Stats.habitRange(h, start, tday), s: Stats.habitStreak(h) }));
  const best = perHabit.filter((x) => x.r.rate !== null && x.r.eligible >= BEST_HABIT_MIN)
    .sort((a, b) => b.r.rate - a.r.rate || b.r.done - a.r.done)[0];
  const consistent = perHabit.filter((x) => x.s.current > 0 || x.s.longest > 0)
    .sort((a, b) => b.s.current - a.s.current || b.s.longest - a.s.longest)[0];

  const kpi = (k, v, m) => `<article class="card kpi"><span class="k">${escapeHtml(t(k))}</span>${v}<span class="m">${escapeHtml(m)}</span></article>`;
  const num = (value, unit = '') => `<span class="v">${value}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</span>`;
  const rateNum = (agg) => (agg.rate === null ? num('—') : num(pct(agg.rate), '%'));
  const habitV = (x) => (x ? `<span class="v text">${habitIconHtml(x.h)}<span>${escapeHtml(x.h.name)}</span></span>` : '<span class="v text"><span>—</span></span>');

  $('#kpiGrid').innerHTML = [
    kpi('weeklyCompletion', rateNum(weekAgg), t('doneOfThisWeek', { done: weekAgg.done, total: weekAgg.eligible })),
    kpi('monthlyCompletion', rateNum(monthAgg), t('doneOfInMonth', { done: monthAgg.done, total: monthAgg.eligible, month: monthLong(tday.getMonth()) })),
    kpi('currentStreak', num(streaks.current, tn('dayUnit', streaks.current)), t('longestN', { days: tn('nDays', streaks.longest) })),
    kpi('totalCompleted', num(Stats.totalCompleted()), t('allTimeCheckins')),
    kpi('bestHabit', habitV(best), best ? t('bestHabitMeta', { pct: pct(best.r.rate), n }) : t('needsMin', { n: BEST_HABIT_MIN })),
    kpi('mostConsistent', habitV(consistent), consistent ? t('consistentMeta', { days: tn('nDays', consistent.s.current), n: consistent.s.longest }) : t('buildStreak')),
    kpi('longestStreak', num(streaks.longest, tn('dayUnit', streaks.longest)), tn('successfulTotal', streaks.successDays)),
    kpi('activeHabits', num(habits.filter((h) => h.active).length, `/ ${habits.length}`), t('nPaused', { n: habits.filter((h) => !h.active).length })),
  ].join('');

  const days = Stats.range(start, tday);
  renderTrendChart(days);
  renderHabitChart(perHabit);
  renderDonutChart(Stats.aggregate(days));
}

/* ---------- Goals page ---------- */
function renderGoals() {
  const grid = $('#goalGrid');
  const all = Store.goals.map((g) => ({ g, p: Stats.goalProgress(g) }));
  if (!all.length) {
    grid.innerHTML = `<div class="grid-empty card">${emptyHtml({ iconName: 'target', title: t('noGoals'), text: t('goalsIntro'), actionLabel: t('createFirstGoal'), action: 'add-goal' })}</div>`;
    return;
  }
  const list = all.filter(({ p }) => UI.goalFilter === 'all' || (UI.goalFilter === 'done' ? p.completed : !p.completed))
    .sort((a, b) => Number(a.p.completed) - Number(b.p.completed) || (a.p.daysLeft ?? 9999) - (b.p.daysLeft ?? 9999));
  if (!list.length) {
    const doneTab = UI.goalFilter === 'done';
    grid.innerHTML = `<div class="grid-empty card">${emptyHtml({ iconName: 'target', title: doneTab ? t('noCompletedGoals') : t('nothingInProgress'), text: doneTab ? t('finishedGoalsHere') : t('allGoalsComplete') })}</div>`;
    return;
  }
  grid.innerHTML = list.map(({ g, p }) => {
    const habit = g.mode === 'habit' ? Store.getHabit(g.habitId) : null;
    const id = escapeHtml(g.id);
    const deadline = escapeHtml(goalDeadlineText(p));
    const statusTag = p.completed ? `<span class="tag good">${iconSpan('check')}${escapeHtml(t('goalCompleted'))}</span>`
      : p.overdue ? `<span class="tag bad">${iconSpan('clock')}${deadline}</span>`
      : p.daysLeft !== null ? `<span class="tag ${p.daysLeft <= 7 ? 'warn' : ''}">${iconSpan('clock')}${deadline}</span>`
      : `<span class="tag">${escapeHtml(t('noDeadline'))}</span>`;
    const a = (k) => escapeHtml(t(k, { name: g.title }));
    return `<article class="card goal-card">
      <div class="row">
        <div style="min-width:0">
          <h3>${escapeHtml(g.title)}</h3>
          <div class="tags">${statusTag}${habit ? `<span class="tag">${iconSpan('link')}${escapeHtml(habit.name)}</span>` : ''}${g.deadline ? `<span class="tag">${escapeHtml(fmtDate(fromKey(g.deadline), { month: 'short', day: 'numeric', year: 'numeric' }))}</span>` : ''}</div>
        </div>
        <div class="card-menu">
          <button class="icon-btn" type="button" data-action="edit-goal" data-id="${id}" aria-label="${a('editGoalName')}">${iconSpan('edit')}</button>
          <button class="icon-btn danger" type="button" data-action="delete-goal" data-id="${id}" aria-label="${a('deleteGoalName')}">${iconSpan('trash')}</button>
        </div>
      </div>
      <div class="goal-num"><strong>${p.current} <small>/ ${p.target}${g.unit ? ` ${escapeHtml(g.unit)}` : ''}</small></strong><span class="pct">${Math.round(p.ratio * 100)}%</span></div>
      <div class="bar"><span style="width:${p.ratio * 100}%"></span></div>
      <div class="goal-actions">
        ${g.mode === 'habit'
          ? `<span class="muted small">${escapeHtml(t('updatesAuto', { name: habit ? habit.name : t('theHabit') }))}</span>`
          : `<button class="btn btn-ghost sm" type="button" data-action="goal-dec" data-id="${id}" aria-label="${escapeHtml(t('decreaseProgress'))}" ${p.current <= 0 ? 'disabled' : ''}>${iconSpan('minus')}</button>
             <button class="btn btn-ghost sm" type="button" data-action="goal-inc" data-id="${id}">${iconSpan('plus')}${escapeHtml(t('addOne'))}</button>`}
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
  const thresholds = new Set([50, 80, 100, p.streakThreshold]);
  thr.innerHTML = [...thresholds].sort((a, b) => a - b)
    .map((v) => `<option value="${v}">${escapeHtml(v >= 100 ? t('thresholdAll') : t('thresholdAtLeast', { n: v }))}</option>`).join('');
  thr.value = String(p.streakThreshold);
  $$('#themeChoice button').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === Prefs.data.theme));
  $('#dataLead').textContent = Store.mode === 'cloud' ? t('dataLeadCloud') : t('dataLeadLocal');
  const kb = (LocalDB.bytes(NS_PREFIX + Store.ns) / 1024).toFixed(1);
  const s = Store.state;
  $('#storageInfo').textContent = t('storageLine', { habits: tn('nHabits', s.habits.length), goals: tn('nGoals', s.goals.length), checkins: tn('nCheckins', countLogs(s.logs)), kb });
  renderAccountCard();
}

function renderAccountCard() {
  const card = $('#accountCard');
  if (!card) return;
  const configured = Boolean(Cloud.auth);
  const T = (k, v) => escapeHtml(t(k, v));
  if (Store.mode === 'cloud') {
    const email = escapeHtml(Auth.email || Prefs.data.lastUser?.email || '');
    const pending = Store.pendingCount();
    card.innerHTML = `
      <div class="card-head"><h2>${T('account')}</h2></div>
      <div class="account-row"><span class="avatar">${escapeHtml(initials(Store.profile.name || email))}</span><div class="who"><strong>${email}</strong><span class="muted small">${T('signedInSyncs')}</span></div></div>
      <div class="sync-line" data-sync-pill data-sync="${Sync.status}"><span class="sync-dot"></span><span>${escapeHtml(syncText(Sync.status))}${pending ? ` · ${T('nWaiting', { changes: tn('nChanges', pending) })}` : ''} · ${T('lastSynced', { time: relativeTime(Store.lastSyncAt) })}</span></div>
      <div class="account-actions">
        <button class="btn btn-ghost" type="button" data-action="sync-now">${iconSpan('refresh')}${T('syncNow')}</button>
        <button class="btn btn-ghost" type="button" data-action="sign-out">${iconSpan('logout')}${T('signOut')}</button>
      </div>
      <div class="danger-zone">
        <button class="btn btn-danger-ghost" type="button" data-action="delete-account">${iconSpan('trash')}${T('deleteAccount')}</button>
      </div>`;
  } else if (configured) {
    card.innerHTML = `
      <div class="card-head"><h2>${T('account')}</h2></div>
      <div class="account-row"><span class="avatar">${iconSpan('device')}</span><div class="who"><strong>${T('deviceOnly')}</strong><span class="muted small">${T('storedInBrowser')}</span></div></div>
      <p class="muted">${T('createFreeAccount')}</p>
      <div class="account-actions"><button class="btn btn-primary" type="button" data-action="show-auth">${iconSpan('cloud')}${T('signInOrCreate')}</button></div>`;
  } else {
    card.innerHTML = `
      <div class="card-head"><h2>${T('account')}</h2></div>
      <div class="notice">${iconSpan('info')}<p>${t('notConfiguredSettings')}</p></div>`;
  }
  if (UI.corruptKey || UI.corruptRaw) {
    card.insertAdjacentHTML('beforeend', `<div class="notice subtle" style="margin-top:14px">${iconSpan('alert')}<p>${T('corruptNotice')} <button class="link-btn" type="button" data-action="download-corrupt">${T('downloadIt')}</button></p></div>`);
  }
}

/* =========================================================
   11. Charts (Chart.js, loaded locally)
   ========================================================= */
const charts = {};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const CHART_FONT = '"Inter", "Noto Sans Thai", system-ui, sans-serif';

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
  const msg = typeof window.Chart === 'undefined' ? t('chartsUnavailable') : emptyMsg;
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
        titleFont: { family: CHART_FONT, weight: '600' }, bodyFont: { family: CHART_FONT },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: th.text, font: { family: CHART_FONT, size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
      y: { min: 0, max: 100, grid: { color: th.grid }, border: { display: false }, ticks: { color: th.text, font: { family: CHART_FONT, size: 11 }, stepSize: 25, callback: (v) => `${v}%` } },
    },
  };
}

function dayTooltip(days) {
  return {
    title: (items) => fmtLong(days[items[0].dataIndex].date),
    label: (item) => { const d = days[item.dataIndex]; return d.rate === null ? t('nothingScheduled') : t('tooltipDone', { pct: pct(d.rate), done: d.done, total: d.eligible }); },
  };
}

function renderWeekChart() {
  const tday = today();
  const days = Stats.range(addDays(tday, -6), tday);
  const avg = Stats.aggregate(days).rate;
  $('#weekAvg').textContent = avg === null ? t('noDataYet') : t('averagePct', { pct: pct(avg) });
  const hasData = days.some((d) => d.rate !== null && (d.done > 0 || d.key < todayKey()));
  if (!prepareChartBox('weekChartBox', 'week', hasData ? null : t('weekChartEmpty'))) return;
  const th = chartTheme();
  const opts = baseOptions(th);
  opts.plugins.tooltip.callbacks = dayTooltip(days);
  upsertChart('week', $('#weekChart'), {
    type: 'bar',
    data: {
      labels: days.map((d, i) => (i === 6 ? t('today') : dayShort(d.date.getDay()))),
      datasets: [{
        label: t('completion'),
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
  if (!prepareChartBox('trendChartBox', 'trend', hasData ? null : t('noCheckinsRange'))) return;
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
  if (!prepareChartBox('habitChartBox', 'habit', rows.length ? null : t('noHabitsRange'))) return;
  const th = chartTheme();
  const opts = baseOptions(th);
  opts.indexAxis = 'y';
  opts.interaction = { mode: 'nearest', axis: 'y', intersect: false };
  opts.scales = {
    x: { min: 0, max: 100, grid: { color: th.grid }, border: { display: false }, ticks: { color: th.text, font: { family: CHART_FONT, size: 11 }, stepSize: 25, callback: (v) => `${v}%` } },
    y: { grid: { display: false }, border: { display: false }, ticks: { color: th.ink, font: { family: CHART_FONT, size: 12, weight: '500' } } },
  };
  opts.plugins.tooltip.callbacks = {
    label: (item) => { const r = rows[item.dataIndex].r; return t('tooltipDone', { pct: pct(r.rate), done: r.done, total: r.eligible }); },
    // Measured habits also show the average actual amount against the target
    afterLabel: (item) => { const x = rows[item.dataIndex]; return isMeasured(x.h) && x.r.avg !== null ? t('tooltipAvg', { avg: fmtAmount(x.r.avg, x.h.unit), target: fmtAmount(x.h.target, x.h.unit) }) : ''; },
  };
  upsertChart('habit', $('#habitChart'), {
    type: 'bar',
    data: {
      labels: rows.map((x) => x.h.name),
      datasets: [{
        label: t('completion'),
        data: rows.map((x) => pct(x.r.rate)),
        backgroundColor: rows.map((x) => x.h.color), // colour follows the habit, not its rank
        borderRadius: 5, borderSkipped: 'start', maxBarThickness: 22,
      }],
    },
    options: opts,
  });
}

function renderDonutChart(agg) {
  const total = agg.done + agg.partial + agg.skipped + agg.missed;
  if (!prepareChartBox('donutChartBox', 'donut', agg.done + agg.partial + agg.skipped > 0 ? null : t('noCheckinsRange'))) return;
  const th = chartTheme();
  const share = (v) => Math.round((v / total) * 100);
  // "Partly done" (some progress, below target) only appears when there is any
  const slices = [[t('donutDone'), agg.done, th.accent], [t('donutPartial'), agg.partial, cssVar('--lv2')], [t('donutMissed'), agg.missed, th.low], [t('donutSkipped'), agg.skipped, th.gray]]
    .filter((x, i) => i !== 1 || agg.partial > 0);
  upsertChart('donut', $('#donutChart'), {
    type: 'doughnut',
    data: {
      labels: slices.map((x) => x[0]),
      datasets: [{ data: slices.map((x) => x[1]), backgroundColor: slices.map((x) => x[2]), borderColor: th.surface, borderWidth: 2, hoverOffset: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%', animation: { duration: 550 },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: th.ink, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 16, font: { family: CHART_FONT, size: 12 },
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
const habitForm = { editingId: null, icon: 'book', color: HABIT_COLORS[0], days: [...ALL_DAYS], minStart: minStartKey(), tracking: 'boolean' };
const UNIT_OTHER = '__other';
const DEFAULT_TARGET = { duration: 1, count: 10, distance: 3 };

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
  habitForm.tracking = TRACKING.includes(src.tracking) ? src.tracking : 'boolean';
  f.elements.dailyTarget.value = habitForm.tracking !== 'boolean' && src.target ? fmtValue(src.target) : '';
  f.elements.rule.value = src.rule || '';
  syncTrackingFields(src.unit || '');
  $('#habitModalTitle').textContent = h ? t('editHabit') : t('newHabit');
  $('#habitSubmit').textContent = h ? t('saveChanges') : t('createHabit');
  $('#habitDeleteBtn').hidden = !h;
  $('#habitHistoryNote').hidden = !h;
  renderHabitPickers();
  $('#habitModal').showModal();
  if (!matchMedia('(max-width: 760px)').matches) f.elements.habitName.focus();
}

function renderHabitPickers() {
  $('#iconPicker').innerHTML = HABIT_ICONS.map((n) => `<button type="button" class="${n === habitForm.icon ? 'active' : ''}" data-icon-choice="${n}" style="--pc:${habitForm.color}" aria-label="${escapeHtml(t('iconName', { name: (Lang.dict().iconNames || window.I18N.en.iconNames)[n] || n }))}" aria-pressed="${n === habitForm.icon}">${iconSpan(n)}</button>`).join('');
  $('#colorPicker').innerHTML = HABIT_COLORS.map((c, i) => `<button type="button" class="${c === habitForm.color ? 'active' : ''}" data-color-choice="${c}" style="--c:${c}" aria-label="${escapeHtml(t('colorN', { n: i + 1 }))}" aria-pressed="${c === habitForm.color}"></button>`).join('');
  const ws = Stats.settings().weekStart;
  $('#dayPicker').innerHTML = ALL_DAYS.map((i) => (ws + i) % 7)
    .map((d) => `<button type="button" class="${habitForm.days.includes(d) ? 'on' : ''}" data-day="${d}" aria-pressed="${habitForm.days.includes(d)}">${dayShort(d)}</button>`).join('');
  const s = [...habitForm.days].sort().join(',');
  $$('#freqPresets .chip').forEach((c) => c.classList.toggle('active',
    (c.dataset.preset === 'daily' && s === '0,1,2,3,4,5,6') || (c.dataset.preset === 'weekdays' && s === '1,2,3,4,5') || (c.dataset.preset === 'weekends' && s === '0,6')));
  syncTargetMax();
}

/** Show the target / unit / rating fields that fit the chosen tracking type. `unit` preselects a unit. */
function syncTrackingFields(unit) {
  const type = habitForm.tracking;
  const measured = type !== 'boolean';
  const f = $('#habitForm').elements;
  $$('#trackingChoice button').forEach((b) => { const on = b.dataset.tracking === type; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  $('#targetFields').hidden = !measured;
  if (!measured) return;
  const known = UNITS[type];
  const current = unit !== undefined ? unit : (f.unitSelect.value === UNIT_OTHER ? f.unitCustom.value : f.unitSelect.value);
  f.unitSelect.innerHTML = known.map((u) => `<option value="${u}">${escapeHtml(unitLabel(u))}</option>`).join('')
    + (type === 'count' ? `<option value="${UNIT_OTHER}">${escapeHtml(t('unitOther'))}</option>` : '');
  const custom = type === 'count' && current && !known.includes(current);
  f.unitSelect.value = custom ? UNIT_OTHER : (known.includes(current) ? current : known[0]);
  f.unitCustom.hidden = f.unitSelect.value !== UNIT_OTHER;
  if (custom) f.unitCustom.value = current;
  $('#ruleField').hidden = type !== 'duration';
  if (type !== 'duration') f.rule.value = '';
  if (!f.dailyTarget.value) f.dailyTarget.value = DEFAULT_TARGET[type];
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
  setErr('habitName', !name ? t('errHabitName') : dup ? t('errHabitDup') : '', el.habitName);
  setErr('days', habitForm.days.length ? '' : t('errPickDay'));
  const start = el.startDate.value;
  setErr('startDate', !isDateKey(start) ? t('errChooseStart') : start > todayKey() ? t('errStartFuture') : start < habitForm.minStart ? t('errStartMin', { date: fmtDate(fromKey(habitForm.minStart), { month: 'short', day: 'numeric', year: 'numeric' }) }) : '', el.startDate);
  // Measured habits need a daily target and a unit
  const measured = habitForm.tracking !== 'boolean';
  const dailyTarget = measured ? num(el.dailyTarget.value, 0, MAX_VALUE, null) : 1;
  const unit = !measured ? '' : el.unitSelect.value === UNIT_OTHER ? str(el.unitCustom.value, 12) : el.unitSelect.value;
  if (measured) {
    setErr('dailyTarget', dailyTarget !== null && dailyTarget > 0 ? '' : t('errDailyTarget'), el.dailyTarget);
    setErr('unit', unit ? '' : t('errUnit'), el.unitCustom);
  }
  if (!valid) return;

  const data = {
    name,
    description: el.description.value.trim(),
    tracking: habitForm.tracking,
    target: dailyTarget,
    unit,
    rule: habitForm.tracking === 'duration' ? el.rule.value : '',
    icon: habitForm.icon,
    color: habitForm.color,
    days: [...habitForm.days].sort(),
    weeklyTarget: clamp(Number(el.weeklyTarget.value) || 1, 1, habitForm.days.length),
    startDate: start,
    active: el.active.checked,
  };
  if (habitForm.editingId) {
    if (!Store.updateHabit(habitForm.editingId, data)) toast(t('habitDeletedElsewhere'), 'alert');
    else toast(t('habitUpdated'));
  } else if (Store.addHabit(data)) {
    toast(t('habitAdded', { name }));
  }
  $('#habitModal').close();
}

async function deleteHabit(id) {
  const h = Store.getHabit(id);
  if (!h) return;
  const ok = await confirmDialog({
    title: t('deleteHabitTitle', { name: h.name }),
    message: t('deleteHabitMsg'),
    confirmText: t('deleteHabitBtn'),
  });
  if (!ok) return;
  if ($('#habitModal').open) $('#habitModal').close();
  Store.deleteHabit(id);
  toast(t('habitDeleted'), 'trash');
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
  $('#goalModalTitle').textContent = g ? t('editGoal') : t('newGoal');
  $('#goalSubmit').textContent = g ? t('saveChanges') : t('createGoal');
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
    if (b.dataset.mode === 'habit') { b.disabled = !hasHabits; b.title = hasHabits ? '' : t('createHabitFirst'); }
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
  setErr('goalTitle', title ? '' : t('errGoalTitle'), el.goalTitle);
  setErr('goalTarget', target >= 1 && target <= 1e9 ? '' : t('errGoalTarget'), el.goalTarget);
  const start = isDateKey(el.startDate.value) ? el.startDate.value : todayKey();
  setErr('deadline', el.deadline.value && el.deadline.value < start ? t('errDeadline') : '', el.deadline);
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
    if (Store.updateGoal(goalForm.editingId, data)) toast(t('goalUpdated'));
    else toast(t('goalDeletedElsewhere'), 'alert');
  } else if (Store.addGoal(data)) {
    toast(t('goalCreated'));
  }
  $('#goalModal').close();
}

async function deleteGoal(id) {
  const g = Store.getGoal(id);
  if (!g) return;
  const ok = await confirmDialog({ title: t('deleteGoalTitle', { name: g.title }), message: t('deleteGoalMsg'), confirmText: t('deleteGoalBtn') });
  if (!ok) return;
  if ($('#goalModal').open) $('#goalModal').close();
  Store.deleteGoal(id);
  toast(t('goalDeleted'), 'trash');
}

function adjustGoal(id, delta) {
  const g = Store.getGoal(id);
  if (!g || g.mode !== 'manual') return;
  const before = Stats.goalProgress(g).completed;
  Store.updateGoal(id, { current: Math.max(0, g.current + delta) });
  const after = Store.getGoal(id);
  if (after && !before && Stats.goalProgress(after).completed) toast(t('goalReached', { name: g.title }), 'award');
}

/* ---------- Background grids (shapegrid.js): sign-in screen + behind every app page ---------- */
let authGrid = null;
let appGrid = null;
const gridColors = () => ({ borderColor: cssVar('--grid-line'), hoverFillColor: cssVar('--grid-hover') });
const appGridColors = () => ({ borderColor: cssVar('--grid-line-app'), hoverFillColor: cssVar('--grid-hover-app') });
function initGrids() {
  if (authGrid || typeof createShapeGrid !== 'function') return;
  const base = { shape: 'hexagon', squareSize: 23, direction: 'diagonal', speed: 0.5, hoverTrailAmount: 5 };
  // Touch devices have no hover and stay open longer, so cap the frame rate there to save battery
  const fps = matchMedia('(hover: none)').matches ? 30 : 0;
  // The pointer is tracked on the whole screen so content on top doesn't block the highlight
  authGrid = createShapeGrid($('#authGrid'), { ...base, eventTarget: $('#auth'), ...gridColors() });
  appGrid = createShapeGrid($('#appGrid'), { ...base, fps, eventTarget: $('#app'), ...appGridColors() });
}

/* ---------- Theme (per device) ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark';
  $$('.theme-label').forEach((el) => { el.textContent = dark ? t('darkMode') : t('lightMode'); });
  $$('.theme-icon').forEach((el) => { el.innerHTML = icon(dark ? 'moon' : 'sun'); });
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#0a0e1f' : '#f4f4fb');
  authGrid?.update(gridColors());
  appGrid?.update(appGridColors());
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
  Object.entries(s.logs).forEach(([date, day]) => Object.entries(day).forEach(([habitId, e]) => logs.push(typeof e === 'object' ? { habitId, date, value: e.v, target: e.t } : { habitId, date, status: e })));
  const payload = { app: 'cadence', version: 2, exportedAt: nowIso(), profile: s.profile, habits: s.habits, goals: s.goals, logs };
  download(`cadence-backup-${todayKey()}.json`, JSON.stringify(payload, null, 2));
  toast(t('backupDownloaded'), 'download');
}

async function importData(file) {
  if (!file) return;
  try {
    if (file.size > LIMITS.backupBytes) throw new Error('File too large');
    const parsed = parseData(JSON.parse(await file.text()));
    const ok = await confirmDialog({
      title: t('replaceTitle'),
      message: t(Store.mode === 'cloud' ? 'replaceMsgCloud' : 'replaceMsg', { habits: tn('nHabits', parsed.habits.length), checkins: tn('nCheckins', countLogs(parsed.logs)), goals: tn('nGoals', parsed.goals.length) }),
      confirmText: t('replaceBtn'),
    });
    if (!ok) return;
    Store.replaceAll(parsed);
    toast(t('backupImported'), 'upload');
  } catch (err) {
    console.error(err);
    toast(err.message === 'File too large' ? t('fileTooLarge') : t('invalidBackup'), 'alert');
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
      'auth/invalid-credential': 'errWrongCredentials',
      'auth/invalid-login-credentials': 'errWrongCredentials',
      'auth/wrong-password': 'errWrongCredentials',
      'auth/user-not-found': 'errWrongCredentials',
      'auth/email-already-in-use': 'errEmailInUse',
      'auth/account-exists-with-different-credential': 'errOtherMethod',
      'auth/weak-password': 'errWeakPassword',
      'auth/invalid-email': 'enterValidEmail',
      'auth/too-many-requests': 'errTooMany',
      'auth/user-disabled': 'errDisabled',
      'auth/network-request-failed': 'errNetwork',
      'auth/unauthorized-domain': 'errDomain',
      'auth/operation-not-allowed': 'errMethodOff',
      'auth/operation-not-supported-in-this-environment': 'errFileProtocol',
      'auth/requires-recent-login': 'errRecentLogin',
      'auth/popup-closed-by-user': '',
      'auth/cancelled-popup-request': '',
      'auth/user-cancelled': '',
    };
    if (code in map) return map[code] ? t(map[code]) : '';
    if (!navigator.onLine) return t('errNetwork');
    return t('errGeneric');
  },
};

function setAuthTab(tab) {
  Auth.tab = tab;
  const signup = tab === 'signup';
  $$('#authTabs button').forEach((b) => b.classList.toggle('active', b.dataset.authTab === tab));
  $('#authTitle').textContent = signup ? t('authCreateTitle') : t('authWelcome');
  $('#authLead').textContent = signup ? t('authLeadSignup') : t('authLeadSignin');
  $('#authNameField').hidden = !signup;
  $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
  $('#authSubmit').textContent = signup ? t('createAccount') : t('signIn');
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
  if (!EMAIL_RE.test(email)) return setMsg('#authMsg', t('enterValidEmail'));
  if (password.length < (signup ? 8 : 1)) return setMsg('#authMsg', signup ? t('passwordMin') : t('enterPassword'));
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
  if (!EMAIL_RE.test(email)) return setMsg('#resetMsg', t('enterValidEmail'));
  const btn = $('#resetForm [type="submit"]');
  setLoading(btn, true);
  try {
    await Cloud.auth.sendPasswordResetEmail(email);
    setMsg('#resetMsg', t('resetSent'), true);
  } catch (err) {
    setMsg('#resetMsg', err?.code === 'auth/user-not-found' ? t('resetSent') : Auth.friendlyError(err));
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
    if (status === 'corrupt') toast(t('corruptCloud'), 'alert');
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
  if (status === 'corrupt') toast(t('corruptLocal'), 'alert');
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
    title: t('mergeTitle'),
    message: t('mergeMsg', { habits: tn('nHabits', data.habits.length), goals: tn('nGoals', data.goals.length) }),
    confirmText: t('addToAccount'), cancelText: t('notNow'), tone: 'neutral',
  });
  if (!ok) return;
  Store.mergeIn(data);
  LocalDB.remove(NS_PREFIX + 'guest');
  toast(t('merged'), 'cloud');
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
    title: t('v1Title'),
    message: t('v1Msg', { habits: tn('nHabits', data.habits.length), checkins: tn('nCheckins', countLogs(data.logs)) }),
    confirmText: t('import'), cancelText: t('dontImport'), tone: 'neutral',
  });
  Prefs.set({ v1Handled: true });
  if (!ok) return;
  Store.mergeIn(data);
  toast(t('v1Imported'), 'upload');
}

async function signOut() {
  if (!Cloud.auth) return;
  if (Store.pendingCount()) await Sync.run();
  const pending = Store.pendingCount();
  const ok = await confirmDialog({
    title: t('signOutTitle'),
    message: pending ? t('signOutPending', { changes: tn('nChanges', pending) }) : t('signOutSafe'),
    confirmText: t('signOut'), tone: pending ? 'danger' : 'neutral',
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
  if (!user) { toast(t('signInAgainToManage'), 'alert'); return; }
  if (!navigator.onLine) { toast(t('needOnlineDelete'), 'alert'); return; }
  // Firebase only deletes accounts that signed in recently; check first so we never delete data but keep the account
  const lastSignIn = Date.parse(user.metadata?.lastSignInTime || 0);
  if (Date.now() - lastSignIn > 4 * 60 * 1000) {
    const again = await confirmDialog({
      title: t('reauthTitle'),
      message: t('reauthMsg'),
      confirmText: t('signOutNow'), tone: 'neutral',
    });
    if (again) { Sync.stop(); finishSignOut(true); await Cloud.auth.signOut().catch(() => {}); }
    return;
  }
  const ok = await confirmDialog({
    title: t('deleteAccountTitle'),
    message: t('deleteAccountMsg'),
    confirmText: t('deleteAccount'),
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
  toast(t('accountDeleted'), 'trash');
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

/* ---------- Record dialog: actual amount for a measured habit on one day ---------- */
const recordForm = { habitId: null, date: null, target: 1 };

/** Quick-pick amounts around the target (e.g. 5–9 h for an 8 h goal). */
function recordChipValues(h, target) {
  const whole = h.tracking === 'count';
  const vals = h.unit === 'h' && target >= 4
    ? [target - 3, target - 2, target - 1, target, target + 1]
    : [0.25, 0.5, 0.75, 1, 1.25].map((f) => target * f);
  return [...new Set(vals.map((v) => (whole ? Math.round(v) : Math.round(v * 100) / 100)).filter((v) => v > 0))];
}

function openRecordModal(id, dateKey) {
  const h = Store.getHabit(id);
  if (!h || !isMeasured(h) || !isDateKey(dateKey) || dateKey > todayKey()) return;
  const entry = Store.getEntry(dateKey, id);
  const hasValue = entry && typeof entry === 'object';
  recordForm.habitId = id;
  recordForm.date = dateKey;
  recordForm.target = hasValue ? entry.t : h.target; // a past day keeps the target it was measured against
  const f = $('#recordForm');
  clearErrors(f);
  $('#recordTitle').textContent = h.name;
  $('#recordDate').textContent = fmtLong(fromKey(dateKey));
  $('#recordTarget').textContent = fmtAmount(recordForm.target, h.unit);
  $('#recordUnit').textContent = unitLabel(h.unit);
  $('#recordValue').value = hasValue ? fmtValue(entry.v) : '';
  $('#recordValue').setAttribute('aria-label', t('actualFor', { name: h.name }));
  $('#recordChips').innerHTML = recordChipValues(h, recordForm.target)
    .map((v) => `<button type="button" class="chip" data-chip="${v}">${escapeHtml(fmtAmount(v, h.unit))}</button>`).join('');
  $('#recordClear').hidden = entry === null;
  updateRecordPreview();
  $('#recordModal').showModal();
  if (!matchMedia('(max-width: 760px)').matches) { $('#recordValue').focus(); $('#recordValue').select(); }
}

function updateRecordPreview() {
  const h = Store.getHabit(recordForm.habitId);
  if (!h) return;
  const v = num($('#recordValue').value, 0, MAX_VALUE, null);
  const ev = v === null ? null : evaluate(h, { v, t: recordForm.target });
  $('#recordBar').className = `bar ${ev ? `lv${ev.level}` : ''}`;
  $('#recordBar').firstElementChild.style.width = `${ev ? ev.bar : 0}%`;
  $('#recordPct').textContent = ev ? `${ev.pct}%` : '—';
  $('#recordLevel').className = `level ${ev ? `lv${ev.level}` : ''}`;
  $('#recordLevel').textContent = ev ? ev.label : t('notRecorded');
  $$('#recordChips .chip').forEach((c) => c.classList.toggle('active', v !== null && Number(c.dataset.chip) === v));
}

function submitRecordForm(e) {
  e.preventDefault();
  const input = $('#recordValue');
  const v = num(input.value, 0, MAX_VALUE, null);
  const err = $('[data-error-for="recordValue"]');
  if (v === null || Number(input.value) < 0) { err.textContent = t('errActual'); input.classList.add('invalid'); return; }
  $('#recordModal').close();
  recordEntry(recordForm.date, recordForm.habitId, { v, t: recordForm.target });
}

/** Change a check-in ('done' | 'skipped' | { v, t } | null), with feedback when the streak grows or the day is complete. */
function recordEntry(dateKey, habitId, entry) {
  const beforeStreak = Stats.streaks().current;
  const beforeRate = Stats.day(fromKey(dateKey)).rate;
  Store.setEntry(dateKey, habitId, entry);
  const afterStreak = Stats.streaks().current;
  const after = Stats.day(fromKey(dateKey));
  if (afterStreak > beforeStreak) {
    toast(t('streakUp', { days: tn('nDays', afterStreak) }), 'flame');
    const card = $('#streakCard');
    if (card && UI.view === 'dashboard') { card.classList.remove('pulse'); void card.offsetWidth; card.classList.add('pulse'); }
  } else if (dateKey === todayKey() && after.rate === 1 && beforeRate !== 1 && after.done > 0) {
    toast(t('allDoneToday'), 'award');
  }
}

/** Run a store mutation without the global re-render (the caller renders selectively). */
let suppressRender = false;
function quietly(fn) { suppressRender = true; try { fn(); } finally { suppressRender = false; } }

const actions = {
  'add-habit': () => openHabitModal(),
  'use-template': (el) => {
    const i = Number(el.dataset.index);
    const tp = TEMPLATES[i];
    if (tp) openHabitModal(null, { ...tp, name: t(tp.key), description: t(`${tp.key}Desc`), color: HABIT_COLORS[i % HABIT_COLORS.length] });
  },
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
    const h = Store.getHabit(id);
    if (!h) return;
    // Measured habits: the tick means "reached today's target"
    const next = Store.getStatus(tk, id) === 'done' ? null : isMeasured(h) ? { v: h.target, t: h.target } : 'done';
    quietly(() => recordEntry(tk, id, next));
    if (UI.todayFilter === 'all') patchTodayItem(id, Boolean(next));
    else { el.classList.toggle('checked', Boolean(next)); if (next) el.classList.add('pop'); setTimeout(renderToday, 350); } // let the tick play before the row filters out
    renderDashboard({ skipToday: true });
  },
  'skip-today': (el) => {
    const id = el.dataset.id;
    const tk = todayKey();
    const next = Store.getStatus(tk, id) === 'skipped' ? null : 'skipped';
    quietly(() => recordEntry(tk, id, next));
    renderDashboard();
    if (next) toast(t('skippedToast'), 'skip');
  },
  cycle: (el) => {
    const { id, date } = el.dataset;
    const cur = Store.getStatus(date, id);
    const next = cur === null ? 'done' : cur === 'done' ? 'skipped' : null;
    quietly(() => recordEntry(date, id, next));
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
  'day-toggle': (el) => recordEntry(UI.calSelected, el.dataset.id, Store.getStatus(UI.calSelected, el.dataset.id) === 'done' ? null : 'done'),
  'day-skip': (el) => recordEntry(UI.calSelected, el.dataset.id, Store.getStatus(UI.calSelected, el.dataset.id) === 'skipped' ? null : 'skipped'),
  record: (el) => openRecordModal(el.dataset.id, el.dataset.date),

  export: exportData,
  'clear-all': async () => {
    const ok = await confirmDialog({
      title: t('clearAllTitle'),
      message: t(Store.mode === 'cloud' ? 'clearAllMsgCloud' : 'clearAllMsgLocal'),
      confirmText: t('deleteEverything'),
    });
    if (!ok) return;
    Store.replaceAll(emptyData(Store.profile));
    toast(t('allDeleted'), 'trash');
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
    if (!navigator.onLine) { toast(t('offlineToast'), 'cloud'); return; }
    Sync.schedule(0);
  },
  'sign-out': signOut,
  'delete-account': deleteAccount,
  'show-auth': () => { Auth.tab = 'signin'; showAuth(); },
  'use-guest': () => enterGuest(),
  'google-sign-in': (el) => signInWithGoogle(el),
  'toggle-lang': () => setLanguage(Lang.current === 'th' ? 'en' : 'th'),
  'show-reset': () => { $('#authMain').hidden = true; $('#authReset').hidden = false; $('#resetEmail').value = $('#authEmail').value; setMsg('#resetMsg', ''); },
  'show-signin': () => { $('#authReset').hidden = true; $('#authMain').hidden = false; },
  'toggle-password': (el) => {
    const input = $('#authPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.setAttribute('aria-label', show ? t('hidePassword') : t('showPassword'));
    el.dataset.i18nAria = show ? 'hidePassword' : 'showPassword';
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
    // Today's list: actual amount typed straight into the row
    if (el.matches('[data-amount]')) {
      const h = Store.getHabit(el.dataset.id);
      if (!h) return;
      const raw = el.value.trim();
      const v = raw === '' ? null : num(raw, 0, MAX_VALUE, null);
      if (raw !== '' && (v === null || Number(raw) < 0)) { el.value = ''; return; }
      const entry = v === null ? null : { v, t: h.target };
      quietly(() => recordEntry(el.dataset.date, h.id, entry));
      if (UI.todayFilter === 'all') patchTodayItem(h.id, entryStatus(entry) === 'done'); else setTimeout(renderToday, 350);
      renderDashboard({ skipToday: true });
      return;
    }
    if (el.matches('[data-action="toggle-active"]')) {
      Store.updateHabit(el.dataset.id, { active: el.checked });
      toast(el.checked ? t('habitResumed') : t('habitPaused'), el.checked ? 'refresh' : 'clock');
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

  // Tracking type + unit
  $('#trackingChoice').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tracking]'); if (!b) return;
    if (habitForm.tracking !== b.dataset.tracking) { habitForm.tracking = b.dataset.tracking; hf.elements.dailyTarget.value = ''; syncTrackingFields(''); }
    clearErrors($('#targetFields'));
  });
  $('#habitUnit').addEventListener('change', () => { const other = $('#habitUnit').value === UNIT_OTHER; $('#habitUnitCustom').hidden = !other; if (other) $('#habitUnitCustom').focus(); });

  // Record dialog (actual amount for a day)
  $('#recordForm').addEventListener('submit', submitRecordForm);
  $('#recordValue').addEventListener('input', () => { $('#recordValue').classList.remove('invalid'); $('[data-error-for="recordValue"]').textContent = ''; updateRecordPreview(); });
  $('#recordChips').addEventListener('click', (e) => { const c = e.target.closest('[data-chip]'); if (c) { $('#recordValue').value = c.dataset.chip; updateRecordPreview(); } });
  $('#recordClear').addEventListener('click', () => { $('#recordModal').close(); recordEntry(recordForm.date, recordForm.habitId, null); });
  $('#recordSkip').addEventListener('click', () => { $('#recordModal').close(); recordEntry(recordForm.date, recordForm.habitId, 'skipped'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('[data-amount]')) e.target.blur(); });

  // Goal modal
  $('#goalForm').addEventListener('submit', submitGoalForm);
  $('#goalModeChoice').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && !b.disabled) { goalForm.mode = b.dataset.mode; syncGoalMode(); } });
  $('#goalDeleteBtn').addEventListener('click', () => deleteGoal(goalForm.editingId));

  // Close buttons; backdrop click closes editors (not confirmations)
  $$('dialog.modal').forEach((dlg) => {
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('click', (e) => { if (e.target === dlg && ['habitModal', 'goalModal', 'recordModal'].includes(dlg.id)) dlg.close(); });
  });

  // Settings
  $('#profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#profileName');
    const name = str(input.value, 40);
    input.classList.toggle('invalid', !name);
    if (!name) return;
    Store.updateProfile({ name });
    toast(t('profileSaved'));
  });
  $('#prefsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    Store.updateProfile({ weekStart: Number($('#weekStart').value), streakThreshold: Number($('#streakThreshold').value) });
    toast(t('prefsSaved'));
  });
  $('#themeChoice').addEventListener('click', (e) => { const b = e.target.closest('[data-theme-choice]'); if (b) setTheme(b.dataset.themeChoice); });
  $('#langChoice').addEventListener('click', (e) => { const b = e.target.closest('[data-lang-choice]'); if (b) setLanguage(b.dataset.langChoice); });
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
    if (e.key === PREFS_KEY) { Prefs.load(); applyTheme(Prefs.data.theme); if (Prefs.data.lang && Prefs.data.lang !== Lang.current) setLanguage(Prefs.data.lang, { save: false }); destroyCharts(); if (Store.ns) renderView(); return; }
    if (!Store.ns || e.key !== NS_PREFIX + Store.ns) return;
    if (e.newValue === null) return; // signed out elsewhere — auth events handle it
    Store.open(Store.ns, Store.mode, Store.userId);
    renderHeader(); renderView(); renderSyncStatus();
  });
}

/* ---------- Language switching ---------- */
function detectLanguage() {
  return (navigator.language || '').toLowerCase().startsWith('th') ? 'th' : 'en';
}

/** Fill every [data-i18n*] element in the static HTML. */
function applyStaticText() {
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); }); // trusted strings from i18n.js only
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $$('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  $$('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}

function setLanguage(lang, { save = true, render = true } = {}) {
  Lang.current = LANGS.includes(lang) ? lang : 'en';
  document.documentElement.lang = Lang.current;
  if (save) Prefs.set({ lang: Lang.current });
  applyStaticText();
  $('#authLang').textContent = Lang.current === 'th' ? 'English' : 'ไทย';
  $('#authLang').setAttribute('lang', Lang.current === 'th' ? 'en' : 'th');
  $$('[data-lang-choice]').forEach((b) => {
    const on = b.dataset.langChoice === Lang.current;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  if (!render) return;
  applyTheme(Prefs.data.theme); // theme labels
  if (!$('#auth').hidden) setAuthTab(Auth.tab);
  if ($('#habitModal').open) { $('#habitModalTitle').textContent = habitForm.editingId ? t('editHabit') : t('newHabit'); $('#habitSubmit').textContent = habitForm.editingId ? t('saveChanges') : t('createHabit'); renderHabitPickers(); syncTrackingFields(); }
  if ($('#recordModal').open) openRecordModal(recordForm.habitId, recordForm.date);
  if ($('#goalModal').open) { $('#goalModalTitle').textContent = goalForm.editingId ? t('editGoal') : t('newGoal'); $('#goalSubmit').textContent = goalForm.editingId ? t('saveChanges') : t('createGoal'); }
  destroyCharts();
  if (Store.ns && !$('#app').hidden) { renderHeader(); renderView(); renderSyncStatus(); }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js')
    // Ask for a newer version on every visit (one small request), so updates arrive promptly
    .then((reg) => reg.update())
    .catch((err) => console.warn('Service worker not registered', err));
}

async function boot() {
  hydrateIcons();
  Prefs.load();
  setLanguage(Prefs.data.lang || detectLanguage(), { save: false, render: false });
  applyTheme(Prefs.data.theme);
  initGrids();
  // Sparks on every click, in the theme's colour (clickspark.js)
  if (typeof createClickSpark === 'function') createClickSpark({ sparkColor: () => cssVar('--spark') || '#fff', sparkSize: 10, sparkRadius: 15, sparkCount: 8, duration: 400 });
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
    document.body.insertAdjacentHTML('afterbegin', `<div class="banner" style="margin:16px">${escapeHtml(t('couldntStart'))}</div>`);
  });
});
