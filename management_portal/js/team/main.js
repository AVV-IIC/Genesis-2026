import {
  $, $$, api, html, raw, setHTML, icon, MARK, clock, toast, toastError, formModal, formValues, withBusy, confirmDialog,
  connectLive, startRouter, preserveInputs, debounce, signOut, richText, timeAgo, fmtTime, fmtDay,
  fmtScore, fmtDateTime, STATE_LABEL, TICKET_LABEL, guardPage, HOME, COMP_LABEL, EVENT_HOURS,
} from '../core.js';
import { setEventTimes, mountDial, eventRangeText, fmtDuration, phase, onPhaseChange } from '../dial.js';
import { celebrate } from '../launch.js';
import { chip, empty, annItem, timeline, urgentBar } from '../portal.js';
import { roster, writer, sheetFor, cells, cellKey, filled, chainsHTML, RULES, SHEETS, ITERATIONS, TOTAL, MAX_TEXT } from '../design.js';

const main = $('#main');
const app = { data: null, view: 'overview', params: [], seq: 0, reveal: false, dismissedUrgent: null, dt: null };

guardPage('team');

// Inauguration: when the organisers press Start while this page is open, celebrate.
onPhaseChange((kind, prev) => {
  if (kind === 'live' && (prev === 'unset' || prev === 'before') && app.data) {
    celebrate({ eventName: app.data.event.event_name, label: COMP_LABEL[app.data.competition], hours: EVENT_HOURS[app.data.competition] });
  }
});
setHTML($('#mark'), MARK);
$('#signout').addEventListener('click', signOut);

