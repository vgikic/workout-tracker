export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

export function addMonths(dateStr, n) {
  const d = parseDate(dateStr);
  d.setMonth(d.getMonth() + n);
  return todayStr(d);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

export function fmtDate(s, opts = { day: 'numeric', month: 'short' }) {
  if (!s) return '';
  return parseDate(s).toLocaleDateString(undefined, opts);
}

export function fmtDateLong(s) {
  return fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function fmtKg(n, digits = 1) {
  if (n == null || isNaN(n)) return '–';
  const r = Number(n.toFixed(digits));
  return String(r);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(strings, ...vals) {
  // tiny tagged template: values are escaped unless wrapped in raw()
  return strings.reduce((out, s, i) => {
    const v = vals[i - 1];
    const str = v && v.__raw ? v.__raw : (Array.isArray(v) ? v.map(x => x && x.__raw ? x.__raw : esc(x)).join('') : esc(v));
    return out + str + s;
  });
}
export function raw(s) { return { __raw: Array.isArray(s) ? s.map(x => x && x.__raw ? x.__raw : x).join('') : String(s) }; }

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Linear regression over (x=day index, y=value). Returns slope per day and intercept.
export function linreg(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

export function restLabel(sec) {
  if (!sec) return '';
  if (sec % 60 === 0) return `${sec / 60} min`;
  return `${sec}s`;
}

export function parseMyo(str) {
  if (!str) return [];
  return String(str).split(/[\s,;+/]+/).map(Number).filter(n => Number.isFinite(n) && n > 0);
}

export function sumArr(arr) { return arr.reduce((a, b) => a + b, 0); }
