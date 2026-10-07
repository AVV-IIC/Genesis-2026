// Judge portal (Hackathon): judges mark and comment on the teams the organisers
// assigned to them while a round is open for judging. Marks save as you type.
import {
  $, $$, api, html, raw, setHTML, icon, MARK, clock, toast, toastError, formModal, withBusy,
  connectLive, startRouter, preserveInputs, debounce, signOut, timeAgo, fmtScore, firstName, STATE_LABEL, guardPage, HOME,
} from '../core.js';
import { setEventTimes, mountDial, eventRangeText } from '../dial.js';
import { chip, empty, annItem, timeline, urgentBar } from '../portal.js';

const main = $('#main');
const app = { data: null, view: 'evaluate', params: [], seq: 0, dismissedUrgent: null };
// The round being judged and the save queue for the open scoring panel.
const J = { round: null, teams: [], teamId: null, q: '', pending: null, chain: Promise.resolve(), inflight: 0 };

guardPage('judge');
setHTML($('#mark'), MARK);
$('#signout').addEventListener('click', async () => {
  await flushPending();
  signOut();
});
addEventListener('beforeunload', (e) => {
  if (J.pending || J.inflight) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- data + chrome ------------------------------------------------------------
async function loadCore() {
  app.data = await api('/judge/overview');
  clock.sync(app.data.serverTime);
  setEventTimes({ ...app.data.event, markers: app.data.markers });
  renderChrome();
}

function renderChrome() {
  const d = app.data;
  $('#brand-name').textContent = d.event.event_name.split(/\s+/)[0];
  document.title = `Judge portal · ${d.event.event_name}`;
  $('#who-name').textContent = d.judge.name;
  $('#who-code').textContent = `${d.judge.username} · Judge`;
  const tabs = [
    ['evaluate', 'Evaluate'],
    ['announcements', 'Announcements', d.unread],
    ['schedule', 'Schedule'],
    ['account', 'Account'],
  ];
  const current = app.view === 'round' ? 'evaluate' : app.view;
  setHTML(
    $('#tabs'),
    tabs.map(([id, label, n]) => html`<a href="#/${id}" data-tab="${id}" ${current === id ? raw('aria-current="page"') : ''}>${label}${n ? html`<span class="badge">${n}</span>` : ''}</a>`)
  );
  const seen = d.announcements_seen_at;
  const urgent = (d.announcements || []).find((x) => x.priority === 'urgent' && (!seen || x.created_at > seen));
  const show = urgent && app.dismissedUrgent !== urgent.id && app.view !== 'announcements';
  urgentBar($('#urgent'), show ? urgent : null, (id) => (app.dismissedUrgent = id));
}

// ---------- helpers -------------------------------------------------------------------
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const teamState = (t) => (t.done ? 'done' : Object.keys(t.scores || {}).length || (t.comments || '').trim() ? 'started' : 'todo');
const STATE_CHIP = { done: ['selected', 'Done'], started: ['pending', 'In progress'], todo: ['upcoming', 'Not started'] };
const stateChip = (t) => chip(...STATE_CHIP[teamState(t)]);

function roundLock(r) {
  if (r.published) return 'Results for this round are published, so marks are locked.';
  if (!r.judging_open) return r.state === 'upcoming' ? 'Judging hasn’t started for this round yet. You can look over your teams in the meantime.' : 'Judging for this round is closed. You can still see what you entered.';
  return '';
}

// ---------- views -------------------------------------------------------------------------
const VIEWS = {
  evaluate() {
    const d = app.data;
    const rounds = d.rounds;
    const assignedAny = rounds.some((r) => r.assigned);
    const openRound = rounds.find((r) => r.judging_open && r.assigned && r.done < r.assigned) || rounds.find((r) => r.judging_open && r.assigned);
    setHTML(
      main,
      html`
      <div class="page-head">
        <div><h1 class="page-title">Hello, ${firstName(d.judge.name)}</h1><p>Score the teams the organisers assigned to you. Marks save as you type; mark each team done when you’ve finished with it.</p></div>
      </div>
      <div class="hero-grid judge-hero">
        <section class="card hero-dial" aria-label="Event clock">
          <div data-dial></div>
          <p class="event-line">${eventRangeText() || 'The organisers will publish the event timing soon.'}${d.event.venue ? html`<br>${d.event.venue}` : ''}</p>
        </section>
        <section class="card stack">
          ${openRound
            ? html`<div class="judge-cta">
                <div><span class="round-no">Judging open · Round ${openRound.number}</span>
                  <h2 class="round-name">${openRound.name}</h2>
                  <p class="muted small">${openRound.done >= openRound.assigned ? 'You’ve finished every team. You can still edit until judging closes.' : `${openRound.assigned - openRound.done} of ${openRound.assigned} teams left to finish.`}</p></div>
                <a class="btn btn-primary" href="#/round/${openRound.number}">${icon('gavel')}${openRound.done ? 'Continue judging' : 'Start judging'}</a>
              </div>`
            : html`<div class="callout">${icon('info')}<span>${assignedAny ? 'No round is open for judging right now. This page updates by itself when the organisers open one.' : 'The organisers haven’t assigned any teams to you yet. This page updates by itself when they do.'}</span></div>`}
          <div class="card-head" style="margin:0"><h2 class="section-title">Your rounds</h2></div>
          <ul class="jrounds">${rounds.map(
            (r) => html`<li>
              <a href="#/round/${r.number}" class="jround${r.judging_open ? ' is-open' : ''}${r.assigned ? '' : ' is-empty'}">
                <span class="round-no">Round ${r.number}</span>
                <strong>${r.name}</strong>
                <span class="row">${r.judging_open ? chip('live', 'Judging open') : chip(r.state, STATE_LABEL[r.state])}${r.published ? chip('selected', 'Published') : ''}</span>
                <span class="jround-progress">${r.assigned
                  ? html`<span class="progress" aria-hidden="true"><i style="width:${pct(r.done, r.assigned)}%"></i></span><span class="small muted">${r.done}/${r.assigned} done</span>`
                  : html`<span class="small faint">No teams assigned</span>`}</span>
              </a>
            </li>`
          )}</ul>
        </section>
      </div>
      <div class="two-col">
        <section class="card">
          <div class="card-head"><h2 class="section-title">Announcements</h2><a class="btn btn-ghost btn-sm" href="#/announcements">See all</a></div>
          ${d.announcements.length
            ? html`<div class="ann-list">${d.announcements.map((a) => annItem(a, { compact: true }))}</div>`
            : empty('Nothing yet', 'Updates from the organisers for judges show up here.')}
        </section>
        ${guideCard()}
      </div>`
    );
    mountDial($('[data-dial]', main));
  },

  async round(params, seq) {
    const number = Number(params[0]);
    const r = app.data.rounds.find((x) => x.number === number);
    if (!r) {
      location.hash = '#/evaluate';
      return;
    }
    let teamParam = Number(params[1]) || null;
    if (!J.round || J.round.id !== r.id || J.stale) {
      await flushPending();
      const res = await api(`/judge/rounds/${r.id}`);
      if (seq !== app.seq) return;
      if (J.round && J.round.id !== res.round.id) J.q = '';
      J.round = res.round;
      J.teams = res.teams;
      J.stale = false;
    } else if (J.teamId !== teamParam) {
      await flushPending();
    }
    if (seq !== app.seq) return;
    // On wide screens, open the next team to judge straight away.
    if (!teamParam && J.round.judging_open && matchMedia('(min-width: 901px)').matches) {
      const pick = J.teams.find((t) => !t.done);
      if (pick) {
        teamParam = pick.team_id;
        history.replaceState(null, '', `#/round/${number}/${pick.team_id}`);
      }
    }
    J.teamId = J.teams.some((t) => t.team_id === teamParam) ? teamParam : null;
    drawRound();
  },

  async announcements(params, seq) {
    const { announcements, seen_at } = await api('/judge/announcements');
    if (seq !== app.seq) return;
    setHTML(
      main,
      html`
      <div class="page-head"><div><h1 class="page-title">Announcements</h1><p>Posts from the organisers for judges and for everyone at the Hackathon, newest first.</p></div></div>
      ${announcements.length
        ? html`<div class="ann-list">${announcements.map((a) => annItem(a, { isNew: !seen_at || a.created_at > seen_at }))}</div>`
        : html`<div class="card">${empty('No announcements yet', 'When the organisers post an update, it appears here.')}</div>`}`
    );
    if (app.data.unread) {
      api('/judge/announcements/seen', { method: 'POST', body: {} }).catch(() => {});
      app.data.unread = 0;
      app.data.announcements_seen_at = new Date(clock.now()).toISOString();
      renderChrome();
    }
  },

  async schedule(params, seq) {
    const { schedule } = await api('/judge/schedule');
    if (seq !== app.seq) return;
    setHTML(
      main,
      html`
      <div class="page-head"><div><h1 class="page-title">Schedule</h1><p>${eventRangeText() || 'Timings are set by the organisers and may change during the event.'}</p></div></div>
      ${schedule.length ? timeline(schedule) : html`<div class="card">${empty('Schedule coming soon', 'The organisers haven’t published the timeline yet.')}</div>`}`
    );
  },

  account() {
    const j = app.data.judge;
    setHTML(
      main,
      html`
      <div class="page-head"><div><h1 class="page-title">Account</h1><p>Your judge login and how scoring works.</p></div></div>
      <div class="two-col" style="margin-top:0">
        <section class="stack">
          <div class="card">
            <h2 class="section-title" style="margin-bottom:12px">Your login</h2>
            <ul class="list-plain">
              <li><span class="muted">Name</span><span>${j.name}</span></li>
              <li><span class="muted">Judge ID</span><span class="code-tag">${j.username}</span></li>
              <li><span class="muted">Competition</span><span>Hackathon</span></li>
            </ul>
          </div>
          <div class="card">
            <h2 class="section-title" style="margin-bottom:8px">Password</h2>
            <p class="muted small" style="margin-bottom:12px">Changing it signs you out on your other devices.</p>
            <button type="button" class="btn" id="change-pw">${icon('key')}Change password</button>
          </div>
        </section>
        ${guideCard()}
      </div>`
    );
    $('#change-pw').addEventListener('click', changePassword);
  },
};

function guideCard() {
  return html`<section class="card">
    <h2 class="section-title" style="margin-bottom:12px">How judging works</h2>
    <ul class="tips">
      <li>You only see the teams the organisers assigned to you, round by round.</li>
      <li>Marks and comments save automatically while judging is open. Press <b>Mark as done</b> when you’ve finished a team so the organisers can track progress.</li>
      <li>A team’s official score is the average of its judges’ marks. The organisers may adjust it.</li>
      <li>Teams see your comments after results are published, labelled “Judge 1”, “Judge 2” and so on, never your name. Your individual marks aren’t shown to them.</li>
      <li>Once results are published, marks for that round are locked.</li>
    </ul>
  </section>`;
}

// ---------- round view ------------------------------------------------------------------------
function visibleTeams() {
  const q = J.q.trim().toLowerCase();
  return J.teams.filter((t) => !q || `${t.code} ${t.name} ${t.leader_name} ${t.track} ${t.table_no}`.toLowerCase().includes(q));
}

function drawRound() {
  const r = J.round;
  const done = J.teams.filter((t) => t.done).length;
  const lock = roundLock(r);
  const team = J.teams.find((t) => t.team_id === J.teamId);
  setHTML(
    main,
    html`
    <a class="back-link" href="#/evaluate">${icon('back')}All rounds</a>
    <div class="page-head">
      <div>
        <div class="round-no">Round ${r.number}${r.is_elimination ? '' : ' · no eliminations'}</div>
        <h1 class="page-title">${r.name}</h1>
        ${r.description ? html`<p>${r.description}</p>` : ''}
      </div>
      <div class="jsummary">
        <span class="row">${r.judging_open ? chip('live', 'Judging open') : chip(r.state, STATE_LABEL[r.state])}</span>
        <span class="progress" aria-hidden="true"><i style="width:${pct(done, J.teams.length)}%"></i></span>
        <span class="small muted" id="j-progress">${done}/${J.teams.length} teams done</span>
      </div>
    </div>
    ${lock ? html`<div class="callout callout-warn" style="margin-bottom:16px">${icon(r.published ? 'eye' : 'clock')}<span>${lock}</span></div>` : ''}
    ${!r.criteria.length ? html`<div class="callout" style="margin-bottom:16px">${icon('info')}<span>The organisers haven’t set the scoring criteria for this round yet.</span></div>` : ''}
    ${J.teams.length
      ? html`<div class="judge-grid${team ? ' has-team' : ''}">
          <section class="card card-flush jlist">
            <div class="jlist-head">
              <label class="search"><span class="sr-only">Search teams</span>${icon('search')}<input class="input" id="j-search" type="search" placeholder="Search your teams" value="${J.q}"></label>
            </div>
            <div class="jlist-items" id="j-list"></div>
          </section>
          <section class="jpanel" id="j-panel">${team ? panelHtml(team) : html`<div class="card">${empty('Pick a team', 'Choose a team from the list to see its details and enter your marks.')}</div>`}</section>
        </div>`
      : html`<div class="card">${empty('No teams assigned', 'The organisers haven’t assigned you any teams for this round. This page updates by itself when they do.')}</div>`}`
  );
  drawList();
  bindRound();
  syncRanges();
  // Switching teams further down the list: bring the scoring panel into view.
  if (team && J.shownTeam !== team.team_id) {
    const top = $('#j-panel').getBoundingClientRect().top;
    if (top < 120 || top > innerHeight - 120) scrollTo({ top: scrollY + top - 140, behavior: 'smooth' });
  }
  J.shownTeam = team ? team.team_id : null;
}

function drawList() {
  const list = $('#j-list');
  if (!list) return;
  const teams = visibleTeams();
  setHTML(
    list,
    teams.length
      ? teams.map(
          (t) => html`<a class="jteam is-${teamState(t)}" href="#/round/${J.round.number}/${t.team_id}" data-team="${t.team_id}" ${t.team_id === J.teamId ? raw('aria-current="true"') : ''}>
            <span class="jteam-main"><strong>${t.name}</strong><small>${t.code}${t.table_no ? ` · Table ${t.table_no}` : ''}${t.track ? ` · ${t.track}` : ''}</small></span>
            <span class="jteam-side">${stateChip(t)}<span class="mono small">${t.total === null ? '–' : `${fmtScore(t.total)}/${fmtScore(J.round.max_total)}`}</span></span>
          </a>`
        )
      : html`<p class="muted small" style="padding:16px">No teams match.</p>`
  );
  const done = J.teams.filter((t) => t.done).length;
  const prog = $('#j-progress');
  if (prog) {
    prog.textContent = `${done}/${J.teams.length} teams done`;
    prog.previousElementSibling.firstElementChild.style.width = `${pct(done, J.teams.length)}%`;
  }
}

function panelHtml(t) {
  const r = J.round;
  const ro = !r.judging_open;
  const members = Array.isArray(t.members) ? t.members : [];
  const step = (max) => (max <= 10 ? 0.5 : 1);
  return html`<form class="card stack" id="score-form" novalidate data-team="${t.team_id}" data-round="${r.id}">
    <div class="row-between" style="align-items:start">
      <div>
        <a class="back-link only-mobile" href="#/round/${r.number}">${icon('back')}All teams</a>
        <h2 class="jteam-title">${t.name}</h2>
        <p class="small muted">${t.code}${t.table_no ? ` · Table ${t.table_no}` : ''}${t.track ? ` · ${t.track}` : ''}${t.leader_name ? ` · Leader: ${t.leader_name}` : ''}</p>
      </div>
      <span id="j-state">${stateChip(t)}</span>
    </div>
    ${members.length ? html`<p class="small"><span class="label">Members</span> ${members.join(', ')}</p>` : ''}

    ${r.criteria.length
      ? html`<div class="score-rows">${r.criteria.map((c) => {
          const v = t.scores[c.id];
          return html`<div class="score-row">
            <label for="sc-${c.id}"><strong>${c.name}</strong><small>out of ${fmtScore(c.max_score)}</small></label>
            <input type="range" class="range${v === undefined ? ' is-empty' : ''}" id="rg-${c.id}" data-range="${c.id}" min="0" max="${c.max_score}" step="${step(c.max_score)}" value="${v ?? 0}" aria-label="${c.name} slider" ${ro ? 'disabled' : ''}>
            <input class="input score-input" type="number" inputmode="decimal" id="sc-${c.id}" data-crit="${c.id}" min="0" max="${c.max_score}" step="any" value="${v ?? ''}" placeholder="–" aria-label="${c.name} mark out of ${fmtScore(c.max_score)}" ${ro ? 'disabled' : ''}>
          </div>`;
        })}</div>
        <div class="score-total"><span class="muted">Your total</span><span><b id="j-total">${fmtScore(t.total)}</b> <span class="of">/ ${fmtScore(r.max_total)}</span></span></div>`
      : ''}

    <label class="field"><span>Comments for the team <span class="hint">Shown to them as “Judge N” after results are published</span></span>
      <textarea class="textarea" id="cm-${r.id}-${t.team_id}" name="comments" rows="5" maxlength="4000" placeholder="What worked, what to improve…" ${ro ? 'disabled' : ''}>${t.comments}</textarea></label>

    <div class="form-error" role="alert"></div>
    <div class="row-between">
      <span class="save-line"><span class="save-state" data-save data-s="${t.updated_at ? 'saved' : ''}"></span><span class="small muted" id="j-saved">${t.updated_at ? `Saved ${timeAgo(t.updated_at)}` : ro ? '' : 'Saves automatically'}</span></span>
      ${ro
        ? ''
        : t.done
          ? html`<button type="button" class="btn" id="j-reopen">${icon('edit')}Reopen</button>`
          : html`<button type="button" class="btn btn-primary" id="j-done">${icon('check')}Mark as done</button>`}
    </div>
  </form>`;
}

function syncRanges() {
  for (const range of $$('[data-range]', main)) {
    const num = $(`#sc-${range.dataset.range}`);
    if (!num) continue;
    range.classList.toggle('is-empty', num.value.trim() === '');
    if (num.value.trim() !== '') range.value = num.value;
  }
}

function readPanel(form) {
  const scores = {};
  let valid = true;
  let filled = 0;
  let total = 0;
  for (const c of J.round.criteria) {
    const input = $(`#sc-${c.id}`, form);
    const val = input.value.trim();
    input.removeAttribute('aria-invalid');
    if (val === '') {
      scores[c.id] = null;
      continue;
    }
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || n > c.max_score) {
      input.setAttribute('aria-invalid', 'true');
      valid = false;
      continue;
    }
    scores[c.id] = n;
    total += n;
    filled++;
  }
  return {
    valid,
    complete: valid && filled === J.round.criteria.length,
    total: filled ? Math.round(total * 100) / 100 : null,
    body: { scores, comments: $('textarea', form).value },
  };
}

function setSave(state, text) {
  const el = $('[data-save]', main);
  if (el) el.dataset.s = state;
  const label = $('#j-saved');
  if (label) label.textContent = text ?? { dirty: 'Unsaved changes…', saving: 'Saving…', saved: 'Saved just now', error: 'Not saved' }[state] ?? '';
}

function scheduleSave(form, delay) {
  const p = readPanel(form);
  const totalEl = $('#j-total');
  if (totalEl) totalEl.textContent = fmtScore(p.total);
  if (J.pending) clearTimeout(J.pending.timer);
  if (!p.valid) {
    J.pending = null;
    setSave('error', 'A mark is outside the allowed range');
    return;
  }
  setSave('dirty');
  const roundId = Number(form.dataset.round);
  const teamId = Number(form.dataset.team);
  J.pending = { roundId, teamId, body: p.body, timer: setTimeout(() => flushPending(), delay) };
}

/** Queue a save; saves run one after another so they can't land out of order. */
function persist(roundId, teamId, body) {
  J.inflight++;
  const run = J.chain.then(async () => {
    const onPanel = () => J.round && J.round.id === roundId && J.teamId === teamId;
    if (onPanel()) setSave('saving');
    try {
      const { row } = await api(`/judge/rounds/${roundId}/teams/${teamId}`, { method: 'PUT', body });
      if (J.round && J.round.id === roundId) {
        const i = J.teams.findIndex((t) => t.team_id === teamId);
        if (i >= 0) J.teams[i] = row;
        drawList();
        if (onPanel()) {
          setHTML($('#j-state'), stateChip(row));
          if (!J.pending) setSave('saved');
        }
      }
      return row;
    } catch (err) {
      if (onPanel()) setSave('error', err.message);
      throw err;
    } finally {
      J.inflight--;
    }
  });
  J.chain = run.catch(() => {});
  return run;
}

async function flushPending() {
  const p = J.pending;
  if (p) {
    clearTimeout(p.timer);
    J.pending = null;
    try {
      await persist(p.roundId, p.teamId, p.body);
    } catch (err) {
      toastError(err);
    }
  }
  await J.chain;
}

function nextTeam(afterId) {
  const list = J.teams;
  const i = list.findIndex((t) => t.team_id === afterId);
  return [...list.slice(i + 1), ...list.slice(0, Math.max(0, i))].find((t) => !t.done);
}

function bindRound() {
  $('#j-search')?.addEventListener('input', (e) => {
    J.q = e.target.value;
    drawList();
  });
  const form = $('#score-form');
  if (!form) return;
  form.addEventListener('submit', (e) => e.preventDefault());
  if (!J.round.judging_open) return;

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-range]')) {
      const num = $(`#sc-${t.dataset.range}`, form);
      num.value = t.value;
      t.classList.remove('is-empty');
      scheduleSave(form, 700);
    } else if (t.matches('.score-input')) {
      const range = $(`#rg-${t.dataset.crit}`, form);
      if (range) {
        range.classList.toggle('is-empty', t.value.trim() === '');
        if (t.value.trim() !== '') range.value = t.value;
      }
      scheduleSave(form, 700);
    } else if (t.matches('textarea')) scheduleSave(form, 1200);
  });
  // Leaving a field saves straight away.
  form.addEventListener('change', (e) => {
    if (e.target.matches('input, textarea') && J.pending) {
      clearTimeout(J.pending.timer);
      flushPending();
    }
  });
  // Enter moves to the next mark.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('.score-input')) return;
    e.preventDefault();
    const inputs = $$('.score-input', form);
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) {
      next.focus();
      next.select();
    } else $('textarea', form).focus();
  });

  $('#j-done')?.addEventListener('click', async (e) => {
    const err = $('.form-error', form);
    err.textContent = '';
    const p = readPanel(form);
    if (!p.complete) {
      err.textContent = p.valid ? 'Enter a mark for every criterion before marking this team as done.' : 'Fix the highlighted mark first.';
      return;
    }
    if (J.pending) clearTimeout(J.pending.timer);
    J.pending = null;
    const teamId = Number(form.dataset.team);
    await withBusy(e.currentTarget, async () => {
      try {
        await persist(J.round.id, teamId, { ...p.body, done: true });
        const next = nextTeam(teamId);
        if (next) {
          toast('Marked as done.', 'ok', { timeout: 2000 });
          location.hash = `#/round/${J.round.number}/${next.team_id}`;
        } else {
          toast(`That’s every team for Round ${J.round.number}. Thank you!`, 'ok', { title: 'All done' });
          location.hash = `#/round/${J.round.number}`;
        }
        refreshCore();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  });

  $('#j-reopen')?.addEventListener('click', async (e) => {
    const teamId = Number(form.dataset.team);
    await withBusy(e.currentTarget, async () => {
      try {
        await flushPending();
        await persist(J.round.id, teamId, { done: false });
        drawRound();
        refreshCore();
      } catch (ex) {
        $('.form-error', form).textContent = ex.message;
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
      <label class="field"><span>New password <span class="hint">At least 8 characters</span></span><input class="input" type="password" name="next" autocomplete="new-password" minlength="8" required></label>
      <label class="field"><span>Repeat new password</span><input class="input" type="password" name="repeat" autocomplete="new-password" required></label>`,
    async onSubmit(v) {
      if (v.next !== v.repeat) throw new Error('The new passwords don’t match.');
      await api('/auth/password', { method: 'POST', body: { current: v.current, next: v.next } });
      toast('Password changed. Your other devices were signed out.', 'ok');
    },
  });
}

// ---------- routing + live updates -------------------------------------------------------------
async function render() {
  const view = VIEWS[app.view] ? app.view : 'evaluate';
  const seq = ++app.seq;
  try {
    await VIEWS[view](app.params, seq);
  } catch (err) {
    if (seq !== app.seq) return;
    setHTML(main, html`<div class="card">${empty('Couldn’t load this page', err.message, html`<button class="btn" type="button" id="retry">${icon('refresh')}Try again</button>`)}</div>`);
    $('#retry')?.addEventListener('click', render);
  }
}

const refreshCore = debounce(() => loadCore().catch(() => {}), 300);

// Something changed on the server: reload, keeping anything being typed.
const refresh = debounce(async () => {
  try {
    if (app.view === 'round') {
      // Don't yank the panel away mid-edit; try again once saves settle.
      if (J.pending || J.inflight) return refresh();
      J.stale = true;
    }
    await loadCore();
    await preserveInputs(main, render);
    syncRanges();
  } catch (err) {
    toastError(err);
  }
}, 400);

function onRoute(view, params) {
  const prev = app.view;
  app.view = VIEWS[view] ? view : 'evaluate';
  app.params = params;
  if (prev === 'round' && app.view !== 'round') flushPending();
  if (app.view === 'round' && prev !== 'round') J.stale = true;
  if (prev !== app.view) scrollTo({ top: 0 });
  renderChrome();
  render();
}

(async () => {
  try {
    await loadCore();
  } catch (err) {
    setHTML(main, html`<div class="card">${empty('Couldn’t load the judge portal', err.message)}</div>`);
    return;
  }
  startRouter('evaluate', onRoute);

  connectLive(
    {
      async announcement(a) {
        const kind = a.priority === 'urgent' ? 'error' : a.priority === 'important' ? 'warn' : 'ember';
        const show = (title) => toast(title, kind, { title: 'New announcement', action: { label: 'Read', onClick: () => (location.hash = '#/announcements') } });
        try {
          await loadCore();
          if (app.view === 'evaluate' || app.view === 'announcements') await preserveInputs(main, render);
          const list = app.data.announcements || [];
          show(a.title || (list.find((x) => x.id === a.id) || list[0] || {}).title || 'Open Announcements to read it.');
        } catch (err) {
          toastError(err);
        }
      },
      announcements: refresh,
      assignments() {
        toast('The organisers updated the teams assigned to you.', 'info', { title: 'Assignments' });
        refresh();
      },
      rounds: refresh,
      results: refresh,
      schedule: refresh,
      settings: refresh,
      'signed-out'() {
        try { localStorage.removeItem('genesis-session'); } catch { /* ignore */ }
        location.href = `${HOME}?signedout=1`;
      },
      reconnect: refresh,
    },
    $('#live')
  );
})();
