import { $, api, html, setHTML, icon, timeAgo, fmtDateTime, STATE_LABEL, TICKET_LABEL, PRIORITY_LABEL } from '../core.js';
import { mountDial, eventRangeText } from '../dial.js';
import { chip, empty } from './shared.js';
import { openComposer } from './announcements.js';

export const live = ['teams', 'rounds', 'results', 'announcement', 'announcements', 'ticket', 'settings', 'schedule', 'judges', 'submission'];

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export async function render(ctx, params, seq) {
  const d = await api('/admin/dashboard');
  if (!ctx.isCurrent(seq)) return;
  const s = d.stats;
  const ideathon = d.competition === 'ideathon';
  const noTime = !d.settings.event_start || !d.settings.event_end;

  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Dashboard</h1><p>${d.settings.event_name}${eventRangeText() ? ` · ${eventRangeText()}` : ''}</p></div>
      <div class="row">
        <button type="button" class="btn" id="d-announce">${icon('megaphone')}New announcement</button>
        ${ideathon
          ? d.ideathon.state.enabled
            ? html`<a class="btn btn-primary" href="#/submissions">${icon('bulb')}View ideas</a>`
            : html`<a class="btn btn-primary" href="#/results">${icon('award')}Results</a>`
          : html`<a class="btn btn-primary" href="#/rounds">${icon('trophy')}Enter scores</a>`}
      </div>
    </div>

    ${noTime ? html`<div class="callout callout-warn" style="margin-bottom:18px">${icon('clock')}<span>The event clock isn’t set. <a href="#/settings">Add the start and end time in Settings</a> so teams see the countdown.</span></div>` : ''}

    <div class="hero-grid">
      <section class="card hero-dial"><div data-dial></div><p class="event-line">${d.settings.venue || 'Venue not set'}</p></section>
      ${ideathon ? ideathonCard(d) : roundsCard(d)}
    </div>

    <div class="stats" style="margin-top:20px">
      ${stat(s.teams, 'Teams registered')}
      ${ideathon
        ? d.ideathon.state.enabled ? stat(`${d.ideathon.submissions}/${s.active}`, 'Ideas submitted') : ''
        : html`${stat(s.competing, 'Still competing')}${stat(s.eliminated, 'Eliminated')}`}
      ${stat(`${s.logged_in}/${s.active}`, 'Have signed in')}
      ${stat(s.tickets_open, 'Open help requests', s.tickets_unread > 0)}
      ${stat(s.online, 'Tabs open right now')}
    </div>

    ${ideathon ? '' : judgingCard(d)}

    <div class="two-col">
      <section class="card card-flush">
        <div class="card-head"><h2 class="section-title">Help requests</h2><a class="btn btn-ghost btn-sm" href="#/help">Open help desk</a></div>
        ${d.tickets.length
          ? html`<div class="ticket-list" style="margin-top:8px">${d.tickets.map(
              (t) => html`<a class="ticket-row${t.admin_unread ? ' is-unread' : ''}" href="#/help/${t.id}"><strong>${t.subject}</strong>${chip(t.status, TICKET_LABEL[t.status])}<small>${t.team_name} · ${t.category} · ${timeAgo(t.updated_at)}</small></a>`
            )}</div>`
          : empty('All clear', 'No open help requests right now.')}
      </section>
      <section class="stack">
        <div class="card">
          <div class="card-head"><h2 class="section-title">Latest announcements</h2><a class="btn btn-ghost btn-sm" href="#/announcements">All</a></div>
          ${d.announcements.length
            ? html`<ul class="list-plain">${d.announcements.map((a) => html`<li><span>${a.title}<br><small class="faint">${timeAgo(a.created_at)} · ${a.author}</small></span>${a.priority !== 'normal' ? chip(a.priority, PRIORITY_LABEL[a.priority]) : ''}</li>`)}</ul>`
            : html`<p class="muted small">Nothing posted yet.</p>`}
        </div>
        <div class="card">
          <div class="card-head"><h2 class="section-title">Not signed in yet</h2><span class="muted small">${d.never_logged_in.length} team${d.never_logged_in.length === 1 ? '' : 's'}</span></div>
          ${d.never_logged_in.length
            ? html`<ul class="list-plain">${d.never_logged_in.slice(0, 8).map((t) => html`<li><span>${t.name}</span><span class="code-tag">${t.code}</span></li>`)}</ul>
               ${d.never_logged_in.length > 8 ? html`<p class="small muted" style="margin-top:8px"><a href="#/teams">See all teams</a></p>` : ''}`
            : html`<p class="muted small">${s.active ? 'Every team has signed in at least once.' : 'Add teams to get started.'}</p>`}
        </div>
      </section>
    </div>`
  );
  mountDial($('[data-dial]', ctx.main));
  $('#d-announce').addEventListener('click', () => openComposer(ctx));
}

function roundsCard(d) {
  return html`<section class="card">
    <div class="card-head"><h2 class="section-title">Rounds</h2><a class="btn btn-ghost btn-sm" href="#/rounds">Manage</a></div>
    <ul class="list-plain">${d.rounds.map(
      (r) => html`<li>
        <a href="#/rounds/${r.number}" style="color:inherit;text-decoration:none"><span class="round-no">Round ${r.number}</span><br><strong>${r.name}</strong>${r.is_elimination ? '' : html` <span class="small faint">· no eliminations</span>`}</a>
        <span class="row">${chip(r.state, STATE_LABEL[r.state])}${r.published ? chip('selected', 'Published') : chip('upcoming', 'Hidden')}</span>
      </li>`
    )}</ul>
  </section>`;
}

function judgingCard(d) {
  const j = d.judging;
  if (!j) return '';
  return html`<section class="card" style="margin-top:20px">
    <div class="card-head"><h2 class="section-title">Judging</h2><a class="btn btn-ghost btn-sm" href="#/judges">${j.judges ? 'Manage judges' : 'Add judges'}</a></div>
    ${j.judges
      ? html`<div class="judging-grid">${j.rounds.map(
          (r) => html`<a class="judging-round${r.open ? ' is-open' : ''}" href="#/judges/${r.number}">
            <span class="round-no">Round ${r.number}</span><strong>${r.name}</strong>
            ${r.assigned
              ? html`<span class="progress" aria-hidden="true"><i style="width:${pct(r.done, r.assigned)}%"></i></span>
                 <span class="small muted">${r.done}/${r.assigned} marked done${r.open ? ' · judging open' : ''}</span>`
              : html`<span class="small faint">No judges assigned</span>`}
          </a>`
        )}</div>
        <p class="small faint" style="margin-top:10px">${j.judges} active judge${j.judges === 1 ? '' : 's'}. Judges can enter marks while a round is “Live” or “Judging” and not yet published.</p>`
      : html`<p class="muted small">No judges yet. You can score teams yourself on the Rounds page, or add judges so each one scores their assigned teams.</p>`}
  </section>`;
}

function ideathonCard(d) {
  const st = d.ideathon.state;
  const subLine = !st.enabled
    ? 'Turned off. Teams just work through the 24 hours.'
    : st.open
      ? `Open${st.deadline ? ` until ${fmtDateTime(st.deadline)}` : ''}`
      : st.accepting && st.deadline ? `Closed (deadline ${fmtDateTime(st.deadline)})` : 'Closed';
  return html`<section class="card stack">
    <div class="card-head" style="margin:0"><h2 class="section-title">Ideathon</h2><a class="btn btn-ghost btn-sm" href="#/settings">Settings</a></div>
    <ul class="list-plain">
      <li><span><strong>Idea submissions</strong><br><small class="faint">${subLine}</small></span>
        <span class="row">${!st.enabled ? chip('upcoming', 'Off') : st.open ? chip('live', 'Open') : chip('completed', 'Closed')}${st.enabled ? html`<a class="btn btn-ghost btn-sm" href="#/submissions">${d.ideathon.submissions} in</a>` : ''}</span></li>
      <li><span><strong>Results</strong><br><small class="faint">${d.ideathon.results_published ? 'Teams can see their awards and notes.' : 'Hidden from teams until you publish.'}</small></span>
        <span class="row">${d.ideathon.results_published ? chip('selected', 'Published') : chip('upcoming', 'Hidden')}<a class="btn btn-ghost btn-sm" href="#/results">Open</a></span></li>
    </ul>
  </section>`;
}

const stat = (value, label, warn = false) => html`<div class="card stat${warn ? ' is-warn' : ''}"><b>${value}</b><span>${label}</span></div>`;
