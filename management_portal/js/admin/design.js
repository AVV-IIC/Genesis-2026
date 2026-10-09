// Ideathon: every team's Design Thinking sheet (4-5-3 brainwriting: base idea + 12 ideas).
import { $, $$, api, html, setHTML, icon, toast, toastError, confirmDialog, richText, timeAgo, plural } from '../core.js';
import { chip, empty } from './shared.js';
import { roster, chainsHTML, TOTAL, RULES, ITERATIONS } from '../design.js';

export const live = ['design', 'teams', 'settings'];

const S = { tab: 'started', q: '', open: new Set() };
let poll = null;

export function leave() {
  clearInterval(poll);
  poll = null;
}

export async function render(ctx, params, seq) {
  const d = await api('/admin/design');
  for (const t of d.teams) t.stage = t.stage || 1; // older databases have no stage yet
  if (!ctx.isCurrent(seq)) return;
  // On the static site saves aren't broadcast (it would use up the Realtime quota), so refresh quietly.
  if (!poll) poll = setInterval(() => { if (document.visibilityState === 'visible') ctx.rerender(); }, 30000);

  const active = d.teams.filter((t) => t.active);
  const isStarted = (t) => t.filled > 0 || String(t.base_idea || '').trim() !== '';
  const started = active.filter(isStarted);
  const notStarted = active.filter((t) => !isStarted(t));
  const complete = active.filter((t) => t.stage > ITERATIONS).length;
  const q = S.q.trim().toLowerCase();
  const match = (t) => !q || `${t.code} ${t.name} ${t.leader_name || ''} ${t.base_idea || ''}`.toLowerCase().includes(q);
  const list = (S.tab === 'started' ? started : notStarted).filter(match);

  const status = d.enabled
    ? html`<div class="callout">${icon('check')}<span><strong>Teams can see and edit their Design Thinking page.</strong> <button type="button" class="btn btn-sm" data-set="0">Turn it off</button></span></div>`
    : html`<div class="callout callout-warn">${icon('eyeOff')}<span><strong>The Design Thinking page is turned off.</strong> Teams don’t see it. <button type="button" class="btn btn-sm" data-set="1">Turn it on</button></span></div>`;

  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Design Thinking</h1><p>The 4-5-3 method: each team develops a base idea, 4 members × about 5 minutes × 3 iterations, passing ideas along. Teams move on one iteration at a time once all 4 ideas are in. ${plural(started.length, 'team')} started, ${complete} finished.</p></div>
      <div class="row"><button type="button" class="btn" data-download="design">${icon('download')}Export CSV</button></div>
    </div>
    <div style="margin-bottom:16px">${status}</div>
    <details class="card dt-rules-card" style="margin-bottom:16px">
      <summary><strong>How teams run it</strong></summary>
      <ol class="dt-rules">${RULES.map(([t, text]) => html`<li><strong>${t}</strong><span>${text}</span></li>`)}</ol>
    </details>
    <div class="toolbar">
      <label class="search"><span class="sr-only">Search teams</span>${icon('search')}<input class="input" id="dt-search" type="search" placeholder="Search team or base idea" value="${S.q}"></label>
      <div class="seg" role="group" aria-label="Show">
        <button type="button" data-tab="started" aria-pressed="${String(S.tab === 'started')}">Started <span class="faint">${started.length}</span></button>
        <button type="button" data-tab="not" aria-pressed="${String(S.tab === 'not')}">Not started <span class="faint">${notStarted.length}</span></button>
      </div>
    </div>
    ${S.tab === 'started'
      ? list.length
        ? html`<div class="stack-sm">${list.map(teamCard)}</div>`
        : html`<div class="card">${empty(q ? 'No matches' : 'Nothing yet', q ? 'Try a different search.' : 'Teams appear here as soon as they write their base idea or first idea.')}</div>`
      : list.length
        ? html`<section class="card card-flush"><div class="table-wrap"><table class="table">
            <thead><tr><th>Team ID</th><th>Team</th><th>Leader</th></tr></thead>
            <tbody>${list.map((t) => html`<tr><td><span class="code-tag">${t.code}</span></td><td><strong>${t.name}</strong></td><td class="muted">${t.leader_name || '–'}</td></tr>`)}</tbody>
          </table></div></section>`
        : html`<div class="card">${empty(q ? 'No matches' : 'Everyone has started', q ? 'Try a different search.' : 'Every active team has written something.')}</div>`}`
  );

  $('#dt-search').addEventListener('input', (e) => {
    S.q = e.target.value;
    ctx.rerender();
  });
  $$('[data-tab]', ctx.main).forEach((b) =>
    b.addEventListener('click', () => {
      S.tab = b.dataset.tab;
      ctx.rerender();
    })
  );
  $$('details[data-team]', ctx.main).forEach((el) =>
    el.addEventListener('toggle', () => (el.open ? S.open.add(el.dataset.team) : S.open.delete(el.dataset.team)))
  );
  $$('[data-back]', ctx.main).forEach((b) =>
    b.addEventListener('click', async () => {
      const to = Number(b.dataset.to);
      const ok = await confirmDialog({
        title: `Reopen iteration ${to} for ${b.dataset.name}?`,
        message: `The team goes back to iteration ${to} and can edit those ideas${to === 1 ? ' and the base idea' : ''} again. Ideas they already wrote in later iterations are kept.`,
        confirmLabel: `Reopen iteration ${to}`,
      });
      if (!ok) return;
      try {
        await api(`/admin/design/${b.dataset.back}/back`, { method: 'POST', body: {} });
        toast(`Iteration ${to} reopened for ${b.dataset.name}.`, 'ok');
        ctx.rerender();
      } catch (err) {
        toastError(err);
      }
    })
  );
  $$('[data-set]', ctx.main).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api('/admin/settings', { method: 'PUT', body: { design_thinking_enabled: b.dataset.set === '1' } });
        toast('Saved.', 'ok', { timeout: 1800 });
        await ctx.refreshMeta();
        ctx.rerender();
      } catch (err) {
        toastError(err);
      }
    })
  );
}

function teamCard(t) {
  const names = roster(t.leader_name, t.members);
  const pct = Math.round((t.filled / TOTAL) * 100);
  return html`<details class="card idea-item" data-team="${t.team_id}" ${S.open.has(String(t.team_id)) ? 'open' : ''}>
    <summary>
      <span class="idea-sum">
        <strong>${t.name}</strong>
        <small><span class="mono">${t.code}</span>${t.base_idea ? html` · ${richText(t.base_idea.length > 90 ? `${t.base_idea.slice(0, 90)}…` : t.base_idea)}` : ' · no base idea yet'}</small>
      </span>
      <span class="row dt-sum-side">
        <span class="dt-meter"><span class="progress" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="small muted">${t.filled}/${TOTAL} ideas</span></span>
        ${t.stage > ITERATIONS ? chip('selected', 'Finished') : chip('pending', `Iteration ${t.stage}`)}
        <span class="small muted">${t.updated_at ? timeAgo(t.updated_at) : ''}</span>
      </span>
    </summary>
    <div class="idea-view">${chainsHTML(t, names)}
      ${t.stage > 1 ? html`<div class="row dt-admin-foot"><button type="button" class="btn btn-sm" data-back="${t.team_id}" data-to="${Math.min(t.stage - 1, ITERATIONS)}" data-name="${t.name}">${icon('back')}Reopen iteration ${Math.min(t.stage - 1, ITERATIONS)}</button>
        <span class="small muted">If the team moved on by mistake. Teams themselves can’t go back.</span></div>` : ''}
    </div>
  </details>`;
}
