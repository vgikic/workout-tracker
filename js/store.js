// State persistence (localStorage) and merging of two copies of the data.
// Every record carries updatedAt (ms epoch); merge keeps the newer copy per id.
// Deletions are tombstones ({deleted:true}) so they survive a merge.
import { DEFAULT_TEMPLATES } from './templates.js';

const KEY = 'wt.data.v1';
const LOCAL_KEY = 'wt.local.v1'; // device-only settings (token, theme)

export function emptyData() {
  return {
    version: 1,
    templates: DEFAULT_TEMPLATES.map(t => ({ ...t, updatedAt: 1, exercises: t.exercises.map(e => ({ ...e })) })),
    sessions: [],
    weights: [],
  };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { console.warn('loadData failed', e); }
  return emptyData();
}

export function saveData(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { return {}; }
}
export function saveLocal(obj) { localStorage.setItem(LOCAL_KEY, JSON.stringify(obj)); }

// One-off upgrades of stored templates when the built-in defaults change.
// Only touches templates the user has not renamed (still called "Workout N").
export function migrateTemplates(data) {
  let changed = false;
  for (const def of DEFAULT_TEMPLATES) {
    const t = data.templates.find(x => x.id === def.id && !x.deleted);
    if (!t || !/^Workout \d+$/.test(t.name || '')) continue;
    t.name = def.name; t.subtitle = def.subtitle;
    if (def.id === 'w6') t.exercises = def.exercises.map(e => ({ ...e })); // Pull B was redefined
    t.updatedAt = Date.now(); changed = true;
  }
  return changed;
}

export function normalize(d) {
  const base = emptyData();
  const out = { version: 1, templates: [], sessions: [], weights: [] };
  out.templates = Array.isArray(d.templates) && d.templates.length ? d.templates : base.templates;
  out.sessions = Array.isArray(d.sessions) ? d.sessions : [];
  out.weights = Array.isArray(d.weights) ? d.weights : [];
  return out;
}

function mergeList(a, b, keyFn) {
  const map = new Map();
  for (const item of [...a, ...b]) {
    const k = keyFn(item);
    const cur = map.get(k);
    if (!cur || (item.updatedAt || 0) > (cur.updatedAt || 0)) map.set(k, item);
  }
  return [...map.values()];
}

export function mergeData(local, remote) {
  local = normalize(local); remote = normalize(remote);
  return {
    version: 1,
    templates: mergeList(local.templates, remote.templates, t => t.id),
    sessions: mergeList(local.sessions, remote.sessions, s => s.id),
    weights: mergeList(local.weights, remote.weights, w => w.date),
  };
}

// Convenience accessors that hide tombstones
export function liveSessions(data) { return data.sessions.filter(s => !s.deleted); }
export function liveWeights(data) { return data.weights.filter(w => !w.deleted).sort((a, b) => a.date < b.date ? -1 : 1); }
export function liveTemplates(data) { return data.templates.filter(t => !t.deleted); }

export function stableStringify(data) {
  // deterministic ordering so git diffs stay readable
  const d = normalize(data);
  d.sessions = [...d.sessions].sort((a, b) => (a.date + a.id) < (b.date + b.id) ? -1 : 1);
  d.weights = [...d.weights].sort((a, b) => a.date < b.date ? -1 : 1);
  return JSON.stringify(d, null, 2);
}