// ---------- data + chrome ------------------------------------------------------------
async function loadCore() {
  app.data = await api('/team/overview');
  clock.sync(app.data.serverTime);
  setEventTimes({ ...app.data.event, markers: app.data.markers, hours: EVENT_HOURS[app.data.competition] });
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
    ideathon && d.design && d.design.enabled ? ['design', 'Design Thinking'] : null,
    ideathon && d.assessments && d.assessments.on ? ['assessments', 'Assessments', asTodo(d)] : null,
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
      ${ideathon ? asBanners(d) : ''}
      <div class="hero-grid">
        <section class="card hero-dial" aria-label="Event clock">
          <div data-dial></div>
          <p class="event-line">${eventRangeText() || `The ${EVENT_HOURS[d.competition]}-hour clock starts when the organisers press Start.`}${d.event.venue ? html`<br>${d.event.venue}` : ''}</p>
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
          <div class="row">${ideathon && d.design && d.design.enabled ? html`<a class="btn" href="#/design">${icon('sparkle')}Design Thinking</a>` : ''}${ideathon
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

  async design(params, seq) {
    const dt = await api('/team/design');
    if (seq !== app.seq) return;
    if (!dt.enabled) {
      setHTML(main, html`<div class="card">${empty('Design Thinking is off', 'The organisers haven’t opened the Design Thinking page right now. Watch the announcements.')}</div>`);
      return;
    }
    dt.stage = dt.stage || 1; // older databases have no stage yet
    app.dt = dt;
    const names = dtNames();
    const map = cells(dt.ideas);
    const stage = dt.stage;
    const finished = stage > ITERATIONS;
    setHTML(
      main,
      html`
      <div class="page-head">
        <div><h1 class="page-title">Design Thinking</h1><p>The 4-5-3 method: 4 members, about 5 minutes each, 3 iterations, 12 ideas. Everything saves as you type.</p></div>
        <div class="row"><span data-dt-total>${dtTotalChip(dt)}</span></div>
      </div>
      <section class="card dt-progress">${dtStepper(stage)}</section>
      ${finished ? '' : html`<details class="card dt-rules-card" ${dt.filled ? '' : 'open'}>
        <summary><strong>How it works</strong></summary>
        <ol class="dt-rules">${RULES.map(([t, text]) => html`<li><strong>${t}</strong><span>${text}</span></li>`)}</ol>
      </details>`}
      ${stage === 1
        ? html`<section class="card stack-sm dt-base">
            <label class="field"><span>Base idea <span class="hint">Your team’s starting idea</span></span>
              <textarea class="textarea" id="dt-base" data-dt="base" rows="3" maxlength="${MAX_TEXT}" placeholder="One or two sentences the whole team agrees on">${dt.base_idea}</textarea></label>
            <p class="small muted dt-state" data-state="base">${dt.base_idea ? 'Saved' : ''}</p>
          </section>`
        : html`<section class="card dt-base dt-base-locked"><span class="label">Base idea · locked</span><div>${richText(dt.base_idea)}</div></section>`}
      ${finished
        ? html`<div class="callout dt-done">${icon('award')}<span><strong>Your team has finished: ${dt.filled} ideas.</strong> Here’s how each idea grew as it passed from member to member.</span></div>
           <section class="card">${chainsHTML(dt, names)}</section>`
        : html`<div class="dt-iter-head">
             <h2 class="section-title">Iteration ${stage} of ${ITERATIONS}</h2>
             <p class="small muted">${stage === 1
               ? 'Everyone develops the base idea at the same time, each in their own box. About 5 minutes.'
               : 'Pass it along: build on the idea shown above your box. About 5 minutes.'}</p>
           </div>
           <div class="dt-grid">${dtRange(SHEETS).map((m) => dtCard(m, stage, names, map, dt))}</div>
           <section class="card dt-next" data-dt-next aria-live="polite">${dtNextHTML()}</section>`}`
    );
    bindDesign();
  },

  async assessments(params, seq) {
    const data = await api('/team/assessments');
    if (seq !== app.seq) return;
    clock.sync(data.serverTime);
    app.as = data.assessments;
    asLocking.clear();
    const head = html`<div class="page-head"><div><h1 class="page-title">Assessments</h1><p>Questions from the organisers after each session. Your team writes one set of answers together. Every answer saves as you type, and you can change it until time is up.</p></div></div>`;
    if (!app.as.length) {
      setHTML(main, html`${head}<div class="card">${empty('No questions right now', 'After each session the organisers post questions here, and this page lets you know.')}</div>`);
      return;
    }
    setHTML(main, html`${head}<div class="stack">${app.as.map(asSheet)}</div>`);
    tickCountdowns();
    bindAssess();
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

// ---------- Design Thinking (4-5-3) helpers ----------------------------------------------------
// The team moves through the iterations one at a time: "Go to iteration n" only unlocks once all
// 4 ideas are in, and after that the earlier iterations (and the base idea) are locked for everyone.
const dtRange = (n) => Array.from({ length: n }, (_, k) => k + 1);
const dtNames = () => roster(app.data.team.leader_name, app.data.team.members);
const dtTotalChip = (dt) => chip(dt.stage > ITERATIONS ? 'selected' : 'pending', `${dt.filled}/${TOTAL} ideas`);

function dtStepper(stage) {
  const steps = [...dtRange(ITERATIONS).map((i) => [`Iteration ${i}`, i]), ['Finished', ITERATIONS + 1]];
  return html`<ol class="path dt-path" style="--n:${steps.length}" aria-label="Design Thinking progress">${steps.map(([label, n]) => {
    const done = n < stage || (n > ITERATIONS && stage > ITERATIONS);
    const now = n === stage && stage <= ITERATIONS;
    return html`<li class="${done ? 'is-done' : now ? 'is-now' : ''}"><span class="node">${done ? icon('check') : n > ITERATIONS ? icon('award') : n}</span>
      <strong>${label}</strong><small>${done ? (n > ITERATIONS ? '12 ideas' : 'Locked') : now ? 'Now' : ''}</small></li>`;
  })}</ol>`;
}

/** What member m builds on in iteration i: the base idea, or the previous member's idea on the same sheet. */
function dtSource(member, iteration, names, map, dt) {
  if (iteration === 1) {
    return dt.base_idea
      ? html`<span class="label">Base idea</span><div>${richText(dt.base_idea)}</div>`
      : html`<span class="label">Base idea</span><p class="faint small">Write the base idea above first.</p>`;
  }
  const sheet = sheetFor(member, iteration);
  const prev = map.get(cellKey(iteration - 1, sheet));
  const by = names[writer(sheet, iteration - 1) - 1];
  return html`<span class="label">Build on ${by}’s idea</span>${filled(prev) ? html`<div>${richText(prev.body)}</div>` : html`<p class="faint small">(left empty)</p>`}`;
}

function dtCard(member, iteration, names, map, dt) {
  const sheet = sheetFor(member, iteration);
  const x = map.get(cellKey(iteration, sheet));
  const key = `${iteration}-${sheet}`;
  return html`<section class="card dt-card">
    <div class="dt-card-head"><span class="dt-who">${names[member - 1]}</span><span class="small faint">Sheet ${sheet}</span></div>
    <div class="dt-prev" data-prev="${member}">${dtSource(member, iteration, names, map, dt)}</div>
    <label class="field"><span class="sr-only">${names[member - 1]}’s idea for iteration ${iteration}</span>
      <textarea class="textarea" id="dt-${key}" data-dt="${key}" data-member="${member}" rows="5" maxlength="${MAX_TEXT}" placeholder="${names[member - 1]}, write your idea here">${x ? x.body : ''}</textarea></label>
    <p class="small muted dt-state" data-state="${key}">${filled(x) ? `Saved ${timeAgo(x.updated_at)}` : ''}</p>
  </section>`;
}

/** Who still has to write, judged from what's in the boxes on this phone right now. */
function dtReadiness() {
  const names = dtNames();
  const boxes = $$('textarea[data-member]', main);
  const missing = boxes.filter((el) => !el.value.trim()).map((el) => names[Number(el.dataset.member) - 1]);
  const base = $('#dt-base');
  const needBase = Boolean(base && !base.value.trim());
  return { done: boxes.length - missing.length, missing, needBase, ready: boxes.length === SHEETS && !missing.length && !needBase };
}

function dtNextHTML() {
  const stage = app.dt.stage;
  const r = dtReadiness();
  const list = r.missing.length > 1 ? `${r.missing.slice(0, -1).join(', ')} and ${r.missing[r.missing.length - 1]}` : r.missing[0];
  const waiting = [r.needBase ? 'the base idea' : '', r.missing.length ? `${r.missing.length === 1 ? 'an idea' : 'ideas'} from ${list}` : ''].filter(Boolean).join(' and ');
  const finish = stage === ITERATIONS;
  return html`<div class="dt-next-text">
      <strong>${r.done} of ${SHEETS} ideas written</strong>
      <small>${r.ready
        ? finish ? 'All in. Finish to lock your 12 ideas and see the whole sheet.' : `All in. Move on when everyone is happy with their idea: iteration ${stage} locks after that.`
        : `Still waiting for ${waiting}.`}</small>
    </div>
    <button type="button" class="btn btn-primary" data-dt-advance ${r.ready ? '' : 'disabled'}>${finish ? html`${icon('award')}Finish` : html`Go to iteration ${stage + 1}${icon('arrow')}`}</button>`;
}
const dtPaintNext = () => {
  const box = $('[data-dt-next]', main);
  if (box && app.dt) setHTML(box, dtNextHTML());
};

// Autosave: each box saves on its own (so 4 people on 4 phones don't overwrite each other),
// a moment after typing stops and when the box loses focus.
const dtTimers = new Map();
const dtSending = new Map();
const dtField = (key) => document.getElementById(key === 'base' ? 'dt-base' : `dt-${key}`);
function dtState(key, text, kind = '') {
  const el = $(`[data-state="${key}"]`, main);
  if (!el) return;
  el.textContent = text;
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
}

function dtSave(key) {
  clearTimeout(dtTimers.get(key));
  dtTimers.delete(key);
  const el = dtField(key);
  if (!el || el.value === el.defaultValue) return Promise.resolve();
  if (dtSending.has(key)) return dtSending.get(key).then(() => dtSave(key));
  const value = el.value;
  dtState(key, 'Saving…');
  const run = (async () => {
    try {
      if (key === 'base') await api('/team/design/base', { method: 'PUT', body: { base_idea: value } });
      else {
        const [i, s] = key.split('-');
        await api(`/team/design/ideas/${i}/${s}`, { method: 'PUT', body: { body: value } });
      }
      const cur = dtField(key);
      if (cur && cur.value === value) {
        cur.defaultValue = value; // clean again: fresh server data may replace it
        dtState(key, value.trim() ? 'Saved' : 'Cleared', 'ok');
      } else if (cur) {
        dtTimers.set(key, setTimeout(() => dtSave(key), 600));
      }
      designRefresh();
    } catch (err) {
      dtState(key, `Not saved: ${err.message || 'check your connection'}`, 'error');
      if (err.status === 409) designRefresh(); // the team moved on from another phone
    } finally {
      dtSending.delete(key);
    }
  })();
  dtSending.set(key, run);
  return run;
}
const dtFlush = () => Promise.all([...new Set([...dtTimers.keys(), ...$$('textarea[data-dt]', main).filter((el) => el.value !== el.defaultValue).map((el) => el.dataset.dt)])].map(dtSave));

async function dtAdvance(btn) {
  const stage = app.dt.stage;
  const finish = stage === ITERATIONS;
  await dtFlush();
  if ($$('textarea[data-dt]', main).some((el) => el.value !== el.defaultValue)) {
    toast('Some ideas haven’t saved yet. Check your connection and try again.', 'error');
    return;
  }
  const ok = await confirmDialog({
    title: finish ? 'Finish Design Thinking?' : `Move on to iteration ${stage + 1}?`,
    message: finish
      ? 'All 12 ideas get locked for your whole team, and you’ll see the full sheet.'
      : `Check that all 4 members are happy with their idea. After this, nobody in your team can change iteration ${stage}${stage === 1 ? ' or the base idea' : ''}.`,
    confirmLabel: finish ? 'Finish' : `Go to iteration ${stage + 1}`,
  });
  if (!ok) return;
  await withBusy(btn, async () => {
    try {
      app.dt = await api('/team/design/next', { method: 'POST', body: { from: stage } });
      toast(app.dt.stage > ITERATIONS ? 'Done! Your team’s 12 ideas are locked in.' : `Iteration ${app.dt.stage}: pass it along.`, 'ok');
      scrollTo({ top: 0, behavior: 'smooth' });
      render();
    } catch (err) {
      toastError(err);
      designRefresh();
    }
  });
}

function bindDesign() {
  for (const el of $$('textarea[data-dt]', main)) {
    const key = el.dataset.dt;
    el.addEventListener('input', () => {
      dtState(key, 'Not saved yet');
      clearTimeout(dtTimers.get(key));
      dtTimers.set(key, setTimeout(() => dtSave(key), 1500));
      dtPaintNext();
    });
    el.addEventListener('blur', () => dtSave(key));
  }
  $('[data-dt-next]', main)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dt-advance]');
    if (b && !b.disabled) dtAdvance(b);
  });
  // The bar was drawn before these boxes existed (it reads them), so draw it again now.
  dtPaintNext();
}

