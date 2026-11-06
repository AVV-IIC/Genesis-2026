// Ideathon results: any number of awards and a note per team, published all at once.
import { $, $$, api, html, setHTML, icon, formModal, confirmDialog, toast, toastError, plural } from '../core.js';
import { chip, empty, awardOptions } from './shared.js';

// A team's awards, stored one per line. Defined here rather than shared, so a cached older copy of another
// file right after an update can't stop this page from loading.
const awardsOf = (text) => String(text || '').split('\n').map((a) => a.trim()).filter(Boolean);

export const live = ['teams', 'results', 'submission'];

const MAX_AWARDS = 10;
const S = { teams: [], published: false, timers: new Map(), q: '', options: [] };

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
  for (const t of S.teams) t.awards = awardsOf(t.award);
  S.published = d.published;
  S.options = awardOptions(ctx.settings);
  const awarded = S.teams.filter((t) => t.awards.length).length;

  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Results</h1><p>Give awards to teams (a team can have several) and add a short note for any team. Teams see their awards and note on their dashboard once you publish.</p></div>
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
    <datalist id="award-list">${S.options.map((a) => html`<option value="${a}"></option>`)}</datalist>
    <div class="toolbar">
      <label class="search"><span class="sr-only">Search teams</span>${icon('search')}<input class="input" id="r-search" type="search" placeholder="Search teams or awards" value="${S.q}"></label>
      <span class="grow"></span>
      <span class="small muted">Pick an award from the list, or type one and press Enter. Changes save automatically.</span>
    </div>
    <section class="card card-flush">
      ${S.teams.length
        ? html`<div class="table-wrap"><table class="table results-table">
            <thead><tr><th>Team</th><th>Idea</th><th style="min-width:280px">Awards <a class="small th-link" href="#/settings">Edit list</a></th><th style="min-width:240px">Note for the team</th><th><span class="sr-only">Save status</span></th></tr></thead>
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
  const rowOf = (el) => el.closest('tr[data-team]');
  body?.addEventListener('input', (e) => {
    const tr = rowOf(e.target);
    if (!tr) return;
    if (e.target.matches('.aw-input')) {
      // Picking from the list adds the award straight away; typed text waits for Enter.
      const v = e.target.value.trim().toLowerCase();
      if (v && S.options.some((a) => a.toLowerCase() === v)) addAward(tr, e.target.value);
      return;
    }
    schedule(tr, 900);
  });
  body?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.aw-input')) {
      e.preventDefault();
      addAward(rowOf(e.target), e.target.value);
    }
  });
  body?.addEventListener('change', (e) => {
    const tr = rowOf(e.target);
    if (!tr) return;
    if (e.target.matches('.aw-input')) {
      if (e.target.value.trim()) addAward(tr, e.target.value);
      return;
    }
    schedule(tr, 0);
  });
  body?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-aw-del]');
    if (!b) return;
    const tr = rowOf(b);
    const t = teamOf(tr);
    t.awards.splice(Number(b.dataset.awDel), 1);
    drawAwards(tr, t, true);
    schedule(tr, 0);
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
  // Don't re-render under someone typing an award or a note.
  if (S.timers.size || chains.size) return true;
  if (live.includes(type)) ctx.rerender();
  return true;
}

const teamOf = (tr) => S.teams.find((x) => x.id === Number(tr.dataset.team));

const awardCell = (t) => html`<div class="aw-pick">
  ${t.awards.map((a, i) => html`<span class="chip chip-award aw-chip">${a}<button type="button" class="aw-x" data-aw-del="${i}" aria-label="Remove ${a}">${icon('x')}</button></span>`)}
  ${t.awards.length < MAX_AWARDS
    ? html`<input class="input aw-input" id="aw-${t.id}" list="award-list" maxlength="80" placeholder="${t.awards.length ? 'Add another award' : 'Add an award'}" aria-label="Add an award for ${t.name}">`
    : ''}
</div>`;

function drawAwards(tr, t, focus) {
  setHTML($('.aw-cell', tr), awardCell(t));
  if (focus) $('.aw-input', tr)?.focus();
}

function addAward(tr, value) {
  const t = teamOf(tr);
  const v = String(value || '').replace(/\s+/g, ' ').trim();
  if (!t || !v) return;
  if (v.length > 80) return toast('An award name can be up to 80 characters.', 'warn');
  if (t.awards.some((a) => a.toLowerCase() === v.toLowerCase())) {
    $('.aw-input', tr).value = '';
    return toast(`${t.name} already has “${v}”.`, 'info', { timeout: 2500 });
  }
  if (t.awards.length >= MAX_AWARDS) return toast(`A team can have up to ${MAX_AWARDS} awards.`, 'warn');
  t.awards.push(v);
  drawAwards(tr, t, true);
  schedule(tr, 0);
}

function drawRows() {
  const body = $('#r-body');
  if (!body) return;
  const q = S.q.trim().toLowerCase();
  const list = S.teams.filter((t) => !q || `${t.code} ${t.name} ${t.leader_name} ${t.track} ${t.submission_title || ''} ${t.awards.join(' ')}`.toLowerCase().includes(q));
  setHTML(
    body,
    list.length
      ? list.map(
          (t) => html`<tr data-team="${t.id}" class="${t.active ? '' : 'is-dim'}">
            <td class="team-cell"><strong>${t.name}</strong><small>${t.code}${t.leader_name ? ` · ${t.leader_name}` : ''}${t.active ? '' : ' · disabled'}</small></td>
            <td class="small">${t.submission_title || html`<span class="faint">No idea submitted</span>`}</td>
            <td class="aw-cell">${awardCell(t)}</td>
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

// One team's saves run one after another, so an older save can't land last and overwrite a newer one.
const chains = new Map();
function save(tr) {
  const id = Number(tr.dataset.team);
  clearTimeout(S.timers.get(id));
  S.timers.delete(id);
  const run = (chains.get(id) || Promise.resolve()).then(() => saveNow(tr, id));
  chains.set(id, run);
  run.then(() => { if (chains.get(id) === run) chains.delete(id); });
  return run;
}

async function saveNow(tr, id) {
  const t = S.teams.find((x) => x.id === id);
  const note = $(`#nt-${id}`, tr); // read when the save runs: always the latest state
  setSaveState(tr, 'saving');
  try {
    const res = await api(`/admin/results/${id}`, { method: 'PUT', body: { awards: t.awards.slice(), result_note: note ? note.value : t.result_note } });
    Object.assign(t, { award: res.team.award, result_note: res.team.result_note });
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
    if (tr) save(tr);
  }
  await Promise.all([...chains.values()]);
}

function publish(ctx) {
  const awarded = S.teams.filter((t) => t.awards.length);
  formModal({
    title: 'Publish results',
    submitLabel: 'Publish results',
    content: html`
      <p class="muted">Every Ideathon team will see their result on their dashboard: their awards if they won any, and your note.</p>
      ${awarded.length
        ? html`<div class="stack-sm"><span class="label">Awards</span><div class="row">${awarded.map((t) => t.awards.map((a) => chip('award', `${a}: ${t.name}`)))}</div></div>`
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
