import {
  $, $$, api, html, raw, setHTML, icon, formModal, confirmDialog, openModal, toast, toastError, fmtScore, fmtDateTime, timeAgo, withBusy, STATE_LABEL,
} from '../core.js';
import { chip, empty } from './shared.js';

const S = {
  rounds: [],
  round: null,
  rows: [],
  lastNumber: 1,
  showAll: false,
  q: '',
  timers: new Map(), // teamId -> timeout
  saving: new Set(),
  openNotes: new Set(),
  needsRerender: false,
  settingsOpen: false,
  ctx: null,
};

const busy = () => S.timers.size > 0 || S.saving.size > 0;
addEventListener('beforeunload', (e) => {
  if (busy()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

export async function render(ctx, params, seq) {
  S.ctx = ctx;
  const wanted = Number(params[0]) || S.lastNumber;
  if (S.round && S.round.number !== wanted) await flushSaves();
  const { rounds } = await api('/admin/rounds');
  const round = rounds.find((r) => r.number === wanted) || rounds[0];
  const sheet = await api(`/admin/rounds/${round.id}/sheet`);
  if (!ctx.isCurrent(seq)) return;
  if (S.round && S.round.id !== round.id) S.openNotes.clear();
  S.rounds = rounds;
  S.round = sheet.round;
  S.rows = sheet.rows;
  S.lastNumber = round.number;
  S.needsRerender = false;
  draw(ctx);
}

export function leave() {
  // Save anything still waiting on the debounce before leaving the page.
  for (const [teamId, t] of S.timers) {
    clearTimeout(t.timer);
    save(teamId, t.tr, t.round);
  }
}

export function onEvent(type, data, ctx) {
  if (type === 'sheet') {
    if (!S.round || data.round_id !== S.round.id) return true;
    // Our own saves already updated the row.
    if (data.by === ctx.me.name && !data.row) return true;
    const apply = (row) => {
      if (!row || !S.round || data.round_id !== S.round.id) return;
      const i = S.rows.findIndex((r) => r.team_id === data.team_id);
      if (i >= 0) S.rows[i] = row;
      if (!S.timers.has(data.team_id) && !S.saving.has(data.team_id)) patchRow(row, data.by !== ctx.me.name);
      drawProgress();
    };
    // Live signals from the database carry no scores; fetch the row.
    if (data.row) apply(data.row);
    else api(`/admin/rounds/${data.round_id}/sheet/${data.team_id}`).then((r) => apply(r.row)).catch(() => {});
    return true;
  }
  if (['rounds', 'results', 'teams', 'judges'].includes(type)) {
    if (busy()) S.needsRerender = true;
    else ctx.rerender();
    return true;
  }
  return false;
}

// ---------- drawing -------------------------------------------------------------------------
function stats(r) {
  return html`<span class="small muted">${r.scored}/${r.eligible} scored${r.is_elimination ? ` · ${r.decided}/${r.eligible} decided` : ''}</span>`;
}

function statusOptions(round, value) {
  const opts = round.is_elimination
    ? [['pending', 'Pending'], ['selected', 'Selected'], ['eliminated', 'Not selected']]
    : [['pending', 'Advances'], ['eliminated', 'Disqualified']];
  const v = !round.is_elimination && value === 'selected' ? 'pending' : value;
  return opts.map(([k, label]) => html`<option value="${k}" ${k === v ? raw('selected') : ''}>${label}</option>`);
}

function draw(ctx) {
  const r = S.round;
  const awaiting = S.rows.filter((x) => x.active && x.awaiting_round).length;
  const judged = S.rows.some((x) => x.judges && x.judges.assigned);
  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Rounds & scores</h1><p>Scores save as you type. Teams only see a round after you publish it, and edits to a published round show up for them straight away.</p></div>
    </div>

    <nav class="round-tabs" aria-label="Rounds">${S.rounds.map((x) => {
      const pct = x.eligible ? Math.round((x.scored / x.eligible) * 100) : 0;
      return html`<a class="round-tab" href="#/rounds/${x.number}" ${x.id === r.id ? raw('aria-current="page"') : ''}>
        <span class="round-no">Round ${x.number}</span><strong>${x.name}</strong>
        <span class="row">${chip(x.state, STATE_LABEL[x.state])}${x.published ? chip('selected', 'Published') : ''}</span>
        <span class="progress" aria-hidden="true"><i style="width:${pct}%"></i></span>${stats(x)}
      </a>`;
    })}</nav>

    <section class="card stack" style="margin-bottom:16px">
      <div class="row-between" style="align-items:start">
        <div>
          <div class="round-no">Round ${r.number} · ${r.is_elimination ? 'elimination round' : 'no eliminations'}</div>
          <h2 class="round-name">${r.name}</h2>
          ${r.description ? html`<p class="muted small" style="margin-top:6px;max-width:70ch">${r.description}</p>` : ''}
        </div>
        <div class="row">
          <label class="field" style="min-width:150px"><span class="sr-only">Round state</span>
            <select class="select" id="r-state" aria-label="Round state">${['upcoming', 'live', 'judging', 'completed'].map((s) => html`<option value="${s}" ${s === r.state ? raw('selected') : ''}>${STATE_LABEL[s]}</option>`)}</select></label>
          ${r.published
            ? html`<button type="button" class="btn" id="r-unpublish">${icon('eyeOff')}Unpublish</button>`
            : html`<button type="button" class="btn btn-primary" id="r-publish">${icon('send')}Publish results</button>`}
        </div>
      </div>
      ${r.published
        ? html`<div class="callout">${icon('eye')}<span><strong>Published ${fmtDateTime(r.published_at)}.</strong> Teams can see their scores, status and judges’ notes for this round.</span></div>`
        : html`<div class="callout callout-warn">${icon('eyeOff')}<span><strong>Hidden from teams.</strong> Enter scores${r.is_elimination ? ' and decide who is selected' : ''}, then publish when you’re ready.</span></div>`}
    </section>

    <details class="card" id="r-settings" style="margin-bottom:16px">
      <summary class="row-between" style="cursor:pointer;list-style:none"><h2 class="section-title">Round settings & criteria</h2><span class="small muted">${r.criteria.length} criteria · out of ${fmtScore(r.max_total)}</span></summary>
      <div class="two-col" style="margin-top:16px">
        <form class="stack" id="r-form" novalidate>
          <label class="field"><span>Round name</span><input class="input" name="name" id="rf-name" value="${r.name}" maxlength="80" required></label>
          <label class="field"><span>Description <span class="hint">Teams see this before results are out</span></span><textarea class="textarea" name="description" id="rf-desc" rows="3" maxlength="1000">${r.description}</textarea></label>
          <div class="switch-row" style="border:0;padding:0"><div><strong>Elimination round</strong><small>Off means every team moves on to the next round.</small></div><input type="checkbox" class="switch" name="is_elimination" id="rf-elim" ${r.is_elimination ? 'checked' : ''} aria-label="Elimination round"></div>
          <div class="form-error" role="alert"></div>
          <div><button type="submit" class="btn">Save round</button></div>
        </form>
        <div class="stack-sm">
          <span class="label">Scoring criteria</span>
          <div class="criteria-editor" id="crit-list">${r.criteria.map(
            (c) => html`<div class="crit-edit" data-crit="${c.id}">
              <input class="input" value="${c.name}" data-f="name" aria-label="Criterion name" maxlength="80">
              <input class="input mono" type="number" min="1" step="any" value="${c.max_score}" data-f="max" aria-label="Maximum score for ${c.name}">
              <button type="button" class="icon-btn" data-del aria-label="Remove ${c.name}">${icon('trash')}</button>
            </div>`
          )}</div>
          <form class="crit-edit" id="crit-add" novalidate>
            <input class="input" name="name" placeholder="New criterion, e.g. Innovation" maxlength="80" aria-label="New criterion name">
            <input class="input mono" name="max_score" type="number" min="1" step="any" value="10" aria-label="Maximum score">
            <button type="submit" class="icon-btn" aria-label="Add criterion">${icon('plus')}</button>
          </form>
          <p class="small faint">Changes save when you leave a field. Removing a criterion deletes its scores.</p>
        </div>
      </div>
    </details>

    ${judged ? html`<div class="callout" style="margin-bottom:14px">${icon('gavel')}<span><strong>Judges are scoring this round.</strong> Grey numbers are the average of each team’s assigned judges. Type a mark to override it for that team; clear it to go back to the judges’ average. <a href="#/judges/${r.number}">Manage judge assignments</a></span></div>` : ''}
    ${awaiting ? html`<div class="callout callout-warn" style="margin-bottom:14px">${icon('alert')}<span>${awaiting} team${awaiting === 1 ? ' has' : 's have'} no decision in Round ${r.number - 1}, so ${awaiting === 1 ? 'it isn’t' : 'they aren’t'} listed here. <a href="#/rounds/${r.number - 1}">Decide in Round ${r.number - 1}</a> first.</span></div>` : ''}

    <div class="toolbar">
      <label class="search"><span class="sr-only">Search teams</span>${icon('search')}<input class="input" id="s-search" type="search" placeholder="Search teams" value="${S.q}"></label>
      <label class="check small"><input type="checkbox" id="s-all" ${S.showAll ? 'checked' : ''}> Show teams not in this round</label>
      <span class="grow"></span>
      <span id="s-progress"></span>
      ${r.is_elimination ? html`<button type="button" class="btn btn-sm" id="s-auto">${icon('zap')}Select top teams</button>` : ''}
    </div>

    <section class="card card-flush">
      ${!r.criteria.length
        ? empty('No criteria yet', 'Add at least one scoring criterion in “Round settings & criteria” to start scoring.')
        : !S.rows.length
          ? empty('No teams yet', 'Add teams on the Teams page first.', html`<a class="btn" href="#/teams">Go to Teams</a>`)
          : html`<div class="table-wrap" style="max-height:72vh"><table class="table sheet">
              <thead><tr><th>Team</th>${r.criteria.map((c) => html`<th class="num" title="${c.name}">${c.name}<br><span class="faint">/${fmtScore(c.max_score)}</span></th>`)}
                <th class="num">Total<br><span class="faint">/${fmtScore(r.max_total)}</span></th><th class="num">Judges</th><th>${r.is_elimination ? 'Decision' : 'Status'}</th><th>Notes</th><th><span class="sr-only">Save status</span></th></tr></thead>
              <tbody id="s-body"></tbody></table></div>`}
    </section>`
  );

  const details = $('#r-settings');
  details.open = S.settingsOpen || !r.criteria.length;
  details.addEventListener('toggle', () => (S.settingsOpen = details.open));
  drawRows();
  drawProgress();
  bind(ctx);
}

function visibleRows() {
  const q = S.q.trim().toLowerCase();
  return S.rows.filter((row) => (S.showAll || row.eligible) && (!q || `${row.code} ${row.name} ${row.leader_name} ${row.track} ${row.table_no}`.toLowerCase().includes(q)));
}

function rowHtml(row) {
  const r = S.round;
  const disabled = !row.eligible;
  const open = S.openNotes.has(row.team_id);
  const cols = r.criteria.length + 6;
  return html`<tr data-team="${row.team_id}" class="${disabled ? 'is-ineligible' : ''}">
      <td class="team-cell"><strong>${row.name}</strong><small>${row.code}${row.table_no ? ` · T${row.table_no}` : ''}${!row.active ? ' · disabled' : row.eliminated_in ? ` · out in R${row.eliminated_in}` : row.awaiting_round ? ` · no R${row.awaiting_round} decision` : ''}</small></td>
      ${r.criteria.map(
        (c) => html`<td class="num"><input class="input score-input" type="number" inputmode="decimal" min="0" max="${c.max_score}" step="any"
          id="s-${row.team_id}-${c.id}" data-crit="${c.id}" value="${row.scores[c.id] ?? ''}" placeholder="${avgOf(row, c.id)}" aria-label="${c.name} score for ${row.name}${avgOf(row, c.id) ? ` (judges’ average ${avgOf(row, c.id)})` : ''}" ${disabled ? 'disabled' : ''}></td>`
      )}
      <td class="num total" data-total>${fmtScore(row.total)}</td>
      <td class="num" data-judges-cell>${judgesCell(row)}</td>
      <td><select class="select status-select" id="st-${row.team_id}" data-v="${row.status}" aria-label="Decision for ${row.name}" ${disabled ? 'disabled' : ''}>${statusOptions(r, row.status)}</select></td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-notes aria-expanded="${open}">${row.comments || row.award ? 'Edit notes' : 'Add notes'}${row.award ? html` ${chip('award', row.award)}` : ''}</button></td>
      <td><span class="save-state" data-save title=""></span></td>
    </tr>
    <tr class="notes-row" data-notes-for="${row.team_id}" ${open ? '' : 'hidden'}>
      <td colspan="${cols}"><div class="sheet-note">
        <label class="field"><span>Comments for the team <span class="hint">Shown once the round is published${row.judges && row.judges.assigned ? ', with the judges’ own comments' : ''}</span></span>
          <textarea class="textarea" rows="3" id="c-${row.team_id}" maxlength="4000" ${disabled ? 'disabled' : ''}>${row.comments}</textarea></label>
        <label class="field"><span>Award <span class="hint">Optional, e.g. Winner, Best UI</span></span>
          <input class="input" id="a-${row.team_id}" maxlength="80" value="${row.award}" ${disabled ? 'disabled' : ''}></label>
      </div></td>
    </tr>`;
}

function drawRows() {
  const body = $('#s-body');
  if (!body) return;
  const list = visibleRows();
  setHTML(body, list.length ? list.map(rowHtml) : html`<tr><td colspan="${S.round.criteria.length + 6}" class="muted" style="text-align:center;padding:28px">No teams match.</td></tr>`);
}

function drawProgress() {
  const el = $('#s-progress');
  if (!el) return;
  const eligible = S.rows.filter((r) => r.eligible);
  const scored = eligible.filter((r) => r.complete).length;
  const selected = eligible.filter((r) => r.status === 'selected').length;
  const out = eligible.filter((r) => r.status === 'eliminated').length;
  setHTML(
    el,
    html`<span class="small muted">${scored}/${eligible.length} fully scored${S.round.is_elimination ? html` · <span style="color:var(--ok)">${selected} selected</span> · <span style="color:var(--bad)">${out} out</span> · ${eligible.length - selected - out} pending` : ''}</span>`
  );
}

function patchRow(row, flash) {
  const tr = $(`tr[data-team="${row.team_id}"]`);
  if (!tr) return;
  for (const c of S.round.criteria) {
    const input = $(`[data-crit="${c.id}"]`, tr);
    if (!input) continue;
    input.placeholder = avgOf(row, c.id);
    if (document.activeElement !== input) input.value = row.scores[c.id] ?? '';
  }
  $('[data-total]', tr).textContent = fmtScore(row.total);
  setHTML($('[data-judges-cell]', tr), judgesCell(row));
  const sel = $('.status-select', tr);
  sel.value = !S.round.is_elimination && row.status === 'selected' ? 'pending' : row.status;
  sel.dataset.v = row.status;
  const notes = tr.nextElementSibling;
  const c = $('textarea', notes);
  const a = $('input', notes);
  if (document.activeElement !== c) c.value = row.comments;
  if (document.activeElement !== a) a.value = row.award;
  if (flash) {
    tr.classList.remove('flash');
    void tr.offsetWidth;
    tr.classList.add('flash');
  }
}

// ---------- saving -----------------------------------------------------------------------------
function setSaveState(tr, s, title = '') {
  const el = $('[data-save]', tr);
  if (!el) return;
  el.dataset.s = s;
  el.title = title || { dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: 'Not saved' }[s] || '';
}

function readRow(tr, round = S.round) {
  const row = S.round && S.round.id === round.id ? S.rows.find((x) => x.team_id === Number(tr.dataset.team)) : null;
  const scores = {};
  let valid = true;
  let total = 0;
  let any = false;
  for (const c of round.criteria) {
    const input = $(`[data-crit="${c.id}"]`, tr);
    const val = input.value.trim();
    input.removeAttribute('aria-invalid');
    if (val === '') {
      scores[c.id] = null;
      // An empty box falls back to the judges' average.
      const avg = row?.judge_avg?.[c.id];
      if (avg !== undefined && avg !== null) {
        total += Number(avg);
        any = true;
      }
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
    any = true;
  }
  const notes = tr.nextElementSibling;
  return {
    valid,
    total: any ? Math.round(total * 100) / 100 : null,
    body: {
      scores,
      status: $('.status-select', tr).value,
      comments: $('textarea', notes).value,
      award: $('input', notes).value,
    },
  };
}

function schedule(tr, delay = 700) {
  const teamId = Number(tr.dataset.team);
  const existing = S.timers.get(teamId);
  if (existing) clearTimeout(existing.timer);
  const { valid, total } = readRow(tr);
  $('[data-total]', tr).textContent = fmtScore(total);
  if (!valid) {
    S.timers.delete(teamId);
    setSaveState(tr, 'error', 'A score is outside the allowed range');
    return;
  }
  setSaveState(tr, 'dirty');
  const round = S.round;
  S.timers.set(teamId, { tr, round, timer: setTimeout(() => save(teamId, tr, round), delay) });
}

// `round` is the round the edit was made in, even if the view has moved on.
async function save(teamId, tr, round = S.round) {
  S.timers.delete(teamId);
  const { valid, body } = readRow(tr, round);
  if (!valid) return setSaveState(tr, 'error', 'A score is outside the allowed range');
  S.saving.add(teamId);
  setSaveState(tr, 'saving');
  const roundId = round.id;
  try {
    const { row } = await api(`/admin/rounds/${roundId}/sheet/${teamId}`, { method: 'PUT', body });
    if (S.round && S.round.id === roundId) {
      const i = S.rows.findIndex((r) => r.team_id === teamId);
      if (i >= 0) S.rows[i] = row;
      $('[data-total]', tr).textContent = fmtScore(row.total);
      $('.status-select', tr).dataset.v = row.status;
      const btn = $('[data-notes]', tr);
      if (btn) setHTML(btn, html`${row.comments || row.award ? 'Edit notes' : 'Add notes'}${row.award ? html` ${chip('award', row.award)}` : ''}`);
      drawProgress();
    }
    setSaveState(tr, S.timers.has(teamId) ? 'dirty' : 'saved');
  } catch (err) {
    setSaveState(tr, 'error', err.message);
    toastError(err);
  } finally {
    S.saving.delete(teamId);
    if (!busy() && S.needsRerender) S.ctx?.rerender();
  }
}

// ---------- events ------------------------------------------------------------------------------
function bind(ctx) {
  const r = S.round;
  const body = $('#s-body');

  if (body) {
    body.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-team]') || e.target.closest('tr.notes-row')?.previousElementSibling;
      if (!tr) return;
      if (e.target.matches('.score-input')) schedule(tr, 700);
      else if (e.target.matches('textarea, input')) schedule(tr, 1200);
    });
    body.addEventListener('change', (e) => {
      if (e.target.matches('.status-select')) {
        e.target.dataset.v = e.target.value;
        schedule(e.target.closest('tr[data-team]'), 0);
      } else if (e.target.matches('input, textarea')) {
        // Leaving a field saves right away (also covers paste/autofill).
        const tr = e.target.closest('tr[data-team]') || e.target.closest('tr.notes-row')?.previousElementSibling;
        if (tr) schedule(tr, 0);
      }
    });
    body.addEventListener('click', (e) => {
      const jb = e.target.closest('[data-judges]');
      if (jb) return showJudges(Number(jb.closest('tr').dataset.team));
      const btn = e.target.closest('[data-notes]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const id = Number(tr.dataset.team);
      const notes = tr.nextElementSibling;
      const open = notes.hidden;
      notes.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) {
        S.openNotes.add(id);
        $('textarea', notes).focus();
      } else S.openNotes.delete(id);
    });
    // Enter jumps to the same criterion in the next team, for fast entry.
    body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('.score-input')) return;
      e.preventDefault();
      const crit = e.target.dataset.crit;
      const rows = $$('tr[data-team]', body);
      const i = rows.indexOf(e.target.closest('tr'));
      const next = rows.slice(i + 1).map((tr) => $(`[data-crit="${crit}"]:not(:disabled)`, tr)).find(Boolean);
      if (next) {
        next.focus();
        next.select();
      }
    });
  }

  $('#s-search')?.addEventListener('input', (e) => {
    S.q = e.target.value;
    drawRows();
  });
  $('#s-all')?.addEventListener('change', (e) => {
    S.showAll = e.target.checked;
    drawRows();
  });

  $('#r-state').addEventListener('change', async (e) => {
    try {
      await api(`/admin/rounds/${r.id}`, { method: 'PUT', body: { name: r.name, description: r.description, state: e.target.value } });
      toast(`Round ${r.number} is now “${STATE_LABEL[e.target.value]}”.`, 'ok');
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  });

  $('#r-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('.form-error', f);
    err.textContent = '';
    await withBusy($('button[type=submit]', f), async () => {
      try {
        await api(`/admin/rounds/${r.id}`, {
          method: 'PUT',
          body: { name: $('#rf-name').value, description: $('#rf-desc').value, is_elimination: $('#rf-elim').checked, state: r.state },
        });
        toast('Round saved.', 'ok');
        ctx.rerender();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  });

  const list = $('#crit-list');
  list.addEventListener('change', async (e) => {
    const rowEl = e.target.closest('[data-crit]');
    if (!rowEl) return;
    const name = $('[data-f=name]', rowEl).value;
    const max = $('[data-f=max]', rowEl).value;
    try {
      await api(`/admin/criteria/${rowEl.dataset.crit}`, { method: 'PUT', body: { name, max_score: max } });
      toast('Criterion saved.', 'ok', { timeout: 1800 });
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  });
  list.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const rowEl = del.closest('[data-crit]');
    const name = $('[data-f=name]', rowEl).value;
    const ok = await confirmDialog({
      title: 'Remove criterion',
      message: `Remove “${name}” from Round ${r.number}? Any scores already entered for it are deleted and totals are recalculated.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/admin/criteria/${rowEl.dataset.crit}`, { method: 'DELETE' });
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  });
  $('#crit-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameEl = e.target.elements.namedItem('name');
    const maxEl = e.target.elements.namedItem('max_score');
    if (!nameEl.value.trim()) return nameEl.focus();
    try {
      await api(`/admin/rounds/${r.id}/criteria`, { method: 'POST', body: { name: nameEl.value, max_score: maxEl.value } });
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  });

  $('#s-auto')?.addEventListener('click', () => autoSelect(ctx));
  $('#r-publish')?.addEventListener('click', () => publish(ctx));
  $('#r-unpublish')?.addEventListener('click', () => unpublish(ctx));
}

// ---------- judges' marks ------------------------------------------------------------------------
const avgOf = (row, critId) => {
  const v = row.judge_avg ? row.judge_avg[critId] : undefined;
  return v === undefined || v === null ? '' : fmtScore(Number(v));
};

function judgesCell(row) {
  const j = row.judges || { assigned: 0, done: 0 };
  if (!j.assigned) return html`<span class="faint small">–</span>`;
  return html`<button type="button" class="btn btn-ghost btn-sm judges-btn${j.done >= j.assigned ? ' is-complete' : ''}" data-judges title="See each judge’s marks">${j.done}/${j.assigned}</button>`;
}

async function showJudges(teamId) {
  const r = S.round;
  let data;
  try {
    data = await api(`/admin/rounds/${r.id}/sheet/${teamId}/judges`);
  } catch (err) {
    return toastError(err);
  }
  const row = S.rows.find((x) => x.team_id === teamId) || {};
  openModal({
    title: `${data.team.name} · Round ${r.number}`,
    wide: true,
    form: false,
    content: html`
      ${data.judges.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Judge</th>${r.criteria.map((c) => html`<th class="num">${c.name}<br><span class="faint">/${fmtScore(c.max_score)}</span></th>`)}<th class="num">Total</th><th>Status</th></tr></thead>
            <tbody>${data.judges.map(
              (j) => html`<tr>
                <td class="team-cell"><strong>${j.judge_name}</strong><small>${j.judge_username}${j.updated_at ? ` · ${timeAgo(j.updated_at)}` : ''}</small></td>
                ${r.criteria.map((c) => html`<td class="num">${fmtScore(j.scores[c.id] ?? null)}</td>`)}
                <td class="num"><strong>${fmtScore(j.total)}</strong></td>
                <td>${j.done ? chip('selected', 'Done') : Object.keys(j.scores).length ? chip('pending', 'In progress') : chip('upcoming', 'Not started')}</td>
              </tr>`
            )}</tbody>
            <tfoot><tr><th>Official</th>${r.criteria.map((c) => html`<td class="num">${row.scores && row.scores[c.id] !== undefined ? html`<strong title="Your override">${fmtScore(row.scores[c.id])}</strong>` : avgOf(row, c.id) || '–'}</td>`)}<td class="num"><strong>${fmtScore(row.total)}</strong></td><td class="small muted">${Object.keys(row.scores || {}).length ? 'Bold = your override' : 'Judges’ average'}</td></tr></tfoot>
          </table></div>
          ${data.judges.some((j) => j.comments)
            ? html`<div class="stack-sm" style="margin-top:16px"><span class="label">Judges’ comments <span class="faint">(teams see these as “Judge 1”, “Judge 2”…)</span></span>
                ${data.judges.filter((j) => j.comments).map((j) => html`<div class="fb"><strong>${j.judge_name}</strong><p>${j.comments}</p></div>`)}</div>`
            : html`<p class="small muted" style="margin-top:12px">No comments from the judges yet.</p>`}`
        : empty('No judges assigned', 'Assign judges to this team on the Judges page.', html`<a class="btn" href="#/judges/${r.number}" data-close>Go to Judges</a>`)}`,
    footer: html`<button type="button" class="btn btn-primary" data-close>Close</button>`,
  });
}

function autoSelect(ctx) {
  const r = S.round;
  const eligible = S.rows.filter((x) => x.eligible);
  const unscored = eligible.filter((x) => x.total === null).length;
  formModal({
    title: 'Select top teams',
    submitLabel: 'Apply decisions',
    content: html`
      <p class="muted">Ranks the ${eligible.length} teams in this round by their Round ${r.number} total. The top teams are marked <strong>Selected</strong> and the rest <strong>Not selected</strong>. Teams tied with the last selected score all go through.</p>
      ${unscored ? html`<div class="callout callout-warn">${icon('alert')}<span>${unscored} team${unscored === 1 ? ' has' : 's have'} no score yet and will rank last.</span></div>` : ''}
      <label class="field"><span>How many teams go through to Round ${r.number + 1 <= S.rounds.length ? r.number + 1 : 'the finish'}?</span>
        <input class="input mono" type="number" name="top" min="1" max="${eligible.length}" value="${Math.max(1, Math.ceil(eligible.length / 2))}" required></label>
      <p class="small faint">This overwrites decisions already made for this round. You can still change any team afterwards.</p>`,
    async onSubmit(v) {
      await flushSaves();
      const res = await api(`/admin/rounds/${r.id}/auto-select`, { method: 'POST', body: { top: Number(v.top) } });
      toast(`${res.selected} selected, ${res.eliminated} not selected${res.ties ? ` (includes ${res.ties} tied at the cut-off)` : ''}.`, 'ok', { timeout: 6000 });
      ctx.rerender();
    },
  });
}

async function flushSaves() {
  const pending = [...S.timers.entries()];
  for (const [teamId, t] of pending) {
    clearTimeout(t.timer);
    await save(teamId, t.tr, t.round);
  }
}

function publish(ctx) {
  const r = S.round;
  const eligible = S.rows.filter((x) => x.eligible);
  const unscored = eligible.filter((x) => !x.complete).length;
  const pending = r.is_elimination ? eligible.filter((x) => x.status === 'pending').length : 0;
  formModal({
    title: `Publish Round ${r.number}`,
    submitLabel: 'Publish results',
    content: html`
      <p class="muted">Every team in this round will see their scores, judges’ notes and ${r.is_elimination ? 'whether they’re selected for the next round' : 'that they move on'}.</p>
      ${pending ? html`<div class="callout callout-warn">${icon('alert')}<span>${pending} team${pending === 1 ? ' has' : 's have'} no decision yet. They’ll see “Result pending”.</span></div>` : ''}
      ${unscored ? html`<div class="callout callout-warn">${icon('alert')}<span>${unscored} team${unscored === 1 ? ' isn’t' : 's aren’t'} fully scored.</span></div>` : ''}
      <label class="check"><input type="checkbox" name="announce" checked> Post an announcement telling teams the results are out</label>`,
    async onSubmit(v) {
      await flushSaves();
      await api(`/admin/rounds/${r.id}/publish`, { method: 'POST', body: { published: true, announce: v.announce } });
      toast(`Round ${r.number} results published.`, 'ok');
      ctx.rerender();
    },
  });
}

async function unpublish(ctx) {
  const r = S.round;
  const ok = await confirmDialog({
    title: `Unpublish Round ${r.number}`,
    message: 'Teams will no longer see scores, notes or decisions for this round until you publish it again. Announcements already posted stay up.',
    confirmLabel: 'Unpublish',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/admin/rounds/${r.id}/publish`, { method: 'POST', body: { published: false } });
    toast(`Round ${r.number} hidden from teams.`, 'ok');
    ctx.rerender();
  } catch (err) {
    toastError(err);
  }
}
