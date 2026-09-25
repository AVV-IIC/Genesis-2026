import {
  $, $$, api, html, raw, setHTML, icon, MARK, clock, toast, toastError, formModal, formValues, withBusy,
  connectLive, startRouter, preserveInputs, debounce, signOut, richText, timeAgo, fmtTime, fmtDay, fmtDayLong,
  dayKey, fmtScore, STATE_LABEL, TICKET_LABEL, PRIORITY_LABEL, guardPage, HOME,
} from '../core.js';
import { setEventTimes, mountDial, eventRangeText } from '../dial.js';

const main = $('#main');
const app = { data: null, view: 'overview', params: [], seq: 0, reveal: false, dismissedUrgent: null };

guardPage('team');
setHTML($('#mark'), MARK);
$('#signout').addEventListener('click', signOut);

// ---------- data + chrome ------------------------------------------------------------
async function loadCore() {
  app.data = await api('/team/overview');
  clock.sync(app.data.serverTime);
  setEventTimes({ ...app.data.event, markers: app.data.markers });
  renderChrome();
}

function renderChrome() {
  const d = app.data;
  const first = d.event.event_name.split(/\s+/)[0];
  $('#brand-name').textContent = first;
  document.title = `${d.team.name} · ${d.event.event_name}`;
  $('#who-team').textContent = d.team.name;
  $('#who-code').textContent = `${d.team.code}${d.team.leader_name ? ' · ' + d.team.leader_name : ''}`;

  const tabs = [
    ['overview', 'Overview'],
    ['scorecard', 'Scorecard'],
    ['announcements', 'Announcements', d.unread],
    ['schedule', 'Schedule'],
    ['help', 'Help desk', d.tickets_unread],
    d.event.leaderboard_visible ? ['leaderboard', 'Leaderboard'] : null,
    ['team', 'My team'],
  ].filter(Boolean);
  setHTML(
    $('#tabs'),
    tabs.map(
      ([id, label, n]) => html`<a href="#/${id}" data-tab="${id}" ${app.view === id ? raw('aria-current="page"') : ''}>${label}${n ? html`<span class="badge">${n}</span>` : ''}</a>`
    )
  );
  renderUrgent();
}

function renderUrgent(fresh) {
  const host = $('#urgent');
  const seen = app.data.announcements_seen_at;
  const a = fresh || (app.data.announcements || []).find((x) => x.priority === 'urgent' && (!seen || x.created_at > seen));
  if (!a || app.dismissedUrgent === a.id || app.view === 'announcements') return setHTML(host, '');
  setHTML(
    host,
    html`<div class="urgent-bar" role="alert"><div class="wrap-bar">${icon('alert')}<span>Urgent: ${a.title}</span>
      <a href="#/announcements">Read it</a>
      <button type="button" class="icon-btn" data-dismiss aria-label="Dismiss">${icon('x')}</button></div></div>`
  );
  $('[data-dismiss]', host).addEventListener('click', () => {
    app.dismissedUrgent = a.id;
    setHTML(host, '');
  });
}

// ---------- rendering helpers ------------------------------------------------------------
const chip = (kind, label) => html`<span class="chip chip-${kind}">${label}</span>`;

function roundStep(r) {
  let cls = '';
  let node = html`${r.number}`;
  let note = r.state === 'upcoming' ? 'Upcoming' : STATE_LABEL[r.state];
  if (!r.reached) {
    cls = 'is-unreached';
    note = 'Not reached';
  } else if (r.published) {
    const score = r.total === null ? '' : `${fmtScore(r.total)}/${fmtScore(r.max_total)} · `;
    if (r.status === 'eliminated') {
      cls = 'is-out';
      node = icon('x');
      note = `${score}Not selected`;
    } else if (r.status === 'pending') {
      cls = 'is-pending';
      note = `${score}Result pending`;
    } else {
      cls = 'is-done';
      node = icon('check');
      note = `${score}${r.status === 'selected' ? 'Selected' : 'Evaluated'}`;
    }
  } else if (r.state === 'live' || r.state === 'judging') {
    cls = 'is-now';
    note = r.state === 'live' ? 'Happening now' : 'Being judged';
  } else if (r.state === 'completed') {
    cls = 'is-pending';
    note = 'Awaiting results';
  }
  return html`<li class="${cls}"><span class="node">${node}</span><strong>${r.name}</strong><small>${note}</small></li>`;
}

