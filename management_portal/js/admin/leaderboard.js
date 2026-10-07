import { $, api, html, setHTML, icon, toast, toastError, fmtScore } from '../core.js';
import { chip, empty } from './shared.js';

export const live = ['sheet', 'rounds', 'results', 'teams', 'settings'];

export async function render(ctx, params, seq) {
  const [board, { settings }] = await Promise.all([api('/admin/leaderboard'), api('/admin/settings')]);
  if (!ctx.isCurrent(seq)) return;
  const visible = settings.leaderboard_visible === '1';

  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Leaderboard</h1><p>Your view includes unpublished rounds. Teams only ever see totals from published rounds.</p></div>
      <button type="button" class="btn" data-download="results">${icon('download')}Export results CSV</button>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="switch-row" style="padding:0">
        <div><strong>Show leaderboard to teams</strong><small>${visible ? 'Team leaders can see a Leaderboard tab with published totals.' : 'Hidden. Teams only see their own scores.'}</small></div>
        <input type="checkbox" class="switch" id="lb-toggle" ${visible ? 'checked' : ''} aria-label="Show leaderboard to teams">
      </div>
    </div>
    ${board.rows.length
      ? html`<section class="card card-flush"><div class="table-wrap"><table class="table">
          <thead><tr><th class="num">#</th><th>Team</th>${board.rounds.map((r) => html`<th class="num" title="${r.name}">R${r.number} <span class="faint">/${fmtScore(r.max_total)}</span>${r.published ? '' : html`<br><span class="faint small">hidden</span>`}</th>`)}<th class="num">Total</th><th>Status</th></tr></thead>
          <tbody>${board.rows.map(
            (row) => html`<tr class="${row.eliminated_in ? 'is-dim' : ''}">
              <td class="num">${row.rank}</td>
              <td class="team-cell"><strong>${row.name}</strong><small>${row.code}${row.track ? ` · ${row.track}` : ''}</small></td>
              ${row.rounds.map((r) => html`<td class="num">${fmtScore(r.total)}</td>`)}
              <td class="num"><strong>${fmtScore(row.total)}</strong></td>
              <td>${row.eliminated_in ? chip('eliminated', `Out in R${row.eliminated_in}`) : chip('selected', 'Competing')}${row.awards.map((a) => html` ${chip('award', a)}`)}</td>
            </tr>`
          )}</tbody></table></div></section>`
      : html`<div class="card">${empty('No teams yet', 'Add teams and enter scores to build the leaderboard.')}</div>`}`
  );

  $('#lb-toggle').addEventListener('change', async (e) => {
    try {
      await api('/admin/settings', { method: 'PUT', body: { leaderboard_visible: e.target.checked } });
      toast(e.target.checked ? 'Leaderboard is now visible to teams.' : 'Leaderboard hidden from teams.', 'ok');
      ctx.refreshMeta();
    } catch (err) {
      e.target.checked = !e.target.checked;
      toastError(err);
    }
  });
}
