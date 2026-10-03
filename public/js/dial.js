// The event clock: drives every dial on the page, the sign-in horizon bar and
// the page's dawn glow (--dawn) from one timer.
import { clock, fmtDateTime, fmtTime, fmtDay } from './core.js';

const state = { start: null, end: null, markers: [], dials: new Set(), horizons: new Set() };
let timer = null;
const listeners = new Set();

export function setEventTimes({ event_start, event_end, markers = [] } = {}) {
  state.start = event_start ? Date.parse(event_start) : null;
  state.end = event_end ? Date.parse(event_end) : null;
  state.markers = markers || [];
  for (const d of state.dials) drawMarks(d);
  tick();
  if (!timer) timer = setInterval(tick, 1000);
}

export function onPhaseChange(fn) {
  listeners.add(fn);
}

export function phase() {
  const now = clock.now();
  const { start, end } = state;
  if (!start || !end || end <= start) return { kind: 'unset', p: 0 };
  if (now < start) return { kind: 'before', p: 0, left: start - now, total: end - start };
  if (now >= end) return { kind: 'after', p: 1, total: end - start };
  return { kind: 'live', p: (now - start) / (end - start), left: end - now, elapsed: now - start, total: end - start };
}

const pad = (n) => String(n).padStart(2, '0');
export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function phaseText(ph = phase()) {
  switch (ph.kind) {
    case 'before':
      return { label: 'Starts in', time: fmtDuration(ph.left), sub: fmtDateTime(new Date(state.start).toISOString()) };
    case 'live': {
      const hours = Math.round(ph.total / 3600000);
      const hour = Math.min(hours, Math.floor(ph.elapsed / 3600000) + 1);
      return { label: 'Time left', time: fmtDuration(ph.left), sub: `Hour ${hour} of ${hours}` };
    }
    case 'after':
      return { label: 'Time’s up', time: '00:00:00', sub: `Ended ${fmtTime(new Date(state.end).toISOString())}` };
    default:
      return { label: 'Event clock', time: '--:--:--', sub: 'Start time not set yet' };
  }
}

/** One-line status for any start/end pair (used for the sign-in cards). */
export function statusLine(startIso, endIso) {
  const start = startIso ? Date.parse(startIso) : null;
  const end = endIso ? Date.parse(endIso) : null;
  const now = clock.now();
  if (!start || !end || end <= start) return { kind: 'unset', text: 'Dates to be announced' };
  if (now < start) return { kind: 'before', text: `Starts in ${fmtDuration(start - now)}` };
  if (now >= end) return { kind: 'after', text: 'Finished' };
  return { kind: 'live', text: `Live · ${fmtDuration(end - now)} left` };
}

export function eventRangeText() {
  if (!state.start || !state.end) return '';
  const s = new Date(state.start).toISOString();
  const e = new Date(state.end).toISOString();
  return fmtDay(s) === fmtDay(e)
    ? `${fmtDay(s)} · ${fmtTime(s)} – ${fmtTime(e)}`
    : `${fmtDateTime(s)} → ${fmtDateTime(e)}`;
}