function annItem(a, { compact = false, isNew = false } = {}) {
  return html`<article class="ann ann-${a.priority}${compact ? ' ann-compact' : ''}${isNew ? ' is-new' : ''}">
    <div class="ann-head">
      ${a.pinned ? html`<span class="pin" title="Pinned">${icon('pin')}</span>` : ''}
      ${a.priority !== 'normal' ? chip(a.priority, PRIORITY_LABEL[a.priority]) : ''}
      ${isNew ? chip('new', 'New') : ''}
      <h3>${a.title}</h3>
    </div>
    ${a.body ? html`<div class="ann-body">${compact && a.body.length > 220 ? a.body.slice(0, 220) + '…' : richText(a.body)}</div>` : ''}
    <div class="ann-meta"><span>${timeAgo(a.created_at)}</span>${a.author ? html`<span>· ${a.author}</span>` : ''}${a.updated_at ? html`<span>· edited</span>` : ''}</div>
  </article>`;
}

const empty = (title, text, action = '') => html`<div class="empty"><h3>${title}</h3><p>${text}</p>${action}</div>`;

// ---------- views -------------------------------------------------------------------------
const VIEWS = {
  overview() {
    const d = app.data;
    const s = d.standing;
    const upcoming = d.upcoming || [];
    setHTML(
      main,
      html`
      <div class="hero-grid">
        <section class="card hero-dial" aria-label="Event clock">
          <div data-dial></div>
          <p class="event-line">${eventRangeText() || 'The organisers will publish the event timing soon.'}${d.event.venue ? html`<br>${d.event.venue}` : ''}</p>
        </section>
        <section class="card standing${app.reveal ? ' reveal' : ''}" data-kind="${s.kind}" aria-live="polite">
          <div class="standing-meta">
            <span class="code-tag">${d.team.code}</span>
            ${d.team.table_no ? html`<span>Table ${d.team.table_no}</span>` : ''}
            ${d.team.track ? html`<span>${d.team.track}</span>` : ''}
          </div>
          <div class="stack-sm">
            <p class="standing-team">${d.team.name}</p>
            <h1 class="standing-title">${s.title}</h1>
            <p class="standing-text">${s.text}</p>
            ${s.award && s.kind !== 'finished' ? html`<p>${chip('award', s.award)}</p>` : ''}
          </div>
          <ol class="path" style="--n:${d.journey.length}" aria-label="Round progress">${d.journey.map(roundStep)}</ol>
          <div class="row"><a class="btn" href="#/scorecard">${icon('trophy')}Open scorecard</a></div>
        </section>
      </div>

      <div class="two-col">
        <section class="card">
          <div class="card-head"><h2 class="section-title">Announcements</h2><a class="btn btn-ghost btn-sm" href="#/announcements">See all</a></div>
          ${d.announcements.length
            ? html`<div class="ann-list">${d.announcements.map((a) => annItem(a, { compact: true }))}</div>`
            : empty('Nothing yet', 'Updates from the organisers will show up here the moment they’re posted.')}
        </section>
        <section class="card">
          <div class="card-head"><h2 class="section-title">Up next</h2><a class="btn btn-ghost btn-sm" href="#/schedule">Full schedule</a></div>
          ${upcoming.length
            ? html`<div class="upnext">${upcoming.map(
                (e) => html`<div class="upnext-item"><span class="mono">${fmtTime(e.starts_at)}<br><span class="faint">${fmtDay(e.starts_at)}</span></span>
                  <div><strong>${e.title}</strong>${e.location ? html`<small>${e.location}</small>` : ''}</div></div>`
              )}</div>`
            : empty('No upcoming items', 'The schedule is empty or everything has already happened.')}
        </section>
      </div>`
    );
    mountDial($('[data-dial]', main));
    app.reveal = false;
  },

  scorecard() {
    const d = app.data;
    const published = d.journey.filter((r) => r.published && r.reached);
    const total = published.reduce((sum, r) => sum + (r.total || 0), 0);
    const max = published.reduce((sum, r) => sum + r.max_total, 0);
    setHTML(
      main,
      html`
      <div class="page-head">
        <div><h1 class="page-title">Scorecard</h1><p>Scores and judges’ notes appear here once the organisers publish each round.</p></div>
        ${published.length ? html`<div class="round-total"><span class="small muted">Total so far</span><div><span class="big">${fmtScore(total)}</span> <span class="of">/ ${fmtScore(max)}</span></div></div>` : ''}
      </div>
      <div class="stack">${d.journey.map(roundCard)}</div>`
    );
  },

  async announcements(params, seq) {
    const { announcements, seen_at } = await api('/team/announcements');
    if (seq !== app.seq) return;
    setHTML(
      main,
      html`
      <div class="page-head"><div><h1 class="page-title">Announcements</h1><p>Everything the organisers have posted, newest first. Pinned posts stay on top.</p></div></div>
      ${announcements.length
        ? html`<div class="ann-list">${announcements.map((a) => annItem(a, { isNew: !seen_at || a.created_at > seen_at }))}</div>`
        : html`<div class="card">${empty('No announcements yet', 'When the organisers post an update, it will appear here and you’ll get a notification on this page.')}</div>`}`
    );
    if (app.data.unread) {
      api('/team/announcements/seen', { method: 'POST', body: {} }).catch(() => {});
      app.data.unread = 0;
      app.data.announcements_seen_at = new Date(clock.now()).toISOString();
      renderChrome();
    }
  },

  async schedule(params, seq) {
    const { schedule } = await api('/team/schedule');
    if (seq !== app.seq) return;
    setHTML(
      main,
      html`
      <div class="page-head"><div><h1 class="page-title">Schedule</h1><p>${eventRangeText() || 'Timings are set by the organisers and may change during the event.'}</p></div></div>
      ${schedule.length ? timeline(schedule) : html`<div class="card">${empty('Schedule coming soon', 'The organisers haven’t published the timeline yet.')}</div>`}`
    );
  },

  async help(params, seq) {
    const data = await api('/team/tickets');
    let ticket = null;
    const id = Number(params[0]);
    if (id) ticket = (await api(`/team/tickets/${id}`)).ticket;
    if (seq !== app.seq) return;
    const listed = data.tickets.find((t) => t.id === id);
    if (listed && listed.team_unread) {
      listed.team_unread = false;
      app.data.tickets_unread = Math.max(0, app.data.tickets_unread - 1);
      renderChrome();
    }
    const composing = params[0] === 'new' || (!ticket && !data.tickets.length);

    await preserveInputs(main, () =>
      setHTML(
        main,
        html`
        <div class="page-head">
          <div><h1 class="page-title">Help desk</h1><p>Need a mentor, stuck on Wi-Fi, or have a question about judging? Raise a request and an organiser will reply here.</p></div>
          ${data.open ? html`<a class="btn btn-primary" href="#/help/new">${icon('plus')}New request</a>` : ''}
        </div>
        ${!data.open ? html`<div class="callout callout-warn" style="margin-bottom:16px">${icon('alert')}<span>The help desk is closed right now. Find an organiser in person.</span></div>` : ''}
        <div class="help-grid">
          <section class="card card-flush">
            <div class="card-head"><h2 class="section-title">Your requests</h2></div>
            ${data.tickets.length
              ? html`<div class="ticket-list" style="margin-top:8px">${data.tickets.map(
                  (t) => html`<a class="ticket-row${t.team_unread ? ' is-unread' : ''}" href="#/help/${t.id}" ${ticket && ticket.id === t.id ? raw('aria-current="true"') : ''}>
                    <strong>${t.subject}</strong>${chip(t.status, TICKET_LABEL[t.status])}
                    <small>${t.category} · ${timeAgo(t.updated_at)}</small></a>`
                )}</div>`
              : html`<div class="empty small"><p>You haven’t raised any requests.</p></div>`}
          </section>
          <section class="stack">
            ${ticket ? threadCard(ticket) : composing && data.open ? newTicketCard(data.categories) : pickCard()}
            ${data.contact ? html`<div class="card"><h2 class="section-title" style="margin-bottom:10px">Contact the organisers</h2><p class="contact-box">${data.contact}</p></div>` : ''}
          </section>
        </div>`
      )
    );
    bindHelp(ticket);
  },

  async leaderboard(params, seq) {
    let data;
    try {
      data = await api('/team/leaderboard');
    } catch (err) {
      if (seq !== app.seq) return;
      setHTML(main, html`<div class="card">${empty('Leaderboard hidden', err.message)}</div>`);
      return;
    }
    if (seq !== app.seq) return;
    setHTML(
      main,
      html`
      <div class="page-head"><div><h1 class="page-title">Leaderboard</h1><p>Totals from published rounds only. Teams still in the competition rank above eliminated teams.</p></div></div>
      ${data.rounds.length
        ? html`<div class="card card-flush"><div class="table-wrap"><table class="table">
          <thead><tr><th class="num">#</th><th>Team</th>${data.rounds.map((r) => html`<th class="num" title="${r.name}">R${r.number} <span class="faint">/${fmtScore(r.max_total)}</span></th>`)}<th class="num">Total</th><th>Status</th></tr></thead>
          <tbody>${data.rows.map(
            (row) => html`<tr class="${row.team_id === data.me ? 'is-me' : ''} ${row.eliminated_in ? 'is-dim' : ''}">
              <td class="num">${row.rank}</td>
              <td class="team-cell"><strong>${row.name}${row.team_id === data.me ? ' (you)' : ''}</strong><small>${row.code}${row.track ? ' · ' + row.track : ''}</small></td>
              ${row.rounds.map((r) => html`<td class="num">${fmtScore(r.total)}</td>`)}
              <td class="num"><strong>${fmtScore(row.total)}</strong></td>
              <td>${row.eliminated_in ? chip('eliminated', `Out in R${row.eliminated_in}`) : chip('selected', 'In')}${row.awards.map((a) => html` ${chip('award', a)}`)}</td>
            </tr>`
          )}</tbody></table></div></div>`
        : html`<div class="card">${empty('No results yet', 'The leaderboard fills in as soon as the first round’s results are published.')}</div>`}`
    );
  },

  team() {
    const t = app.data.team;
    setHTML(
      main,
      html`
      <div class="page-head"><div><h1 class="page-title">${t.name}</h1><p>Your team’s details as registered with the organisers. Ask at the help desk if anything is wrong.</p></div></div>
      <div class="two-col" style="margin-top:0">
        <section class="card">
          <h2 class="section-title" style="margin-bottom:12px">Team details</h2>
          <ul class="list-plain">
            <li><span class="muted">Team ID</span><span class="code-tag">${t.code}</span></li>
            <li><span class="muted">Team leader</span><span>${t.leader_name || '–'}</span></li>
            ${t.email ? html`<li><span class="muted">Email</span><span>${t.email}</span></li>` : ''}
            ${t.phone ? html`<li><span class="muted">Phone</span><span>${t.phone}</span></li>` : ''}
            <li><span class="muted">Track</span><span>${t.track || '–'}</span></li>
            <li><span class="muted">Table</span><span>${t.table_no || '–'}</span></li>
          </ul>
        </section>
        <section class="stack">
          <div class="card">
            <h2 class="section-title" style="margin-bottom:12px">Members</h2>
            ${t.members.length ? html`<ul class="list-plain">${t.members.map((m, i) => html`<li><span>${m}</span>${i === 0 && m === t.leader_name ? chip('judging', 'Leader') : ''}</li>`)}</ul>` : html`<p class="muted">No members listed.</p>`}
          </div>
          <div class="card">
            <h2 class="section-title" style="margin-bottom:8px">Password</h2>
            ${app.data.event.allow_password_change
              ? html`<p class="muted small" style="margin-bottom:12px">Changing it signs out your team’s other devices.</p><button type="button" class="btn" id="change-pw">${icon('key')}Change password</button>`
              : html`<p class="muted small">Only the organisers can change your password. Ask at the help desk if you need a new one.</p>`}
          </div>
        </section>
      </div>`
    );
    $('#change-pw')?.addEventListener('click', changePassword);
  },
};

