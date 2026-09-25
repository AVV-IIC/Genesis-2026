import { $, $$, api, clock, html, setHTML, icon, STATIC, hasSession } from './core.js';
import { setEventTimes, mountHorizon, eventRangeText } from './dial.js';

const form = $('#login-form');
const errorBox = $('#login-error');
const username = $('#username');
const password = $('#password');
let role = 'team';


function setRole(next) {
  role = next;
  for (const b of $$('[data-role]')) b.setAttribute('aria-pressed', String(b.dataset.role === role));
  $('#user-label').textContent = role === 'team' ? 'Team ID' : 'Username';
  username.placeholder = role === 'team' ? 'e.g. GEN014' : 'e.g. admin1';
  username.setAttribute('autocapitalize', role === 'team' ? 'characters' : 'none');
  $('#login-foot').textContent =
    role === 'team'
      ? 'Forgot your password? An organiser can reset it for you.'
      : 'Organiser accounts are set up on the server. See the README to reset one.';
  errorBox.textContent = '';
  try { localStorage.setItem('gh-role', role); } catch { /* storage unavailable */ }
}

for (const b of $$('[data-role]')) b.addEventListener('click', () => setRole(b.dataset.role));
try {
  const saved = localStorage.getItem('gh-role');
  if (saved === 'admin' || saved === 'team') setRole(saved);
} catch { /* storage unavailable */ }

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

const params = new URLSearchParams(location.search);
// Static hosting has no server-side redirect: skip sign-in if already signed in.
if (STATIC && hasSession() && !params.has('expired') && !params.has('signedout')) {
  api('/auth/me')
    .then(({ user }) => location.replace(user.role === 'admin' ? 'admin.html' : 'team.html'))
    .catch(() => { /* not signed in */ });
}
if (params.has('expired')) errorBox.textContent = 'Your session ended. Sign in again.';
if (params.has('signedout')) errorBox.textContent = 'You were signed out because your team’s login changed. Sign in with your new password.';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.textContent = '';
  if (!username.value.trim() || !password.value) {
    errorBox.textContent = role === 'team' ? 'Enter your team ID and password.' : 'Enter your username and password.';
    return;
  }
  const btn = $('#login-btn');
  btn.classList.add('is-busy');
  try {
    const res = await api('/auth/login', {
      method: 'POST',
      body: { role, username: username.value.trim(), password: password.value },
    });
    location.href = res.redirect;
  } catch (err) {
    errorBox.textContent = err.message;
    password.select();
    btn.classList.remove('is-busy');
  }
});

// Event details + countdown
(async () => {
  try {
    const info = await api('/public/info');
    clock.sync(info.serverTime);
    document.title = `Sign in · ${info.event_name}`;
    const [first, ...rest] = info.event_name.split(/\s+/);
    setHTML($('#wordmark'), html`<span>${first}</span>${rest.length ? html`<span>${rest.join(' ')}</span>` : ''}`);
    $('#tagline').textContent = info.tagline;
    setEventTimes(info);
    mountHorizon($('#horizon'));

    if (info.event_start && info.event_end) {
      const hours = (Date.parse(info.event_end) - Date.parse(info.event_start)) / 3600000;
      setHTML($('#horizon-scale'), [0, 1, 2, 3, 4].map((k) => html`<span>${Math.round((hours * k) / 4)}h</span>`));
    }
    const facts = [];
    const range = eventRangeText();
    if (range) facts.push(html`<div><b>When</b>${range}</div>`);
    if (info.venue) facts.push(html`<div><b>Where</b>${info.venue}</div>`);
    facts.push(html`<div><b>Format</b>4 rounds · 3 with eliminations</div>`);
    setHTML($('#facts'), facts);
  } catch {
    /* sign-in still works without event info */
  }
})();