/** Fresh data from teammates' devices, without touching a box someone is typing in. */
const designRefresh = debounce(async () => {
  if (app.view !== 'design') return;
  let dt;
  try {
    dt = await api('/team/design');
  } catch {
    return;
  }
  if (app.view !== 'design') return;
  if (!dt.enabled) return refresh();
  dt.stage = dt.stage || 1;
  if (app.dt && dt.stage !== app.dt.stage) {
    // Another phone moved the team on (or an organiser reopened a step): show the new step.
    toast(dt.stage > ITERATIONS ? 'Your team has finished Design Thinking.' : `Your team is now on iteration ${dt.stage}.`, 'info', { title: 'Design Thinking' });
    app.dt = dt;
    return render();
  }
  app.dt = dt;
  const names = dtNames();
  const map = cells(dt.ideas);
  for (const el of $$('textarea[data-dt]', main)) {
    const key = el.dataset.dt;
    const [i, s] = key.split('-').map(Number);
    const server = key === 'base' ? dt.base_idea : (map.get(cellKey(i, s)) || {}).body || '';
    const busy = document.activeElement === el || el.value !== el.defaultValue || dtTimers.has(key) || dtSending.has(key);
    if (!busy && el.value !== server) {
      el.value = server;
      el.defaultValue = server;
      dtState(key, server ? 'Updated from a teammate' : '');
    }
  }
  for (const box of $$('[data-prev]', main)) setHTML(box, dtSource(Number(box.dataset.prev), dt.stage, names, map, dt));
  const total = $('[data-dt-total]', main);
  if (total) setHTML(total, dtTotalChip(dt));
  dtPaintNext();
}, 400);