function roundCard(r) {
  const head = html`<div><div class="round-no">Round ${r.number}${r.is_elimination ? '' : ' · no eliminations'}</div><h2 class="round-name">${r.name}</h2></div>`;
  if (!r.reached) {
    return html`<section class="card round-card" style="opacity:.6"><div class="round-locked">${head}${chip('upcoming', 'Not reached')}</div></section>`;
  }
  if (!r.published) {
    const crit = r.criteria.map((c) => `${c.name} (/${fmtScore(c.max_score)})`).join(' · ');
    return html`<section class="card round-card">
      <div class="round-locked">${head}${chip(r.state, r.state === 'completed' ? 'Awaiting results' : STATE_LABEL[r.state])}</div>
      ${r.description ? html`<p class="muted" style="margin-top:10px">${r.description}</p>` : ''}
      ${crit ? html`<p class="crit-names">Judged on: ${crit}</p>` : ''}
    </section>`;
  }
  const statusChip =
    r.status === 'eliminated' ? chip('eliminated', 'Not selected') : r.status === 'pending' ? chip('pending', 'Result pending') : r.status === 'selected' ? chip('selected', 'Selected') : chip('advanced', 'Evaluated');
  return html`<section class="card round-card">
    <div class="round-head">${head}
      <div class="round-total"><div><span class="big">${fmtScore(r.total)}</span> <span class="of">/ ${fmtScore(r.max_total)}</span></div><div class="row" style="justify-content:flex-end;margin-top:8px">${statusChip}${r.award ? chip('award', r.award) : ''}</div></div>
    </div>
    <div class="crit-list">${r.criteria.map((c) => {
      const pct = c.score === null ? 0 : Math.max(0, Math.min(100, (c.score / c.max_score) * 100));
      return html`<div class="crit"><span>${c.name}</span><div class="bar" role="img" aria-label="${c.name}: ${fmtScore(c.score)} of ${fmtScore(c.max_score)}"><i style="width:${pct.toFixed(1)}%"></i></div><span class="mono">${fmtScore(c.score)} / ${fmtScore(c.max_score)}</span></div>`;
    })}</div>
    ${r.comments ? html`<div class="notes"><span class="label">Judges’ notes</span><p>${r.comments}</p></div>` : ''}
  </section>`;
}

