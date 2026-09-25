import {
  $, $$, api, html, raw, setHTML, icon, MARK, clock, toast, toastError, connectLive, startRouter, preserveInputs,
  debounce, signOut, guardPage, download, withBusy,
} from '../core.js';
import { setEventTimes } from '../dial.js';
import { empty } from './shared.js';
import * as dashboard from './dashboard.js';
import * as teams from './teams.js';
import * as rounds from './rounds.js';
import * as announcements from './announcements.js';
import * as help from './helpdesk.js';
import * as schedule from './schedule.js';
import * as leaderboard from './leaderboard.js';
import * as settings from './settings.js';

const VIEWS = { dashboard, teams, rounds, announcements, help, schedule, leaderboard, settings };
const NAV = [
  ['dashboard', 'Dashboard', 'home'],
  ['teams', 'Teams', 'users'],
  ['rounds', 'Rounds & scores', 'trophy'],
  ['announcements', 'Announcements', 'megaphone'],
  ['help', 'Help desk', 'help', 'tickets_unread'],
  ['schedule', 'Schedule', 'calendar'],
  ['leaderboard', 'Leaderboard', 'chart'],
  ['settings', 'Settings', 'settings'],
];

const main = $('#main');
const ctx = {
  main,
  meta: null,
  view: null,
  params: [],
  seq: 0,
  get me() { return this.meta?.me; },
  get settings() { return this.meta?.settings || {}; },
  refreshMeta,
  rerender: null,
  isCurrent: (seq) => seq === ctx.seq,
};

guardPage('admin');
$$('[data-mark]').forEach((el) => setHTML(el, MARK));

// Export / backup buttons anywhere in the console.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-download]');
  if (b) withBusy(b, () => download(b.dataset.download)).catch(toastError);
});
$$('[data-signout]').forEach((b) => b.addEventListener('click', signOut));

async function refreshMeta() {
  ctx.meta = await api('/admin/meta');
  clock.sync(ctx.meta.serverTime);
  setEventTimes({ ...ctx.meta.settings, markers: ctx.meta.markers });
  renderNav();
}

function renderNav() {
  const m = ctx.meta;
  $$('[data-brand]').forEach((el) => (el.textContent = m.settings.event_name.split(/\s+/)[0]));
  $('[data-me-name]').textContent = m.me.name;
  $('[data-me-user]').textContent = `@${m.me.username}`;
  document.title = `Organiser console · ${m.settings.event_name}`;
  const nav = NAV.map(
    ([id, label, ic, badgeKey]) =>
      html`<a href="#/${id}" data-view="${id}" ${ctx.view === id ? raw('aria-current="page"') : ''}>${icon(ic)}<span>${label}</span>${badgeKey && m[badgeKey] ? html`<span class="badge">${m[badgeKey]}</span>` : ''}</a>`
  );
  $$('[data-nav]').forEach((el) => setHTML(el, nav));
}

async function renderView() {
  const mod = VIEWS[ctx.view] || VIEWS.dashboard;
  const seq = ++ctx.seq;
  try {
    await mod.render(ctx, ctx.params, seq);
  } catch (err) {
    if (seq !== ctx.seq) return;
    console.error(err);
    setHTML(main, html`<div class="card">${empty('Couldn’t load this page', err.message, html`<button class="btn" type="button" id="retry">${icon('refresh')}Try again</button>`)}</div>`);
    $('#retry')?.addEventListener('click', renderView);
  }
}

ctx.rerender = debounce(() => preserveInputs(main, renderView), 250);

function onRoute(view, params) {
  const changed = view !== ctx.view;
  if (changed && VIEWS[ctx.view]?.leave) VIEWS[ctx.view].leave(ctx);
  ctx.view = VIEWS[view] ? view : 'dashboard';
  ctx.params = params;
  if (changed) scrollTo({ top: 0 });
  renderNav();
  renderView();
}

function dispatch(type, data) {
  const mod = VIEWS[ctx.view];
  if (!mod) return;
  if (mod.onEvent && mod.onEvent(type, data, ctx)) return;
  if (mod.live && mod.live.includes(type)) ctx.rerender();
}

const metaSoon = debounce(() => refreshMeta().catch(() => {}), 300);

(async () => {
  try {
    await refreshMeta();
  } catch (err) {
    setHTML(main, html`<div class="card">${empty('Couldn’t load the console', err.message)}</div>`);
    return;
  }
  startRouter('dashboard', onRoute);

  const handlers = {};
  for (const type of ['teams', 'rounds', 'sheet', 'results', 'announcement', 'announcements', 'schedule', 'settings', 'ticket']) {
    handlers[type] = (data) => {
      if (type === 'ticket' && (data.kind === 'new' || data.kind === 'reply')) {
        const who = data.team ? ` · ${data.team}` : '';
        toast(data.subject || 'Open the help desk to read it.', 'ember', {
          title: data.kind === 'new' ? `New help request${who}` : `A team replied${who}`,
          action: { label: 'Open', onClick: () => (location.hash = `#/help/${data.id}`) },
        });
      }
      if (['ticket', 'settings', 'schedule'].includes(type)) metaSoon();
      dispatch(type, data);
    };
  }
  handlers.reconnect = () => {
    metaSoon();
    ctx.rerender();
  };
  connectLive(handlers, $$('[data-live]'));
})();

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.status !== undefined) {
    toastError(e.reason);
    e.preventDefault();
  }
});