// Saves aren't broadcast on the static site, so an open Design Thinking page checks for teammates' ideas.
setInterval(() => { if (app.view === 'design' && document.visibilityState === 'visible') designRefresh(); }, 20000);
document.addEventListener('visibilitychange', () => {
  if (app.view !== 'design') return;
  if (document.visibilityState === 'hidden') dtFlush();
  else designRefresh();
});

// ---------- ideathon: Assessments ------------------------------------------------------------
// One answer sheet per team: every box saves on its own (several phones can answer different questions),
// a moment after typing stops and when the box loses focus. Answers lock at the organiser's end time.
const asTodo = (d) => ((d.assessments && d.assessments.open) || []).filter((a) => a.answered < a.total).length;

function asBanners(d) {
  const open = (d.assessments && d.assessments.open) || [];
  return open.map((a) => html`<section class="card as-banner">
    <span class="as-banner-icon">${icon('clipboard')}</span>
    <div><strong>${a.answered >= a.total ? 'Answered' : 'New questions'}: ${a.title}</strong>
      <small>${a.answered} of ${a.total} answered · closes in <b class="mono" data-countdown="${a.closes_at}"></b></small></div>
    <a class="btn ${a.answered >= a.total ? '' : 'btn-primary'}" href="#/assessments">${a.answered >= a.total ? 'Review answers' : 'Answer now'}</a>
  </section>`);
}

