// Shared helpers for every page: safe HTML templating, API calls, time
// formatting, toasts, dialogs, icons and the live event stream.
import * as backend from './backend.js';

export const { STATIC, HOME, guardPage, download, hasSession } = backend;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- safe templating ----------------------------------------------------
// html`...` escapes every interpolated value unless it is itself html`` or raw().
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function renderVal(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderVal).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += renderVal(vals[i]) + strings[i + 1];
  return new Raw(out);
}
export function setHTML(el, content) {
  el.innerHTML = content instanceof Raw ? content.s : renderVal(content);
}

// Re-render without losing what someone is typing (live updates re-render views).
export async function preserveInputs(root, fn) {
  const saved = new Map();
  const active = document.activeElement;
  let activeKey = null;
  let selection = null;
  // Only keep fields the user has changed since they were rendered, so fresh
  // server data still replaces everything else.
  const edited = (el) => {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') return [...el.options].some((o) => o.selected !== o.defaultSelected);
    return el.value !== el.defaultValue;
  };
  for (const el of $$('input[id], textarea[id], select[id]', root)) {
    if (edited(el)) {
      if (el.type === 'checkbox' || el.type === 'radio') saved.set(el.id, { checked: el.checked });
      else saved.set(el.id, { value: el.value });
    }
    if (el === active) {
      activeKey = el.id;
      try { selection = [el.selectionStart, el.selectionEnd]; } catch { /* not a text input */ }
    }
  }
  await fn();
  for (const [id, v] of saved) {
    const el = document.getElementById(id);
    if (!el || el.dataset.fresh !== undefined) continue;
    if ('checked' in v) el.checked = v.checked;
    else el.value = v.value;
  }
  if (activeKey) {
    const el = document.getElementById(activeKey);
    if (el) {
      el.focus();
      if (selection) try { el.setSelectionRange(...selection); } catch { /* ignore */ }
    }
  }
}

// ---------- API -------------------------------------------------------------------
export async function api(path, { method = 'GET', body } = {}) {
  if (STATIC) {
    try {
      return await backend.request(method, path, body);
    } catch (err) {
      if (err.status === 401 && !path.startsWith('/auth/')) {
        backend.session.clear();
        location.href = `${HOME}?expired=1`;
      }
      throw new ApiError(err.message, err.status, err.data);
    }
  }
  const opts = { method, headers: { 'X-Genesis': '1' }, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    throw new ApiError('Can’t reach the server. Check your connection and try again.', 0);
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (res.status === 401 && !path.startsWith('/auth/')) {
    location.href = `${HOME}?expired=1`;
    throw new ApiError('Your session has ended.', 401);
  }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status}).`, res.status, data);
  return data;
}
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function signOut() {
  try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
  backend.session.clear();
  location.href = HOME;
}

// ---------- time --------------------------------------------------------------------
let clockOffset = 0;
export const clock = {
  sync(serverIso) {
    const t = Date.parse(serverIso);
    if (!Number.isNaN(t)) clockOffset = t - Date.now();
  },
  now: () => Date.now() + clockOffset,
};

const dtf = (opts) => new Intl.DateTimeFormat(undefined, opts);
const F_TIME = dtf({ hour: 'numeric', minute: '2-digit' });
const F_DAY = dtf({ weekday: 'short', day: 'numeric', month: 'short' });
const F_DAY_LONG = dtf({ weekday: 'long', day: 'numeric', month: 'long' });
export const fmtTime = (iso) => (iso ? F_TIME.format(new Date(iso)) : '');
export const fmtDay = (iso) => (iso ? F_DAY.format(new Date(iso)) : '');
export const fmtDayLong = (iso) => (iso ? F_DAY_LONG.format(new Date(iso)) : '');
export const fmtDateTime = (iso) => (iso ? `${fmtDay(iso)}, ${fmtTime(iso)}` : '');
export const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.round((clock.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return fmtDateTime(iso);
}

// <input type="datetime-local"> works in local time.
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : '');

export function fmtScore(n) {
  if (n === null || n === undefined || n === '') return '–';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// ---------- rich text (announcements, notes) --------------------------------------
// Escapes first, then allows **bold**, links and line breaks.
export function richText(text) {
  let s = esc(text || '');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\n/g, '<br>');
  return raw(s);
}

// ---------- icons ------------------------------------------------------------------------
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.8 3.1 2.5 3.5 5.2"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v3.5M8 21h8M9 21v-2.5h6V21"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h3l8 5V4L7 9H4a1 1 0 0 0-1 1z"/><path d="M19 8.5a4.5 4.5 0 0 1 0 7"/>',
  help: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.8"/><path d="m5.6 5.6 3.7 3.7M14.7 14.7l3.7 3.7M18.4 5.6l-3.7 3.7M9.3 14.7l-3.7 3.7"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M5 20V11M10 20V5M15 20v-6M20 20V9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  printer: '<path d="M7 9V3.5h10V9M7 17H4.5a1 1 0 0 1-1-1v-5.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5V16a1 1 0 0 1-1 1H17"/><rect x="7" y="14" width="10" height="6.5" rx="1"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14.5 8.5l2 2"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>',
  pin: '<path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5zM12 13v7.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.5"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  mapPin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.7 4.3L20 15.5M20 20v-4.5h-4.5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
};
export const icon = (name) =>
  raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);

// The Genesis logo (light bulb), used in every header.
export const MARK = raw('<img src="img/logo-sm.png" alt="" width="120" height="194">');

// ---------- toasts ------------------------------------------------------------------------
function toastHost() {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  return host;
}
export function toast(message, kind = 'info', { title, timeout = 4500, action } = {}) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = html`<div>${title ? html`<strong>${title}</strong>` : ''}${message}</div>
    ${action ? html`<button type="button" class="btn btn-sm">${action.label}</button>` : ''}`.s;
  if (action) el.querySelector('button').addEventListener('click', () => { action.onClick(); el.remove(); });
  toastHost().append(el);
  setTimeout(() => el.remove(), timeout);
}
export const toastError = (err) => toast(err.message || String(err), 'error', { timeout: 6000 });

// ---------- dialogs -----------------------------------------------------------------------
export function openModal({ title, content, footer, wide = false, onMount, form = true }) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal${wide ? ' modal-wide' : ''}`;
  const inner = html`
    <header class="modal-head"><h2>${title}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
    <div class="modal-body">${content}</div>
    ${footer ? html`<footer class="modal-foot">${footer}</footer>` : ''}`;
  dlg.innerHTML = form ? `<form class="modal-inner" novalidate>${inner.s}</form>` : `<div class="modal-inner">${inner.s}</div>`;
  document.body.append(dlg);
  const close = () => dlg.open && dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', close));
  dlg.showModal();
  onMount?.(dlg, close);
  return { el: dlg, close };
}

