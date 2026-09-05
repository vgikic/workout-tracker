// Thin wrapper around Chart.js (global `Chart` from vendor/chart.umd.js) with theme-aware colors.
import { fmtDate } from './util.js';

let charts = [];

export function destroyCharts() {
  for (const c of charts) { try { c.destroy(); } catch {} }
  charts = [];
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function theme() {
  return {
    text: cssVar('--text'), muted: cssVar('--muted'), grid: cssVar('--border'),
    accent: cssVar('--accent'), good: cssVar('--good'), bad: cssVar('--bad'), warn: cssVar('--warn'),
  };
}

function baseOptions(t, { yLabel = '', ySuggestedMin, ySuggestedMax, beginAtZero = false } = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, labels: { color: t.muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } } },
      tooltip: { callbacks: { title: items => items.length ? fmtDate(items[0].label, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '' } },
    },
    scales: {
      x: { ticks: { color: t.muted, maxTicksLimit: 6, maxRotation: 0, callback: (v, i, ticks) => fmtDate(ticksLabel(v, i, ticks)), font: { size: 11 } }, grid: { color: t.grid, drawTicks: false } },
      y: { ticks: { color: t.muted, font: { size: 11 } }, grid: { color: t.grid }, suggestedMin: ySuggestedMin, suggestedMax: ySuggestedMax, beginAtZero, title: yLabel ? { display: true, text: yLabel, color: t.muted, font: { size: 11 } } : undefined },
    },
  };
}
// Chart.js passes tick index; we need the label from the chart's labels array. We stash it on the scale via closure below.
let currentLabels = [];
function ticksLabel(v, i) { return currentLabels[v] ?? ''; }

export function weightChart(canvas, entries, rolling, reg, firstDateIdx) {
  const t = theme();
  currentLabels = entries.map(e => e.date);
  const vals = entries.map(e => Number(e.kg));
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = Math.max(0.5, (max - min) * 0.15);
  const datasets = [
    { label: 'Weight', data: vals, borderColor: t.accent, backgroundColor: t.accent, pointRadius: entries.length > 60 ? 0 : 3, pointHoverRadius: 4, borderWidth: 1.5, tension: 0.2 },
    { label: '7-day avg', data: rolling.map(r => r.kg), borderColor: t.good, backgroundColor: t.good, pointRadius: 0, borderWidth: 2.5, tension: 0.3 },
  ];
  if (reg) {
    datasets.push({ label: 'Trend', data: firstDateIdx.map(x => reg.intercept + reg.slope * x), borderColor: t.muted, backgroundColor: t.muted, borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 });
  }
  const opts = baseOptions(t, { ySuggestedMin: min - pad, ySuggestedMax: max + pad });
  const c = new Chart(canvas, { type: 'line', data: { labels: currentLabels, datasets }, options: opts });
  charts.push(c);
  return c;
}

export function lineChart(canvas, labels, series, { yLabel, beginAtZero = false } = {}) {
  const t = theme();
  currentLabels = labels;
  const colors = [t.accent, t.good, t.warn, t.bad];
  const datasets = series.map((s, i) => ({
    label: s.label, data: s.data, borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length],
    pointRadius: labels.length > 60 ? 0 : 3, borderWidth: 2, tension: 0.2, yAxisID: s.axis || 'y', stepped: s.stepped || false,
  }));
  const opts = baseOptions(t, { yLabel, beginAtZero });
  if (series.some(s => s.axis === 'y2')) {
    opts.scales.y2 = { position: 'right', ticks: { color: t.muted, font: { size: 11 } }, grid: { drawOnChartArea: false }, beginAtZero };
  }
  const c = new Chart(canvas, { type: 'line', data: { labels, datasets }, options: opts });
  charts.push(c);
  return c;
}

export function barChart(canvas, labels, values, label, { yLabel } = {}) {
  const t = theme();
  currentLabels = labels;
  const opts = baseOptions(t, { yLabel, beginAtZero: true });
  opts.plugins.legend.display = false;
  const c = new Chart(canvas, { type: 'bar', data: { labels, datasets: [{ label, data: values, backgroundColor: t.accent, borderRadius: 4 }] }, options: opts });
  charts.push(c);
  return c;
}