const asKey = (aid, qid) => `${aid}-${qid}`;
const asField = (key) => document.getElementById(`as-a-${key}`);
const asAnswerMap = (a) => new Map(a.answers.map((x) => [x.question_id, x.body]));
const asFilled = (a) => {
  const map = asAnswerMap(a);
  return a.questions.filter((q) => {
    const el = asField(asKey(a.id, q.id));
    return String(el ? el.value : map.get(q.id) || '').trim() !== '';
  }).length;
};
const asCountChip = (a) => chip(asFilled(a) === a.questions.length ? 'selected' : 'pending', `${asFilled(a)}/${a.questions.length} answered`);

function asSheet(a) {
  const map = asAnswerMap(a);
  return html`<section class="card as-sheet" data-as="${a.id}">
    <div class="as-sheet-head">
      <div class="as-sheet-title"><h2 class="section-title">${a.title}</h2>
        <p class="small muted">${a.open
          ? html`Answers lock at <strong>${fmtTime(a.closes_at)}</strong>.`
          : html`Time’s up: answers locked at ${fmtDateTime(a.closes_at)}.`}</p></div>
      <div class="row">
        ${a.open ? html`<span class="as-timer">${icon('clock')}<b class="mono" data-countdown="${a.closes_at}"></b></span>` : chip('completed', 'Locked')}
        <span data-as-count="${a.id}">${asCountChip(a)}</span>
      </div>
    </div>
    ${a.instructions ? html`<div class="callout">${icon('info')}<span>${richText(a.instructions)}</span></div>` : ''}
    <ol class="as-qs">${a.questions.map((q, i) => {
      const key = asKey(a.id, q.id);
      const ans = map.get(q.id) || '';
      return html`<li class="as-q">
        <div class="as-qtext" id="as-qt-${key}"><span class="as-qno">Q${i + 1}</span><span>${richText(q.body)}</span></div>
        ${a.open
          ? html`<textarea class="textarea" id="as-a-${key}" data-ans="${key}" aria-labelledby="as-qt-${key}" rows="4" maxlength="5000" placeholder="Your team’s answer">${ans}</textarea>
             <p class="small muted dt-state" data-state="as-${key}">${ans ? 'Saved' : ''}</p>`
          : html`<div class="as-answer">${ans ? richText(ans) : html`<span class="faint">No answer</span>`}</div>`}
      </li>`;
    })}</ol>
    ${a.open ? html`<div class="row-between as-foot"><span class="small muted">Answers save as you type. Anyone in your team can add to them until ${fmtTime(a.closes_at)}.</span>
      <button type="button" class="btn btn-primary" data-as-save="${a.id}">${icon('check')}Save answers</button></div>` : ''}
  </section>`;
}

