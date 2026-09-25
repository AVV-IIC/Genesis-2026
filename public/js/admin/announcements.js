import { $, $$, api, html, raw, setHTML, icon, formModal, confirmDialog, toast, toastError, richText, timeAgo, PRIORITY_LABEL } from '../core.js';
import { chip, empty } from './shared.js';

export const live = ['announcement', 'announcements', 'teams'];

let teamsCache = [];

async function loadTeams() {
  const { teams } = await api('/admin/teams');
  teamsCache = teams;
  return teams;
}

const AUDIENCE_LABEL = { all: 'All teams', competing: 'Teams still competing', team: 'One team' };

function fields(a = {}, teams = teamsCache, idp = '') {
  const id = (k) => (idp ? raw(`id="${idp}-${k}"`) : '');
  const priority = a.priority || 'normal';
  const audience = a.audience || 'all';
  return html`
    <label class="field"><span>Title</span><input class="input" name="title" ${id('title')} maxlength="140" value="${a.title || ''}" placeholder="e.g. Dinner is served in Hall B" required></label>
    <label class="field"><span>Message <span class="hint">Use **bold** for emphasis. Links become clickable.</span></span>
      <textarea class="textarea" name="body" ${id('body')} rows="5" maxlength="5000" placeholder="Details for the teams…">${a.body || ''}</textarea></label>
    <div class="form-grid">
      <div class="field"><span>Priority</span>
        <div class="seg" role="radiogroup" aria-label="Priority" data-priority>
          ${['normal', 'important', 'urgent'].map((p) => html`<button type="button" data-p="${p}" aria-pressed="${p === priority}">${PRIORITY_LABEL[p]}</button>`)}
        </div>
        <input type="hidden" name="priority" value="${priority}">
        <span class="hint">Urgent shows a red banner on every team’s screen.</span>
      </div>
      <label class="field"><span>Send to</span>
        <select class="select" name="audience" data-audience>${Object.entries(AUDIENCE_LABEL).map(([k, v]) => html`<option value="${k}" ${k === audience ? raw('selected') : ''}>${v}</option>`)}</select></label>
      <label class="field span-2" data-team-pick ${audience === 'team' ? '' : 'hidden'}><span>Team</span>
        <select class="select" name="team_id">${teams.map((t) => html`<option value="${t.id}" ${t.id === a.team_id ? raw('selected') : ''}>${t.code} · ${t.name}</option>`)}</select></label>
    </div>
    <label class="check"><input type="checkbox" name="pinned" ${a.pinned ? 'checked' : ''}> Pin to the top of the announcements page</label>`;
}

function bindFields(root) {
  const seg = $('[data-priority]', root);
  const hidden = $('input[name=priority]', root);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    hidden.value = b.dataset.p;
    $$('[data-p]', seg).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  const aud = $('[data-audience]', root);
  aud.addEventListener('change', () => ($('[data-team-pick]', root).hidden = aud.value !== 'team'));
}

/** Composer modal, used from the dashboard and the announcements page. */
export async function openComposer(ctx, existing = null) {
  const teams = await loadTeams();
  formModal({
    title: existing ? 'Edit announcement' : 'New announcement',
    submitLabel: existing ? 'Save changes' : 'Post announcement',
    wide: true,
    content: fields(existing || {}, teams),
    onMount: (dlg) => bindFields(dlg),
    async onSubmit(v) {
      if (v.audience === 'team' && !teams.length) throw new Error('There are no teams to send this to yet.');
      if (existing) await api(`/admin/announcements/${existing.id}`, { method: 'PUT', body: v });
      else await api('/admin/announcements', { method: 'POST', body: v });
      toast(existing ? 'Announcement updated.' : 'Announcement posted.', 'ok');
      if (ctx.view === 'announcements' || ctx.view === 'dashboard') ctx.rerender();
    },
  });
}

export async function render(ctx, params, seq) {
  const [{ announcements }] = await Promise.all([api('/admin/announcements'), loadTeams()]);
  if (!ctx.isCurrent(seq)) return;

  setHTML(
    ctx.main,
    html`
    <div class="page-head"><div><h1 class="page-title">Announcements</h1><p>Posts appear instantly on every team leader’s screen with a notification.</p></div></div>
    <div class="two-col" style="margin-top:0;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr)">
      <form class="card stack" id="an-form" novalidate>
        <h2 class="section-title">Compose</h2>
        ${fields({}, teamsCache, 'an')}
        <div class="form-error" role="alert"></div>
        <div><button type="submit" class="btn btn-primary">${icon('send')}Post announcement</button></div>
      </form>
      <section class="stack">
        <h2 class="section-title">Posted <span class="faint">${announcements.length}</span></h2>
        ${announcements.length
          ? html`<div class="ann-list">${announcements.map(
              (a) => html`<article class="ann ann-${a.priority}">
                <div class="ann-head">
                  ${a.pinned ? html`<span class="pin" title="Pinned">${icon('pin')}</span>` : ''}
                  ${a.priority !== 'normal' ? chip(a.priority, PRIORITY_LABEL[a.priority]) : ''}
                  <h3>${a.title}</h3>
                </div>
                ${a.body ? html`<div class="ann-body">${richText(a.body)}</div>` : ''}
                <div class="ann-meta">
                  <span>${timeAgo(a.created_at)} · ${a.author}</span>
                  <span>· ${a.audience === 'team' ? `Only ${a.team_code || 'one team'}${a.team_name ? ` (${a.team_name})` : ''}` : AUDIENCE_LABEL[a.audience]}</span>
                  <span class="grow"></span>
                  <button type="button" class="btn btn-ghost btn-sm" data-pin="${a.id}">${a.pinned ? 'Unpin' : 'Pin'}</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-edit="${a.id}">${icon('edit')}Edit</button>
                  <button type="button" class="btn btn-ghost btn-sm btn-danger" data-del="${a.id}">${icon('trash')}Delete</button>
                </div>
              </article>`
            )}</div>`
          : html`<div class="card">${empty('Nothing posted yet', 'Write your first announcement on the left. Teams see it the moment you post.')}</div>`}
      </section>
    </div>`
  );

  const form = $('#an-form');
  bindFields(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    err.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    data.pinned = form.elements.namedItem('pinned').checked;
    const btn = $('button[type=submit]', form);
    btn.classList.add('is-busy');
    try {
      await api('/admin/announcements', { method: 'POST', body: data });
      form.reset();
      $('input[name=priority]', form).value = 'normal';
      $$('[data-p]', form).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.p === 'normal')));
      $('[data-team-pick]', form).hidden = true;
      toast('Announcement posted.', 'ok');
      ctx.rerender();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.classList.remove('is-busy');
    }
  });

  const byId = (id) => announcements.find((a) => a.id === Number(id));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openComposer(ctx, byId(b.dataset.edit))));
  $$('[data-pin]').forEach((b) =>
    b.addEventListener('click', async () => {
      const a = byId(b.dataset.pin);
      try {
        await api(`/admin/announcements/${a.id}`, { method: 'PUT', body: { ...a, pinned: !a.pinned } });
        ctx.rerender();
      } catch (err) {
        toastError(err);
      }
    })
  );
  $$('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const a = byId(b.dataset.del);
      if (!(await confirmDialog({ title: 'Delete announcement', message: `Delete “${a.title}”? Teams will no longer see it.`, confirmLabel: 'Delete', danger: true }))) return;
      try {
        await api(`/admin/announcements/${a.id}`, { method: 'DELETE' });
        toast('Announcement deleted.', 'ok');
        ctx.rerender();
      } catch (err) {
        toastError(err);
      }
    })
  );
}
