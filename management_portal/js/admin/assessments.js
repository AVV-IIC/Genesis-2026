// Ideathon: Assessments. After each session the organisers post a set of questions; every team writes one
// set of answers until the end time picked when turning it on (answers then lock by themselves).
// Turning an assessment off hides it from teams. Reports open as a printable page (Save as PDF).
import {
  $, $$, api, html, setHTML, icon, toast, toastError, confirmDialog, formModal, richText, timeAgo, fmtTime, fmtDateTime,
  plural, clock, toLocalInput, fromLocalInput,
} from '../core.js';
import { fmtDuration } from '../dial.js';
import { chip, empty } from './shared.js';

export const live = ['assessment', 'teams'];

const MAX_QUESTIONS = 30;
const DURATIONS = [[30, '30 min'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours'], [180, '3 hours']];
const S = { draft: null, data: null, expiredAt: 0 };
let poll = null;
let tick = null;
let keySeq = 0;

export function leave() {
  clearInterval(poll);
  clearInterval(tick);
  poll = null;
  tick = null;
  S.draft = null;
}

// While the editor is open, live updates must not rebuild it (that would throw away unsaved edits).
export function onEvent(type, data, ctx) {
  if (!editing(ctx.params)) return false;
  if (type === 'assessment' && S.draft && S.draft.id && Number(data.id) === S.draft.id && data.kind === 'updated') {
    toast('Another organiser just saved changes to this assessment. Saving yours will replace them.', 'warn', { title: 'Assessments' });
  }
  return true;
}

const editing = (params) => params[0] === 'new' || params[1] === 'edit';
const reportUrl = (id) => `report.html#${id || 'all'}`;

export async function render(ctx, params, seq) {
  if (editing(params)) return renderEditor(ctx, params, seq);
  S.draft = null;
  const d = await api('/admin/assessments');
  if (!ctx.isCurrent(seq)) return;
  clock.sync(d.serverTime);
  S.data = d;
  // Answer saves aren't broadcast on the static site (Realtime quota), so refresh the counts quietly.
  if (!poll) poll = setInterval(() => { if (document.visibilityState === 'visible' && !editing(ctx.params)) ctx.rerender(); }, 30000);
  if (!tick) tick = setInterval(() => tickList(ctx), 1000);

  const list = d.assessments;
  setHTML(
    ctx.main,
    html`<div data-as-root>
    <div class="page-head">
      <div><h1 class="page-title">Assessments</h1><p>Post questions after each session. Each team writes one set of answers before the end time you set, and the answers lock by themselves when time is up. Turn an assessment off to hide it from teams.</p></div>
      <div class="row">${list.length ? html`<a class="btn" href="${reportUrl()}" target="_blank" rel="noopener">${icon('printer')}Report: all sessions</a>` : ''}
        <a class="btn btn-primary" href="#/assessments/new">${icon('plus')}New assessment</a></div>
    </div>
    ${list.length
      ? html`<div class="stack">${list.map((a) => card(a, d.teams))}</div>`
      : html`<div class="card">${empty('No assessments yet', 'Write the questions for a session now and turn them on when the session ends. Teams see nothing until then.',
          html`<a class="btn btn-primary" href="#/assessments/new">${icon('plus')}New assessment</a>`)}</div>`}
    </div>`
  );

  $('[data-as-root]', ctx.main).addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = S.data.assessments.find((x) => x.id === Number(b.dataset.id));
    if (a) act(ctx, b.dataset.act, a);
  });
}

const left = (a) => Date.parse(a.closes_at) - clock.now();

function statusChip(a) {
  if (a.status === 'open') return chip('live', 'On · open');
  if (a.status === 'ended') return chip('judging', 'On · time’s up');
  if (a.status === 'off') return chip('completed', 'Off');
  return chip('upcoming', 'Draft');
}

function statusLine(a) {
  if (a.status === 'open') {
    return html`Teams are answering. Closes at <strong>${fmtTime(a.closes_at)}</strong>, in <b class="mono" data-as-left="${a.closes_at}">${fmtDuration(left(a))}</b>.`;
  }
  if (a.status === 'ended') return html`Time’s up since ${fmtDateTime(a.closes_at)}. Teams still see their answers, locked. Reopen it to give more time.`;
  if (a.status === 'off') return html`Off: teams don’t see it.${a.closes_at ? ` Answers closed ${fmtDateTime(a.closes_at)}.` : ''}`;
  return 'Draft: teams don’t see it yet. Turn it on when the session ends.';
}