const asTimers = new Map();
const asSending = new Map();
const asLocking = new Set();
function asState(key, text, kind = '') {
  const el = $(`[data-state="as-${key}"]`, main);
  if (!el) return;
  el.textContent = text;
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
}
function asPaintCount(aid) {
  const a = (app.as || []).find((x) => x.id === aid);
  const el = $(`[data-as-count="${aid}"]`, main);
  if (a && el) setHTML(el, asCountChip(a));
}

function asSave(key) {
  clearTimeout(asTimers.get(key));
  asTimers.delete(key);
  const el = asField(key);
  if (!el || el.value === el.defaultValue) return Promise.resolve(true);
  if (asSending.has(key)) return asSending.get(key).then(() => asSave(key));
  const value = el.value;
  const [aid, qid] = key.split('-').map(Number);
  asState(key, 'Saving…');
  const run = (async () => {
    try {
      await api(`/team/assessments/${aid}/answers/${qid}`, { method: 'PUT', body: { body: value } });
      const cur = asField(key);
      if (cur && cur.value === value) {
        cur.defaultValue = value; // clean again: fresh server data may replace it
        asState(key, value.trim() ? 'Saved' : 'Cleared', 'ok');
      } else if (cur) {
        asTimers.set(key, setTimeout(() => asSave(key), 600));
      }
      asPaintCount(aid);
      return true;
    } catch (err) {
      asState(key, `Not saved: ${err.message || 'check your connection'}`, 'error');
      if (err.status === 409 || err.status === 404) assessRefresh(); // time is up, turned off or the question changed
      return false;
    } finally {
      asSending.delete(key);
    }
  })();
  asSending.set(key, run);
  return run;
}
const asDirty = () => $$('textarea[data-ans]', main).filter((el) => el.value !== el.defaultValue).map((el) => el.dataset.ans);
const asFlush = () => Promise.all([...new Set([...asTimers.keys(), ...asDirty()])].map(asSave));

function bindAssess() {
  for (const el of $$('textarea[data-ans]', main)) {
    const key = el.dataset.ans;
    el.addEventListener('input', () => {
      asState(key, 'Not saved yet');
      clearTimeout(asTimers.get(key));
      asTimers.set(key, setTimeout(() => asSave(key), 1500));
      asPaintCount(Number(key.split('-')[0]));
    });
    el.addEventListener('blur', () => asSave(key));
  }
  for (const b of $$('[data-as-save]', main)) {
    b.addEventListener('click', () =>
      withBusy(b, async () => {
        const results = await asFlush();
        if (results.every(Boolean)) toast('All answers saved. You can still change them until time is up.', 'ok');
        else toast('Some answers didn’t save. Check the message under each one.', 'error');
      })
    );
  }
}

/** Fresh data: teammates' answers go into boxes nobody is typing in; other changes redraw the page. */
const asShape = (list) => JSON.stringify((list || []).map((a) => [a.id, a.open, a.title, a.instructions, a.closes_at, a.questions.map((q) => [q.id, q.body])]));
const assessRefresh = debounce(async () => {
  if (app.view !== 'assessments') return;
  let data;
  try {
    data = await api('/team/assessments');
  } catch {
    return;
  }
  if (app.view !== 'assessments') return;
  clock.sync(data.serverTime);
  if (asShape(data.assessments) !== asShape(app.as)) {
    // Questions, timing or the list changed (or time is up): save what's typed, then redraw.
    await asFlush().catch(() => {});
    if (!data.assessments.length) return refresh(); // nothing left to show: back to the overview
    return preserveInputs(main, render);
  }
  app.as = data.assessments;
  for (const a of data.assessments) {
    if (!a.open) continue;
    const map = asAnswerMap(a);
    for (const q of a.questions) {
      const key = asKey(a.id, q.id);
      const el = asField(key);
      if (!el) continue;
      const server = map.get(q.id) || '';
      const busy = document.activeElement === el || el.value !== el.defaultValue || asTimers.has(key) || asSending.has(key);
      if (!busy && el.value !== server) {
        el.value = server;
        el.defaultValue = server;
        asState(key, server ? 'Updated from a teammate' : '');
      }
    }
    asPaintCount(a.id);
  }
}, 400);

