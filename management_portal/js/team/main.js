import {
  $, $$, api, html, raw, setHTML, icon, MARK, clock, toast, toastError, formModal, formValues, withBusy,
  connectLive, startRouter, preserveInputs, debounce, signOut, richText, timeAgo, fmtTime, fmtDay,
  fmtScore, fmtDateTime, STATE_LABEL, TICKET_LABEL, guardPage, HOME, COMP_LABEL,
} from '../core.js';
import { setEventTimes, mountDial, eventRangeText, fmtDuration, phase } from '../dial.js';
import { chip, empty, annItem, timeline, urgentBar } from '../portal.js';

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
  $('#brand-comp').textContent = COMP_LABEL[d.competition];
  document.title = `${d.team.name} · ${d.event.event_name}`;
  $('#who-team').textContent = d.team.name;
  $('#who-code').textContent = `${d.team.code}${d.team.leader_name ? ' · ' + d.team.leader_name : ''}`;

  document.body.dataset.comp = d.competition;
  const ideathon = d.competition === 'ideathon';
  const tabs = [
    ['overview', 'Overview'],
    ideathon ? null : ['scorecard', 'Scorecard'],
    ideathon && d.submission.enabled ? ['idea', 'My idea'] : null,
    ['announcements', 'Announcements', d.unread],
    ['schedule', 'Schedule'],
    ['help', 'Help desk', d.tickets_unread],
    !ideathon && d.event.leaderboard_visible ? ['leaderboard', 'Leaderboard'] : null,
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
  const seen = app.data.announcements_seen_at;
  const a = fresh || (app.data.announcements || []).find((x) => x.priority === 'urgent' && (!seen || x.created_at > seen));
  const show = a && app.dismissedUrgent !== a.id && app.view !== 'announcements';
  urgentBar($('#urgent'), show ? a : null, (id) => (app.dismissedUrgent = id));
}

// ---------- rendering helpers ------------------------------------------------------------

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

// ---------- ideathon: no rounds, so status comes from the idea and the final results ----------
function ideaStanding(d) {
  const sub = d.submission;
  const res = d.result;
  const mine = sub.mine;
  if (res.published) {
    return res.award
      ? { kind: 'finished', title: res.award, text: res.note || 'Congratulations to the whole team. Thank you for taking part!' }
      : { kind: 'waiting', title: 'Results are out', text: res.note || 'Thank you for taking part. See Announcements for the full list of winners.' };
  }
  if (!sub.enabled) {
    return { kind: 'waiting', title: 'You’re in', text: 'Work on your idea through the 24 hours. Your result will appear here once the organisers publish it.' };
  }
  if (mine) {
    return {
      kind: 'advancing',
      title: 'Idea submitted',
      text: sub.open ? `“${mine.title}”. You can keep improving it until submissions close.` : `“${mine.title}”. Submissions are closed. Your result will appear here.`,
      countdown: sub.open && sub.deadline ? sub.deadline : null,
    };
  }
  if (sub.open) {
    return {
      kind: 'pending',
      title: 'Submit your idea',
      text: 'Add your idea any time during the event and keep improving it. The judges see your latest version.',
      countdown: sub.deadline || null,
    };
  }
  return sub.accepting && sub.deadline
    ? { kind: 'eliminated', title: 'Submissions closed', text: 'The deadline has passed without an idea from your team. Talk to an organiser if this is a mistake.' }
    : { kind: 'waiting', title: 'You’re in', text: 'Idea submissions aren’t open yet. Watch Announcements for when they open.' };
}

function ideaSteps(d) {
  const sub = d.submission;
  const ph = phase();
  const step = (cls, node, title, note) => html`<li class="${cls}"><span class="node">${node}</span><strong>${title}</strong><small>${note}</small></li>`;
  const out = [step('is-done', icon('check'), 'Registered', 'You’re in')];
  if (sub.enabled) {
    if (sub.mine) out.push(step('is-done', icon('check'), 'Idea submitted', `Saved ${timeAgo(sub.mine.updated_at)}`));
    else if (sub.open) out.push(step('is-now', '2', 'Idea', sub.deadline ? `Due ${fmtDateTime(sub.deadline)}` : 'Open now'));
    else out.push(step('is-pending', '2', 'Idea', sub.accepting && sub.deadline ? 'Closed' : 'Not open yet'));
  } else {
    const kinds = { live: ['is-now', 'Happening now'], after: ['is-done', '24 hours done'], before: ['', 'Starts soon'], unset: ['', 'Time to be announced'] };
    const [cls, note] = kinds[ph.kind];
    out.push(step(cls, cls === 'is-done' ? icon('check') : '2', 'Build your idea', note));
  }
  out.push(d.result.published ? step('is-done', icon('award'), 'Results', 'Published') : step('', '3', 'Results', 'After judging'));
  return out;
}

