// Sign-in: choose Hackathon or Ideathon first, then how you're signing in.
import { $, $$, api, clock, html, setHTML, icon, STATIC, hasSession, COMP_LABEL } from './core.js';
import { setEventTimes, mountHorizon, eventRangeText, statusLine } from './dial.js';

const form = $('#login-form');
const chooser = $('#chooser');
const errorBox = $('#login-error');
const username = $('#username');
const password = $('#password');
const HOME = { admin: 'admin.html', team: 'team.html', judge: 'judge.html' };

const ROLES = {
  hackathon: [['team', 'Team leader'], ['judge', 'Judge'], ['admin', 'Organiser']],
  ideathon: [['team', 'Team leader'], ['admin', 'Organiser']],
};
const FIELDS = {
  team: { label: 'Team ID', placeholder: { hackathon: 'e.g. GEN014', ideathon: 'e.g. IDE014' }, caps: true, foot: 'Forgot your password? An organiser can reset it for you.' },
  judge: { label: 'Judge ID', placeholder: { hackathon: 'e.g. JDG001' }, caps: true, foot: 'Your judge ID and password come from the organisers.' },
  admin: { label: 'Username', placeholder: { hackathon: 'e.g. admin1', ideathon: 'e.g. ideaadmin1' }, caps: false, foot: 'Organiser accounts are set up by the event team.' },
};
const FORMAT = { hackathon: '4 rounds · 3 with eliminations', ideathon: '24 hours · one idea · no rounds' };

let info = null;
let competition = null;
let role = 'team';

$$('[data-icon]').forEach((el) => setHTML(el, icon(el.dataset.icon)));

const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

function setRole(next) {
  role = ROLES[competition].some(([r]) => r === next) ? next : 'team';
  for (const b of $$('[data-role]')) b.setAttribute('aria-pressed', String(b.dataset.role === role));
  const f = FIELDS[role];
  $('#user-label').textContent = f.label;
  username.placeholder = f.placeholder[competition] || '';
  username.setAttribute('autocapitalize', f.caps ? 'characters' : 'none');
  $('#login-foot').textContent = f.foot;
  errorBox.textContent = '';
  remember('gh-role', role);
}

function choose(comp, { focus = true } = {}) {
  competition = comp;
  remember('gh-competition', comp);
  if (location.hash !== `#${comp}`) history.replaceState(null, '', `#${comp}`);
  chooser.hidden = true;
  form.hidden = false;
  $('#comp-chip').textContent = COMP_LABEL[comp];
  $('#comp-chip').dataset.comp = comp;
  setHTML(
    $('#roles'),
    ROLES[comp].map(([r, label]) => html`<button type="button" data-role="${r}" aria-pressed="false">${label}</button>`)
  );
  $$('[data-role]').forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));
  setRole(recall('gh-role') || 'team');
  renderHero();
  if (focus) username.focus();
}

function showChooser() {
  competition = null;
  history.replaceState(null, '', location.pathname + location.search);
  form.hidden = true;
  chooser.hidden = false;
  errorBox.textContent = '';
  renderHero();
  const last = recall('gh-competition');
  const btn = $(`[data-comp="${last}"]`) || $('[data-comp]');
  btn.focus();
}

$$('[data-comp]').forEach((b) => b.addEventListener('click', () => choose(b.dataset.comp)));
$('#back').addEventListener('click', showChooser);

// Left side: the chosen competition's name, clock and facts.
function renderHero() {
  const details = $('#hero-details');
  if (!competition || !info) {
    setHTML($('#wordmark'), html`<span>Genesis</span><span>Hackathon · Ideathon</span>`);
    $('#tagline').textContent = 'Two 24-hour competitions, running side by side.';
    details.hidden = true;
    document.title = 'Sign in · Genesis';
    return;
  }
  const c = info.competitions[competition];
  setHTML($('#wordmark'), html`<span>Genesis</span><span>${COMP_LABEL[competition]}</span>`);
  $('#tagline').textContent = c.tagline;
  document.title = `Sign in · ${c.event_name}`;
  setEventTimes(c);
  details.hidden = false;
  if (c.event_start && c.event_end) {
    const hours = (Date.parse(c.event_end) - Date.parse(c.event_start)) / 3600000;
    setHTML($('#horizon-scale'), [0, 1, 2, 3, 4].map((k) => html`<span>${Math.round((hours * k) / 4)}h</span>`));
  }
  const facts = [];
  const range = eventRangeText();
  if (range) facts.push(html`<div><b>When</b>${range}</div>`);
  if (c.venue) facts.push(html`<div><b>Where</b>${c.venue}</div>`);
  facts.push(html`<div><b>Format</b>${FORMAT[competition]}</div>`);
  setHTML($('#facts'), facts);
}

function tickCards() {
  if (!info) return;
  for (const el of $$('[data-clock]')) {
    const c = info.competitions[el.dataset.clock];
    const s = statusLine(c.event_start, c.event_end);
    el.textContent = s.text;
    el.dataset.kind = s.kind;
  }
}

// ---- password visibility ----------------------------------------------------------
const toggle = $('#pw-toggle');
const drawToggle = () => {
  const shown = password.type === 'text';
  setHTML(toggle, icon(shown ? 'eyeOff' : 'eye'));
  toggle.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
};
toggle.addEventListener('click', () => {
  password.type = password.type === 'password' ? 'text' : 'password';
  drawToggle();
  password.focus();
});
drawToggle();

// ---- messages and existing sessions --------------------------------------------------
const params = new URLSearchParams(location.search);
// Static hosting has no server-side redirect: skip sign-in if already signed in.
if (STATIC && hasSession() && !params.has('expired') && !params.has('signedout')) {
  api('/auth/me')
    .then(({ user }) => location.replace(HOME[user.role]))
    .catch(() => { /* not signed in */ });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.textContent = '';
  if (!username.value.trim() || !password.value) {
    errorBox.textContent = `Enter your ${FIELDS[role].label.toLowerCase()} and password.`;
    return;
  }
  const btn = $('#login-btn');
  btn.classList.add('is-busy');
  try {
    const res = await api('/auth/login', {
      method: 'POST',
      body: { competition, role, username: username.value.trim(), password: password.value },
    });
    location.href = res.redirect;
  } catch (err) {
    errorBox.textContent = err.message;
    password.select();
    btn.classList.remove('is-busy');
  }
});

// ---- start --------------------------------------------------------------------------------
const fromUrl = (location.hash.slice(1) || params.get('c') || '').toLowerCase();
if (fromUrl === 'hackathon' || fromUrl === 'ideathon') choose(fromUrl, { focus: false });
if (params.has('expired') || params.has('signedout')) {
  const last = recall('gh-competition');
  if (!competition && (last === 'hackathon' || last === 'ideathon')) choose(last, { focus: false });
  errorBox.textContent = params.has('expired')
    ? 'Your session ended. Sign in again.'
    : 'You were signed out because your login changed. Sign in with your new password.';
}

(async () => {
  try {
    info = await api('/public/info');
    clock.sync(info.serverTime);
    mountHorizon($('#horizon'));
    renderHero();
    tickCards();
    setInterval(tickCards, 1000);
  } catch {
    /* sign-in still works without event info */
  }
})();
