import { loadData, saveData, loadLocal, saveLocal, liveSessions, liveWeights, liveTemplates, mergeData, normalize, stableStringify, emptyData, migrateTemplates } from './store.js';
import { GitHubSync } from './sync.js';
import { DEFAULT_TEMPLATES, slug } from './templates.js';
import * as S from './stats.js';
import { destroyCharts, weightChart, lineChart, barChart } from './charts.js';
import { todayStr, fmtDate, fmtDateLong, uid, fmtKg, esc, h, raw, restLabel, parseMyo, parseNum, sumArr, daysBetween, addDays } from './util.js';

// ---------------------------------------------------------------- state
let data = loadData();
if (migrateTemplates(data)) saveData(data);
let local = loadLocal();
local.sync = local.sync || { owner: 'vgikic', repo: 'workout-data', path: 'data.json', branch: 'main', token: '' };
let gh = new GitHubSync(local.sync);
const ui = { weightPeriod: '30d', weightCustom: null, statsTemplate: 'w1', statsExercise: null, statsPeriod: '6m', statsMetric: 'topKg', histFilter: 'all', showAllWeights: false };

const $view = document.getElementById('view');
const $status = document.getElementById('sync-status');
const $toast = document.getElementById('toast');

function persist() { saveData(data); scheduleSync(); }
function persistLocal() { saveLocal(local); }

// ---------------------------------------------------------------- sync
let syncTimer = null, syncing = false, syncQueued = false, lastSyncError = '';
function scheduleSync(delay = 1500) {
  if (!gh.configured) { setStatus('local', 'Local only'); return; }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, delay);
}
async function doSync(message) {
  if (!gh.configured) { setStatus('local', 'Local only'); return; }
  if (!navigator.onLine) { setStatus('err', 'Offline'); return; }
  if (syncing) { syncQueued = true; return; }
  syncing = true; setStatus('busy', 'Syncing…');
  try {
    const before = stableStringify(data);
    const merged = await gh.sync(data, message || 'Update from Lift Log');
    if (stableStringify(merged) !== before) { data = merged; migrateTemplates(data); saveData(data); render(); }
    lastSyncError = '';
    setStatus('ok', 'Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    console.error(e); setStatus('err', 'Sync failed'); lastSyncError = e.message; toast(e.message, 6000);
    const m = document.getElementById('gh-msg'); if (m) m.textContent = e.message;
  } finally {
    syncing = false;
    if (syncQueued) { syncQueued = false; scheduleSync(500); }
  }
}
function setStatus(cls, text) {
  $status.className = 'sync-status ' + cls;
  $status.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>`;
}
window.addEventListener('online', () => scheduleSync(200));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });

let toastTimer;
function toast(msg, ms = 2600) {
  $toast.textContent = msg; $toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $toast.hidden = true; }, ms);
}

// ---------------------------------------------------------------- routing
const NAV = [
  { path: '#/workouts', label: 'Workouts', ico: '🏋️' },
  { path: '#/weight', label: 'Weight', ico: '⚖️' },
  { path: '#/history', label: 'History', ico: '📅' },
  { path: '#/stats', label: 'Stats', ico: '📈' },
  { path: '#/settings', label: 'Settings', ico: '⚙️' },
];
function renderNav() {
  const cur = location.hash || '#/workouts';
  const html = NAV.map(n => `<a href="${n.path}" class="${cur.startsWith(n.path) || (n.path === '#/workouts' && cur.startsWith('#/session')) || (n.path === '#/settings' && cur.startsWith('#/template')) ? 'active' : ''}"><span class="ico">${n.ico}</span><span>${n.label}</span></a>`).join('');
  document.getElementById('nav-top').innerHTML = html;
  document.getElementById('nav-bottom').innerHTML = html;
}
function go(hash) { location.hash = hash; }

function render() {
  destroyCharts();
  renderNav();
  const hash = location.hash || '#/workouts';
  const [_, route, arg] = hash.split('/');
  try {
    if (route === 'session' && arg) return viewSession(arg);
    if (route === 'weight') return viewWeight();
    if (route === 'history') return viewHistory();
    if (route === 'stats') return viewStats();
    if (route === 'settings') return viewSettings();
    if (route === 'template' && arg) return viewTemplate(arg);
    return viewWorkouts();
  } catch (e) {
    console.error(e);
    $view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted small mt">${esc(e.message)}</p><button class="btn mt" onclick="location.hash='#/workouts';location.reload()">Reload</button></div>`;
  }
}
window.addEventListener('hashchange', () => {
  if (editingSessionId && location.hash !== '#/session/' + editingSessionId) { editingSessionId = null; editSnapshot = null; } // leaving the page keeps whatever was saved so far
  window.scrollTo(0, 0); render();
});

// ---------------------------------------------------------------- helpers
function tmpl(id) { return liveTemplates(data).find(t => t.id === id); }
function session(id) { return data.sessions.find(s => s.id === id && !s.deleted); }
function agoLabel(dateStr) {
  const d = daysBetween(dateStr, todayStr());
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}
function setLabel(set) {
  if (!S.setDone(set)) return '–';
  let s = `${fmtKg(Number(set.kg))}×${set.reps}`;
  if (set.myo && set.myo.length) s += ' +' + set.myo.join('+');
  return s;
}
function progHtml(p) {
  if (!p) return '<span class="muted tiny">first</span>';
  return `<span class="prog"><span class="u">▲${p.up}</span><span class="s">=${p.same}</span><span class="d">▼${p.down}</span></span>`;
}
function nextTemplateId() {
  const finished = liveSessions(data).filter(s => !s.inProgress).sort((a, b) => (a.date + (a.startedAt || 0)) < (b.date + (b.startedAt || 0)) ? 1 : -1);
  const tl = liveTemplates(data);
  if (!finished.length || !tl.length) return tl[0]?.id;
  const idx = tl.findIndex(t => t.id === finished[0].templateId);
  return tl[(idx + 1) % tl.length]?.id;
}
function periodChips(active, onId, extra = '') {
  return `<div class="chips scroll mb" data-chips="${onId}">${S.PERIODS.map(p => `<button class="chip ${p.id === active ? 'active' : ''}" data-period="${p.id}">${p.label}</button>`).join('')}${extra}</div>`;
}

