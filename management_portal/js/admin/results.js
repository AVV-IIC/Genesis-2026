// Ideathon results: one award and a note per team, published all at once.
import { $, $$, api, html, setHTML, icon, formModal, confirmDialog, toast, toastError, plural } from '../core.js';
import { chip, empty } from './shared.js';

export const live = ['teams', 'results', 'submission'];

const AWARDS = ['Winner', 'First runner-up', 'Second runner-up', 'Best innovation', 'Best social impact', 'Best pitch', 'Special mention'];
const S = { teams: [], published: false, timers: new Map(), q: '' };

addEventListener('beforeunload', (e) => {
  if (S.timers.size) {
    e.preventDefault();
    e.returnValue = '';
  }
});

export async function render(ctx, params, seq) {
  const d = await api('/admin/results');
  if (!ctx.isCurrent(seq)) return;
  S.teams = d.teams;
  S.published = d.published;
  const awarded = S.teams.filter((t) => t.award).length;

  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Results</h1><p>Give awards to the winning teams and add a short note for any team. Teams see their award and note on their dashboard once you publish.</p></div>
      <div class="row">
        <button type="button" class="btn" data-download="results">${icon('download')}Export CSV</button>
        ${S.published
          ? html`<button type="button" class="btn" id="r-unpublish">${icon('eyeOff')}Unpublish</button>`
          : html`<button type="button" class="btn btn-primary" id="r-publish">${icon('send')}Publish results</button>`}
      </div>
    </div>
    <div style="margin-bottom:16px">${S.published
      ? html`<div class="callout">${icon('eye')}<span><strong>Published.</strong> Teams can see their results. Changes you make now show up for them straight away.</span></div>`
      : html`<div class="callout callout-warn">${icon('eyeOff')}<span><strong>Hidden from teams.</strong> ${awarded ? `${plural(awarded, 'team')} ${awarded === 1 ? 'has' : 'have'} an award so far.` : 'No awards given yet.'} Publish when you’re ready.</span></div>`}</div>
    <datalist id="award-list">${AWARDS.map((a) => html`<option value="${a}"></option>`)}</datalist>
    <div class="toolbar">
      <label class="search"><span class="sr-only">Search teams</span>${icon('search')}<input class="input" id="r-search" type="search" placeholder="Search teams" value="${S.q}"></label>
      <span class="grow"></span>
      <span class="small muted">Changes save automatically.</span>
    </div>
    <section class="card card-flush">
      ${S.teams.length
        ? html`<div class="table-wrap"><table class="table results-table">
            <thead><tr><th>Team</th><th>Idea</th><th style="min-width:200px">Award</th><th style="min-width:260px">Note for the team</th><th><span class="sr-only">Save status</span></th></tr></thead>
            <tbody id="r-body"></tbody></table></div>`
        : empty('No teams yet', 'Add Ideathon teams on the Teams page first.', html`<a class="btn" href="#/teams">Go to Teams</a>`)}
    </section>`
  );
  drawRows();

  $('#r-search').addEventListener('input', (e) => {
    S.q = e.target.value;
    drawRows();
  });
  const body = $('#r-body');
  body?.addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-team]');
    if (tr) schedule(tr, 900);
  });
  body?.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-team]');
    if (tr) schedule(tr, 0);
  });
  $('#r-publish')?.addEventListener('click', () => publish(ctx));
  $('#r-unpublish')?.addEventListener('click', () => unpublish(ctx));
}

export function leave() {
  for (const [id, t] of S.timers) {
    clearTimeout(t);
    const tr = $(`tr[data-team="${id}"]`);
    if (tr) save(tr);
  }
}

export function onEvent(type, data, ctx) {
  // Don't re-render under someone typing an award.
  if (S.timers.size) return true;
  if (live.includes(type)) ctx.rerender();
  return true;
}

function drawRows() {
  const body = $('#r-body');
  if (!body) return;
  const q = S.q.trim().toLowerCase();
  const list = S.teams.filter((t) => !q || `${t.code} ${t.name} ${t.leader_name} ${t.track} ${t.submission_title || ''} ${t.award}`.toLowerCase().includes(q));
  setHTML(
    body,
    list.length
      ? list.map(
          (t) => html`<tr data-team="${t.id}" class="${t.active ? '' : 'is-dim'}">
            <td class="team-cell"><strong>${t.name}</strong><small>${t.code}${t.leader_name ? ` · ${t.leader_name}` : ''}${t.active ? '' : ' · disabled'}</small></td>
            <td class="small">${t.submission_title || html`<span class="faint">No idea submitted</span>`}</td>
            <td><input class="input" id="aw-${t.id}" list="award-list" maxlength="80" value="${t.award}" placeholder="No award" aria-label="Award for ${t.name}"></td>
            <td><input class="input" id="nt-${t.id}" maxlength="1000" value="${t.result_note}" placeholder="Optional, e.g. Great pitch!" aria-label="Note for ${t.name}"></td>
            <td><span class="save-state" data-save></span></td>
          </tr>`
        )
      : html`<tr><td colspan="5" class="muted" style="text-align:center;padding:28px">No teams match.</td></tr>`
  );
}

function setSaveState(tr, s, title = '') {
  const el = $('[data-save]', tr);
  if (!el) return;
  el.dataset.s = s;
  el.title = title || { dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: 'Not saved' }[s] || '';
}

function schedule(tr, delay) {
  const id = Number(tr.dataset.team);
  clearTimeout(S.timers.get(id));
  setSaveState(tr, 'dirty');
  S.timers.set(id, setTimeout(() => save(tr), delay));
}

async function save(tr) {
  const id = Number(tr.dataset.team);
  clearTimeout(S.timers.get(id));
  S.timers.delete(id);
  const [award, note] = $$('input', tr);
  setSaveState(tr, 'saving');
  try {
    const res = await api(`/admin/results/${id}`, { method: 'PUT', body: { award: award.value, result_note: note.value } });
    const t = S.teams.find((x) => x.id === id);
    if (t) Object.assign(t, { award: res.team.award, result_note: res.team.result_note });
    setSaveState(tr, S.timers.has(id) ? 'dirty' : 'saved');
  } catch (err) {
    setSaveState(tr, 'error', err.message);
    toastError(err);
  }
}

async function flush() {
  for (const [id, t] of [...S.timers]) {
    clearTimeout(t);
    const tr = $(`tr[data-team="${id}"]`);
    if (tr) await save(tr);
  }
}

function publish(ctx) {
  const awarded = S.teams.filter((t) => t.award);
  formModal({
    title: 'Publish results',
    submitLabel: 'Publish results',
    content: html`
      <p class="muted">Every Ideathon team will see their result on their dashboard: their award if they won one, and your note.</p>
      ${awarded.length
        ? html`<div class="stack-sm"><span class="label">Awards</span><div class="row">${awarded.map((t) => chip('award', `${t.award}: ${t.name}`))}</div></div>`
        : html`<div class="callout callout-warn">${icon('alert')}<span>No team has an award yet. Teams will just see a thank-you.</span></div>`}
      <label class="check"><input type="checkbox" name="announce" checked> Post an announcement telling teams the results are out</label>`,
    async onSubmit(v) {
      await flush();
      await api('/admin/results/publish', { method: 'POST', body: { published: true, announce: v.announce } });
      toast('Results published.', 'ok');
      ctx.rerender();
    },
  });
}

async function unpublish(ctx) {
  const ok = await confirmDialog({
    title: 'Unpublish results',
    message: 'Teams will no longer see their awards or notes until you publish again. Announcements already posted stay up.',
    confirmLabel: 'Unpublish',
    danger: true,
  });
  if (!ok) return;
  try {
    await api('/admin/results/publish', { method: 'POST', body: { published: false } });
    toast('Results hidden from teams.', 'ok');
    ctx.rerender();
  } catch (err) {
    toastError(err);
  }
}
