import { $$, api, html, raw, setHTML, icon, formModal, confirmDialog, toast, toastError, fmtTime, fmtDayLong, dayKey, toLocalInput, fromLocalInput } from '../core.js';
import { chip, empty, scope } from './shared.js';

export const live = ['schedule'];

const KINDS = { general: 'General', round: 'Round / judging', deadline: 'Deadline', food: 'Food & break', talk: 'Talk / workshop' };
const KIND_CHIP = { general: 'normal', round: 'judging', deadline: 'eliminated', food: 'advanced', talk: 'pending' };

export async function render(ctx, params, seq) {
  const { schedule } = await api('/admin/schedule');
  if (!ctx.isCurrent(seq)) return;

  const groups = new Map();
  for (const e of schedule) {
    const k = dayKey(e.starts_at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Schedule</h1><p>Teams${scope.comp === 'hackathon' ? ' and judges' : ''} see this timeline with a live “happening now” marker. Items marked “Both” also show in the other competition.</p></div>
      <button type="button" class="btn btn-primary" id="sc-add">${icon('plus')}Add item</button>
    </div>
    <div class="callout" style="margin-bottom:16px">${icon('info')}<span>Items of type <strong>Round / judging</strong> or <strong>Deadline</strong> show up as markers on the countdown dial. Put “Round 1”, “Round 2”… in the title to label them R1, R2.</span></div>
    ${schedule.length
      ? html`<div class="stack">${[...groups.values()].map(
          (list) => html`<section class="card card-flush">
            <div class="card-head"><h2 class="section-title">${fmtDayLong(list[0].starts_at)}</h2></div>
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Time</th><th>What</th><th>Shown in</th><th>Type</th><th>Where</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>${list.map(
                (e) => html`<tr>
                  <td class="mono small nowrap">${fmtTime(e.starts_at)}${e.ends_at ? ` – ${fmtTime(e.ends_at)}` : ''}</td>
                  <td class="team-cell"><strong>${e.title}</strong>${e.details ? html`<small>${e.details}</small>` : ''}</td>
                  <td>${e.competition === 'both' ? chip('live', 'Both') : html`<span class="small muted">This only</span>`}</td>
                  <td>${chip(KIND_CHIP[e.kind], KINDS[e.kind])}</td>
                  <td class="muted">${e.location || '–'}</td>
                  <td class="actions">
                    <button type="button" class="icon-btn" data-edit="${e.id}" aria-label="Edit ${e.title}">${icon('edit')}</button>
                    <button type="button" class="icon-btn" data-del="${e.id}" aria-label="Delete ${e.title}">${icon('trash')}</button>
                  </td>
                </tr>`
              )}</tbody></table></div>
          </section>`
        )}</div>`
      : html`<div class="card">${empty('No schedule yet', 'Add check-in, rounds, meals, talks and the final deadline so teams always know what’s next.', html`<button type="button" class="btn btn-primary" id="sc-add-2">${icon('plus')}Add the first item</button>`)}</div>`}`
  );

  const byId = (id) => schedule.find((e) => e.id === Number(id));
  const open = (item) => editItem(ctx, item);
  ctx.main.querySelector('#sc-add').addEventListener('click', () => open(null));
  ctx.main.querySelector('#sc-add-2')?.addEventListener('click', () => open(null));
  $$('[data-edit]', ctx.main).forEach((b) => b.addEventListener('click', () => open(byId(b.dataset.edit))));
  $$('[data-del]', ctx.main).forEach((b) =>
    b.addEventListener('click', async () => {
      const e = byId(b.dataset.del);
      if (!(await confirmDialog({ title: 'Delete item', message: `Remove “${e.title}” from the schedule?`, confirmLabel: 'Delete', danger: true }))) return;
      try {
        await api(`/admin/schedule/${e.id}`, { method: 'DELETE' });
        ctx.rerender();
      } catch (err) {
        toastError(err);
      }
    })
  );
}

function editItem(ctx, item) {
  const e = item || { title: '', kind: 'general', starts_at: ctx.settings.event_start || '', ends_at: '', location: '', details: '' };
  formModal({
    title: item ? 'Edit schedule item' : 'Add schedule item',
    submitLabel: item ? 'Save changes' : 'Add item',
    content: html`
      <label class="field"><span>Title</span><input class="input" name="title" value="${e.title}" maxlength="120" placeholder="e.g. Round 2 · Progress check" required></label>
      <div class="form-grid">
        <label class="field"><span>Type</span><select class="select" name="kind">${Object.entries(KINDS).map(([k, v]) => html`<option value="${k}" ${k === e.kind ? raw('selected') : ''}>${v}</option>`)}</select></label>
        <label class="field"><span>Where</span><input class="input" name="location" value="${e.location}" maxlength="120" placeholder="e.g. Main hall"></label>
        <label class="field"><span>Starts</span><input class="input" type="datetime-local" name="starts_at" value="${toLocalInput(e.starts_at)}" required></label>
        <label class="field"><span>Ends <span class="hint">Optional</span></span><input class="input" type="datetime-local" name="ends_at" value="${toLocalInput(e.ends_at)}"></label>
      </div>
      <label class="field"><span>Details <span class="hint">Optional</span></span><textarea class="textarea" name="details" rows="3" maxlength="1000">${e.details}</textarea></label>
      <label class="check"><input type="checkbox" name="both" ${e.competition === 'both' ? 'checked' : ''}> Also show in the ${scope.comp === 'hackathon' ? 'Ideathon' : 'Hackathon'} schedule (e.g. opening, meals, closing ceremony)</label>`,
    async onSubmit(v) {
      if (!v.starts_at) throw new Error('Pick a start time.');
      const { both, ...rest } = v;
      const body = { ...rest, scope: both ? 'both' : 'own', starts_at: fromLocalInput(v.starts_at), ends_at: fromLocalInput(v.ends_at) || null };
      if (item) await api(`/admin/schedule/${item.id}`, { method: 'PUT', body });
      else await api('/admin/schedule', { method: 'POST', body });
      toast(item ? 'Schedule item saved.' : 'Added to the schedule.', 'ok');
      ctx.rerender();
    },
  });
}