// ---- dial -------------------------------------------------------------------------------
const C = 140;
const RING = 113.7;
const pt = (angleDeg, r) => {
  const a = (angleDeg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};
const f = (n) => n.toFixed(2);

export function mountDial(el) {
  el.classList.add('dial');
  el.innerHTML = `
    <div class="dial-ring"></div>
    <svg class="dial-svg" viewBox="0 0 280 280" aria-hidden="true">
      <g class="dial-ticks"></g><g class="dial-markers"></g>
      <g class="dial-hand"><circle cx="${C}" cy="${f(C - RING)}" r="6.5"></circle></g>
    </svg>
    <div class="dial-center" role="timer">
      <span class="dial-label"></span><span class="dial-time"></span><span class="dial-sub"></span>
    </div>`;
  state.dials.add(el);
  drawMarks(el);
  tick();
}

function drawMarks(el) {
  const total = state.start && state.end ? (state.end - state.start) / 3600000 : 24;
  const n = Math.max(12, Math.min(48, Math.round(total) || 24));
  const quarter = n % 4 === 0 ? n / 4 : null;
  let ticks = '';
  for (let i = 0; i < n; i++) {
    const major = quarter ? i % quarter === 0 : i === 0;
    const [x1, y1] = pt((i / n) * 360, major ? 90 : 95);
    const [x2, y2] = pt((i / n) * 360, 101);
    ticks += `<line class="tick${major ? ' major' : ''}" data-f="${i / n}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
    if (major) {
      const [tx, ty] = pt((i / n) * 360, 79);
      ticks += `<text class="hour" x="${f(tx)}" y="${f(ty)}">${Math.round((total * i) / n)}h</text>`;
    }
  }
  el.querySelector('.dial-ticks').innerHTML = ticks;

  let marks = '';
  if (state.start && state.end) {
    for (const m of state.markers) {
      const t = Date.parse(m.starts_at);
      if (!(t >= state.start && t <= state.end)) continue;
      const frac = (t - state.start) / (state.end - state.start);
      const deg = frac * 360;
      const [ax, ay] = pt(deg, RING - 7);
      const [bx, by] = pt(deg, RING + 7);
      marks += `<line class="notch" x1="${f(ax)}" y1="${f(ay)}" x2="${f(bx)}" y2="${f(by)}"/>`;
      const round = /round\s*(\d+)/i.exec(m.title || '');
      const [lx, ly] = pt(deg, RING + 17);
      const safeTitle = String(m.title || '').replace(/[<>&"]/g, '');
      marks += round
        ? `<text class="marker" data-f="${frac}" x="${f(lx)}" y="${f(ly)}"><title>${safeTitle}</title>R${round[1]}</text>`
        : `<circle class="marker-dot" data-f="${frac}" cx="${f(lx)}" cy="${f(ly)}" r="2.6"><title>${safeTitle}</title></circle>`;
    }
  }
  el.querySelector('.dial-markers').innerHTML = marks;
}

// ---- horizon bar (sign-in page) -------------------------------------------------------------
export function mountHorizon(el) {
  state.horizons.add(el);
  tick();
}

let lastKind = null;
function tick() {
  const ph = phase();
  document.documentElement.style.setProperty('--dawn', ph.p.toFixed(4));
  const text = phaseText(ph);

  for (const el of state.dials) {
    if (!el.isConnected) {
      state.dials.delete(el);
      continue;
    }
    el.style.setProperty('--p', ph.p.toFixed(5));
    el.dataset.phase = ph.kind;
    el.querySelector('.dial-hand').style.transform = `rotate(${(ph.p * 360).toFixed(3)}deg)`;
    el.querySelector('.dial-label').textContent = text.label;
    const t = el.querySelector('.dial-time');
    t.textContent = text.time;
    t.classList.toggle('is-long', text.time.length > 8);
    el.querySelector('.dial-sub').textContent = text.sub;
    for (const node of el.querySelectorAll('[data-f]')) node.classList.toggle('past', Number(node.dataset.f) <= ph.p && ph.kind !== 'unset' && ph.kind !== 'before');
  }

  for (const el of state.horizons) {
    if (!el.isConnected) {
      state.horizons.delete(el);
      continue;
    }
    el.style.setProperty('--p', ph.p.toFixed(5));
    const label = el.querySelector('[data-h-label]');
    const time = el.querySelector('[data-h-time]');
    if (label) label.textContent = text.label;
    if (time) time.textContent = text.time;
  }

  if (ph.kind !== lastKind) {
    const prev = lastKind;
    lastKind = ph.kind;
    if (prev !== null) listeners.forEach((fn) => fn(ph.kind, prev));
  }
}