// ---------------------------------------------------------------- Workouts (home)
function viewWorkouts() {
  const tl = liveTemplates(data);
  const inProgress = liveSessions(data).filter(s => s.inProgress).sort((a, b) => a.date < b.date ? 1 : -1);
  const nextId = nextTemplateId();
  let html = '';
  if (inProgress.length) {
    html += `<div class="section-title"><h2>In progress</h2></div>`;
    for (const s of inProgress) {
      const t = tmpl(s.templateId);
      html += `<div class="card clickable" data-go="#/session/${s.id}"><div class="row between"><div><div class="ex-title">${esc(t ? t.name : s.templateId)}</div><div class="muted small">${fmtDateLong(s.date)} · ${agoLabel(s.date)}</div></div><span class="badge accent">Continue</span></div></div>`;
    }
  }
  html += `<div class="section-title"><h2>Workouts</h2><span class="muted small">tap to start</span></div>`;
  tl.forEach((t, idx) => {
    const last = S.lastSessionOfTemplate(data, t.id);
    const count = S.sessionsForTemplate(data, t.id).length;
    html += `<div class="card clickable wk-card ${t.id === nextId ? 'next' : ''}" data-start="${t.id}">
      <div class="wk-num">${idx + 1}</div>
      <div class="grow"><div class="row between"><div class="ex-title">${esc(t.name)}</div>${t.id === nextId ? '<span class="badge accent">Next</span>' : ''}</div>
        <div class="muted small">${esc(t.subtitle || '')}</div>
        <div class="muted tiny mt" style="margin-top:4px">${t.exercises.length} exercises · ${last ? `last ${fmtDate(last.date)} (${agoLabel(last.date)})` : 'never done'} · ${count} sessions</div></div>
    </div>`;
  });
  const w = liveWeights(data); const lastW = w[w.length - 1];
  html += `<div class="section-title"><h2>Body weight</h2><a href="#/weight" class="small">details</a></div>
    <div class="card"><div class="row between"><div><div class="ex-title">${lastW ? fmtKg(Number(lastW.kg)) + ' kg' : 'No entries yet'}</div><div class="muted small">${lastW ? (lastW.date === todayStr() ? 'today' : 'last entry ' + fmtDate(lastW.date)) : 'log your morning weight'}</div></div>
    ${lastW && lastW.date === todayStr() ? '' : `<a href="#/weight" class="btn small">Log today</a>`}</div></div>`;
  $view.innerHTML = html;
  $view.querySelectorAll('[data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
  $view.querySelectorAll('[data-start]').forEach(el => el.onclick = () => startSession(el.dataset.start));
}

function startSession(templateId) {
  const t = tmpl(templateId);
  if (!t) return;
  const existing = liveSessions(data).find(s => s.inProgress && s.templateId === templateId);
  if (existing && !confirm(`${t.name} already has an unfinished session from ${fmtDate(existing.date)}. Start a new one anyway?`)) { go('#/session/' + existing.id); return; }
  const s = {
    id: uid(), templateId, date: todayStr(), startedAt: Date.now(), inProgress: true, notes: '',
    exercises: t.exercises.map(e => ({ id: e.id, name: e.name, rest: e.rest, myoLast: !!e.myoLast, supersetWithPrev: !!e.supersetWithPrev, sets: Array.from({ length: e.sets }, (_, si) => ({ kg: '', reps: '', myo: [], isMyo: !!e.myoLast && si === e.sets - 1 })) })),
    updatedAt: Date.now(),
  };
  data.sessions.push(s); persist();
  go('#/session/' + s.id);
}

// ---------------------------------------------------------------- Session logging
let editingSessionId = null, editSnapshot = null;

// Finished workouts open read-only; Edit switches to the same form used while training.
function viewSessionReadOnly(s) {
  const t = tmpl(s.templateId);
  const prev = S.previousSession(data, s);
  const prevEx = ex => prev && prev.exercises.find(p => p.id === ex.id || p.name === ex.name);
  const p = S.sessionProgress(s, prev);
  let html = `<div class="row between mb"><div><h1>${esc(t ? t.name : 'Workout')}</h1><div class="muted small">${fmtDateLong(s.date)}${prev ? ` · vs ${fmtDate(prev.date)}` : ' · first session'}</div></div>${progHtml(p)}</div>`;
  for (const ex of s.exercises) {
    const pex = prevEx(ex); const sum = S.exerciseSummary(ex);
    html += `<div class="card ex-card"><div class="ex-title">${esc(ex.name)}</div>
      <div class="ex-meta mb">${sum ? `top ${fmtKg(sum.topKg)} kg · vol ${Math.round(sum.volume)} · e1RM ${fmtKg(sum.e1rm, 0)}` : 'no sets logged'}</div>`;
    if (sum) {
      html += `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Set</th><th>Done</th><th>Last time</th><th></th></tr></thead><tbody>`;
      ex.sets.forEach((set, si) => {
        if (!S.setDone(set)) return;
        const pset = pex && pex.sets[si]; const cm = cmpMarkup(set, pset);
        html += `<tr><td class="muted">${si + 1}${isMyoSet(ex, set, si) ? ' <span class="badge">myo</span>' : ''}</td><td class="mono">${esc(setLabel(set))}</td><td class="mono muted">${pset ? esc(setLabel(pset)) : '–'}</td><td class="${cm.cls}">${cm.txt}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }
    html += `</div>`;
  }
  if (s.notes) html += `<div class="card"><div class="ex-meta">Notes</div><p style="white-space:pre-wrap">${esc(s.notes)}</p></div>`;
  html += `<div class="sticky-actions"><a class="btn" href="#/history">← History</a><button class="btn primary grow" id="s-edit">Edit</button></div>`;
  $view.innerHTML = html;
  $view.querySelector('#s-edit').onclick = () => { editingSessionId = s.id; editSnapshot = JSON.stringify({ date: s.date, notes: s.notes, exercises: s.exercises }); render(); };
}

function viewSession(id) {
  const s = session(id);
  if (!s) { $view.innerHTML = '<div class="empty">Session not found. <a href="#/workouts">Back</a></div>'; return; }
  if (!s.inProgress && editingSessionId !== s.id) return viewSessionReadOnly(s);
  const editing = !s.inProgress; // editing a finished workout (vs. logging a live one)
  const t = tmpl(s.templateId);
  const prev = S.previousSession(data, s);
  const prevEx = ex => prev && prev.exercises.find(p => p.id === ex.id || p.name === ex.name);

  let html = `<div class="row between mb"><div><h1>${esc(t ? t.name : 'Workout')}</h1><div class="muted small">${prev ? `vs ${fmtDate(prev.date)} (${agoLabel(prev.date)})` : 'first time · nothing to compare yet'}</div></div>
    <span class="badge ${s.inProgress ? 'accent' : ''}">${s.inProgress ? 'in progress' : 'editing'}</span></div>
    <div class="card"><div class="row"><label class="field grow" style="margin:0"><span>Date</span><input type="date" id="s-date" value="${s.date}" max="${todayStr()}"></label></div></div>`;

  // group exercises into superset groups
  const groups = [];
  s.exercises.forEach((ex, i) => {
    if (ex.supersetWithPrev && groups.length) groups[groups.length - 1].push(i); else groups.push([i]);
  });
  for (const g of groups) {
    const isSS = g.length > 1;
    html += `<div class="card ex-card">`;
    if (isSS) html += `<div class="ss-label mb">Superset</div>`;
    if (!isSS) html += exHeader(s.exercises[g[0]], g[0], prevEx(s.exercises[g[0]]));
    else for (const i of g) html += exHeader(s.exercises[i], i, prevEx(s.exercises[i]), true);
    html += `<div class="set-head"><span>Set</span><span>kg</span><span>Reps</span><span>Last time</span><span></span></div>`;
    const maxSets = Math.max(...g.map(i => s.exercises[i].sets.length));
    for (let si = 0; si < maxSets; si++) {
      for (const i of g) {
        const ex = s.exercises[i]; const set = ex.sets[si]; if (!set) continue;
        const pex = prevEx(ex); const pset = pex && pex.sets[si];
        html += setRow(ex, i, si, set, pset, isSS ? ex.name : null);
      }
    }
    html += `<div class="row mt" style="justify-content:flex-end;gap:6px">${g.map(i => `<button class="btn small" data-addset="${i}">+ set${isSS ? ' ' + shortName(s.exercises[i].name) : ''}</button><button class="btn small" data-rmset="${i}" ${s.exercises[i].sets.length <= 1 ? 'disabled' : ''}>− set${isSS ? ' ' + shortName(s.exercises[i].name) : ''}</button>`).join('')}</div>`;
    html += `</div>`;
  }
  html += `<div class="card"><label class="field" style="margin:0"><span>Notes</span><textarea id="s-notes" placeholder="How did it go? Pain, sleep, anything worth remembering…">${esc(s.notes || '')}</textarea></label></div>`;
  html += `<div class="sticky-actions">
      ${editing ? `<button class="btn" id="s-cancel">Cancel</button>` : ''}
      <button class="btn primary grow" id="s-finish">${s.inProgress ? 'Finish workout' : 'Save changes'}</button>
    </div>
    <div style="text-align:center;margin-top:28px"><button class="btn ghost danger small" id="s-delete">Delete this workout</button></div>`;
  $view.innerHTML = html;

  // handlers
  $view.querySelector('#s-date').onchange = e => { s.date = e.target.value || todayStr(); touch(s); render(); };
  $view.querySelector('#s-notes').oninput = e => { s.notes = e.target.value; touch(s); };
  $view.querySelector('#s-delete').onclick = () => {
    if (!confirm(`Delete this ${t ? t.name : ''} workout from ${fmtDate(s.date)}? This cannot be undone.`)) return;
    s.deleted = true; touch(s); editingSessionId = null; go('#/history'); toast('Workout deleted');
  };
  const cancel = $view.querySelector('#s-cancel');
  if (cancel) cancel.onclick = () => {
    if (editSnapshot) { Object.assign(s, JSON.parse(editSnapshot)); touch(s); }
    editingSessionId = null; editSnapshot = null; render(); toast('Changes discarded');
  };
  $view.querySelector('#s-finish').onclick = () => {
    if (s.inProgress) {
      const done = s.exercises.some(ex => ex.sets.some(S.setDone));
      if (!done && !confirm('No sets logged. Finish anyway?')) return;
      s.inProgress = false; touch(s);
      const p = S.sessionProgress(s, prev);
      toast(p ? `Finished · ▲${p.up} =${p.same} ▼${p.down} vs last time` : 'Finished · first session logged');
      doSync(`${t ? t.name : 'Workout'} ${s.date}`);
      go('#/history');
    } else {
      editingSessionId = null; editSnapshot = null;
      doSync(`Edit ${t ? t.name : 'workout'} ${s.date}`); toast('Saved'); render();
    }
  };
  $view.querySelectorAll('[data-addset]').forEach(b => b.onclick = () => { const ex = s.exercises[+b.dataset.addset]; const last = ex.sets[ex.sets.length - 1]; ex.sets.push({ kg: last ? last.kg : '', reps: '', myo: [], isMyo: false }); touch(s); render(); });
  $view.querySelectorAll('[data-mtoggle]').forEach(b => b.onclick = () => {
    const ex = s.exercises[+b.dataset.ex]; const set = ex.sets[+b.dataset.set];
    set.isMyo = !isMyoSet(ex, set, +b.dataset.set);
    if (!set.isMyo) set.myo = [];
    touch(s); render();
  });
  $view.querySelectorAll('[data-copylast]').forEach(b => b.onclick = () => {
    const ex = s.exercises[+b.dataset.copylast]; const pex = prevEx(ex);
    if (!pex) return;
    ex.sets = pex.sets.map((ps, si) => ({ kg: ps.kg, reps: ps.reps, myo: [...(ps.myo || [])], isMyo: isMyoSet(pex, ps, si) }));
    touch(s); render(); toast(`Copied last ${ex.name} · adjust and beat it`);
  });
  $view.querySelectorAll('[data-rmset]').forEach(b => b.onclick = () => { const ex = s.exercises[+b.dataset.rmset]; if (ex.sets.length > 1) { ex.sets.pop(); touch(s); render(); } });
  $view.querySelectorAll('input[data-ex]').forEach(inp => {
    inp.oninput = () => {
      const ex = s.exercises[+inp.dataset.ex]; const set = ex.sets[+inp.dataset.set];
      const f = inp.dataset.field;
      if (f === 'myo') set.myo = parseMyo(inp.value);
      else set[f] = parseNum(inp.value);
      if (f === 'kg') {
        // same weight for every set of an exercise: propagate to sets that are empty or still hold the old value
        const old = inp.dataset.prev ?? '';
        ex.sets.forEach((other, j) => {
          if (j === +inp.dataset.set) return;
          if (parseNum(other.kg) === '' || parseNum(other.kg) === parseNum(old)) {
            other.kg = set.kg;
            const oi = $view.querySelector(`input[data-ex="${inp.dataset.ex}"][data-set="${j}"][data-field="kg"]`);
            if (oi) { oi.value = set.kg; oi.dataset.prev = inp.value; const pj = pexSets(ex)[j]; const c2 = $view.querySelector(`.cmp[data-ex="${inp.dataset.ex}"][data-set="${j}"]`); if (c2) { const r2 = cmpMarkup(other, pj); c2.className = r2.cls; c2.textContent = r2.txt; } }
          }
        });
        inp.dataset.prev = inp.value;
      }
      touch(s);
      // live update of compare marker and myo summary without re-render (keeps keyboard focus)
      const pex = prevEx(ex); const pset = pex && pex.sets[+inp.dataset.set];
      const cmp = $view.querySelector(`.cmp[data-ex="${inp.dataset.ex}"][data-set="${inp.dataset.set}"]`);
      if (cmp) { const r = cmpMarkup(set, pset); cmp.className = r.cls; cmp.textContent = r.txt; }
      const sub = $view.querySelector(`.myo-sub[data-ex="${inp.dataset.ex}"][data-set="${inp.dataset.set}"]`);
      if (sub) sub.textContent = myoSummary(set, pset);
    };
    // pressing enter / next moves to next input
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const all = [...$view.querySelectorAll('input[data-ex]')]; const n = all[all.indexOf(inp) + 1]; if (n) n.focus(); else inp.blur(); } };
  });

  function touch(sess) { sess.updatedAt = Date.now(); persist(); }
  function pexSets(ex) { const p = prevEx(ex); return p ? p.sets : []; }
}
// A set is a myo-rep match set if flagged on the set itself; older sessions fall back to the template's "last set" flag.
function isMyoSet(ex, set, si) {
  if (set.isMyo !== undefined) return !!set.isMyo;
  return (!!ex.myoLast && si === ex.sets.length - 1) || (set.myo && set.myo.length > 0);
}
function shortName(n) { return n.split(' ').slice(-1)[0].toLowerCase(); }
function exHeader(ex, i, pex, compact = false) {
  const psum = pex && S.exerciseSummary(pex);
  return `<div class="row between" style="margin-bottom:${compact ? 4 : 6}px"><div class="grow"><div class="ex-title">${esc(ex.name)}</div>
    <div class="ex-meta">${ex.sets.length} sets · rest ${restLabel(ex.rest)}${psum ? ` · last: top ${fmtKg(psum.topKg)} kg, vol ${Math.round(psum.volume)}` : ''}</div></div>
    ${psum ? `<button class="btn small" data-copylast="${i}" title="Fill every set with last time's numbers">⟲ Copy last</button>` : ''}</div>`;
}
function cmpMarkup(set, pset) {
  const c = S.compareSet(set, pset);
  if (c === 1) return { cls: 'cmp up', txt: '▲' };
  if (c === -1) return { cls: 'cmp down', txt: '▼' };
  if (c === 0) return { cls: 'cmp same', txt: '=' };
  return { cls: 'cmp', txt: '' };
}
function myoSummary(set, pset) {
  const m = set.myo || [];
  if (!Number(set.reps)) return 'Myo-rep match: activation reps in the Reps box, mini-set reps here (e.g. 4 4 4).';
  if (!m.length) return `Target: match ${set.reps} reps in mini-sets, ~20 s rest between.`;
  const total = sumArr(m);
  let txt = `${total}/${set.reps} matched in ${m.length} mini-set${m.length === 1 ? '' : 's'} (total ${Number(set.reps) + total} reps)`;
  if (pset && pset.myo && pset.myo.length) txt += ` · last time ${pset.myo.length} mini-sets`;
  return txt;
}
function setRow(ex, i, si, set, pset, ssName) {
  const isMyo = isMyoSet(ex, set, si);
  const cm = cmpMarkup(set, pset);
  const kgVal = set.kg === '' || set.kg == null ? '' : set.kg;
  let html = `<div class="set-row ${isMyo ? 'myo' : ''}">
    <button class="n" data-mtoggle data-ex="${i}" data-set="${si}" title="${isMyo ? 'Myo-rep match set – tap to make it a normal set' : 'Tap to make this a myo-rep match set'}">${ssName ? esc(ssName[0].toUpperCase()) : ''}${si + 1}</button>
    <input type="text" inputmode="decimal" autocomplete="off" placeholder="${pset && S.setDone(pset) ? fmtKg(Number(pset.kg)) : 'kg'}" value="${kgVal}" data-prev="${kgVal}" data-ex="${i}" data-set="${si}" data-field="kg">
    <input type="number" inputmode="numeric" step="1" min="0" placeholder="${pset && S.setDone(pset) ? pset.reps : 'reps'}" value="${set.reps === '' || set.reps == null ? '' : set.reps}" data-ex="${i}" data-set="${si}" data-field="reps">
    <span class="prev">${pset ? esc(setLabel(pset)) : '–'}</span>
    <span class="${cm.cls}" data-ex="${i}" data-set="${si}">${cm.txt}</span>
  </div>`;
  if (isMyo) {
    html += `<div class="myo-row"><span class="l">MYO</span><input type="text" inputmode="numeric" placeholder="mini-set reps, e.g. 4 4 4" value="${esc((set.myo || []).join(' '))}" data-ex="${i}" data-set="${si}" data-field="myo">
      <span class="sub myo-sub" data-ex="${i}" data-set="${si}">${esc(myoSummary(set, pset))}</span></div>`;
  }
  return html;
}

// ---------------------------------------------------------------- Weight
function viewWeight() {
  const all = liveWeights(data);
  const today = todayStr();
  const todayEntry = all.find(w => w.date === today);
  const range = ui.weightPeriod === 'custom' && ui.weightCustom ? ui.weightCustom : S.periodRange(ui.weightPeriod, today);
  const entries = S.weightsInRange(data, range.from, range.to);
  const st = S.weightStats(entries);
  const rolling = S.rollingAverage(all, 7).filter(r => r.date >= range.from && r.date <= range.to);

  let html = `<h1 class="mb">Body weight</h1>
  <div class="card"><div class="weight-entry">
    <label class="field" style="margin:0"><span>Date</span><input type="date" id="w-date" value="${today}" max="${today}"></label>
    <label class="field" style="margin:0"><span>Weight (kg)</span><input type="text" id="w-kg" inputmode="decimal" autocomplete="off" placeholder="${all.length ? fmtKg(Number(all[all.length - 1].kg)) : '80.0'}" value="${todayEntry ? todayEntry.kg : ''}"></label>
    <button class="btn primary" id="w-save">${todayEntry ? 'Update' : 'Save'}</button>
  </div></div>`;

  html += periodChips(ui.weightPeriod, 'weight', `<button class="chip ${ui.weightPeriod === 'custom' ? 'active' : ''}" data-period="custom">Custom</button>`);
  if (ui.weightPeriod === 'custom') {
    const c = ui.weightCustom || { from: addDays(today, -6), to: today };
    html += `<div class="card"><div class="row"><label class="field grow" style="margin:0"><span>From</span><input type="date" id="w-from" value="${c.from}" max="${today}"></label><label class="field grow" style="margin:0"><span>To</span><input type="date" id="w-to" value="${c.to}" max="${today}"></label></div></div>`;
  }

  if (!entries.length) {
    html += `<div class="card empty"><div class="big">⚖️</div>No entries in this period.</div>`;
  } else {
    html += `<div class="card"><div class="chart-wrap"><canvas id="w-chart"></canvas></div></div>`;
    html += `<div class="card"><div class="card-head"><h3>Statistics</h3><span class="muted small">${fmtDate(st.firstDate)} – ${fmtDate(st.lastDate)} · ${st.count} entries</span></div>
      <div class="stat-grid">
        <div class="stat"><div class="v">${fmtKg(st.mean, 2)}</div><div class="l">Average (mean)</div></div>
        <div class="stat"><div class="v">${fmtKg(st.median, 2)}</div><div class="l">Median</div></div>
        <div class="stat"><div class="v ${st.change < 0 ? 'good' : st.change > 0 ? 'bad' : ''}">${st.change > 0 ? '+' : ''}${fmtKg(st.change, 1)}</div><div class="l">Change (first → last)</div></div>
        <div class="stat"><div class="v">${st.perWeek == null ? '–' : (st.perWeek > 0 ? '+' : '') + fmtKg(st.perWeek, 2)}</div><div class="l">Trend kg / week</div></div>
        <div class="stat"><div class="v">${fmtKg(st.min)}</div><div class="l">Lowest</div></div>
        <div class="stat"><div class="v">${fmtKg(st.max)}</div><div class="l">Highest</div></div>
      </div></div>`;
  }

  // entries list
  const listSrc = [...all].reverse();
  const list = ui.showAllWeights ? listSrc : listSrc.slice(0, 10);
  html += `<div class="section-title"><h2>Entries</h2>${listSrc.length > 10 ? `<button class="btn ghost small" id="w-more">${ui.showAllWeights ? 'Show less' : `Show all (${listSrc.length})`}</button>` : ''}</div>`;
  if (!list.length) html += `<div class="card empty">Nothing logged yet.</div>`;
  else {
    html += `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th class="num">kg</th><th class="num">Δ day</th><th></th></tr></thead><tbody>`;
    for (let i = 0; i < list.length; i++) {
      const w = list[i]; const prevW = all[all.indexOf(w) - 1];
      const d = prevW ? Number(w.kg) - Number(prevW.kg) : null;
      html += `<tr><td>${fmtDate(w.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td class="num">${fmtKg(Number(w.kg))}</td><td class="num ${d == null ? 'muted' : d < 0 ? 'good' : d > 0 ? 'bad' : 'muted'}">${d == null ? '–' : (d > 0 ? '+' : '') + fmtKg(d)}</td><td class="num"><button class="btn ghost small" data-editw="${w.date}">edit</button><button class="btn ghost small danger" data-delw="${w.date}">✕</button></td></tr>`;
    }
    html += `</tbody></table></div></div>`;
  }
  $view.innerHTML = html;

  // handlers
  const save = () => {
    const date = $view.querySelector('#w-date').value; const kg = parseNum($view.querySelector('#w-kg').value);
    if (!date || !kg || kg <= 0 || kg > 400) { toast('Enter a valid weight, e.g. 82,5'); return; }
    upsertWeight(date, kg); toast(`Saved ${fmtKg(kg)} kg for ${fmtDate(date)}`); render();
  };
  $view.querySelector('#w-save').onclick = save;
  $view.querySelector('#w-kg').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  $view.querySelector('#w-date').onchange = e => { const ex = all.find(w => w.date === e.target.value); $view.querySelector('#w-kg').value = ex ? ex.kg : ''; $view.querySelector('#w-save').textContent = ex ? 'Update' : 'Save'; };
  $view.querySelectorAll('[data-chips="weight"] .chip').forEach(c => c.onclick = () => { ui.weightPeriod = c.dataset.period; if (ui.weightPeriod === 'custom' && !ui.weightCustom) ui.weightCustom = { from: addDays(today, -6), to: today }; render(); });
  const from = $view.querySelector('#w-from'), to = $view.querySelector('#w-to');
  if (from && to) { const upd = () => { ui.weightCustom = { from: from.value || '0000-00-00', to: to.value || today }; render(); }; from.onchange = upd; to.onchange = upd; }
  const more = $view.querySelector('#w-more'); if (more) more.onclick = () => { ui.showAllWeights = !ui.showAllWeights; render(); };
  $view.querySelectorAll('[data-delw]').forEach(b => b.onclick = () => { if (confirm(`Delete entry for ${fmtDate(b.dataset.delw)}?`)) { deleteWeight(b.dataset.delw); render(); } });
  $view.querySelectorAll('[data-editw]').forEach(b => b.onclick = () => { const w = all.find(x => x.date === b.dataset.editw); $view.querySelector('#w-date').value = w.date; $view.querySelector('#w-kg').value = w.kg; $view.querySelector('#w-save').textContent = 'Update'; window.scrollTo({ top: 0, behavior: 'smooth' }); $view.querySelector('#w-kg').focus(); });

  const canvas = $view.querySelector('#w-chart');
  if (canvas && st) {
    const idx = entries.map(e => daysBetween(entries[0].date, e.date));
    weightChart(canvas, entries, rolling, entries.length >= 3 ? st.reg : null, idx);
  }
}
function upsertWeight(date, kg) {
  const ex = data.weights.find(w => w.date === date);
  if (ex) { ex.kg = kg; ex.deleted = false; ex.updatedAt = Date.now(); }
  else data.weights.push({ date, kg, updatedAt: Date.now() });
  persist();
}
function deleteWeight(date) {
  const ex = data.weights.find(w => w.date === date);
  if (ex) { ex.deleted = true; ex.updatedAt = Date.now(); persist(); }
}

// ---------------------------------------------------------------- History
function viewHistory() {
  const tl = liveTemplates(data);
  let list = liveSessions(data).filter(s => !s.inProgress).sort((a, b) => (a.date + (a.startedAt || 0)) < (b.date + (b.startedAt || 0)) ? 1 : -1);
  if (ui.histFilter !== 'all') list = list.filter(s => s.templateId === ui.histFilter);
  let html = `<h1 class="mb">History</h1>
    <div class="chips scroll mb"><button class="chip ${ui.histFilter === 'all' ? 'active' : ''}" data-f="all">All</button>${tl.map(t => `<button class="chip ${ui.histFilter === t.id ? 'active' : ''}" data-f="${t.id}">${esc(t.name)}</button>`).join('')}</div>`;
  if (!list.length) html += `<div class="card empty"><div class="big">📅</div>No finished workouts yet.</div>`;
  let lastMonth = '';
  for (const s of list) {
    const month = fmtDate(s.date, { month: 'long', year: 'numeric' });
    if (month !== lastMonth) { html += `<div class="section-title"><h3 class="muted">${month}</h3></div>`; lastMonth = month; }
    const t = tmpl(s.templateId);
    const prev = S.previousSession(data, s);
    const p = S.sessionProgress(s, prev);
    const vol = S.sessionVolume(s);
    const setsDone = sumArr(s.exercises.map(e => e.sets.filter(S.setDone).length));
    html += `<div class="card clickable hist-item" data-go="#/session/${s.id}">
      <div class="d"><div class="ex-title">${fmtDate(s.date, { day: 'numeric', month: 'short' })}</div><div class="muted tiny">${fmtDate(s.date, { weekday: 'short' })}</div></div>
      <div class="grow"><div class="ex-title">${esc(t ? t.name : s.templateId)}</div><div class="muted small">${setsDone} sets · ${Math.round(vol).toLocaleString()} kg volume${s.notes ? ' · 📝' : ''}</div></div>
      <div>${progHtml(p)}</div></div>`;
  }
  $view.innerHTML = html;
  $view.querySelectorAll('[data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
  $view.querySelectorAll('[data-f]').forEach(c => c.onclick = () => { ui.histFilter = c.dataset.f; render(); });
}

// ---------------------------------------------------------------- Stats
function viewStats() {
  const tl = liveTemplates(data);
  if (!tl.find(t => t.id === ui.statsTemplate)) ui.statsTemplate = tl[0]?.id;
  const t = tmpl(ui.statsTemplate);
  const range = S.periodRange(ui.statsPeriod);
  // exercises that appear in any session of this template (so renamed/removed ones still show)
  const exMap = new Map();
  for (const e of (t ? t.exercises : [])) exMap.set(e.id, e.name);
  for (const s of S.sessionsForTemplate(data, ui.statsTemplate)) for (const e of s.exercises) if (!exMap.has(e.id)) exMap.set(e.id, e.name);
  const exList = [...exMap.entries()];
  if (!exList.find(([id]) => id === ui.statsExercise)) ui.statsExercise = exList[0]?.[0] || null;

  let html = `<h1 class="mb">Progress</h1>
    <div class="chips scroll mb">${tl.map(x => `<button class="chip ${x.id === ui.statsTemplate ? 'active' : ''}" data-t="${x.id}">${esc(x.name)}</button>`).join('')}</div>`;
  html += periodChips(ui.statsPeriod, 'stats');

  // workout-level volume
  const volHist = S.templateVolumeHistory(data, ui.statsTemplate, range);
  html += `<div class="card"><div class="card-head"><h3>${esc(t ? t.name : '')} · session volume</h3><span class="muted small">${volHist.length} sessions</span></div>`;
  if (volHist.length < 1) html += `<div class="empty small">No finished sessions in this period.</div>`;
  else {
    const first = volHist[0].volume, last = volHist[volHist.length - 1].volume;
    const pct = first ? ((last - first) / first * 100) : 0;
    html += `<div class="stat-grid mb">
      <div class="stat"><div class="v">${Math.round(last).toLocaleString()}</div><div class="l">Last session (kg)</div></div>
      <div class="stat"><div class="v ${pct > 0 ? 'good' : pct < 0 ? 'bad' : ''}">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</div><div class="l">vs first in period</div></div>
      <div class="stat"><div class="v">${Math.round(Math.max(...volHist.map(v => v.volume))).toLocaleString()}</div><div class="l">Best (kg)</div></div>
    </div><div class="chart-wrap" style="height:200px"><canvas id="vol-chart"></canvas></div>`;
  }
  html += `</div>`;

  // exercise-level
  html += `<div class="section-title"><h2>Exercise</h2></div>
    <div class="card"><select id="st-ex">${exList.map(([id, name]) => `<option value="${esc(id)}" ${id === ui.statsExercise ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
    <div class="chips mt"><button class="chip ${ui.statsMetric === 'topKg' ? 'active' : ''}" data-m="topKg">Top weight</button><button class="chip ${ui.statsMetric === 'e1rm' ? 'active' : ''}" data-m="e1rm">Est. 1RM</button><button class="chip ${ui.statsMetric === 'volume' ? 'active' : ''}" data-m="volume">Volume</button><button class="chip ${ui.statsMetric === 'reps' ? 'active' : ''}" data-m="reps">Total reps</button></div>`;
  const hist = ui.statsExercise ? S.exerciseHistory(data, ui.statsTemplate, ui.statsExercise, range) : [];
  const trend = S.exerciseTrend(hist);
  if (!hist.length) html += `<div class="empty small">No data for this exercise in the period.</div>`;
  else {
    if (trend) {
      html += `<div class="stat-grid mt">
        <div class="stat"><div class="v">${fmtKg(trend.topKg.from)} → ${fmtKg(trend.topKg.to)}</div><div class="l">Top weight (kg) ${pctBadge(trend.topKg.pct)}</div></div>
        <div class="stat"><div class="v">${fmtKg(trend.e1rm.from, 0)} → ${fmtKg(trend.e1rm.to, 0)}</div><div class="l">Est. 1RM ${pctBadge(trend.e1rm.pct)}</div></div>
        <div class="stat"><div class="v">${Math.round(trend.volume.from)} → ${Math.round(trend.volume.to)}</div><div class="l">Volume ${pctBadge(trend.volume.pct)}</div></div>
        <div class="stat"><div class="v">${fmtKg(trend.bestTopKg)} kg</div><div class="l">Best top weight</div></div>
      </div>`;
    }
    html += `<div class="chart-wrap mt"><canvas id="ex-chart"></canvas></div>`;
    html += `<div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Date</th><th>Sets</th><th class="num">Top</th><th class="num">Vol</th><th class="num">e1RM</th></tr></thead><tbody>`;
    for (let i = hist.length - 1; i >= 0; i--) {
      const hh = hist[i]; const ph = hist[i - 1];
      const c = ph ? S.compareSet(hh.summary.best, ph.summary.best) : null;
      html += `<tr><td>${fmtDate(hh.date)} ${c === 1 ? '<span class="good">▲</span>' : c === -1 ? '<span class="bad">▼</span>' : c === 0 ? '<span class="muted">=</span>' : ''}</td><td class="mono small">${esc(hh.exercise.sets.filter(S.setDone).map(setLabel).join(', '))}</td><td class="num">${fmtKg(hh.summary.topKg)}</td><td class="num">${Math.round(hh.summary.volume)}</td><td class="num">${fmtKg(hh.summary.e1rm, 0)}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }
  html += `</div>`;
  html += `<p class="muted tiny mt">Volume = Σ kg × reps (myo mini-set reps included). Est. 1RM uses the Epley formula on the best normal set. ▲/▼ compares the best set (weight, then reps, then fewer myo mini-sets) with the previous session of the same workout.</p>`;

  $view.innerHTML = html;
  $view.querySelectorAll('[data-t]').forEach(c => c.onclick = () => { ui.statsTemplate = c.dataset.t; ui.statsExercise = null; render(); });
  $view.querySelectorAll('[data-chips="stats"] .chip').forEach(c => c.onclick = () => { ui.statsPeriod = c.dataset.period; render(); });
  $view.querySelectorAll('[data-m]').forEach(c => c.onclick = () => { ui.statsMetric = c.dataset.m; render(); });
  $view.querySelector('#st-ex').onchange = e => { ui.statsExercise = e.target.value; render(); };

  const vc = $view.querySelector('#vol-chart');
  if (vc) barChart(vc, volHist.map(v => v.date), volHist.map(v => Math.round(v.volume)), 'Volume (kg)');
  const ec = $view.querySelector('#ex-chart');
  if (ec && hist.length) {
    const labels = hist.map(x => x.date);
    const m = ui.statsMetric;
    const series = m === 'topKg' ? [{ label: 'Top weight (kg)', data: hist.map(x => x.summary.topKg) }]
      : m === 'e1rm' ? [{ label: 'Est. 1RM (kg)', data: hist.map(x => Math.round(x.summary.e1rm * 10) / 10) }]
      : m === 'volume' ? [{ label: 'Volume (kg)', data: hist.map(x => Math.round(x.summary.volume)) }]
      : [{ label: 'Total reps', data: hist.map(x => x.summary.reps) }];
    lineChart(ec, labels, series, { beginAtZero: false });
  }
}
function pctBadge(p) {
  if (p == null || !isFinite(p)) return '';
  return `<span class="${p > 0 ? 'good' : p < 0 ? 'bad' : 'muted'}">${p > 0 ? '+' : ''}${p.toFixed(1)}%</span>`;
}

// ---------------------------------------------------------------- Settings
function viewSettings() {
  const tl = liveTemplates(data);
  const c = local.sync;
  let html = `<h1 class="mb">Settings</h1>
  <div class="card"><h3 class="mb">Appearance</h3>
    <div class="chips"><button class="chip ${!local.theme || local.theme === 'system' ? 'active' : ''}" data-theme="system">System</button><button class="chip ${local.theme === 'light' ? 'active' : ''}" data-theme="light">Light</button><button class="chip ${local.theme === 'dark' ? 'active' : ''}" data-theme="dark">Dark</button></div></div>

  <div class="card"><h3>Backup &amp; sync (GitHub)</h3>
    <p class="muted small mt">Your data is saved on this device instantly and pushed as <code>data.json</code> to a private GitHub repository. The token stays on this device only.</p>
    <div class="mt">
      <div class="row"><label class="field grow"><span>Owner</span><input type="text" id="gh-owner" value="${esc(c.owner)}" autocapitalize="off"></label><label class="field grow"><span>Repository</span><input type="text" id="gh-repo" value="${esc(c.repo)}" autocapitalize="off"></label></div>
      <div class="row"><label class="field grow"><span>File path</span><input type="text" id="gh-path" value="${esc(c.path)}" autocapitalize="off"></label><label class="field grow"><span>Branch</span><input type="text" id="gh-branch" value="${esc(c.branch || 'main')}" autocapitalize="off"></label></div>
      <label class="field"><span>Fine-grained personal access token (Contents: read &amp; write on that repo)</span><input type="password" id="gh-token" value="${esc(c.token || '')}" placeholder="github_pat_…" autocapitalize="off" autocomplete="off"></label>
      <div class="row wrap"><button class="btn primary" id="gh-save">Save &amp; sync now</button><button class="btn" id="gh-test">Test connection</button></div>
      <p class="small mt ${lastSyncError ? 'bad' : 'muted'}" id="gh-msg" style="white-space:pre-line">${esc(lastSyncError || (gh.configured ? 'Configured' : 'Not configured'))}</p>
    </div>
    <details class="mt"><summary class="small">How to create the token</summary><ol class="small muted" style="padding-left:18px;line-height:1.6">
      <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
      <li>Repository access: <b>Only select repositories</b> → pick <code>${esc(c.owner)}/${esc(c.repo)}</code>.</li>
      <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Nothing else.</li>
      <li>Expiration: pick the longest you're comfortable with, then paste the token above.</li></ol></details>
  </div>

  <div class="card"><div class="card-head"><h3>Workout templates</h3><button class="btn small" id="t-add">+ New</button></div>
    ${tl.map(t => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><div class="ex-title">${esc(t.name)}</div><div class="muted small">${esc(t.subtitle || '')} · ${t.exercises.length} exercises</div></div><a class="btn small" href="#/template/${t.id}">Edit</a></div>`).join('')}
    <p class="muted tiny mt">Edits apply to new sessions only. Already logged sessions keep what you did.</p>
  </div>

  <div class="card"><h3>Data</h3>
    <div class="row wrap mt"><button class="btn" id="d-export">Export JSON</button><label class="btn">Import JSON (merge)<input type="file" id="d-import" accept="application/json,.json" hidden></label></div>
    <p class="muted small mt">${liveSessions(data).filter(s => !s.inProgress).length} workouts · ${liveWeights(data).length} weight entries · ${(new Blob([stableStringify(data)]).size / 1024).toFixed(1)} kB</p>
    <hr><button class="btn danger" id="d-reset">Erase local data on this device</button>
    <p class="muted tiny mt">Only clears this device. If sync is configured the data is pulled back from GitHub on next load.</p>
  </div>

  <div class="card"><h3>Install on iPhone</h3><p class="muted small mt">Open this page in Safari → Share button → <b>Add to Home Screen</b>. It then runs full-screen and works offline in the gym; data syncs when you're back online.</p></div>
  <p class="muted tiny" style="text-align:center">Lift Log · <a href="https://github.com/${esc(c.owner)}/workout-tracker">source</a></p>`;
  $view.innerHTML = html;

  $view.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => { local.theme = b.dataset.theme; persistLocal(); applyTheme(); render(); });
  $view.querySelector('#gh-save').onclick = async () => {
    local.sync = { owner: val('#gh-owner'), repo: val('#gh-repo'), path: val('#gh-path') || 'data.json', branch: val('#gh-branch') || 'main', token: val('#gh-token') };
    persistLocal(); gh = new GitHubSync(local.sync);
    const msg = $view.querySelector('#gh-msg');
    if (!gh.configured) { msg.textContent = 'Not configured (token missing)'; setStatus('local', 'Local only'); return; }
    msg.textContent = 'Syncing…'; msg.className = 'small mt muted';
    await doSync('Sync from Lift Log settings');
    if ($status.classList.contains('ok')) { msg.textContent = 'Connected and synced ✓'; }
    else { msg.className = 'small mt bad'; msg.textContent = (lastSyncError || 'Sync failed') + '\nTap "Test connection" for details.'; }
  };
  $view.querySelector('#gh-test').onclick = async () => {
    const msg = $view.querySelector('#gh-msg');
    const cfg = { owner: val('#gh-owner'), repo: val('#gh-repo'), path: val('#gh-path') || 'data.json', branch: val('#gh-branch') || 'main', token: val('#gh-token') };
    const probe = new GitHubSync(cfg);
    if (!probe.configured) { msg.textContent = 'Fill in owner, repo and token first.'; return; }
    msg.className = 'small mt muted'; msg.textContent = 'Testing…';
    try { const r = await probe.diagnose(); msg.className = 'small mt ' + (r.ok ? 'muted' : 'bad'); msg.textContent = r.lines.join('\n'); }
    catch (e) { msg.className = 'small mt bad'; msg.textContent = 'Test failed: ' + e.message; }
  };
  $view.querySelector('#t-add').onclick = () => {
    const n = tl.length + 1;
    const t = { id: 'w' + uid(), name: `Workout ${n}`, subtitle: '', exercises: [], updatedAt: Date.now() };
    data.templates.push(t); persist(); go('#/template/' + t.id);
  };
  $view.querySelector('#d-export').onclick = () => {
    const blob = new Blob([stableStringify(data)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `liftlog-${todayStr()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $view.querySelector('#d-import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const json = JSON.parse(await f.text()); data = mergeData(data, normalize(json)); persist(); toast('Imported and merged'); render(); }
    catch (err) { toast('Import failed: ' + err.message); }
  };
  $view.querySelector('#d-reset').onclick = () => {
    if (!confirm('Erase all data on this device?')) return;
    data = emptyData(); saveData(data); toast('Local data erased'); render(); scheduleSync(300);
  };
  function val(sel) { return $view.querySelector(sel).value.trim(); }
}

function applyTheme() {
  if (local.theme === 'dark' || local.theme === 'light') document.documentElement.setAttribute('data-theme', local.theme);
  else document.documentElement.removeAttribute('data-theme');
}

// ---------------------------------------------------------------- Template editor
function viewTemplate(id) {
  const t = tmpl(id);
  if (!t) { $view.innerHTML = '<div class="empty">Template not found. <a href="#/settings">Back</a></div>'; return; }
  // work on a copy until saved
  const draft = JSON.parse(JSON.stringify(t));
  const draw = () => {
    let html = `<div class="row between mb"><h1>Edit template</h1><a class="btn small" href="#/settings">Cancel</a></div>
    <div class="card"><label class="field"><span>Name</span><input type="text" id="t-name" value="${esc(draft.name)}"></label>
    <label class="field" style="margin:0"><span>Subtitle</span><input type="text" id="t-sub" value="${esc(draft.subtitle || '')}" placeholder="e.g. Chest · Triceps"></label></div>
    <div class="card"><div class="card-head"><h3>Exercises</h3><span class="muted tiny">name · sets · rest (s)</span></div>`;
    draft.exercises.forEach((e, i) => {
      html += `<div class="tmpl-ex">
        <input type="text" data-i="${i}" data-f="name" value="${esc(e.name)}" placeholder="Exercise name">
        <input type="number" data-i="${i}" data-f="sets" value="${e.sets}" min="1" max="20" inputmode="numeric">
        <input type="number" data-i="${i}" data-f="rest" value="${e.rest}" min="0" step="30" inputmode="numeric">
        <div class="flags">
          <label><input type="checkbox" data-i="${i}" data-f="myoLast" ${e.myoLast ? 'checked' : ''}> last set myo-rep match</label>
          <label ${i === 0 ? 'hidden' : ''}><input type="checkbox" data-i="${i}" data-f="supersetWithPrev" ${e.supersetWithPrev ? 'checked' : ''}> superset with previous</label>
          <span class="grow"></span>
          <button class="btn small" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn small" data-down="${i}" ${i === draft.exercises.length - 1 ? 'disabled' : ''}>↓</button><button class="btn small danger" data-del="${i}">✕</button>
        </div></div>`;
    });
    html += `<button class="btn block mt" id="t-addex">+ Add exercise</button></div>
    <div class="sticky-actions"><button class="btn danger" id="t-delete">Delete template</button><button class="btn primary grow" id="t-save">Save template</button></div>`;
    $view.innerHTML = html;

    $view.querySelector('#t-name').oninput = e => draft.name = e.target.value;
    $view.querySelector('#t-sub').oninput = e => draft.subtitle = e.target.value;
    $view.querySelectorAll('.tmpl-ex input').forEach(inp => {
      inp.onchange = () => { const e = draft.exercises[+inp.dataset.i]; const f = inp.dataset.f;
        if (inp.type === 'checkbox') e[f] = inp.checked; else if (inp.type === 'number') e[f] = Math.max(f === 'sets' ? 1 : 0, Number(inp.value) || 0); else e[f] = inp.value; };
    });
    $view.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [draft.exercises[i - 1], draft.exercises[i]] = [draft.exercises[i], draft.exercises[i - 1]]; draw(); });
    $view.querySelectorAll('[data-down]').forEach(b => b.onclick = () => { const i = +b.dataset.down; [draft.exercises[i + 1], draft.exercises[i]] = [draft.exercises[i], draft.exercises[i + 1]]; draw(); });
    $view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { draft.exercises.splice(+b.dataset.del, 1); draw(); });
    $view.querySelector('#t-addex').onclick = () => { draft.exercises.push({ id: 'new-' + uid(), name: '', sets: 3, rest: 120, myoLast: false, supersetWithPrev: false }); draw(); setTimeout(() => { const ins = $view.querySelectorAll('.tmpl-ex input[data-f="name"]'); ins[ins.length - 1]?.focus(); }, 0); };
    $view.querySelector('#t-save').onclick = () => {
      draft.exercises = draft.exercises.filter(e => e.name.trim());
      const used = new Set();
      for (const e of draft.exercises) {
        // keep existing ids (so history stays linked); new exercises get an id from their name
        if (e.id.startsWith('new-')) e.id = slug(e.name);
        while (used.has(e.id)) e.id += '-2';
        used.add(e.id);
      }
      draft.exercises[0] && (draft.exercises[0].supersetWithPrev = false);
      Object.assign(t, draft, { updatedAt: Date.now() });
      persist(); toast('Template saved'); go('#/settings');
    };
    $view.querySelector('#t-delete').onclick = () => {
      if (!confirm(`Delete "${t.name}"? Logged sessions are kept.`)) return;
      t.deleted = true; t.updatedAt = Date.now(); persist(); go('#/settings');
    };
  };
  draw();
}

// ---------------------------------------------------------------- boot
applyTheme();
render();
if (gh.configured) doSync(); else setStatus('local', 'Local only');
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW registration failed', e)));
}
