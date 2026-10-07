// Hackathon judges: accounts, and which judge scores which team in each round.
import { $, $$, api, html, raw, setHTML, icon, formModal, confirmDialog, toast, toastError, timeAgo, plural, withBusy, firstName } from '../core.js';
import { empty, showCredentials } from './shared.js';

const S = { judges: [], nextUsername: '', rounds: [], round: null, data: null, pairs: new Set(), saved: new Set(), dirty: false, stale: false, lastNumber: 1 };
const key = (j, t) => `${j}:${t}`;

addEventListener('beforeunload', (e) => {
  if (S.dirty && location.hash.startsWith('#/judges')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

export async function render(ctx, params, seq) {
  const wanted = Number(params[0]) || S.lastNumber;
  if (S.dirty && S.round && S.round.number !== wanted) {
    const discard = await confirmDialog({
      title: 'Unsaved assignments',
      message: `You changed the Round ${S.round.number} assignments without saving. Discard those changes?`,
      confirmLabel: 'Discard changes',
      danger: true,
    });
    if (!discard) {
      location.hash = `#/judges/${S.round.number}`;
      return;
    }
    S.dirty = false;
  }
  const [{ judges, next_username }, { rounds }] = await Promise.all([api('/admin/judges'), api('/admin/rounds')]);
  const round = rounds.find((r) => r.number === wanted) || rounds[0];
  const data = round ? await api(`/admin/rounds/${round.id}/assignments`) : null;
  if (!ctx.isCurrent(seq)) return;
  S.judges = judges;
  S.nextUsername = next_username;
  S.rounds = rounds;
  if (!S.dirty || !S.round || S.round.id !== round?.id) {
    S.round = data?.round || null;
    S.data = data;
    S.pairs = new Set((data?.pairs || []).map(([j, t]) => key(j, t)));
    S.saved = new Set(S.pairs);
    S.dirty = false;
  }
  S.stale = false;
  S.lastNumber = round?.number || 1;
  draw(ctx);
}

export function leave() {
  // Unsaved ticks are kept for when you come back; just remind.
  if (S.dirty) toast(`Round ${S.round.number} judge assignments aren’t saved yet.`, 'warn', { action: { label: 'Back to judges', onClick: () => (location.hash = `#/judges/${S.round.number}`) } });
}

export function onEvent(type, data, ctx) {
  if (['judges', 'rounds', 'teams', 'results'].includes(type)) {
    // Don't throw away unsaved ticks; offer a reload instead.
    if (S.dirty) {
      S.stale = true;
      const note = $('#as-stale');
      if (note) note.hidden = false;
    } else ctx.rerender();
    return true;
  }
  return type === 'sheet';
}

// ---------- drawing -------------------------------------------------------------------------
function draw(ctx) {
  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Judges</h1><p>Judges sign in on the Hackathon side with a Judge ID. Each judge scores only the teams you assign to them; a team’s official score is the average of its judges’ marks.</p></div>
      <button type="button" class="btn btn-primary" id="j-add">${icon('plus')}Add judge</button>
    </div>

    <section class="card card-flush" style="margin-bottom:20px">
      <div class="card-head"><h2 class="section-title">Judge accounts <span class="faint">${S.judges.length}</span></h2></div>
      ${S.judges.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Judge ID</th><th>Name</th>${S.rounds.map((r) => html`<th class="num" title="${r.name}">R${r.number}</th>`)}<th>Last sign-in</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${S.judges.map(
              (j) => html`<tr class="${j.active ? '' : 'is-dim'}">
                <td><span class="code-tag">${j.username}</span></td>
                <td class="team-cell"><strong>${j.display_name}</strong>${j.active ? '' : html`<small>Disabled</small>`}</td>
                ${S.rounds.map((r) => {
                  const p = (j.rounds || []).find((x) => x.number === r.number) || { assigned: 0, done: 0 };
                  return html`<td class="num small">${p.assigned ? html`<span class="${p.done >= p.assigned ? 'ok-text' : ''}">${p.done}/${p.assigned}</span>` : html`<span class="faint">–</span>`}</td>`;
                })}
                <td class="small ${j.last_login_at ? 'muted' : 'faint'}">${j.last_login_at ? timeAgo(j.last_login_at) : 'Never'}</td>
                <td class="actions">
                  <button type="button" class="icon-btn" data-edit="${j.id}" aria-label="Edit ${j.display_name}" title="Edit">${icon('edit')}</button>
                  <button type="button" class="icon-btn" data-reset="${j.id}" aria-label="Reset password for ${j.display_name}" title="Reset password">${icon('key')}</button>
                  <button type="button" class="icon-btn" data-del="${j.id}" aria-label="Delete ${j.display_name}" title="Delete">${icon('trash')}</button>
                </td>
              </tr>`
            )}</tbody></table></div>
            <p class="small faint" style="padding:10px 18px 14px">Numbers per round are teams marked done / teams assigned.</p>`
        : empty('No judges yet', 'Add a judge to create their login. You’ll get a printable slip with their Judge ID and password.', html`<button type="button" class="btn btn-primary" id="j-add-2">${icon('plus')}Add the first judge</button>`)}
    </section>

    ${S.round && S.judges.length ? assignmentsHtml() : ''}`
  );
  bind(ctx);
}

function assignmentsHtml() {
  const r = S.round;
  const teams = S.data.teams;
  const judges = S.data.judges.filter((j) => j.active || [...S.pairs].some((p) => p.startsWith(`${j.id}:`)));
  const done = new Set((S.data.done || []).map(([j, t]) => key(j, t)));
  const perTeam = (t) => judges.filter((j) => S.pairs.has(key(j.id, t.team_id))).length;
  const perJudge = (j) => teams.filter((t) => S.pairs.has(key(j.id, t.team_id))).length;
  const unassigned = teams.filter((t) => t.eligible && !perTeam(t)).length;
  return html`<section class="card stack" id="assign">
    <div class="row-between" style="align-items:start">
      <div><h2 class="section-title">Assignments</h2><p class="small muted" style="margin-top:4px">Tick who judges which team in each round. Judges see their list as soon as you save.</p></div>
      <div class="row" id="as-actions">
        <span class="small" id="as-dirty" ${S.dirty ? '' : 'hidden'} style="color:var(--warn)">Unsaved changes</span>
        <button type="button" class="btn btn-ghost btn-sm" id="as-discard" ${S.dirty ? '' : 'hidden'}>Discard</button>
        <button type="button" class="btn btn-primary btn-sm" id="as-save" ${S.dirty ? '' : 'disabled'}>${icon('check')}Save assignments</button>
      </div>
    </div>
    <nav class="seg" aria-label="Round">${S.rounds.map(
      (x) => html`<a href="#/judges/${x.number}" class="seg-link" ${x.id === r.id ? raw('aria-current="page"') : ''}>Round ${x.number}</a>`
    )}</nav>
    <div class="callout" id="as-stale" hidden>${icon('refresh')}<span>Teams or judges changed while you were editing. Save or discard to see the latest.</span></div>
    ${!teams.length
      ? empty('No teams in this round', r.number > 1 ? `Teams appear here once they’re selected in Round ${r.number - 1}.` : 'Add teams on the Teams page first.')
      : html`
        <div class="toolbar" style="margin:0">
          <button type="button" class="btn btn-sm" data-quick="all">${icon('grid')}Every judge, every team</button>
          <button type="button" class="btn btn-sm" data-quick="split">${icon('users')}Split teams evenly…</button>
          ${r.number > 1 ? html`<button type="button" class="btn btn-sm" data-quick="copy">${icon('copy')}Copy Round ${r.number - 1}</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-quick="clear">${icon('x')}Clear</button>
          <span class="grow"></span>
          <span class="small ${unassigned ? '' : 'muted'}" style="${unassigned ? 'color:var(--warn)' : ''}">${unassigned ? `${plural(unassigned, 'team')} without a judge` : 'Every team has a judge'}</span>
        </div>
        <div class="table-wrap" style="max-height:64vh"><table class="table matrix">
          <thead><tr><th>Team</th>${judges.map((j) => html`<th class="num" title="${j.display_name}">${j.username}<br><span class="faint small">${firstName(j.display_name)}</span></th>`)}<th class="num">Judges</th></tr></thead>
          <tbody>${teams.map(
            (t) => html`<tr class="${t.eligible ? '' : 'is-ineligible'}">
              <td class="team-cell"><strong>${t.name}</strong><small>${t.code}${t.table_no ? ` · T${t.table_no}` : ''}${t.eligible ? '' : ' · no longer in this round'}</small></td>
              ${judges.map((j) => {
                const k = key(j.id, t.team_id);
                return html`<td class="num"><label class="cell-check${done.has(k) && S.pairs.has(k) ? ' is-done' : ''}" title="${done.has(k) ? 'Marked done' : ''}">
                  <input type="checkbox" data-pair="${k}" ${S.pairs.has(k) ? 'checked' : ''} aria-label="${j.display_name} judges ${t.name}">
                </label></td>`;
              })}
              <td class="num" data-team-count="${t.team_id}">${perTeam(t) || html`<span style="color:var(--warn)">0</span>`}</td>
            </tr>`
          )}</tbody>
          <tfoot><tr><th>Teams per judge</th>${judges.map((j) => html`<td class="num" data-judge-count="${j.id}">${perJudge(j)}</td>`)}<td></td></tr></tfoot>
        </table></div>
        <p class="small faint">A filled check means the judge has marked that team done. Removing a judge from a team hides their marks for it from the average.</p>`}
  </section>`;
}

function markDirty() {
  S.dirty = S.pairs.size !== S.saved.size || [...S.pairs].some((p) => !S.saved.has(p));
  $('#as-dirty').hidden = !S.dirty;
  $('#as-discard').hidden = !S.dirty;
  $('#as-save').disabled = !S.dirty;
}

function redrawMatrix(ctx) {
  const scroll = $('.matrix')?.closest('.table-wrap')?.scrollTop || 0;
  draw(ctx);
  markDirty();
  const wrap = $('.matrix')?.closest('.table-wrap');
  if (wrap) wrap.scrollTop = scroll;
  $('#assign')?.scrollIntoView({ block: 'nearest' });
}

// ---------- events ------------------------------------------------------------------------------
function bind(ctx) {
  $('#j-add').addEventListener('click', () => editJudge(ctx, null));
  $('#j-add-2')?.addEventListener('click', () => editJudge(ctx, null));
  const byId = (id) => S.judges.find((j) => j.id === Number(id));
  $$('[data-edit]', ctx.main).forEach((b) => b.addEventListener('click', () => editJudge(ctx, byId(b.dataset.edit))));
  $$('[data-reset]', ctx.main).forEach((b) => b.addEventListener('click', () => resetPassword(byId(b.dataset.reset))));
  $$('[data-del]', ctx.main).forEach((b) => b.addEventListener('click', () => deleteJudge(ctx, byId(b.dataset.del))));

  const matrix = $('.matrix');
  matrix?.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-pair]');
    if (!cb) return;
    if (cb.checked) S.pairs.add(cb.dataset.pair);
    else S.pairs.delete(cb.dataset.pair);
    const [j, t] = cb.dataset.pair.split(':');
    const teamCount = S.data.judges.filter((x) => S.pairs.has(key(x.id, t))).length;
    setHTML($(`[data-team-count="${t}"]`), teamCount ? String(teamCount) : html`<span style="color:var(--warn)">0</span>`);
    $(`[data-judge-count="${j}"]`).textContent = S.data.teams.filter((x) => S.pairs.has(key(j, x.team_id))).length;
    markDirty();
  });

  $$('[data-quick]', ctx.main).forEach((b) => b.addEventListener('click', () => quick(ctx, b.dataset.quick, b)));
  $('#as-discard')?.addEventListener('click', () => {
    S.pairs = new Set(S.saved);
    S.dirty = false;
    if (S.stale) ctx.rerender();
    else redrawMatrix(ctx);
  });
  $('#as-save')?.addEventListener('click', (e) => save(ctx, e.currentTarget));
}

function activeJudges() {
  return S.data.judges.filter((j) => j.active);
}

async function quick(ctx, kind, btn) {
  const teams = S.data.teams.filter((t) => t.eligible);
  const judges = activeJudges();
  if (!judges.length) return toast('Every judge is disabled. Turn one back on first.', 'warn');
  if (kind === 'all') {
    for (const t of teams) for (const j of judges) S.pairs.add(key(j.id, t.team_id));
    redrawMatrix(ctx);
  } else if (kind === 'clear') {
    S.pairs = new Set();
    redrawMatrix(ctx);
  } else if (kind === 'copy') {
    const prev = S.rounds.find((r) => r.number === S.round.number - 1);
    await withBusy(btn, async () => {
      try {
        const res = await api(`/admin/rounds/${prev.id}/assignments`);
        const inRound = new Set(teams.map((t) => t.team_id));
        const copied = res.pairs.filter(([, t]) => inRound.has(t));
        if (!copied.length) return toast(`Nobody in this round was assigned in Round ${prev.number}.`, 'warn');
        S.pairs = new Set(copied.map(([j, t]) => key(j, t)));
        redrawMatrix(ctx);
        toast(`Copied ${plural(copied.length, 'assignment')} from Round ${prev.number}. Save to apply.`, 'ok');
      } catch (err) {
        toastError(err);
      }
    });
  } else if (kind === 'split') {
    formModal({
      title: 'Split teams evenly',
      submitLabel: 'Split teams',
      content: html`
        <p class="muted">Spreads the ${plural(teams.length, 'team')} in Round ${S.round.number} across your ${plural(judges.length, 'active judge')}, so everyone gets a similar load. This replaces the current ticks for this round.</p>
        <label class="field"><span>Judges per team</span>
          <input class="input mono" type="number" name="per" min="1" max="${judges.length}" value="${Math.min(2, judges.length)}" required></label>`,
      async onSubmit(v) {
        const per = Math.max(1, Math.min(judges.length, Math.floor(Number(v.per)) || 1));
        S.pairs = new Set();
        // Round-robin keeps every judge's load within one team of the others.
        teams.forEach((t, i) => {
          for (let k = 0; k < per; k++) S.pairs.add(key(judges[(i * per + k) % judges.length].id, t.team_id));
        });
        redrawMatrix(ctx);
        toast('Teams split. Check the ticks, then save.', 'ok');
      },
    });
  }
}

async function save(ctx, btn) {
  const pairs = [...S.pairs].map((p) => p.split(':').map(Number));
  await withBusy(btn, async () => {
    try {
      await api(`/admin/rounds/${S.round.id}/assignments`, { method: 'PUT', body: { pairs } });
      S.saved = new Set(S.pairs);
      S.dirty = false;
      toast(`Round ${S.round.number} assignments saved. Judges see them now.`, 'ok');
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  });
}

// ---------- accounts ------------------------------------------------------------------------------
function editJudge(ctx, judge) {
  formModal({
    title: judge ? 'Edit judge' : 'Add judge',
    submitLabel: judge ? 'Save changes' : 'Add judge',
    content: html`
      <label class="field"><span>Name</span><input class="input" name="display_name" value="${judge?.display_name || ''}" maxlength="80" placeholder="e.g. Dr. Meera Iyer" required></label>
      <label class="field"><span>Judge ID (login) ${judge ? '' : html`<span class="hint">Leave blank for ${S.nextUsername}</span>`}</span>
        <input class="input mono" name="username" value="${judge?.username || ''}" maxlength="32" placeholder="${S.nextUsername}" autocapitalize="characters" spellcheck="false" ${judge ? 'required' : ''}></label>
      ${judge
        ? html`<label class="check"><input type="checkbox" name="active" ${judge.active ? 'checked' : ''}> Judge can sign in</label>
          <p class="small faint">Turning this off signs them out. Their marks stay.</p>`
        : html`<label class="field"><span>Password <span class="hint">Leave blank to generate one</span></span><input class="input mono" name="password" maxlength="100" autocomplete="off" spellcheck="false"></label>`}`,
    async onSubmit(v) {
      if (judge) {
        await api(`/admin/judges/${judge.id}`, { method: 'PUT', body: v });
        toast('Judge saved.', 'ok');
      } else {
        const res = await api('/admin/judges', { method: 'POST', body: v });
        showCredentials([{ code: res.judge.username, name: res.judge.display_name, password: res.password, judge: true }], { title: 'Judge added' });
      }
      ctx.rerender();
    },
  });
}

async function resetPassword(judge) {
  const ok = await confirmDialog({
    title: 'Reset password',
    message: `Generate a new password for ${judge.display_name}? Their current password stops working and they’re signed out.`,
    confirmLabel: 'Reset password',
  });
  if (!ok) return;
  try {
    const res = await api(`/admin/judges/${judge.id}/password`, { method: 'POST', body: {} });
    showCredentials(res.credentials, { title: 'New judge password' });
  } catch (err) {
    toastError(err);
  }
}

async function deleteJudge(ctx, judge) {
  const ok = await confirmDialog({
    title: 'Delete judge',
    message: `Delete ${judge.display_name} (${judge.username})? Their marks, comments and assignments are deleted too, and team averages are recalculated. To keep their marks, edit the judge and turn off sign-in instead.`,
    confirmLabel: 'Delete judge',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/admin/judges/${judge.id}`, { method: 'DELETE' });
    toast(`${judge.display_name} deleted.`, 'ok');
    ctx.rerender();
  } catch (err) {
    toastError(err);
  }
}
