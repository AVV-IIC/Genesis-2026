// Ideathon results, evaluated per event: Genesis (#/results/marks) and Innovation Mela (#/mela-results).
// Each event has its own rounds (each with criteria and maximum marks) and its own judges, who sit in panels. Each
// panel marks its own teams: organisers pick a judge and type in that judge's marks. A team's mark for a round is its
// panel's average (the average of the panel's judges who marked it); the overall total adds up the rounds and ranks
// the teams. Viewing shows only the teams that have marks; editing a judge's marks lists every team.
// Marks stay with the organisers. Only helpers that core.js and shared.js have exported for a long time are used
// here, so a browser still holding older cached copies of those files keeps working.
import { $, $$, api, html, raw, setHTML, icon, formModal, confirmDialog, toast, toastError, plural, fmtScore, downloadText, fmtDateTime, preserveInputs } from '../core.js';
import { empty } from './shared.js';

const EVENTS = {
  genesis: {
    title: 'Genesis results',
    intro: 'Judges’ marks for the Genesis Ideathon. Add the rounds (each with its own criteria and maximum marks), the panels and their judges, then type in each judge’s marks. Only organisers see the marks.',
    file: 'genesis',
    noTeams: 'Add Ideathon teams on the Teams page first.',
  },
  mela: {
    title: 'Innovation Mela results',
    intro: 'Judges’ marks for Innovation Mela: the teams shortlisted for Innovation Mela and the outside teams. Add the rounds, the panels and their judges, then type in each judge’s marks. A team’s mark is its panel’s average. Only organisers see the marks.',
    file: 'innovation-mela',
    noTeams: 'Teams appear here once they get the “Shortlisted for Innovation Mela” award (Genesis results) or when you add outside teams on the Innovation Mela page.',
  },
};

const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (n === null || n === undefined ? '–' : fmtScore(r2(n)));
const roundMax = (r) => r.criteria.reduce((s, c) => s + Number(c.max_score), 0);
const sel = (on) => (on ? raw('aria-current="page"') : '');
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** The two tabs at the top of Results → Genesis. */
export const genesisTabs = (active) => html`<nav class="tabs page-tabs" aria-label="Genesis results">
  <a href="#/results" ${sel(active === 'awards')}>${icon('award')}Awards &amp; publish</a>
  <a href="#/results/marks" ${sel(active === 'marks')}>${icon('clipboard')}Judges’ marks</a>
</nav>`;