// Answer saves aren't broadcast on the static site, so an open Assessments page checks for teammates' answers.
// At the end time the boxes lock straight away; the page then redraws with the locked answers.
setInterval(() => {
  if (app.view !== 'assessments' || !app.as) return;
  for (const a of app.as) {
    if (a.open && Date.parse(a.closes_at) <= clock.now() && !asLocking.has(a.id)) {
      asLocking.add(a.id);
      for (const el of $$(`[data-as="${a.id}"] textarea`, main)) el.readOnly = true;
      asFlush().finally(() => setTimeout(assessRefresh, 1500));
    }
  }
}, 1000);
setInterval(() => { if (app.view === 'assessments' && document.visibilityState === 'visible') assessRefresh(); }, 20000);
document.addEventListener('visibilitychange', () => {
  if (app.view !== 'assessments') return;
  if (document.visibilityState === 'hidden') asFlush();
  else assessRefresh();
});

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
    design: !ideathon || !(d.design && d.design.enabled),
    assessments: !ideathon || !(d.assessments && d.assessments.on),
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

// Redraw the current view with fresh data. The Design Thinking page only pulls teammates' changes,
// so a box someone is typing in is never replaced (that would close the keyboard on phones).
async function redraw() {
  if (app.view === 'design' && app.data.design && app.data.design.enabled) return designRefresh();
  if (app.view === 'assessments' && app.data.assessments && app.data.assessments.on) return assessRefresh();
  await preserveInputs(main, render);
}

const refresh = debounce(async () => {
  try {
    await loadCore();
    await redraw();
  } catch (err) {
    toastError(err);
  }
}, 250);

function onRoute(view, params) {
  if (app.view === 'design' && view !== 'design') dtFlush(); // save what was typed before the boxes go away
  if (app.view === 'assessments' && view !== 'assessments') asFlush().then(() => refresh()); // and update the counts
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
          await redraw();
          const list = app.data.announcements || [];
          const latest = list.find((x) => x.id === a.id) || list[0];
          show(latest ? latest.title : 'Open Announcements to read it.');
        } catch (err) {
          toastError(err);
        }
      },
      announcements: refresh,
      async results(e) {
        if (e.kind === 'published') {
          // Check with the server before celebrating (live signals are only hints).
          try {
            const d = await api('/team/overview');
            const out = d.competition === 'ideathon' ? d.result && d.result.published : (d.journey || []).some((r) => r.number === Number(e.round) && r.published);
            if (out) {
              toast(e.round ? `Round ${e.round} results are out.` : 'The final results are out.', 'ember', { title: 'Results published', action: { label: 'View', onClick: () => (location.hash = '#/overview') } });
              app.reveal = true;
            }
          } catch { /* the refresh below shows whatever is true */ }
        }
        refresh();
      },
      rounds: refresh,
      design: designRefresh,
      async assessment(e) {
        if (e.kind === 'answer') return assessRefresh(); // a teammate's save (laptop server only)
        // Live signals carry no text: ask the server what changed.
        try {
          await loadCore();
          const a = ((app.data.assessments && app.data.assessments.open) || []).find((x) => x.id === Number(e.id));
          const go = { label: 'Answer', onClick: () => (location.hash = '#/assessments') };
          if (e.kind === 'opened' && a) toast(`${a.title}. Answers close at ${fmtTime(a.closes_at)}.`, 'ember', { title: 'New questions from the organisers', action: go });
          else if (e.kind === 'time' && a) toast(`Answers for “${a.title}” now close at ${fmtTime(a.closes_at)}.`, 'info', { title: 'Assessments' });
          else if (e.kind === 'updated' && app.view === 'assessments') toast('The organisers updated the questions.', 'info', { title: 'Assessments' });
          await redraw();
        } catch (err) {
          toastError(err);
        }
      },
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
