// Calculations for progression and bodyweight statistics.
import { liveSessions, liveWeights } from './store.js';
import { addDays, addMonths, todayStr, daysBetween, linreg, mean, median, sumArr } from './util.js';

export const PERIODS = [
  { id: '7d', label: '7 days', from: t => addDays(t, -6) },
  { id: '14d', label: '14 days', from: t => addDays(t, -13) },
  { id: '30d', label: '30 days', from: t => addDays(t, -29) },
  { id: '3m', label: '3 months', from: t => addMonths(t, -3) },
  { id: '6m', label: '6 months', from: t => addMonths(t, -6) },
  { id: '1y', label: '1 year', from: t => addMonths(t, -12) },
  { id: 'all', label: 'All', from: () => '0000-00-00' },
];

export function periodRange(id, today = todayStr()) {
  const p = PERIODS.find(x => x.id === id) || PERIODS[PERIODS.length - 1];
  return { from: p.from(today), to: today };
}

// ---------- Sets ----------
export function setVolume(set) {
  const kg = Number(set.kg) || 0;
  const reps = (Number(set.reps) || 0) + sumArr(set.myo || []);
  return kg * reps;
}
export function setTotalReps(set) { return (Number(set.reps) || 0) + sumArr(set.myo || []); }
export function setE1RM(set) {
  const kg = Number(set.kg), reps = Number(set.reps);
  if (!kg || !reps) return 0;
  if (reps === 1) return kg;
  return kg * (1 + reps / 30); // Epley
}
export function setDone(set) { return Number(set.kg) > 0 && Number(set.reps) > 0; }

// Compare a set with the same set of the previous session. Returns 1 better, 0 same, -1 worse, null no data.
export function compareSet(cur, prev) {
  if (!prev || !setDone(prev)) return null;
  if (!setDone(cur)) return null;
  const ck = Number(cur.kg), pk = Number(prev.kg), cr = Number(cur.reps), pr = Number(prev.reps);
  if (ck !== pk) return ck > pk ? 1 : -1;
  if (cr !== pr) return cr > pr ? 1 : -1;
  const cm = cur.myo || [], pm = prev.myo || [];
  if (cm.length || pm.length) {
    // same weight and activation reps: matched in fewer mini-sets is better
    if (cm.length !== pm.length) return cm.length < pm.length ? 1 : -1;
  }
  return 0;
}

// ---------- Exercise within a session ----------
export function exerciseSummary(ex) {
  const sets = (ex.sets || []).filter(setDone);
  if (!sets.length) return null;
  return {
    topKg: Math.max(...sets.map(s => Number(s.kg))),
    volume: sumArr(sets.map(setVolume)),
    reps: sumArr(sets.map(setTotalReps)),
    e1rm: Math.max(...sets.map(setE1RM)),
    sets: sets.length,
    // best set = highest e1rm
    best: sets.reduce((a, b) => setE1RM(b) > setE1RM(a) ? b : a),
  };
}

export function sessionVolume(session) {
  return sumArr(session.exercises.map(e => (exerciseSummary(e) || { volume: 0 }).volume));
}

// Compare a whole session with the previous one of the same template: counts of exercises up / same / down
export function sessionProgress(session, prev) {
  if (!prev) return null;
  let up = 0, same = 0, down = 0;
  for (const ex of session.exercises) {
    const pex = prev.exercises.find(p => p.id === ex.id || p.name === ex.name);
    const cs = exerciseSummary(ex), ps = pex && exerciseSummary(pex);
    if (!cs || !ps) continue;
    // Exercise-level: best set comparison first, then volume
    const c = compareSet(cs.best, ps.best);
    if (c === 1) up++; else if (c === -1) down++; else if (cs.volume > ps.volume) up++; else if (cs.volume < ps.volume) down++; else same++;
  }
  return { up, same, down };
}

// ---------- Sessions ----------
export function sessionsForTemplate(data, templateId, { includeInProgress = false } = {}) {
  return liveSessions(data)
    .filter(s => s.templateId === templateId && (includeInProgress || !s.inProgress))
    .sort((a, b) => (a.date + (a.startedAt || 0)) < (b.date + (b.startedAt || 0)) ? -1 : 1);
}

export function previousSession(data, session) {
  const list = sessionsForTemplate(data, session.templateId);
  const before = list.filter(s => s.id !== session.id && (s.date < session.date || (s.date === session.date && (s.startedAt || 0) < (session.startedAt || 0))));
  return before[before.length - 1] || null;
}

export function lastSessionOfTemplate(data, templateId) {
  const list = sessionsForTemplate(data, templateId);
  return list[list.length - 1] || null;
}

// History of one exercise (by id or name) within one template: [{date, session, summary}]
export function exerciseHistory(data, templateId, exerciseId, range) {
  const out = [];
  for (const s of sessionsForTemplate(data, templateId)) {
    if (range && (s.date < range.from || s.date > range.to)) continue;
    const ex = s.exercises.find(e => e.id === exerciseId);
    if (!ex) continue;
    const sum = exerciseSummary(ex);
    if (sum) out.push({ date: s.date, session: s, exercise: ex, summary: sum });
  }
  return out;
}

export function exerciseTrend(history) {
  if (history.length < 2) return null;
  const first = history[0].summary, last = history[history.length - 1].summary;
  const pct = (a, b) => a ? ((b - a) / a) * 100 : null;
  return {
    sessions: history.length,
    topKg: { from: first.topKg, to: last.topKg, pct: pct(first.topKg, last.topKg) },
    volume: { from: first.volume, to: last.volume, pct: pct(first.volume, last.volume) },
    e1rm: { from: first.e1rm, to: last.e1rm, pct: pct(first.e1rm, last.e1rm) },
    bestTopKg: Math.max(...history.map(h => h.summary.topKg)),
    bestE1rm: Math.max(...history.map(h => h.summary.e1rm)),
    bestVolume: Math.max(...history.map(h => h.summary.volume)),
  };
}

// Volume of every finished session in range, for the per-workout chart
export function templateVolumeHistory(data, templateId, range) {
  return sessionsForTemplate(data, templateId)
    .filter(s => !range || (s.date >= range.from && s.date <= range.to))
    .map(s => ({ date: s.date, volume: sessionVolume(s), session: s }));
}

// ---------- Body weight ----------
export function weightsInRange(data, from, to) {
  return liveWeights(data).filter(w => w.date >= from && w.date <= to);
}

export function weightStats(entries) {
  if (!entries.length) return null;
  const vals = entries.map(w => Number(w.kg));
  const first = entries[0], last = entries[entries.length - 1];
  const points = entries.map(w => [daysBetween(first.date, w.date), Number(w.kg)]);
  const reg = linreg(points);
  return {
    count: entries.length,
    mean: mean(vals),
    median: median(vals),
    min: Math.min(...vals),
    max: Math.max(...vals),
    first: Number(first.kg), firstDate: first.date,
    last: Number(last.kg), lastDate: last.date,
    change: Number(last.kg) - Number(first.kg),
    days: daysBetween(first.date, last.date),
    perWeek: reg ? reg.slope * 7 : null,
    reg,
  };
}

// Rolling average of the previous N days (calendar-based, using available entries)
export function rollingAverage(entries, windowDays = 7) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const to = entries[i].date, from = addDays(to, -(windowDays - 1));
    const win = entries.filter(w => w.date >= from && w.date <= to).map(w => Number(w.kg));
    out.push({ date: to, kg: mean(win) });
  }
  return out;
}