function card(a, teams) {
  const opened = a.status !== 'draft';
  const pct = teams ? Math.round((a.answered / teams) * 100) : 0;
  const buttons = [];
  if (a.status === 'open') {
    buttons.push(html`<button type="button" class="btn btn-sm" data-act="time" data-id="${a.id}">${icon('clock')}Change end time</button>`);
    buttons.push(html`<button type="button" class="btn btn-sm" data-act="off" data-id="${a.id}">${icon('eyeOff')}Turn off</button>`);
  } else if (a.status === 'ended') {
    buttons.push(html`<button type="button" class="btn btn-sm btn-primary" data-act="on" data-id="${a.id}">${icon('clock')}Reopen for more time</button>`);
    buttons.push(html`<button type="button" class="btn btn-sm" data-act="off" data-id="${a.id}">${icon('eyeOff')}Turn off</button>`);
  } else {
    buttons.push(html`<button type="button" class="btn btn-sm btn-primary" data-act="on" data-id="${a.id}">${icon('eye')}Turn on</button>`);
  }
  buttons.push(html`<a class="btn btn-sm" href="#/assessments/${a.id}/edit">${icon('edit')}Edit</a>`);
  if (opened) buttons.push(html`<a class="btn btn-sm" href="${reportUrl(a.id)}" target="_blank" rel="noopener">${icon('printer')}Report</a>`);
  if (!a.on) buttons.push(html`<button type="button" class="btn btn-sm btn-ghost btn-danger" data-act="delete" data-id="${a.id}">${icon('trash')}Delete</button>`);

  return html`<section class="card as-card" data-status="${a.status}">
    <div class="as-card-head">
      <div class="as-title"><h2 class="section-title">${a.title}</h2>
        <small class="muted">${plural(a.questions.length, 'question')}${a.opened_at ? ` · first opened ${fmtDateTime(a.opened_at)}` : ` · created ${timeAgo(a.created_at)}`}</small></div>
      ${statusChip(a)}
    </div>
    <p class="as-status">${statusLine(a)}</p>
    ${opened
      ? html`<div class="as-meter"><span class="progress" aria-hidden="true"><i style="width:${pct}%"></i></span>
          <span class="small muted"><strong>${a.answered}</strong> of ${plural(teams, 'team')} answered · ${a.complete} answered every question</span></div>`
      : ''}
    <details class="as-qlist">
      <summary>Questions</summary>
      ${a.instructions ? html`<p class="small muted">${richText(a.instructions)}</p>` : ''}
      <ol>${a.questions.map((q) => html`<li><span>${richText(q.body)}</span>${opened ? html`<small class="faint">${plural(q.answers, 'answer')}</small>` : ''}</li>`)}</ol>
    </details>
    <div class="row as-actions">${buttons}</div>
  </section>`;
}

// Update the "closes in" timers; when one runs out, redraw so it shows "time's up".
function tickList(ctx) {
  if (editing(ctx.params) || !S.data) return;
  let expired = false;
  for (const el of $$('[data-as-left]', ctx.main)) {
    const ms = Date.parse(el.dataset.asLeft) - clock.now();
    el.textContent = fmtDuration(ms);
    if (ms <= 0) expired = true;
  }
  // Ask the server at most every few seconds (its clock decides when time is up).
  if (expired && Date.now() - S.expiredAt > 4000) {
    S.expiredAt = Date.now();
    ctx.rerender();
  }
}