function ideaReadOnly(s) {
  const links = [['Pitch deck', s.deck_url], ['Video', s.video_url], ['Other link', s.extra_url]].filter(([, u]) => u);
  return html`<article class="card stack idea-view">
    <h2 class="idea-title">${s.title}</h2>
    <section><span class="label">The problem</span><div>${richText(s.problem)}</div></section>
    <section><span class="label">Solution</span><div>${richText(s.solution)}</div></section>
    ${s.impact ? html`<section><span class="label">Impact</span><div>${richText(s.impact)}</div></section>` : ''}
    ${links.length ? html`<div class="row">${links.map(([label, u]) => html`<a class="btn btn-sm" href="${u}" target="_blank" rel="noopener noreferrer">${icon('link')}${label}</a>`)}</div>` : ''}
    <p class="small muted">Last saved ${fmtDateTime(s.updated_at)}</p>
  </article>`;
}

// Live "closes in" countdowns anywhere on the page.
function tickCountdowns() {
  for (const el of $$('[data-countdown]')) {
    const left = Date.parse(el.dataset.countdown) - clock.now();
    el.textContent = left > 0 ? fmtDuration(left) : 'now';
  }
}
setInterval(tickCountdowns, 1000);

// ---------- views -------------------------------------------------------------------------
const VIEWS = {
  overview() {
    const d = app.data;
    const ideathon = d.competition === 'ideathon';
    const s = ideathon ? ideaStanding(d) : d.standing;
    const steps = ideathon ? ideaSteps(d) : d.journey.map(roundStep);
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
            ${s.countdown ? html`<p class="deadline-line">${icon('clock')}<span>Submissions close in <b class="mono" data-countdown="${s.countdown}"></b></span></p>` : ''}
          </div>
          <ol class="path" style="--n:${steps.length}" aria-label="${ideathon ? 'Your progress' : 'Round progress'}">${steps}</ol>
          <div class="row">${ideathon
            ? d.submission.enabled
              ? html`<a class="btn${d.submission.mine || !d.submission.open ? '' : ' btn-primary'}" href="#/idea">${icon('bulb')}${d.submission.mine ? 'View my idea' : d.submission.open ? 'Submit your idea' : 'My idea'}</a>`
              : html`<a class="btn" href="#/announcements">${icon('megaphone')}Announcements</a>`
            : html`<a class="btn" href="#/scorecard">${icon('trophy')}Open scorecard</a>`}</div>
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
    tickCountdowns();
    app.reveal = false;
  },

  async idea(params, seq) {
    const data = await api('/team/submission');
    if (seq !== app.seq) return;
    if (!data.enabled) {
      setHTML(main, html`<div class="card">${empty('Idea submissions are off', 'The organisers aren’t collecting ideas through the portal for this Ideathon. Follow the announcements for how to present.')}</div>`);
      return;
    }
    const s = data.submission;
    const locked = !data.open;
    const closedText = data.accepting && data.deadline ? `The deadline (${fmtDateTime(data.deadline)}) has passed.` : 'The organisers haven’t opened submissions right now.';
    const head = html`<div class="page-head">
      <div><h1 class="page-title">My idea</h1><p>${locked
        ? s ? 'Submissions are closed, so this is the final version the judges will see.' : closedText
        : 'Save as often as you like. The organisers always see your latest version.'}</p></div>
      <div class="row">${s ? chip('selected', 'Submitted') : chip(locked ? 'eliminated' : 'pending', locked ? 'Not submitted' : 'Not submitted yet')}
        ${!locked && data.deadline ? html`<span class="deadline-line">${icon('clock')}<span>Closes in <b class="mono" data-countdown="${data.deadline}"></b></span></span>` : ''}</div>
    </div>`;

    if (locked) {
      setHTML(main, html`${head}${s ? ideaReadOnly(s) : html`<div class="card">${empty('No idea on file', closedText + ' Ask at the help desk if you think this is a mistake.')}</div>`}`);
      tickCountdowns();
      return;
    }

    const v = s || {};
    setHTML(
      main,
      html`${head}
      <div class="idea-grid">
        <form class="card stack" id="idea-form" novalidate>
          <label class="field"><span>Idea title <span class="hint">Up to 120 characters</span></span>
            <input class="input" id="idea-title" name="title" maxlength="120" value="${v.title || ''}" placeholder="A short, memorable name for your idea" required></label>
          <label class="field"><span>The problem <span class="hint">Who has it, and why it matters</span></span>
            <textarea class="textarea" id="idea-problem" name="problem" maxlength="2000" rows="5" required>${v.problem || ''}</textarea></label>
          <label class="field"><span>Your solution <span class="hint">What you’d build and how it works</span></span>
            <textarea class="textarea" id="idea-solution" name="solution" maxlength="3000" rows="7" required>${v.solution || ''}</textarea></label>
          <label class="field"><span>Impact <span class="hint">Optional · who benefits and how you’d measure it</span></span>
            <textarea class="textarea" id="idea-impact" name="impact" maxlength="1500" rows="4">${v.impact || ''}</textarea></label>
          <div class="grid-3">
            <label class="field"><span>Pitch deck link</span><input class="input" id="idea-deck" name="deck_url" type="url" maxlength="500" value="${v.deck_url || ''}" placeholder="https://"></label>
            <label class="field"><span>Video link</span><input class="input" id="idea-video" name="video_url" type="url" maxlength="500" value="${v.video_url || ''}" placeholder="https://"></label>
            <label class="field"><span>Other link</span><input class="input" id="idea-extra" name="extra_url" type="url" maxlength="500" value="${v.extra_url || ''}" placeholder="https://"></label>
          </div>
          <div class="form-error" role="alert"></div>
          <div class="row-between">
            <span class="small muted">${s ? `Last saved ${timeAgo(s.updated_at)}` : 'Not saved yet'}</span>
            <button class="btn btn-primary" type="submit">${icon('check')}${s ? 'Save changes' : 'Submit idea'}</button>
          </div>
        </form>
        <aside class="card stack-sm idea-tips">
          <h2 class="section-title">Tips</h2>
          <ul class="tips">
            <li>Lead with the problem. Judges remember a sharp problem statement.</li>
            <li>Keep the solution concrete: who uses it, and what happens step by step.</li>
            <li>Share links as “anyone with the link can view”, or judges won’t be able to open them.</li>
            <li>You can keep editing until submissions close.</li>
          </ul>
        </aside>
      </div>`
    );
    tickCountdowns();
    const form = $('#idea-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      err.textContent = '';
      const body = formValues(form);
      if (!body.title.trim() || !body.problem.trim() || !body.solution.trim()) {
        err.textContent = 'Add a title, the problem and your solution.';
        return;
      }
      await withBusy($('button[type=submit]', form), async () => {
        try {
          const res = await api('/team/submission', { method: 'PUT', body });
          app.data.submission.mine = res.submission;
          toast(s ? 'Changes saved.' : 'Idea submitted. You can keep editing until submissions close.', 'ok');
          render();
        } catch (ex) {
          err.textContent = ex.message;
        }
      });
    });
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
    ${r.comments ? html`<div class="notes"><span class="label">${r.feedback?.length ? 'Organisers’ summary' : 'Judges’ notes'}</span><p>${r.comments}</p></div>` : ''}
    ${r.feedback?.length
      ? html`<div class="notes"><span class="label">Judges’ comments</span><div class="feedback">${r.feedback.map(
          (f) => html`<div class="fb"><strong>${f.label}</strong><p>${f.comments}</p></div>`
        )}</div></div>`
      : ''}
  </section>`;
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
  const d = app.data;
  const ideathon = d.competition === 'ideathon';
  const hidden = {
    leaderboard: ideathon || !d.event.leaderboard_visible,
    scorecard: ideathon,
    idea: !ideathon || !d.submission.enabled,
  };
  if (hidden[view]) {
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
          toast(e.round ? `Round ${e.round} results are out.` : 'The final results are out.', 'ember', { title: 'Results published', action: { label: 'View', onClick: () => (location.hash = '#/overview') } });
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