// Reads a form into an object; checkboxes become booleans.
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

/** A dialog with a form; onSubmit(values) may throw to show an inline error. */
export function formModal({ title, content, submitLabel = 'Save', danger = false, wide = false, onSubmit, onMount }) {
  return openModal({
    title,
    wide,
    content: html`${content}<div class="form-error" role="alert"></div>`,
    footer: html`<button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="submit" class="btn ${danger ? 'btn-danger btn-solid' : 'btn-primary'}">${submitLabel}</button>`,
    onMount(dlg, close) {
      const formEl = $('form', dlg);
      const err = $('.form-error', dlg);
      const submit = $('button[type=submit]', dlg);
      formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        submit.classList.add('is-busy');
        try {
          const keepOpen = await onSubmit(formValues(formEl), dlg);
          if (keepOpen !== true) close();
        } catch (ex) {
          err.textContent = ex.message;
          if (ex.data && ex.data.errors) {
            err.innerHTML = html`${ex.message}<ul class="error-list">${ex.data.errors.map((x) => html`<li>Line ${x.line}: ${x.message}</li>`)}</ul>`.s;
          }
        } finally {
          submit.classList.remove('is-busy');
        }
      });
      onMount?.(dlg, close);
      const first = $('input:not([type=hidden]):not([type=checkbox]), textarea, select', dlg);
      if (first) first.focus();
    },
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const { el } = openModal({
      title,
      form: false,
      content: html`<p class="muted">${message}</p>`,
      footer: html`<button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn ${danger ? 'btn-danger btn-solid' : 'btn-primary'}" data-ok>${confirmLabel}</button>`,
      onMount(dlg, close) {
        $('[data-ok]', dlg).addEventListener('click', () => { answered = true; resolve(true); close(); });
        $('[data-ok]', dlg).focus();
      },
    });
    el.addEventListener('close', () => { if (!answered) resolve(false); });
  });
}

export async function withBusy(btn, fn) {
  btn?.classList.add('is-busy');
  try { return await fn(); } finally { btn?.classList.remove('is-busy'); }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard.', 'ok', { timeout: 2000 });
  } catch {
    toast('Couldn’t copy. Select the text and copy it manually.', 'warn');
  }
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- live updates ---------------------------------------------------------------
/** handlers: { [eventType]: fn(data) , reconnect?: fn() } */
export function connectLive(handlers, indicator) {
  if (STATIC) return backend.live(handlers, [].concat(indicator || []).filter(Boolean));
  let es;
  let wasDown = false;
  const indicators = [].concat(indicator || []).filter(Boolean);
  const setState = (on) => {
    for (const el of indicators) {
      el.classList.toggle('is-on', on);
      el.textContent = on ? 'Live' : 'Reconnecting…';
    }
  };
  function open() {
    es = new EventSource('/api/events');
    es.onopen = () => {
      setState(true);
      if (wasDown) handlers.reconnect?.();
      wasDown = false;
    };
    es.onerror = () => {
      setState(false);
      wasDown = true;
      if (es.readyState === EventSource.CLOSED) {
        // Closed for good (e.g. session ended). Check before retrying.
        fetch('/api/auth/me', { credentials: 'same-origin' })
          .then((r) => (r.status === 401 ? (location.href = `${HOME}?expired=1`) : setTimeout(open, 3000)))
          .catch(() => setTimeout(open, 5000));
      }
    };
    for (const [type, fn] of Object.entries(handlers)) {
      if (type === 'reconnect') continue;
      es.addEventListener(type, (e) => {
        let data = {};
        try { data = JSON.parse(e.data || '{}'); } catch { /* ignore */ }
        fn(data);
      });
    }
  }
  open();
  // Phones suspend background tabs; catch up when the tab comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handlers.reconnect?.();
  });
}

// ---------- hash router ----------------------------------------------------------------------
export function startRouter(fallback, onRoute) {
  const go = () => {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    onRoute(parts[0] || fallback, parts.slice(1));
  };
  addEventListener('hashchange', go);
  go();
  return go;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export const STATUS_LABEL = {
  selected: 'Selected',
  eliminated: 'Not selected',
  pending: 'Pending',
  advanced: 'Advances',
};
export const STATE_LABEL = { upcoming: 'Upcoming', live: 'Live now', judging: 'Judging', completed: 'Completed' };
export const TICKET_LABEL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
export const PRIORITY_LABEL = { normal: 'Normal', important: 'Important', urgent: 'Urgent' };