async function act(ctx, what, a) {
  try {
    if (what === 'on' || what === 'time') return openDialog(ctx, a);
    if (what === 'off') {
      const ok = await confirmDialog({
        title: `Turn off “${a.title}”?`,
        message: a.status === 'open'
          ? `Teams are still answering (closes in ${fmtDuration(left(a))}). Turning it off locks their answers now and hides the questions from them. Answers are kept for the report.`
          : 'Teams won’t see these questions or their answers any more. Answers are kept for the report.',
        confirmLabel: 'Turn off',
        danger: a.status === 'open',
      });
      if (!ok) return;
      await api(`/admin/assessments/${a.id}/state`, { method: 'POST', body: { on: false } });
      toast(`“${a.title}” is off.`, 'ok');
      return ctx.rerender();
    }
    if (what === 'delete') {
      const ok = await confirmDialog({
        title: `Delete “${a.title}”?`,
        message: a.answered
          ? `This deletes the questions and every team’s answers (${plural(a.answered, 'team')} answered). Download the report first if you need it. This can’t be undone.`
          : 'This deletes the questions. This can’t be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      await api(`/admin/assessments/${a.id}`, { method: 'DELETE' });
      toast('Deleted.', 'ok');
      return ctx.rerender();
    }
  } catch (err) {
    toastError(err);
    ctx.rerender();
  }
}

/** Turn on / reopen (pick how long teams get) or change the end time of an open assessment. */
function openDialog(ctx, a) {
  const changing = a.status === 'open';
  const defaultEnd = changing ? a.closes_at : new Date(clock.now() + 120 * 60000).toISOString();
  formModal({
    title: changing ? `Change the end time` : a.status === 'ended' ? `Reopen “${a.title}”` : `Turn on “${a.title}”`,
    submitLabel: changing ? 'Save end time' : 'Turn on',
    content: html`
      <p class="muted">${changing
        ? html`Answers now close at <strong>${fmtTime(a.closes_at)}</strong>. Pick a new end time; teams see it straight away.`
        : `Teams see these ${plural(a.questions.length, 'question')} straight away and can answer until the end time. Answers lock by themselves then.`}</p>
      <fieldset class="field as-durations"><legend class="label">${changing ? 'Close' : 'Answers close'}</legend>
        <div class="seg seg-radio">${DURATIONS.map(([m, label]) => html`<label><input type="radio" name="minutes" value="${m}" ${m === 120 && !changing ? 'checked' : ''}><span>${label} from now</span></label>`)}
          <label><input type="radio" name="minutes" value="custom" ${changing ? 'checked' : ''}><span>At a set time</span></label></div>
      </fieldset>
      <label class="field" data-custom ${changing ? '' : 'hidden'}><span>Close at</span><input class="input" type="datetime-local" name="closes_at" value="${toLocalInput(defaultEnd)}"></label>`,
    onMount(dlg) {
      const custom = $('[data-custom]', dlg);
      for (const r of $$('input[name=minutes]', dlg)) r.addEventListener('change', () => { custom.hidden = r.value !== 'custom' || !r.checked; });
    },
    async onSubmit(v) {
      if (!v.minutes) throw new Error('Pick when answers close.');
      const body = v.minutes === 'custom' ? { on: true, closes_at: fromLocalInput(v.closes_at) } : { on: true, minutes: Number(v.minutes) };
      if (v.minutes === 'custom' && !v.closes_at) throw new Error('Pick the time answers close.');
      const res = await api(`/admin/assessments/${a.id}/state`, { method: 'POST', body });
      toast(changing ? `Answers now close at ${fmtTime(res.assessment.closes_at)}.` : `“${a.title}” is on. Answers close at ${fmtTime(res.assessment.closes_at)}.`, 'ok');
      ctx.rerender();
    },
  });
}

// ---------- editor ------------------------------------------------------------------------------
const blankQ = () => ({ key: ++keySeq, id: null, body: '', answers: 0 });

async function renderEditor(ctx, params, seq) {
  const isNew = params[0] === 'new';
  const id = isNew ? null : Number(params[0]);
  if (!S.draft || S.draft.id !== id) {
    let a = null;
    if (!isNew) {
      const d = await api('/admin/assessments');
      if (!ctx.isCurrent(seq)) return;
      a = d.assessments.find((x) => x.id === id);
      if (!a) {
        setHTML(ctx.main, html`<div class="card">${empty('Assessment not found', 'It may have been deleted by another organiser.', html`<a class="btn" href="#/assessments">${icon('back')}All assessments</a>`)}</div>`);
        return;
      }
    }
    S.draft = a
      ? { id, on: a.on, status: a.status, title: a.title, instructions: a.instructions, original: a.questions,
          questions: a.questions.map((q) => ({ key: ++keySeq, id: q.id, body: q.body, answers: q.answers || 0 })) }
      : { id: null, on: false, status: 'draft', title: '', instructions: '', original: [], questions: [blankQ(), blankQ(), blankQ()] };
  }
  if (!ctx.isCurrent(seq)) return;
  drawEditor(ctx);
}

function drawEditor(ctx, focusKey) {
  const D = S.draft;
  const live = D.status === 'open' || D.status === 'ended';
  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><a class="back-link" href="#/assessments">${icon('back')}All assessments</a>
        <h1 class="page-title">${D.id ? 'Edit assessment' : 'New assessment'}</h1>
        <p>${D.id ? 'Change the title, instructions or questions.' : 'Teams don’t see it until you turn it on, so you can prepare it before the session.'}</p></div>
    </div>
    ${D.status === 'open'
      ? html`<div class="callout callout-warn as-warn">${icon('alert')}<span><strong>Teams are answering this right now.</strong> Your changes reach their screens within seconds. Answers to questions you keep stay as they are; answers to questions you remove are deleted.</span></div>`
      : live ? html`<div class="callout callout-warn as-warn">${icon('alert')}<span><strong>Teams can see this assessment.</strong> Changes show on their screens.</span></div>` : ''}
    <form class="card stack as-editor" id="as-form" novalidate>
      <label class="field"><span>Title <span class="hint">For example “Session 2: Customer interviews”</span></span>
        <input class="input" id="as-title" maxlength="120" value="${D.title}" placeholder="Session name" required></label>
      <label class="field"><span>Instructions <span class="hint">Optional · shown to teams above the questions</span></span>
        <textarea class="textarea" id="as-instructions" rows="2" maxlength="2000" placeholder="For example: Discuss as a team and answer in a few sentences.">${D.instructions}</textarea></label>
      <div class="stack-sm">
        <span class="label">Questions</span>
        <ol class="as-qedit">${D.questions.map((q, i) => html`<li data-key="${q.key}">
          <span class="as-qno">Q${i + 1}</span>
          <div class="as-qbody"><textarea class="textarea" id="as-q-${q.key}" data-q="${q.key}" rows="2" maxlength="1000" placeholder="Type the question">${q.body}</textarea>
            ${q.id && q.answers ? html`<small class="faint">${plural(q.answers, 'team')} answered this</small>` : ''}</div>
          <span class="as-qtools">
            <button type="button" class="icon-btn" data-move="-1" aria-label="Move question ${i + 1} up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button type="button" class="icon-btn" data-move="1" aria-label="Move question ${i + 1} down" ${i === D.questions.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
            <button type="button" class="icon-btn" data-remove aria-label="Remove question ${i + 1}">${icon('x')}</button>
          </span></li>`)}</ol>
        <div class="row">
          <button type="button" class="btn btn-sm" data-add ${D.questions.length >= MAX_QUESTIONS ? 'disabled' : ''}>${icon('plus')}Add a question</button>
          <span class="small faint">${D.questions.length} of up to ${MAX_QUESTIONS}</span>
        </div>
        <details class="as-paste">
          <summary>Paste several questions at once</summary>
          <label class="field"><span>One question per line <span class="hint">Numbers like “1.” or “Q1)” at the start are removed</span></span>
            <textarea class="textarea" id="as-paste" rows="5" placeholder="What problem did your team choose?&#10;Who has this problem?&#10;What did you learn in this session?"></textarea></label>
          <div><button type="button" class="btn btn-sm" data-paste>${icon('plus')}Add these questions</button></div>
        </details>
      </div>
      <div class="form-error" role="alert"></div>
      <div class="row-between">
        <span class="small muted">${D.status === 'draft' ? 'Saved as a draft. Turn it on from the list when the session ends.' : ''}</span>
        <div class="row"><a class="btn btn-ghost" href="#/assessments">Cancel</a><button class="btn btn-primary" type="submit">${icon('check')}${D.id ? 'Save changes' : 'Save assessment'}</button></div>
      </div>
    </form>`
  );
  const form = $('#as-form');
  $('#as-title').addEventListener('input', (e) => (D.title = e.target.value));
  $('#as-instructions').addEventListener('input', (e) => (D.instructions = e.target.value));
  for (const ta of $$('textarea[data-q]', form)) {
    ta.addEventListener('input', () => {
      const q = D.questions.find((x) => x.key === Number(ta.dataset.q));
      if (q) q.body = ta.value;
    });
  }
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.type === 'submit') return;
    const li = b.closest('li[data-key]');
    const idx = li ? D.questions.findIndex((x) => x.key === Number(li.dataset.key)) : -1;
    if (b.hasAttribute('data-add')) {
      if (D.questions.length >= MAX_QUESTIONS) return;
      const q = blankQ();
      D.questions.push(q);
      drawEditor(ctx, q.key);
    } else if (b.dataset.move && idx >= 0) {
      const to = idx + Number(b.dataset.move);
      if (to < 0 || to >= D.questions.length) return;
      const [q] = D.questions.splice(idx, 1);
      D.questions.splice(to, 0, q);
      drawEditor(ctx);
    } else if (b.hasAttribute('data-remove') && idx >= 0) {
      D.questions.splice(idx, 1);
      if (!D.questions.length) D.questions.push(blankQ());
      drawEditor(ctx);
    } else if (b.hasAttribute('data-paste')) {
      const lines = $('#as-paste').value.split(/\r?\n/).map((l) => l.replace(/^\s*(?:q\s*)?\d+\s*[.):-]\s*|^\s*[-•*]\s+/i, '').trim()).filter(Boolean);
      if (!lines.length) return toast('Paste at least one question, one per line.', 'warn');
      const kept = D.questions.filter((x) => x.body.trim() || x.id);
      const room = MAX_QUESTIONS - kept.length;
      D.questions = [...kept, ...lines.slice(0, room).map((body) => ({ ...blankQ(), body }))];
      if (!D.questions.length) D.questions.push(blankQ());
      if (lines.length > room) toast(`Only ${room} more fit: an assessment can have up to ${MAX_QUESTIONS} questions.`, 'warn');
      else toast(`${plural(lines.length, 'question')} added.`, 'ok', { timeout: 1800 });
      drawEditor(ctx);
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save(ctx, form);
  });
  if (focusKey) document.getElementById(`as-q-${focusKey}`)?.focus();
}

async function save(ctx, form) {
  const D = S.draft;
  const err = $('.form-error', form);
  err.textContent = '';
  const questions = D.questions.filter((q) => q.body.trim()).map((q) => (q.id ? { id: q.id, body: q.body.trim() } : { body: q.body.trim() }));
  if (!D.title.trim()) {
    err.textContent = 'Give the assessment a title.';
    return $('#as-title').focus();
  }
  if (!questions.length) {
    err.textContent = 'Add at least one question.';
    return;
  }
  const kept = new Set(questions.filter((q) => q.id).map((q) => q.id));
  const removed = D.original.filter((q) => !kept.has(q.id));
  const lost = removed.reduce((n, q) => n + (q.answers || 0), 0);
  if (D.status === 'open' || D.status === 'ended' || lost) {
    const ok = await confirmDialog({
      title: D.status === 'open' ? 'Change the questions while teams are answering?' : 'Save these changes?',
      message: `${D.status === 'open' ? 'Teams are answering right now and will see the changes within seconds. ' : D.status === 'ended' ? 'Teams can see this assessment and will see the changes. ' : ''}${lost
        ? `You removed ${plural(removed.length, 'question')} that teams already answered: ${plural(lost, 'answer')} will be deleted.`
        : 'Answers to the questions you kept stay as they are.'}`,
      confirmLabel: 'Save changes',
      danger: lost > 0,
    });
    if (!ok) return;
  }
  const btn = $('button[type=submit]', form);
  btn.classList.add('is-busy');
  try {
    const body = { title: D.title.trim(), instructions: D.instructions.trim(), questions };
    if (D.id) await api(`/admin/assessments/${D.id}`, { method: 'PUT', body });
    else await api('/admin/assessments', { method: 'POST', body });
    toast(D.id ? 'Changes saved.' : 'Assessment saved as a draft. Turn it on when the session ends.', 'ok');
    S.draft = null;
    location.hash = '#/assessments';
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.classList.remove('is-busy');
  }
}