const KIND_LABEL = { round: 'Round', deadline: 'Deadline', food: 'Food', talk: 'Talk' };
const KIND_CHIP = { round: 'judging', deadline: 'eliminated', food: 'advanced', talk: 'pending' };

function timeline(items) {
  const now = clock.now();
  const groups = new Map();
  for (const e of items) {
    const k = dayKey(e.starts_at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  let nextMarked = false;
  return html`<div class="timeline">${[...groups.values()].map(
    (list) => html`<section class="tl-day"><h2>${fmtDayLong(list[0].starts_at)}</h2><ol class="tl-items">${list.map((e) => {
      const start = Date.parse(e.starts_at);
      const end = e.ends_at ? Date.parse(e.ends_at) : start + 15 * 60000;
      const state = end < now ? 'is-past' : start <= now ? 'is-now' : '';
      let tag = '';
      if (state === 'is-now') tag = chip('live', 'Happening now');
      else if (!state && !nextMarked) {
        nextMarked = true;
        tag = chip('open', 'Up next');
      }
      return html`<li class="tl-item ${state} kind-${e.kind}">
        <span class="tl-time">${fmtTime(e.starts_at)}${e.ends_at ? html`<br><span class="faint">– ${fmtTime(e.ends_at)}</span>` : ''}</span>
        <div class="tl-body"><h3>${e.title}</h3>${e.details ? html`<p>${e.details}</p>` : ''}
          <div class="row">${tag}${KIND_LABEL[e.kind] ? chip(KIND_CHIP[e.kind], KIND_LABEL[e.kind]) : ''}${e.location ? html`<span class="small muted">${e.location}</span>` : ''}</div></div>
      </li>`;
    })}</ol></section>`
  )}</div>`;
}

// ---------- help desk bits --------------------------------------------------------------------
function newTicketCard(categories) {
  return html`<form class="card stack" id="ticket-form" novalidate>
    <h2 class="section-title">New request</h2>
    <label class="field"><span>What do you need?</span>
      <select class="select" name="category" id="t-category">${categories.map((c) => html`<option>${c}</option>`)}</select></label>
    <label class="field"><span>Subject</span><input class="input" name="subject" id="t-subject" maxlength="120" placeholder="e.g. Need a mentor for our ML model" required></label>
    <label class="field"><span>Details</span><textarea class="textarea" name="message" id="t-message" maxlength="3000" placeholder="Tell the organisers what’s going on and where to find you." required></textarea></label>
    <div class="form-error" role="alert"></div>
    <div class="row"><button class="btn btn-primary" type="submit">${icon('send')}Send request</button>
      ${app.data && location.hash.includes('new') ? html`<a class="btn btn-ghost" href="#/help">Cancel</a>` : ''}</div>
  </form>`;
}

function pickCard() {
  return html`<div class="card">${empty('Pick a request', 'Select a request on the left to see the conversation, or raise a new one.')}</div>`;
}

function threadCard(t) {
  return html`<section class="card stack">
    <div class="row-between"><div><h2 class="section-title">${t.subject}</h2><p class="small muted" style="margin-top:6px">${t.category} · opened ${timeAgo(t.created_at)}</p></div>${chip(t.status, TICKET_LABEL[t.status])}</div>
    <div class="thread">${t.messages.map(
      (m) => html`<div class="msg ${m.author_type === 'team' ? 'mine' : ''}"><p>${m.body}</p><small>${m.author_type === 'admin' ? `${m.author_name} (organiser)` : m.author_name} · ${timeAgo(m.created_at)}</small></div>`
    )}</div>
    <form class="stack-sm" id="reply-form" novalidate>
      <label class="field"><span>${t.status === 'resolved' ? 'Reply to reopen this request' : 'Reply'}</span>
        <textarea class="textarea" name="message" id="reply-${t.id}" maxlength="3000" required placeholder="Write a reply…"></textarea></label>
      <div class="form-error" role="alert"></div>
      <div><button class="btn btn-primary" type="submit">${icon('send')}Send reply</button></div>
    </form>
  </section>`;
}

function bindHelp(ticket) {
  const tf = $('#ticket-form');
  tf?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', tf);
    err.textContent = '';
    const v = formValues(tf);
    if (!v.subject.trim() || !v.message.trim()) return (err.textContent = 'Add a subject and some details.');
    await withBusy($('button[type=submit]', tf), async () => {
      try {
        const res = await api('/team/tickets', { method: 'POST', body: v });
        tf.reset();
        toast('Request sent. An organiser will reply here.', 'ok');
        location.hash = `#/help/${res.ticket.id}`;
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  });
  const rf = $('#reply-form');
  rf?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', rf);
    const box = $('textarea', rf);
    if (!box.value.trim()) return (err.textContent = 'Write a message first.');
    await withBusy($('button[type=submit]', rf), async () => {
      try {
        await api(`/team/tickets/${ticket.id}/messages`, { method: 'POST', body: { message: box.value } });
        box.value = '';
        render();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  });
}

function changePassword() {
  formModal({
    title: 'Change password',
    submitLabel: 'Change password',
    content: html`
      <label class="field"><span>Current password</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span>New password <span class="hint">At least 8 characters</span></span><input class="input" type="password" name="next" autocomplete="new-password" minlength="8" required></label>`,
    async onSubmit(v) {
      await api('/auth/password', { method: 'POST', body: v });
      toast('Password changed. Other devices were signed out.', 'ok');
    },
  });
}

// ---------- routing + live updates -------------------------------------------------------------
async function render() {
  const view = VIEWS[app.view] ? app.view : 'overview';
  if (view === 'leaderboard' && !app.data.event.leaderboard_visible) {
    location.hash = '#/overview';
    return;
  }
  for (const a of $$('#tabs a')) {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const seq = ++app.seq;
  try {
    await VIEWS[view](app.params, seq);
  } catch (err) {
    if (seq !== app.seq) return;
    setHTML(main, html`<div class="card">${empty('Couldn’t load this page', err.message, html`<button class="btn" type="button" id="retry">${icon('refresh')}Try again</button>`)}</div>`);
    $('#retry')?.addEventListener('click', render);
  }
}

const refresh = debounce(async () => {
  try {
    await loadCore();
    await preserveInputs(main, render);
  } catch (err) {
    toastError(err);
  }
}, 250);

function onRoute(view, params) {
  const changed = view !== app.view;
  app.view = view;
  app.params = params;
  if (changed) scrollTo({ top: 0 });
  renderChrome();
  render();
}

(async () => {
  try {
    await loadCore();
  } catch (err) {
    setHTML(main, html`<div class="card">${empty('Couldn’t load your portal', err.message)}</div>`);
    return;
  }
  startRouter('overview', onRoute);

  connectLive(
    {
      async announcement(a) {
        const kind = a.priority === 'urgent' ? 'error' : a.priority === 'important' ? 'warn' : 'ember';
        const show = (title) => toast(title, kind, { title: 'New announcement', action: { label: 'Read', onClick: () => (location.hash = '#/announcements') } });
        if (a.title) {
          show(a.title);
          if (a.priority === 'urgent' && app.view !== 'announcements') renderUrgent(a);
          return refresh();
        }
        // Live signals from the database carry no text; fetch the announcement.
        try {
          await loadCore();
          await preserveInputs(main, render);
          const list = app.data.announcements || [];
          const latest = list.find((x) => x.id === a.id) || list[0];
          show(latest ? latest.title : 'Open Announcements to read it.');
        } catch (err) {
          toastError(err);
        }
      },
      announcements: refresh,
      results(e) {
        if (e.kind === 'published') {
          toast(`Round ${e.round} results are out.`, 'ember', { title: 'Results published', action: { label: 'View', onClick: () => (location.hash = '#/overview') } });
          app.reveal = true;
        }
        refresh();
      },
      rounds: refresh,
      schedule: refresh,
      settings: refresh,
      profile: refresh,
      ticket(e) {
        const what = e.subject ? `“${e.subject}”` : 'your help request';
        if (e.kind === 'reply') toast(`An organiser replied to ${what}.`, 'ember', { title: 'Help desk', action: { label: 'Open', onClick: () => (location.hash = `#/help/${e.id}`) } });
        if (e.kind === 'status' && TICKET_LABEL[e.status]) toast(`${e.subject ? what : 'Your help request'} is now ${TICKET_LABEL[e.status].toLowerCase()}.`, 'info', { title: 'Help desk' });
        refresh();
      },
      'signed-out'() {
        try { localStorage.removeItem('genesis-session'); } catch { /* ignore */ }
        location.href = `${HOME}?signedout=1`;
      },
      reconnect: refresh,
    },
    $('#live')
  );
})();
