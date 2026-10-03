// Ideathon: every team's latest idea, and who hasn't submitted yet.
import { $, $$, api, html, setHTML, icon, toast, toastError, richText, timeAgo, fmtDateTime, plural } from '../core.js';
import { chip, empty } from './shared.js';

export const live = ['submission', 'teams', 'settings'];

const S = { tab: 'in', q: '', open: new Set() };

export async function render(ctx, params, seq) {
  const d = await api('/admin/submissions');
  if (!ctx.isCurrent(seq)) return;
  const q = S.q.trim().toLowerCase();
  const match = (x) => !q || `${x.code} ${x.name} ${x.leader_name || ''} ${x.track || ''} ${x.title || ''}`.toLowerCase().includes(q);
  const subs = d.submissions.filter(match);
  const missing = d.missing.filter(match);
  const status = !d.enabled
    ? html`<div class="callout callout-warn">${icon('eyeOff')}<span><strong>Idea submission is turned off.</strong> Teams don’t see the “My idea” page. <button type="button" class="btn btn-sm" data-set="submissions_enabled" data-v="1">Turn it on</button></span></div>`
    : d.open
      ? html`<div class="callout">${icon('check')}<span><strong>Accepting ideas${d.deadline ? ` until ${fmtDateTime(d.deadline)}` : ''}.</strong> Teams can edit their idea until submissions close. <button type="button" class="btn btn-sm" data-set="submissions_open" data-v="0">Close submissions now</button></span></div>`
      : html`<div class="callout callout-warn">${icon('clock')}<span><strong>${d.accepting && d.deadline ? `Closed. The deadline (${fmtDateTime(d.deadline)}) has passed.` : 'Submissions are closed.'}</strong> Teams can read but not change their idea. ${d.accepting ? html`<a href="#/settings">Change the deadline</a>` : html`<button type="button" class="btn btn-sm" data-set="submissions_open" data-v="1">Open submissions</button>`}</span></div>`;

  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Ideas</h1><p>Each team’s latest idea, newest first. ${plural(d.submissions.length, 'team')} submitted, ${d.missing.length} still to go.</p></div>
      <div class="row"><button type="button" class="btn" data-download="submissions">${icon('download')}Export CSV</button></div>
    </div>
    <div style="margin-bottom:16px">${status}</div>
    <div class="toolbar">
      <label class="search"><span class="sr-only">Search ideas</span>${icon('search')}<input class="input" id="sub-search" type="search" placeholder="Search team or idea" value="${S.q}"></label>
      <div class="seg" role="group" aria-label="Show">
        <button type="button" data-tab="in" aria-pressed="${S.tab === 'in'}">Submitted <span class="faint">${d.submissions.length}</span></button>
        <button type="button" data-tab="missing" aria-pressed="${S.tab === 'missing'}">Not yet <span class="faint">${d.missing.length}</span></button>
      </div>
    </div>
    ${S.tab === 'in'
      ? subs.length
        ? html`<div class="stack-sm">${subs.map(ideaCard)}</div>`
        : html`<div class="card">${empty(q ? 'No matches' : 'No ideas yet', q ? 'Try a different search.' : 'Ideas appear here the moment a team saves one.')}</div>`
      : missing.length
        ? html`<section class="card card-flush"><div class="table-wrap"><table class="table">
            <thead><tr><th>Team ID</th><th>Team</th><th>Leader</th></tr></thead>
            <tbody>${missing.map((t) => html`<tr><td><span class="code-tag">${t.code}</span></td><td><strong>${t.name}</strong></td><td class="muted">${t.leader_name || '–'}</td></tr>`)}</tbody>
          </table></div></section>`
        : html`<div class="card">${empty(q ? 'No matches' : 'Everyone’s in', q ? 'Try a different search.' : 'Every active team has submitted an idea.')}</div>`}`
  );

  $('#sub-search').addEventListener('input', (e) => {
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
  $$('[data-set]', ctx.main).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api('/admin/settings', { method: 'PUT', body: { [b.dataset.set]: b.dataset.v === '1' } });
        toast('Saved.', 'ok', { timeout: 1800 });
        await ctx.refreshMeta();
        ctx.rerender();
      } catch (err) {
        toastError(err);
      }
    })
  );
}

function ideaCard(s) {
  const links = [['Pitch deck', s.deck_url], ['Video', s.video_url], ['Other link', s.extra_url]].filter(([, u]) => u);
  return html`<details class="card idea-item" data-team="${s.team_id}" ${S.open.has(String(s.team_id)) ? 'open' : ''}>
    <summary>
      <span class="idea-sum">
        <strong>${s.title}</strong>
        <small>${s.name} · <span class="mono">${s.code}</span>${s.track ? ` · ${s.track}` : ''}${s.table_no ? ` · Table ${s.table_no}` : ''}</small>
      </span>
      <span class="row">${links.length ? chip('advanced', plural(links.length, 'link')) : ''}<span class="small muted">${timeAgo(s.updated_at)}</span></span>
    </summary>
    <div class="idea-view stack">
      <section><span class="label">The problem</span><div>${richText(s.problem)}</div></section>
      <section><span class="label">Solution</span><div>${richText(s.solution)}</div></section>
      ${s.impact ? html`<section><span class="label">Impact</span><div>${richText(s.impact)}</div></section>` : ''}
      ${links.length ? html`<div class="row">${links.map(([label, u]) => html`<a class="btn btn-sm" href="${u}" target="_blank" rel="noopener noreferrer">${icon('link')}${label}</a>`)}</div>` : ''}
      <p class="small faint">Team leader: ${s.leader_name || '–'} · first saved ${fmtDateTime(s.created_at)} · last saved ${fmtDateTime(s.updated_at)}</p>
    </div>
  </details>`;
}
