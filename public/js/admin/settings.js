import { $, $$, api, html, setHTML, icon, formModal, confirmDialog, toast, toastError, withBusy, toLocalInput, fromLocalInput, copyText, openModal } from '../core.js';

export async function render(ctx, params, seq) {
  const [{ settings: s }, { admins, me }] = await Promise.all([api('/admin/settings'), api('/admin/admins')]);
  if (!ctx.isCurrent(seq)) return;
  const toggle = (key, title, text) =>
    html`<div class="switch-row"><div><strong>${title}</strong><small>${text}</small></div><input type="checkbox" class="switch" data-toggle="${key}" ${s[key] === '1' ? 'checked' : ''} aria-label="${title}"></div>`;

  setHTML(
    ctx.main,
    html`
    <div class="page-head"><div><h1 class="page-title">Settings</h1><p>Event details, what team leaders can see, organiser accounts and your data.</p></div></div>
    <div class="two-col" style="margin-top:0;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)">
      <form class="card stack" id="st-event" novalidate>
        <h2 class="section-title">Event</h2>
        <label class="field"><span>Event name</span><input class="input" name="event_name" id="st-name" value="${s.event_name}" maxlength="80" required></label>
        <label class="field"><span>Tagline <span class="hint">Shown on the sign-in page</span></span><input class="input" name="tagline" id="st-tagline" value="${s.tagline}" maxlength="160"></label>
        <label class="field"><span>Venue</span><input class="input" name="venue" id="st-venue" value="${s.venue}" maxlength="160" placeholder="e.g. Main Auditorium, ABC College"></label>
        <div class="form-grid">
          <label class="field"><span>Hackathon starts</span><input class="input" type="datetime-local" name="event_start" id="st-start" value="${toLocalInput(s.event_start)}"></label>
          <label class="field"><span>Hackathon ends</span><input class="input" type="datetime-local" name="event_end" id="st-end" value="${toLocalInput(s.event_end)}"></label>
        </div>
        <p class="small faint" style="margin-top:-6px">Times are in this device’s time zone. The countdown dial runs from start to end.</p>
        <label class="field"><span>Team ID prefix <span class="hint">New teams get IDs like ${s.team_code_prefix}001</span></span><input class="input mono" name="team_code_prefix" id="st-prefix" value="${s.team_code_prefix}" maxlength="8" style="max-width:160px"></label>
        <label class="field"><span>Help desk contact <span class="hint">Shown on the team help desk page, e.g. organiser phone numbers</span></span>
          <textarea class="textarea" name="helpdesk_contact" id="st-contact" rows="3" maxlength="600" placeholder="Rohit: 98xxxxxx01&#10;Help desk: near the main stage">${s.helpdesk_contact}</textarea></label>
        <div class="form-error" role="alert"></div>
        <div><button type="submit" class="btn btn-primary">Save event details</button></div>
      </form>

      <div class="stack">
        <section class="card">
          <h2 class="section-title" style="margin-bottom:4px">Team portal</h2>
          ${toggle('leaderboard_visible', 'Show leaderboard to teams', 'Totals from published rounds, visible to every team leader.')}
          ${toggle('helpdesk_open', 'Help desk open', 'Team leaders can raise new help requests.')}
          ${toggle('allow_password_change', 'Teams can change their password', 'Off keeps the passwords on your printed slips valid.')}
        </section>

        <section class="card">
          <h2 class="section-title" style="margin-bottom:8px">Organiser accounts</h2>
          <ul class="list-plain">${admins.map(
            (a) => html`<li>
              <span><strong>${a.display_name}</strong>${a.id === me ? html` <span class="chip chip-plain chip-live">You</span>` : ''}<br><small class="faint">@${a.username}</small></span>
              <span class="row">
                <button type="button" class="btn btn-ghost btn-sm" data-rename="${a.id}" data-name="${a.display_name}">${icon('edit')}Rename</button>
                ${a.id === me
                  ? html`<button type="button" class="btn btn-sm" id="st-mypw">${icon('key')}Change my password</button>`
                  : html`<button type="button" class="btn btn-ghost btn-sm" data-reset-admin="${a.id}" data-user="${a.username}">${icon('key')}Reset password</button>`}
              </span>
            </li>`
          )}</ul>
          <p class="small faint" style="margin-top:8px">Your display name appears on announcements and help desk replies.</p>
        </section>

        <section class="card">
          <h2 class="section-title" style="margin-bottom:12px">Data</h2>
          <div class="row">
            <button type="button" class="btn btn-sm" data-download="results">${icon('download')}Results CSV</button>
            <button type="button" class="btn btn-sm" data-download="teams">${icon('download')}Teams CSV</button>
            <button type="button" class="btn btn-sm" data-download="backup">${icon('download')}Full backup</button>
          </div>
          <p class="small faint" style="margin-top:10px">Download a backup before and after each round. It holds every team, score, decision, note, announcement and help request (never passwords).</p>
          <hr class="divider">
          <h3 style="font-size:15px;margin-bottom:4px;color:var(--bad)">Danger zone</h3>
          <p class="small muted" style="margin-bottom:12px">Use this to clear test data before the event starts.</p>
          <div class="row">
            <button type="button" class="btn btn-sm btn-danger" data-reset="scores">Clear all scores</button>
            <button type="button" class="btn btn-sm btn-danger" data-reset="everything">Delete teams & all event data</button>
          </div>
        </section>
      </div>
    </div>`
  );

  const form = $('#st-event');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    err.textContent = '';
    const v = Object.fromEntries(new FormData(form));
    v.event_start = fromLocalInput(v.event_start);
    v.event_end = fromLocalInput(v.event_end);
    await withBusy($('button[type=submit]', form), async () => {
      try {
        await api('/admin/settings', { method: 'PUT', body: v });
        toast('Event details saved.', 'ok');
        await ctx.refreshMeta();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  });

  $$('[data-toggle]').forEach((sw) =>
    sw.addEventListener('change', async () => {
      try {
        await api('/admin/settings', { method: 'PUT', body: { [sw.dataset.toggle]: sw.checked } });
        toast('Saved.', 'ok', { timeout: 1800 });
        ctx.refreshMeta();
      } catch (err) {
        sw.checked = !sw.checked;
        toastError(err);
      }
    })
  );

  $$('[data-rename]').forEach((b) =>
    b.addEventListener('click', () =>
      formModal({
        title: 'Rename organiser',
        content: html`<label class="field"><span>Display name</span><input class="input" name="display_name" value="${b.dataset.name}" maxlength="60" required></label>`,
        async onSubmit(v) {
          await api(`/admin/admins/${b.dataset.rename}`, { method: 'PUT', body: v });
          toast('Name updated.', 'ok');
          await ctx.refreshMeta();
          ctx.rerender();
        },
      })
    )
  );

  $('#st-mypw')?.addEventListener('click', () =>
    formModal({
      title: 'Change my password',
      submitLabel: 'Change password',
      content: html`
        <label class="field"><span>Current password</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
        <label class="field"><span>New password <span class="hint">At least 8 characters</span></span><input class="input" type="password" name="next" autocomplete="new-password" required></label>
        <label class="field"><span>Repeat new password</span><input class="input" type="password" name="repeat" autocomplete="new-password" required></label>`,
      async onSubmit(v) {
        if (v.next !== v.repeat) throw new Error('The new passwords don’t match.');
        await api('/auth/password', { method: 'POST', body: { current: v.current, next: v.next } });
        toast('Password changed. Your other devices were signed out.', 'ok');
      },
    })
  );

  $$('[data-reset-admin]').forEach((b) =>
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Reset organiser password',
        message: `Generate a new password for @${b.dataset.user}? Their current password stops working and they’re signed out everywhere.`,
        confirmLabel: 'Reset password',
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api(`/admin/admins/${b.dataset.resetAdmin}/password`, { method: 'POST', body: {} });
        openModal({
          title: 'New organiser password',
          form: false,
          content: html`<dl class="cred"><dt>Username</dt><dd>${res.username}</dd><span></span><dt>Password</dt><dd>${res.password}</dd>
            <button type="button" class="icon-btn" data-copy aria-label="Copy password">${icon('copy')}</button></dl>
            <p class="small muted">Share this privately. They can change it after signing in.</p>`,
          footer: html`<button type="button" class="btn btn-primary" data-close>Done</button>`,
          onMount: (dlg) => $('[data-copy]', dlg).addEventListener('click', () => copyText(res.password)),
        });
      } catch (err) {
        toastError(err);
      }
    })
  );

  $$('[data-reset]').forEach((b) =>
    b.addEventListener('click', () => {
      const everything = b.dataset.reset === 'everything';
      formModal({
        title: everything ? 'Delete all event data' : 'Clear all scores',
        submitLabel: everything ? 'Delete everything' : 'Clear scores',
        danger: true,
        content: html`
          <p class="muted">${everything
            ? 'This deletes every team, score, result, announcement, help request and schedule item. Rounds, criteria, settings and organiser accounts are kept.'
            : 'This deletes every score, decision and judges’ note, and unpublishes all rounds. Teams, announcements and the schedule are kept.'}</p>
          <p class="muted">This can’t be undone. Download a backup first if you might need this data.</p>
          <label class="field"><span>Type RESET to confirm</span><input class="input mono" name="confirm" autocomplete="off" required></label>`,
        async onSubmit(v) {
          if (v.confirm !== 'RESET') throw new Error('Type RESET in capitals to confirm.');
          await api('/admin/reset', { method: 'POST', body: { confirm: v.confirm, scope: everything ? 'everything' : 'scores' } });
          toast(everything ? 'All event data deleted.' : 'All scores cleared.', 'ok');
          ctx.rerender();
        },
      });
    })
  );
}
