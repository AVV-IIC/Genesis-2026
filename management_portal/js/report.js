// Printable Ideathon assessment report: report.html#<id> for one assessment, report.html#all for every session.
// Opened from the organiser console (Assessments); "Save as PDF / Print" uses the browser's print window.
import { api, html, setHTML, richText, fmtDateTime, plural, guardPage } from './core.js';

const doc = document.getElementById('report');
const printBtn = document.getElementById('rp-print');
let by = 'team';
let data = null;

const ask = () => {
  const h = location.hash.replace(/^#\/?/, '');
  return /^\d+$/.test(h) ? Number(h) : null;
};

async function load() {
  printBtn.disabled = true;
  setHTML(doc, html`<p class="rp-note">Preparing the report…</p>`);
  const id = ask();
  try {
    data = id ? await api(`/admin/assessments/${id}/report`) : await api('/admin/assessments/report');
  } catch (err) {
    setHTML(doc, html`<p class="rp-note rp-error">Couldn’t load the report: ${err.message}</p>`);
    return;
  }
  draw();
}

function draw() {
  const d = data;
  const single = d.assessments.length === 1 && ask() !== null;
  const title = single ? d.assessments[0].title : 'All sessions';
  document.title = `${d.event_name} · ${title} · answers`;
  if (!d.assessments.length) {
    setHTML(doc, html`<p class="rp-note">There are no assessments yet.</p>`);
    return;
  }

  // answers[assessmentId][questionId][teamId] = text
  const A = new Map();
  for (const x of d.answers) {
    if (!A.has(x.assessment_id)) A.set(x.assessment_id, new Map());
    const m = A.get(x.assessment_id);
    if (!m.has(x.question_id)) m.set(x.question_id, new Map());
    m.get(x.question_id).set(x.team_id, x.body);
  }
  const answer = (a, q, t) => A.get(a.id)?.get(q.id)?.get(t.id) || '';
  const answeredIn = (a, t) => a.questions.filter((q) => answer(a, q, t).trim()).length;
  const totalQs = d.assessments.reduce((n, a) => n + a.questions.length, 0);
  const answeredAll = (t) => d.assessments.reduce((n, a) => n + answeredIn(a, t), 0);
  const withAnswers = d.teams.filter((t) => answeredAll(t) > 0);
  const without = d.teams.filter((t) => t.active && answeredAll(t) === 0);
  const teamName = (t) => html`<span class="rp-code">${t.code}</span> ${t.name}${t.active ? '' : html` <em>(inactive)</em>`}`;
  const windowText = (a) =>
    a.opened_at ? `${fmtDateTime(a.opened_at)} – ${a.closes_at ? fmtDateTime(a.closes_at) : 'no end time'}${a.status === 'open' ? ' (still open)' : ''}` : 'Not opened yet';
  const qa = (q, i, text) => html`<div class="rp-qa"><div class="rp-q"><b>Q${i + 1}.</b> ${richText(q.body)}</div>
    <div class="rp-a${text.trim() ? '' : ' rp-blank'}">${text.trim() ? richText(text) : 'Not answered'}</div></div>`;

  const head = html`<header class="rp-head">
    <img src="img/logo-sm.png" alt="" width="60" height="97">
    <div><p class="rp-kicker">${d.event_name} · Assessment report</p><h1>${title}</h1>
      <p class="rp-meta">Generated ${fmtDateTime(d.generated_at)}${d.generated_by ? ` by ${d.generated_by}` : ''} · ${plural(withAnswers.length, 'team')} answered${without.length ? ` · ${without.length} active ${without.length === 1 ? 'team' : 'teams'} didn’t` : ''}</p></div>
  </header>`;

  const overview = single
    ? (() => {
        const a = d.assessments[0];
        return html`<section class="rp-box">
          <dl class="rp-facts"><dt>Open</dt><dd>${windowText(a)}</dd><dt>Questions</dt><dd>${a.questions.length}</dd>
            <dt>Answered</dt><dd>${withAnswers.length} of ${plural(d.teams.filter((t) => t.active).length, 'team')} · ${d.teams.filter((t) => a.questions.length && answeredIn(a, t) === a.questions.length).length} answered every question</dd></dl>
          ${a.instructions ? html`<p class="rp-instr">${richText(a.instructions)}</p>` : ''}
          <ol class="rp-qlist">${a.questions.map((q) => html`<li>${richText(q.body)}</li>`)}</ol>
        </section>`;
      })()
    : html`<section class="rp-box"><table class="rp-table">
        <thead><tr><th>Session</th><th>Open</th><th>Questions</th><th>Teams answered</th></tr></thead>
        <tbody>${d.assessments.map((a) => html`<tr><td><strong>${a.title}</strong></td><td>${windowText(a)}</td><td>${a.questions.length}</td>
          <td>${d.teams.filter((t) => answeredIn(a, t) > 0).length}</td></tr>`)}</tbody></table></section>`;

  const summary = html`<section class="rp-section"><h2>Summary</h2><table class="rp-table rp-sum">
    <thead><tr><th>Team</th><th>Leader</th><th>Table</th><th>Answered</th></tr></thead>
    <tbody>${d.teams.filter((t) => t.active || answeredAll(t)).map((t) => {
      const n = answeredAll(t);
      return html`<tr class="${n ? '' : 'rp-none'}"><td>${teamName(t)}</td><td>${t.leader_name || '–'}</td><td>${t.table_no || '–'}</td><td>${n} / ${totalQs}</td></tr>`;
    })}</tbody></table></section>`;

  let body;
  if (by === 'team') {
    body = html`<section class="rp-section"><h2>Answers by team</h2>
      ${withAnswers.map((t) => html`<article class="rp-team">
        <h3>${teamName(t)}</h3>
        <p class="rp-sub">${[t.leader_name && `Leader: ${t.leader_name}`, t.table_no && `Table ${t.table_no}`, t.track, (t.members || []).length && `Members: ${t.members.join(', ')}`].filter(Boolean).join(' · ')}</p>
        ${d.assessments.map((a) => html`${single ? '' : html`<h4>${a.title}</h4>`}${a.questions.map((q, i) => qa(q, i, answer(a, q, t)))}`)}
      </article>`)}
      ${withAnswers.length ? '' : html`<p class="rp-note">No answers yet.</p>`}
    </section>`;
  } else {
    body = html`<section class="rp-section"><h2>Answers by question</h2>
      ${d.assessments.map((a) => html`${single ? '' : html`<h3 class="rp-session">${a.title}</h3>`}
        ${a.questions.map((q, i) => {
          const rows = d.teams.filter((t) => answer(a, q, t).trim());
          const missing = d.teams.filter((t) => t.active && !answer(a, q, t).trim());
          return html`<article class="rp-question">
            <h3><b>Q${i + 1}.</b> ${richText(q.body)}</h3>
            <p class="rp-sub">${plural(rows.length, 'answer')}</p>
            ${rows.map((t) => html`<div class="rp-qa"><div class="rp-q">${teamName(t)}</div><div class="rp-a">${richText(answer(a, q, t))}</div></div>`)}
            ${missing.length ? html`<p class="rp-missing"><b>No answer:</b> ${missing.map((t) => t.code).join(', ')}</p>` : ''}
          </article>`;
        })}`)}
    </section>`;
  }

  const blanks = without.length
    ? html`<section class="rp-section"><h2>No answers (${without.length})</h2><p class="rp-missing">${without.map((t) => `${t.code} ${t.name}`).join(' · ')}</p></section>`
    : '';

  setHTML(doc, html`${head}${overview}${summary}${body}${blanks}`);
  printBtn.disabled = false;
}

for (const b of document.querySelectorAll('[data-by]')) {
  b.addEventListener('click', () => {
    by = b.dataset.by;
    for (const x of document.querySelectorAll('[data-by]')) x.setAttribute('aria-pressed', String(x === b));
    if (data) draw();
  });
}
printBtn.addEventListener('click', () => window.print());
addEventListener('hashchange', load);
if (guardPage('admin')) load();