function csvText(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function evalView(event) {
  const E = EVENTS[event];
  // view: a round id or 'overall' · judge: 'all' (the panels) or a judge id · edit: typing that judge's marks
  const S = { d: null, view: null, judge: 'all', edit: false, q: '', timers: new Map(), groups: [] };
  const chains = new Map();
  let M = new Map(); // `${judge}:${team}:${criterion}` -> mark
  let C = new Map(); // `${judge}:${team}:${round}` -> comment

  // ---------- panels and numbers ----------
  const hasPanels = () => S.d.panels.length > 0;
  // The panels with their judges, plus judges not in a panel (all the judges, when there are no panels).
  function panelGroups() {
    const d = S.d;
    const known = new Set(d.panels.map((p) => p.id));
    const out = d.panels.map((p) => ({ id: p.id, name: p.name, judges: d.judges.filter((j) => j.panel_id === p.id) }));
    const loose = d.judges.filter((j) => !j.panel_id || !known.has(j.panel_id));
    if (loose.length || !d.panels.length) out.push({ id: 0, name: d.panels.length ? 'Not in a panel' : 'Judges', judges: loose, loose: true });
    return out;
  }
  const groupOf = (jid) => S.groups.find((g) => g.judges.some((j) => j.id === jid));
  function judgeTotal(r, jid, tid) {
    let sum = 0;
    let n = 0;
    for (const c of r.criteria) {
      const v = M.get(`${jid}:${tid}:${c.id}`);
      if (v !== undefined) {
        sum += v;
        n += 1;
      }
    }
    return n ? { sum, n, complete: n === r.criteria.length } : null;
  }
  function groupAvg(r, g, tid) {
    const ts = g.judges.map((j) => judgeTotal(r, j.id, tid)).filter(Boolean);
    return ts.length ? { avg: mean(ts.map((x) => x.sum)), n: ts.length } : null;
  }
  // A team's mark for a round is its panel's average. (If two panels marked the same team, it's the average of the two.)
  function roundScore(r, tid) {
    const per = S.groups.map((g) => ({ g, a: groupAvg(r, g, tid) })).filter((x) => x.a);
    return per.length ? { score: mean(per.map((x) => x.a.avg)), groups: per.map((x) => x.g) } : null;
  }
  // Only the teams that have marks; equal totals share a rank.
  function standings() {
    const rows = S.d.teams
      .map((t) => {
        const per = S.d.rounds.map((r) => roundScore(r, t.id));
        const names = [...new Set(per.filter(Boolean).flatMap((x) => x.groups.map((g) => g.name)))];
        return { t, per: per.map((x) => (x ? x.score : null)), panels: names, total: per.reduce((s, x) => s + (x ? x.score : 0), 0) };
      })
      .filter((x) => x.per.some((v) => v !== null))
      .sort((a, b) => b.total - a.total || a.t.code.localeCompare(b.t.code));
    rows.forEach((x, i) => {
      x.rank = i > 0 && r2(rows[i - 1].total) === r2(x.total) ? rows[i - 1].rank : i + 1;
    });
    return rows;
  }
  const matches = (t) => {
    const q = S.q.trim().toLowerCase();
    return !q || `${t.code} ${t.name} ${t.leader_name || ''} ${t.title || ''}`.toLowerCase().includes(q);
  };
  const judgedCount = (r, jid) => S.d.teams.filter((t) => judgeTotal(r, jid, t.id)).length;

  // ---------- page ----------
  async function render(ctx, params, seq) {
    const d = await api(`/admin/eval/${event}`);
    if (!ctx.isCurrent(seq)) return;
    d.panels = d.panels || [];
    S.d = d;
    M = new Map(d.marks.map(([j, t, c, s]) => [`${j}:${t}:${c}`, Number(s)]));
    C = new Map(d.comments.map((x) => [`${x.judge_id}:${x.team_id}:${x.round_id}`, x.comment]));
    draw(ctx);
  }

  function draw(ctx) {
    const d = S.d;
    S.groups = panelGroups();
    if (S.view !== 'overall' && !d.rounds.some((r) => r.id === S.view)) S.view = d.rounds.length ? d.rounds[0].id : 'overall';
    if (S.judge !== 'all' && !d.judges.some((j) => j.id === S.judge)) S.judge = 'all';
    if (S.judge === 'all' || S.view === 'overall') S.edit = false;
    const round = d.rounds.find((r) => r.id === S.view) || null;
    setHTML(
      ctx.main,
      html`<div data-eval-root data-event="${event}" class="eval${event === 'mela' ? ' mela-theme' : ''}">
        ${head()}
        ${setup()}
        ${d.rounds.length
          ? board(round)
          : html`<section class="card">${empty('No rounds yet', 'Add a round with its criteria and maximum marks, for example Innovation /10, Feasibility /10 and Presentation /10. Then add the panels and judges and type in their marks.',
              html`<button type="button" class="btn btn-primary" data-ev-add-round>${icon('plus')}Add a round</button>`)}</section>`}
      </div>`
    );
    bind(ctx);
  }
  const redraw = (ctx) => preserveInputs(ctx.main, () => draw(ctx));

  const actions = () => html`
    <button type="button" class="btn" data-ev-csv ${S.d.rounds.length ? '' : 'disabled'}>${icon('download')}Results CSV</button>
    <button type="button" class="btn" data-ev-marks-csv ${M.size ? '' : 'disabled'}>${icon('download')}All marks CSV</button>
    <button type="button" class="btn" data-ev-print ${S.d.rounds.length ? '' : 'disabled'}>${icon('printer')}Print</button>`;

  const head = () =>
    event === 'mela'
      ? html`<section class="card mela-hero eval-hero">
          <div class="mela-title mela-title-row">
            <div class="mela-title-text">
              <p class="mela-kicker">Results · judges’ marks</p>
              <h1 class="page-title mela-name"><span>Innovation</span> <span class="mela-name-hi">Mela</span></h1>
              <p>${E.intro}</p>
            </div>
            <div class="row mela-actions">${actions()}</div>
          </div>
        </section>`
      : html`<div class="page-head">
          <div><h1 class="page-title">${E.title}</h1><p>${E.intro}</p></div>
          <div class="row">${actions()}</div>
        </div>
        ${genesisTabs('marks')}`;

  // ---------- setup: rounds, panels and judges ----------
  const setup = () => html`<div class="eval-setup">
    <section class="card stack-sm" id="ev-rounds">
      <div class="row-between"><h2 class="section-title">Rounds</h2>
        <button type="button" class="btn btn-sm" data-ev-add-round>${icon('plus')}Add a round</button></div>
      ${S.d.rounds.length
        ? html`<ul class="eval-list">${S.d.rounds.map((r) => html`<li>
            <div class="eval-list-main"><strong>${r.name}</strong>
              <small>${r.criteria.map((c) => `${c.name} /${fmtScore(Number(c.max_score))}`).join(' · ')} · out of ${fmtScore(roundMax(r))}</small></div>
            <button type="button" class="icon-btn" data-ev-edit-round="${r.id}" aria-label="Edit ${r.name}" title="Edit">${icon('edit')}</button>
            <button type="button" class="icon-btn" data-ev-del-round="${r.id}" aria-label="Delete ${r.name}" title="Delete">${icon('trash')}</button>
          </li>`)}</ul>`
        : html`<p class="small muted">No rounds yet.</p>`}
    </section>
    <section class="card stack-sm" id="ev-judges">
      <div class="row-between"><h2 class="section-title">Panels &amp; judges</h2>
        <button type="button" class="btn btn-sm" data-ev-add-panel>${icon('plus')}Add a panel</button></div>
      <p class="small muted">${hasPanels()
        ? 'Each panel marks its own teams. A team’s mark for a round is the average of its panel’s judges.'
        : 'If different judges mark different teams, add a panel for each group of judges: a team’s mark is then its panel’s average. Without panels, it’s the average of every judge who marked the team.'}</p>
      <div class="eval-panels">${S.groups.map(panelBlock)}</div>
    </section>
  </div>`;

  const panelBlock = (g) => html`<div class="eval-panel${g.loose ? ' is-loose' : ''}" data-panel="${g.id}">
    <div class="eval-panel-head">
      <strong>${g.name}</strong><span class="small muted">${plural(g.judges.length, 'judge')}</span>
      <span class="grow"></span>
      ${g.loose ? '' : html`<button type="button" class="icon-btn" data-ev-edit-panel="${g.id}" aria-label="Rename ${g.name}" title="Rename">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-ev-del-panel="${g.id}" aria-label="Delete ${g.name}" title="Delete">${icon('trash')}</button>`}
    </div>
    ${g.judges.length
      ? html`<ul class="eval-judge-chips">${g.judges.map((j) => html`<li><span>${j.name}</span>
          <button type="button" class="icon-btn" data-ev-edit-judge="${j.id}" aria-label="Edit ${j.name}" title="${hasPanels() ? 'Rename or move to another panel' : 'Rename'}">${icon('edit')}</button>
          <button type="button" class="icon-btn" data-ev-del-judge="${j.id}" aria-label="Remove ${j.name}" title="Remove">${icon('x')}</button></li>`)}</ul>`
      : html`<p class="small faint">No judges yet.</p>`}
    ${g.loose && hasPanels()
      ? html`<p class="small muted">Use ${icon('edit')} to move these judges into a panel.</p>`
      : html`<form class="eval-add-judge" data-ev-judge-form data-panel="${g.id}" novalidate>
          <input class="input" id="ev-judge-name-${g.id}" maxlength="80" placeholder="Judge’s name, e.g. Dr. Meera" aria-label="New judge${g.loose ? '' : ` in ${g.name}`}" autocomplete="off">
          <button type="submit" class="btn btn-sm">${icon('plus')}Add judge</button>
        </form>`}
  </div>`;

  // ---------- the marks ----------
  const board = (round) => html`
    <div class="toolbar eval-toolbar">
      <div class="seg" role="group" aria-label="Show">
        ${S.d.rounds.map((r) => html`<button type="button" data-ev-view="${r.id}" aria-pressed="${String(S.view === r.id)}">${r.name}</button>`)}
        <button type="button" data-ev-view="overall" aria-pressed="${String(S.view === 'overall')}">${icon('trophy')}Overall</button>
      </div>
      <label class="search"><span class="sr-only">Search teams</span>${icon('search')}<input class="input" id="ev-search" type="search" placeholder="Search teams" value="${S.q}"></label>
    </div>
    ${round ? roundBoard(round) : overallBoard()}`;

  const teamCell = (t, note = '') => html`<td class="team-cell"><strong>${t.name}</strong><small>${t.code}${t.only ? ' · outside team' : ''}${t.active ? '' : ' · disabled'}${note}</small></td>`;
  const dash = html`<span class="faint">–</span>`;
  const noMatch = (span) => html`<tr><td colspan="${span}" class="muted" style="text-align:center;padding:24px">No teams match your search.</td></tr>`;

  function roundBoard(r) {
    const d = S.d;
    if (!d.teams.length) return html`<section class="card">${empty('No teams yet', E.noTeams)}</section>`;
    if (!d.judges.length) return html`<div class="callout callout-warn eval-callout">${icon('info')}<span>Add ${hasPanels() ? 'judges to the panels' : 'the judges'} above to type in their marks for ${r.name}.</span></div>`;
    const judge = d.judges.find((j) => j.id === S.judge);
    const bar = html`<div class="eval-judgebar" role="group" aria-label="Panels and judges">
      <button type="button" class="eval-jbtn eval-jall" data-ev-judge="all" aria-pressed="${String(!judge)}">${icon('users')}${hasPanels() ? 'All panels' : 'All judges'}</button>
      ${S.groups.filter((g) => g.judges.length).map((g) => html`<div class="eval-jgroup">
        ${hasPanels() ? html`<span class="eval-jgroup-name">${g.name}</span>` : ''}
        ${g.judges.map((j) => html`<button type="button" class="eval-jbtn" data-ev-judge="${j.id}" aria-pressed="${String(S.judge === j.id)}" title="Teams ${j.name} marked in ${r.name}">${j.name} <span class="eval-count" data-ev-count="${j.id}">${judgedCount(r, j.id)}</span></button>`)}
      </div>`)}
    </div>`;
    return html`${bar}${!judge ? panelsSummary(r) : S.edit ? sheet(r, judge) : judgeView(r, judge)}`;
  }

  // Every panel with the teams it marked: each judge's total and the panel average.
  function panelsSummary(r) {
    const d = S.d;
    const teams = d.teams.filter(matches);
    const unmarked = teams.filter((t) => !roundScore(r, t.id)).length;
    return html`${S.groups.filter((g) => g.judges.length).map((g) => {
      const list = teams.filter((t) => groupAvg(r, g, t.id));
      return html`<section class="card card-flush eval-panel-card" data-ev-panel-card="${g.id}">
        <header class="eval-card-head">
          <div><h3>${g.name}</h3><small>${g.judges.map((j) => j.name).join(' · ')}</small></div>
          <span class="small muted">${plural(list.length, 'team')} marked</span>
        </header>
        ${list.length
          ? html`<div class="table-wrap"><table class="table eval-table" data-ev-summary data-group="${g.id}">
              <thead><tr><th>Team</th>
                ${g.judges.map((j) => html`<th class="num"><button type="button" class="th-btn" data-ev-judge="${j.id}" title="See ${j.name}’s marks">${j.name}</button></th>`)}
                <th class="num">${hasPanels() && !g.loose ? 'Panel average' : 'Average'} <small>/ ${fmtScore(roundMax(r))}</small></th></tr></thead>
              <tbody>${list.map((t) => {
                const a = groupAvg(r, g, t.id);
                const others = (roundScore(r, t.id)?.groups || []).filter((x) => x !== g);
                return html`<tr data-team="${t.id}" class="${t.active ? '' : 'is-dim'}">${teamCell(t, others.length ? ` · also marked by ${others.map((x) => x.name).join(', ')}` : '')}
                  ${g.judges.map((j) => {
                    const x = judgeTotal(r, j.id, t.id);
                    return html`<td class="num">${x ? html`${fmt(x.sum)}${x.complete ? '' : html`<span class="eval-part" title="Not every criterion is marked">*</span>`}` : dash}</td>`;
                  })}
                  <td class="num"><strong data-avg>${fmt(a.avg)}</strong><small class="eval-n">${plural(a.n, 'judge')}</small></td>
                </tr>`;
              })}</tbody></table></div>`
          : html`<p class="eval-empty small muted">${S.q.trim() ? 'No teams match your search.' : html`No marks yet. Pick a judge above, then <strong>Edit marks</strong>.`}</p>`}
      </section>`;
    })}
    ${unmarked ? html`<p class="small muted eval-note-out">${plural(unmarked, 'team')} ${unmarked === 1 ? 'has' : 'have'} no marks in ${r.name} yet. They show up here once a judge marks them.</p>` : ''}`;
  }

  // One judge, viewing: only the teams they marked.
  function judgeView(r, j) {
    const g = groupOf(j.id);
    const teams = S.d.teams.filter(matches).filter((t) => judgeTotal(r, j.id, t.id) || C.has(`${j.id}:${t.id}:${r.id}`));
    return html`<section class="card card-flush">
      <header class="eval-card-head">
        <div><h3>${j.name}</h3><small>${hasPanels() && g && !g.loose ? `${g.name} · ` : ''}${r.name} · ${plural(teams.length, 'team')} marked</small></div>
        <button type="button" class="btn btn-primary btn-sm" data-ev-edit-marks>${icon('edit')}Edit marks</button>
      </header>
      ${teams.length
        ? html`<div class="table-wrap"><table class="table eval-table" data-ev-judge-view>
            <thead><tr><th>Team</th>${r.criteria.map((c) => html`<th class="num">${c.name} <small>/ ${fmtScore(Number(c.max_score))}</small></th>`)}
              <th class="num">Total <small>/ ${fmtScore(roundMax(r))}</small></th><th>Comment</th></tr></thead>
            <tbody>${teams.map((t) => {
              const tot = judgeTotal(r, j.id, t.id);
              return html`<tr data-team="${t.id}" class="${t.active ? '' : 'is-dim'}">${teamCell(t)}
                ${r.criteria.map((c) => html`<td class="num">${M.has(`${j.id}:${t.id}:${c.id}`) ? fmt(M.get(`${j.id}:${t.id}:${c.id}`)) : dash}</td>`)}
                <td class="num"><strong>${tot ? fmt(tot.sum) : dash}</strong></td>
                <td class="small">${C.get(`${j.id}:${t.id}:${r.id}`) || html`<span class="faint">–</span>`}</td>
              </tr>`;
            })}</tbody></table></div>`
        : html`<p class="eval-empty small muted">${S.q.trim() ? 'No teams match your search.' : `${j.name} hasn’t marked any team in ${r.name} yet. Press Edit marks to type them in.`}</p>`}
    </section>`;
  }

  // One judge, editing: every team, so any team the judge saw can be marked.
  function sheet(r, j) {
    const g = groupOf(j.id);
    const teams = S.d.teams.filter(matches);
    const markedElsewhere = (t) => S.groups.filter((x) => x !== g && groupAvg(r, x, t.id)).map((x) => x.name);
    return html`<section class="card card-flush eval-editing">
      <header class="eval-card-head">
        <div><h3>Editing ${j.name}’s marks</h3><small>${hasPanels() && g && !g.loose ? `${g.name} · ` : ''}${r.name} · every team is listed: fill in the teams ${j.name} marked and leave the rest empty. Marks save on their own; Enter moves down.</small></div>
        <button type="button" class="btn btn-sm" data-ev-done>${icon('check')}Done</button>
      </header>
      <div class="table-wrap"><table class="table eval-table eval-sheet" data-ev-sheet data-round="${r.id}" data-judge="${j.id}">
        <thead><tr><th>Team</th>
          ${r.criteria.map((c) => html`<th class="num">${c.name} <small>/ ${fmtScore(Number(c.max_score))}</small></th>`)}
          <th class="num">Total <small>/ ${fmtScore(roundMax(r))}</small></th><th class="eval-comment-h">Comment</th><th><span class="sr-only">Save status</span></th></tr></thead>
        <tbody>${teams.length
          ? teams.map((t) => {
              const tot = judgeTotal(r, j.id, t.id);
              const other = hasPanels() ? markedElsewhere(t) : [];
              return html`<tr data-team="${t.id}" class="${t.active ? '' : 'is-dim'}">${teamCell(t, other.length ? html` · <span class="eval-other">marked by ${other.join(', ')}</span>` : '')}
                ${r.criteria.map((c, ci) => {
                  const v = M.get(`${j.id}:${t.id}:${c.id}`);
                  return html`<td class="num"><input class="input ev-mark" id="em-${r.id}-${j.id}-${t.id}-${c.id}" data-c="${c.id}" data-col="${ci}" type="number" inputmode="decimal" min="0" max="${Number(c.max_score)}" step="any" value="${v === undefined ? '' : String(v)}" aria-label="${c.name} for ${t.name}"></td>`;
                })}
                <td class="num"><strong data-total>${tot ? fmt(tot.sum) : '–'}</strong></td>
                <td><input class="input" id="ec-${r.id}-${j.id}-${t.id}" data-comment maxlength="1000" value="${C.get(`${j.id}:${t.id}:${r.id}`) || ''}" placeholder="Optional" aria-label="${j.name}’s comment for ${t.name}"></td>
                <td><span class="save-state" data-save></span></td>
              </tr>`;
            })
          : noMatch(r.criteria.length + 4)}</tbody></table></div>
    </section>`;
  }

  function overallBoard() {
    const d = S.d;
    const all = standings();
    const list = all.filter((x) => matches(x.t));
    const maxAll = d.rounds.reduce((s, r) => s + roundMax(r), 0);
    const waiting = d.teams.length - all.length;
    return html`<section class="card card-flush">${all.length
      ? html`<div class="table-wrap"><table class="table eval-table" data-ev-overall>
          <thead><tr><th class="eval-rank-col">Rank</th><th>Team</th>${hasPanels() ? html`<th>Panel</th>` : ''}
            ${d.rounds.map((r) => html`<th class="num">${r.name} <small>/ ${fmtScore(roundMax(r))}</small></th>`)}
            <th class="num">Total <small>/ ${fmtScore(maxAll)}</small></th></tr></thead>
          <tbody>${list.length
            ? list.map((x) => html`<tr data-team="${x.t.id}" class="${x.t.active ? '' : 'is-dim'}${x.rank <= 3 ? ` eval-top eval-top-${x.rank}` : ''}">
                <td class="eval-rank-col"><span class="eval-rank">${x.rank}</span></td>
                ${teamCell(x.t)}
                ${hasPanels() ? html`<td class="small">${x.panels.join(', ')}</td>` : ''}
                ${x.per.map((v) => html`<td class="num">${v === null ? dash : fmt(v)}</td>`)}
                <td class="num"><strong data-total>${fmt(x.total)}</strong></td>
              </tr>`)
            : noMatch(d.rounds.length + (hasPanels() ? 4 : 3))}</tbody></table></div>
          <p class="small muted eval-note">${hasPanels() ? 'Each round’s mark is the team’s panel average' : 'Each round’s mark is the average of the judges who marked the team'}, and the total adds up the rounds.${waiting ? ` ${plural(waiting, 'team')} without marks ${waiting === 1 ? 'isn’t' : 'aren’t'} listed.` : ''}</p>`
      : empty('No marks yet', d.teams.length ? 'Teams appear here once a judge has marked them.' : E.noTeams)}</section>`;
  }

  // ---------- events ----------
  function bind(ctx) {
    const root = $('[data-eval-root]', ctx.main);
    if (!root) return;
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b || b.type === 'submit') return;
      const ds = b.dataset;
      if (ds.evView) {
        await flush();
        S.view = ds.evView === 'overall' ? 'overall' : Number(ds.evView);
        redraw(ctx);
      } else if (ds.evJudge) {
        await flush();
        S.judge = ds.evJudge === 'all' ? 'all' : Number(ds.evJudge);
        redraw(ctx);
      } else if (b.hasAttribute('data-ev-edit-marks')) {
        S.edit = true;
        redraw(ctx);
        setTimeout(() => $('[data-ev-sheet] .ev-mark')?.focus(), 50);
      } else if (b.hasAttribute('data-ev-done')) {
        await flush();
        S.edit = false;
        redraw(ctx);
      } else if (b.hasAttribute('data-ev-add-round')) roundForm(ctx, null);
      else if (ds.evEditRound) roundForm(ctx, S.d.rounds.find((r) => r.id === Number(ds.evEditRound)));
      else if (ds.evDelRound) deleteRound(ctx, S.d.rounds.find((r) => r.id === Number(ds.evDelRound)));
      else if (b.hasAttribute('data-ev-add-panel')) panelForm(ctx, null);
      else if (ds.evEditPanel) panelForm(ctx, S.d.panels.find((p) => p.id === Number(ds.evEditPanel)));
      else if (ds.evDelPanel) deletePanel(ctx, S.d.panels.find((p) => p.id === Number(ds.evDelPanel)));
      else if (ds.evEditJudge) judgeForm(ctx, S.d.judges.find((j) => j.id === Number(ds.evEditJudge)));
      else if (ds.evDelJudge) deleteJudge(ctx, S.d.judges.find((j) => j.id === Number(ds.evDelJudge)));
      else if (b.hasAttribute('data-ev-csv')) exportResults();
      else if (b.hasAttribute('data-ev-marks-csv')) exportMarks();
      else if (b.hasAttribute('data-ev-print')) printView();
    });
    for (const form of $$('[data-ev-judge-form]', root)) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pid = Number(form.dataset.panel) || null;
        const input = $('input', form);
        const name = input.value.trim();
        if (!name) return input.focus();
        await withButton($('button[type=submit]', form), async () => {
          await api(`/admin/eval/${event}/judges`, { method: 'POST', body: { name, panel_id: pid } });
          input.value = '';
          toast(`${name} added.`, 'ok');
          ctx.rerender();
        });
      });
    }
    $('#ev-search', root)?.addEventListener('input', async (e) => {
      S.q = e.target.value;
      await flush();
      redraw(ctx);
    });
    const table = $('[data-ev-sheet]', root);
    if (table) {
      table.addEventListener('input', (e) => {
        const tr = e.target.closest('tr[data-team]');
        if (!tr) return;
        if (e.target.matches('.ev-mark')) updateTotal(tr);
        schedule(tr, 900);
      });
      table.addEventListener('change', (e) => {
        const tr = e.target.closest('tr[data-team]');
        if (tr && S.timers.has(keyOf(tr))) schedule(tr, 0);
      });
      table.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.matches('.ev-mark, [data-comment]')) return;
        e.preventDefault();
        const next = e.target.closest('tr').nextElementSibling;
        const pick = e.target.matches('.ev-mark') ? `.ev-mark[data-col="${e.target.dataset.col}"]` : '[data-comment]';
        const to = next && $(pick, next);
        if (to) {
          to.focus();
          to.select?.();
        } else e.target.blur();
      });
    }
  }

  async function withButton(btn, fn) {
    btn?.classList.add('is-busy');
    try {
      await fn();
    } catch (err) {
      toastError(err);
    } finally {
      btn?.classList.remove('is-busy');
    }
  }

  // ---------- typing marks: each row saves on its own, one save at a time per row ----------
  const keyOf = (tr) => {
    const t = tr.closest('[data-ev-sheet]');
    return `${t.dataset.round}:${t.dataset.judge}:${tr.dataset.team}`;
  };
  function setSaveState(tr, s, title = '') {
    const el = $('[data-save]', tr);
    if (!el) return;
    el.dataset.s = s;
    el.title = title || { dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: 'Not saved' }[s] || '';
  }
  function updateTotal(tr) {
    const vals = $$('.ev-mark', tr).map((i) => i.value.trim()).filter((v) => v !== '' && Number.isFinite(Number(v)));
    $('[data-total]', tr).textContent = vals.length ? fmt(vals.reduce((s, v) => s + Number(v), 0)) : '–';
  }
  function schedule(tr, delay) {
    const k = keyOf(tr);
    clearTimeout(S.timers.get(k));
    setSaveState(tr, 'dirty');
    S.timers.set(k, setTimeout(() => save(tr), delay));
  }
  function save(tr) {
    const k = keyOf(tr);
    clearTimeout(S.timers.get(k));
    S.timers.delete(k);
    const run = (chains.get(k) || Promise.resolve()).then(() => saveNow(tr, k));
    chains.set(k, run);
    run.then(() => {
      if (chains.get(k) === run) chains.delete(k);
    });
    return run;
  }
  async function saveNow(tr, k) {
    const [rid, jid, tid] = k.split(':').map(Number);
    const inputs = $$('.ev-mark', tr);
    const wrong = inputs.find((i) => i.validity.badInput || (i.value.trim() !== '' && (Number(i.value) < 0 || Number(i.value) > Number(i.max))));
    if (wrong) {
      setSaveState(tr, 'error', 'Not saved');
      toast(`${wrong.getAttribute('aria-label')}: give a mark from 0 to ${wrong.max}.`, 'error');
      return;
    }
    const scores = Object.fromEntries(inputs.map((i) => [i.dataset.c, i.value.trim()]));
    const comment = $('[data-comment]', tr)?.value ?? '';
    setSaveState(tr, 'saving');
    try {
      await api(`/admin/eval/rounds/${rid}/marks`, { method: 'PUT', body: { judge_id: jid, team_id: tid, scores, comment } });
      for (const [c, v] of Object.entries(scores)) {
        if (v === '') M.delete(`${jid}:${tid}:${c}`);
        else M.set(`${jid}:${tid}:${c}`, Number(v));
      }
      if (comment.trim()) C.set(`${jid}:${tid}:${rid}`, comment.trim());
      else C.delete(`${jid}:${tid}:${rid}`);
      setSaveState(tr, S.timers.has(k) ? 'dirty' : 'saved');
      // keep the judge's count and the marks download in step without reloading the page
      const round = S.d.rounds.find((x) => x.id === rid);
      const count = $(`[data-ev-count="${jid}"]`);
      if (round && count && S.view === rid) count.textContent = String(judgedCount(round, jid));
      const dl = $('[data-ev-marks-csv]');
      if (dl) dl.disabled = !M.size;
    } catch (err) {
      setSaveState(tr, 'error', err.message);
      toastError(err);
    }
  }
  async function flush() {
    for (const [k, t] of [...S.timers]) {
      clearTimeout(t);
      const [rid, jid, tid] = k.split(':');
      const tr = $(`[data-ev-sheet][data-round="${rid}"][data-judge="${jid}"] tr[data-team="${tid}"]`);
      if (tr) save(tr);
      else S.timers.delete(k);
    }
    await Promise.all([...chains.values()]);
  }

  // ---------- rounds ----------
  function roundForm(ctx, r) {
    const rows = r
      ? r.criteria.map((c) => ({ id: c.id, name: c.name, max: String(Number(c.max_score)) }))
      : [{ id: null, name: '', max: '10' }, { id: null, name: '', max: '10' }, { id: null, name: '', max: '10' }];
    const rowHtml = () =>
      rows.map(
        (x, i) => html`<li>
          <input class="input" data-k="name" data-i="${i}" id="crit-${i}-name" maxlength="60" value="${x.name}" placeholder="Criterion, e.g. Innovation" aria-label="Criterion ${i + 1} name">
          <label class="eval-max"><span>out of</span><input class="input" data-k="max" data-i="${i}" id="crit-${i}-max" type="number" min="1" max="1000" step="any" value="${x.max}" aria-label="Criterion ${i + 1} maximum marks"></label>
          <button type="button" class="icon-btn" data-crit-del="${i}" aria-label="Remove criterion ${i + 1}" ${rows.length < 2 ? 'disabled' : ''}>${icon('x')}</button>
        </li>`
      );
    formModal({
      title: r ? `Edit ${r.name}` : 'Add a round',
      submitLabel: r ? 'Save round' : 'Add round',
      wide: true,
      content: html`
        <label class="field"><span>Round name</span><input class="input" name="name" maxlength="80" value="${r ? r.name : `Round ${S.d.rounds.length + 1}`}"></label>
        <div class="stack-sm">
          <span class="label">Criteria <span class="hint">Each judge gives marks for every criterion, up to its maximum.</span></span>
          <ol class="eval-crit" data-crit-list>${rowHtml()}</ol>
          <div class="row-between"><button type="button" class="btn btn-sm" data-crit-add>${icon('plus')}Add a criterion</button><span class="small muted" data-crit-total></span></div>
        </div>
        ${r ? html`<p class="small muted">Renaming a criterion keeps its marks. Removing one deletes the marks given for it.</p>` : ''}`,
      onMount(dlg) {
        const list = $('[data-crit-list]', dlg);
        const total = () => {
          const t = rows.reduce((s, x) => s + (Number(x.max) || 0), 0);
          $('[data-crit-total]', dlg).textContent = `Round total: ${fmtScore(r2(t))}`;
        };
        const redrawRows = (focus) => {
          setHTML(list, rowHtml());
          total();
          if (focus !== undefined) $(`#crit-${focus}-name`, dlg)?.focus();
        };
        total();
        list.addEventListener('input', (e) => {
          const i = e.target.dataset.i;
          if (i === undefined) return;
          rows[Number(i)][e.target.dataset.k] = e.target.value;
          if (e.target.dataset.k === 'max') total();
        });
        list.addEventListener('click', (e) => {
          const b = e.target.closest('[data-crit-del]');
          if (!b || rows.length < 2) return;
          rows.splice(Number(b.dataset.critDel), 1);
          redrawRows();
        });
        $('[data-crit-add]', dlg).addEventListener('click', () => {
          if (rows.length >= 15) return toast('A round can have up to 15 criteria.', 'warn');
          rows.push({ id: null, name: '', max: rows.length ? rows[rows.length - 1].max : '10' });
          redrawRows(rows.length - 1);
        });
      },
      async onSubmit(v) {
        const criteria = rows.filter((x) => x.name.trim() || x.id).map((x) => ({ ...(x.id ? { id: x.id } : {}), name: x.name, max_score: x.max }));
        const body = { name: v.name, criteria };
        if (r) {
          await api(`/admin/eval/rounds/${r.id}`, { method: 'PUT', body });
          toast('Round saved.', 'ok');
        } else {
          const res = await api(`/admin/eval/${event}/rounds`, { method: 'POST', body });
          S.view = res.round.id;
          toast(`${res.round.name} added.`, 'ok');
        }
        ctx.rerender();
      },
    });
  }

  async function deleteRound(ctx, r) {
    if (!r) return;
    const n = S.d.teams.filter((t) => roundScore(r, t.id)).length;
    const ok = await confirmDialog({
      title: `Delete ${r.name}?`,
      message: n ? `This deletes the round and the marks already given in it (${plural(n, 'team')} marked). It can’t be undone.` : 'No marks have been given in this round yet.',
      confirmLabel: 'Delete round',
      danger: true,
    });
    if (!ok) return;
    try {
      await flush();
      await api(`/admin/eval/rounds/${r.id}`, { method: 'DELETE' });
      toast(`${r.name} deleted.`, 'ok');
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  }

  // ---------- panels and judges ----------
  function panelForm(ctx, p) {
    const next = `Panel ${String.fromCharCode(65 + Math.min(S.d.panels.length, 25))}`;
    formModal({
      title: p ? 'Rename panel' : 'Add a panel',
      submitLabel: p ? 'Save' : 'Add panel',
      content: html`<label class="field"><span>Panel name</span><input class="input" name="name" maxlength="60" value="${p ? p.name : next}"></label>
        ${p ? '' : html`<p class="small muted">Then add the panel’s judges in it. Each panel marks its own teams.</p>`}`,
      async onSubmit(v) {
        if (p) await api(`/admin/eval/panels/${p.id}`, { method: 'PUT', body: { name: v.name } });
        else await api(`/admin/eval/${event}/panels`, { method: 'POST', body: { name: v.name } });
        toast(p ? 'Panel renamed.' : `${v.name.trim()} added.`, 'ok');
        ctx.rerender();
      },
    });
  }

  async function deletePanel(ctx, p) {
    if (!p) return;
    const ok = await confirmDialog({ title: `Delete ${p.name}?`, message: 'The panel is removed. Its judges must be moved or removed first.', confirmLabel: 'Delete panel', danger: true });
    if (!ok) return;
    try {
      await api(`/admin/eval/panels/${p.id}`, { method: 'DELETE' });
      toast(`${p.name} deleted.`, 'ok');
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  }

  function judgeForm(ctx, j) {
    if (!j) return;
    formModal({
      title: 'Edit judge',
      submitLabel: 'Save',
      content: html`<label class="field"><span>Judge’s name</span><input class="input" name="name" maxlength="80" value="${j.name}"></label>
        ${hasPanels()
          ? html`<label class="field"><span>Panel <span class="hint">Marks already given stay with the judge.</span></span>
              <select class="select" name="panel_id">
                ${S.d.panels.map((p) => html`<option value="${p.id}" ${j.panel_id === p.id ? 'selected' : ''}>${p.name}</option>`)}
                <option value="" ${S.d.panels.some((p) => p.id === j.panel_id) ? '' : 'selected'}>Not in a panel</option>
              </select></label>`
          : ''}`,
      async onSubmit(v) {
        const body = { name: v.name };
        if (hasPanels()) body.panel_id = v.panel_id ? Number(v.panel_id) : null;
        await api(`/admin/eval/judges/${j.id}`, { method: 'PUT', body });
        toast('Judge saved.', 'ok');
        ctx.rerender();
      },
    });
  }

  async function deleteJudge(ctx, j) {
    if (!j) return;
    const n = [...M.keys()].filter((k) => k.startsWith(`${j.id}:`)).length;
    const ok = await confirmDialog({
      title: `Remove ${j.name}?`,
      message: n ? `${j.name}’s ${plural(n, 'mark')} will be deleted as well. It can’t be undone.` : `${j.name} hasn’t given any marks yet.`,
      confirmLabel: 'Remove judge',
      danger: true,
    });
    if (!ok) return;
    try {
      await flush();
      await api(`/admin/eval/judges/${j.id}`, { method: 'DELETE' });
      if (S.judge === j.id) S.judge = 'all';
      toast(`${j.name} removed.`, 'ok');
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  }

  // ---------- export and print ----------
  const stamp = () => new Date().toISOString().slice(0, 10);
  const panelLabel = (j) => {
    const g = groupOf(j.id);
    return hasPanels() && g && !g.loose ? g.name : '';
  };
  // One row per team that has marks: rank, panel, each round's mark and the total, then every judge's total.
  function exportResults() {
    const d = S.d;
    const head = ['Rank', 'Team ID', 'Team'];
    if (hasPanels()) head.push('Panel');
    for (const r of d.rounds) head.push(`${r.name} (out of ${fmtScore(roundMax(r))})`);
    head.push(`Total (out of ${fmtScore(d.rounds.reduce((s, r) => s + roundMax(r), 0))})`);
    for (const r of d.rounds) for (const j of d.judges) head.push(`${r.name}: ${j.name}${panelLabel(j) ? ` (${panelLabel(j)})` : ''}`);
    const rows = standings().map((x) => {
      const out = [x.rank, x.t.code, x.t.name];
      if (hasPanels()) out.push(x.panels.join('; '));
      for (const v of x.per) out.push(v === null ? '' : r2(v));
      out.push(r2(x.total));
      for (const r of d.rounds) {
        for (const j of d.judges) {
          const t = judgeTotal(r, j.id, x.t.id);
          out.push(t ? r2(t.sum) : '');
        }
      }
      return out;
    });
    downloadText(`${E.file}-results-${stamp()}.csv`, csvText([head, ...rows]));
  }
  function exportMarks() {
    const d = S.d;
    const maxCrit = Math.max(1, ...d.rounds.map((r) => r.criteria.length));
    const head = ['Round', 'Panel', 'Judge', 'Team ID', 'Team'];
    for (let i = 1; i <= maxCrit; i++) head.push(`Criterion ${i}`, `Mark ${i}`, `Out of ${i}`);
    head.push('Total', 'Out of', 'Comment');
    const rows = [];
    for (const r of d.rounds) {
      for (const g of S.groups) {
        for (const j of g.judges) {
          for (const t of d.teams) {
            const tot = judgeTotal(r, j.id, t.id);
            const cm = C.get(`${j.id}:${t.id}:${r.id}`) || '';
            if (!tot && !cm) continue;
            const row = [r.name, g.loose ? '' : g.name, j.name, t.code, t.name];
            for (let i = 0; i < maxCrit; i++) {
              const c = r.criteria[i];
              const v = c ? M.get(`${j.id}:${t.id}:${c.id}`) : undefined;
              row.push(c ? c.name : '', v === undefined ? '' : v, c ? Number(c.max_score) : '');
            }
            row.push(tot ? r2(tot.sum) : '', roundMax(r), cm);
            rows.push(row);
          }
        }
      }
    }
    downloadText(`${E.file}-marks-${stamp()}.csv`, csvText([head, ...rows]));
  }

  // Prints what's on screen. A judge's sheet in Edit marks lists every team with empty boxes, so it also works as a
  // paper marking form; everything else lists only the teams that have marks.
  function printView() {
    const area = $('#print-area');
    if (!area) return;
    const d = S.d;
    const round = d.rounds.find((r) => r.id === S.view);
    const judge = round && d.judges.find((j) => j.id === S.judge);
    const teams = d.teams.filter(matches);
    let title;
    let body;
    if (!round) {
      title = 'Overall ranking';
      const list = standings().filter((x) => matches(x.t));
      body = html`<table><thead><tr><th>Rank</th><th>Team</th>${hasPanels() ? html`<th>Panel</th>` : ''}${d.rounds.map((r) => html`<th>${r.name} (/${fmtScore(roundMax(r))})</th>`)}<th>Total</th></tr></thead>
        <tbody>${list.map((x) => html`<tr><td>${x.rank}</td><td>${x.t.code} · ${x.t.name}</td>${hasPanels() ? html`<td>${x.panels.join(', ')}</td>` : ''}${x.per.map((v) => html`<td>${fmt(v)}</td>`)}<td><b>${fmt(x.total)}</b></td></tr>`)}</tbody></table>`;
    } else if (judge) {
      const list = S.edit ? teams : teams.filter((t) => judgeTotal(round, judge.id, t.id) || C.has(`${judge.id}:${t.id}:${round.id}`));
      title = `${round.name} · ${judge.name}${panelLabel(judge) ? ` · ${panelLabel(judge)}` : ''}`;
      body = html`<table><thead><tr><th>Team</th>${round.criteria.map((c) => html`<th>${c.name} (/${fmtScore(Number(c.max_score))})</th>`)}<th>Total (/${fmtScore(roundMax(round))})</th><th class="pe-wide">Comment</th></tr></thead>
        <tbody>${list.map((t) => {
          const tot = judgeTotal(round, judge.id, t.id);
          return html`<tr><td>${t.code} · ${t.name}</td>${round.criteria.map((c) => html`<td>${M.has(`${judge.id}:${t.id}:${c.id}`) ? fmt(M.get(`${judge.id}:${t.id}:${c.id}`)) : ''}</td>`)}<td><b>${tot ? fmt(tot.sum) : ''}</b></td><td>${C.get(`${judge.id}:${t.id}:${round.id}`) || ''}</td></tr>`;
        })}</tbody></table>`;
    } else {
      title = `${round.name} · ${hasPanels() ? 'all panels' : 'all judges'}`;
      body = html`${S.groups.filter((g) => g.judges.length).map((g) => {
        const list = teams.filter((t) => groupAvg(round, g, t.id));
        return list.length
          ? html`<h2>${g.name}</h2><table><thead><tr><th>Team</th>${g.judges.map((j) => html`<th>${j.name}</th>`)}<th>Average (/${fmtScore(roundMax(round))})</th></tr></thead>
              <tbody>${list.map((t) => html`<tr><td>${t.code} · ${t.name}</td>${g.judges.map((j) => html`<td>${fmt(judgeTotal(round, j.id, t.id)?.sum ?? null)}</td>`)}<td><b>${fmt(groupAvg(round, g, t.id).avg)}</b></td></tr>`)}</tbody></table>`
          : '';
      })}`;
    }
    area.classList.add('print-eval');
    setHTML(area, html`<header><h1>${E.title}</h1><p>${title} · printed ${fmtDateTime(new Date().toISOString())}</p></header>${body}`);
    const done = () => {
      area.classList.remove('print-eval');
      setHTML(area, '');
      removeEventListener('afterprint', done);
    };
    addEventListener('afterprint', done);
    window.print();
  }

  // ---------- view hooks ----------
  function leave() {
    for (const [k, t] of [...S.timers]) {
      clearTimeout(t);
      const [rid, jid, tid] = k.split(':');
      const tr = $(`[data-ev-sheet][data-round="${rid}"][data-judge="${jid}"] tr[data-team="${tid}"]`);
      if (tr) save(tr);
    }
  }
  const LIVE = ['eval', 'teams', 'results', 'mela'];
  function onEvent(type, data, ctx) {
    // Don't redraw under someone typing marks.
    if (S.timers.size || chains.size) return true;
    if (type === 'eval' && data && data.event && data.event !== event) return true;
    if (LIVE.includes(type)) ctx.rerender();
    return true;
  }

  return { live: LIVE, render, leave, onEvent };
}
