import { $, $$, api, html, setHTML, icon, formModal, confirmDialog, toast, toastError, withBusy, toLocalInput, fromLocalInput, copyText, openModal, clock, fmtDateTime, COMP_LABEL } from '../core.js';

/** Where the event clock stands: unset (never started), running, or ended. */
export function clockState(s) {
  const start = s.event_start ? Date.parse(s.event_start) : NaN;
  const end = s.event_end ? Date.parse(s.event_end) : NaN;
  const now = clock.now();
  if (!(start <= now)) return 'unset'; // also covers an old start time set in the future
  return now < end ? 'running' : 'ended';
}

const RESET = {
  hackathon: {
    scores: ['Clear all scores', 'This deletes every score, decision, judge mark and comment, and unpublishes all rounds. Teams, judges, announcements and the schedule are kept.', 'All scores cleared.'],
    everything: ['Delete teams & all Hackathon data', 'This deletes every Hackathon team, judge, score, result, announcement, help request and schedule item. Rounds, criteria, settings and organiser accounts are kept. The Ideathon is not touched.', 'All Hackathon data deleted.'],
  },
  ideathon: {
    scores: ['Clear ideas & results', 'This deletes every submitted idea, Design Thinking sheet and assessment answer, and every award and note, and hides the results again. Assessment questions (turned off), teams, announcements and the schedule are kept.', 'Ideas and results cleared.'],
    everything: ['Delete teams & all Ideathon data', 'This deletes every Ideathon team, idea, assessment answer, result, announcement, help request and schedule item. Assessment questions (turned off), settings and organiser accounts are kept. The Hackathon is not touched.', 'All Ideathon data deleted.'],
  },
};

function clockLine(s) {
  const st = clockState(s);
  if (st === 'running') return `Running since ${fmtDateTime(s.event_start)} · ends ${fmtDateTime(s.event_end)}.`;
  if (st === 'ended') return `Finished at ${fmtDateTime(s.event_end)}.`;
  return 'Not started. Press Start on the dashboard to begin the 24 hours.';
}

export async function render(ctx, params, seq) {
  const [{ settings: s }, { admins, me }] = await Promise.all([api('/admin/settings'), api('/admin/admins')]);
  if (!ctx.isCurrent(seq)) return;
  const comp = ctx.comp;
  const ideathon = comp === 'ideathon';
  const label = COMP_LABEL[comp];
  const toggle = (key, title, text) =>
    html`<div class="switch-row"><div><strong>${title}</strong><small>${text}</small></div><input type="checkbox" class="switch" data-toggle="${key}" ${s[key] === '1' ? 'checked' : ''} aria-label="${title}"></div>`;

  setHTML(
    ctx.main,
    html`
    <div class="page-head"><div><h1 class="page-title">Settings</h1><p>${label} details, what team leaders can see, organiser accounts and your data. These settings only affect the ${label}.</p></div></div>
    <div class="two-col cols-settings">
      <form class="card stack" id="st-event" novalidate>
        <h2 class="section-title">Event</h2>
        <label class="field"><span>Event name</span><input class="input" name="event_name" id="st-name" value="${s.event_name}" maxlength="80" required></label>
        <label class="field"><span>Tagline <span class="hint">Shown on the sign-in page</span></span><input class="input" name="tagline" id="st-tagline" value="${s.tagline}" maxlength="160"></label>
        <label class="field"><span>Venue</span><input class="input" name="venue" id="st-venue" value="${s.venue}" maxlength="160" placeholder="e.g. Main Auditorium, ABC College"></label>
        <p class="small faint" style="margin-top:-6px">The 24-hour clock starts when an organiser presses <strong>Start</strong> on the dashboard.</p>
        ${ideathon
          ? html`<label class="field"><span>Idea submission deadline <span class="hint">Optional. Teams can’t edit their idea after this</span></span><input class="input" type="datetime-local" name="submission_deadline" id="st-deadline" value="${toLocalInput(s.submission_deadline)}" style="max-width:280px"></label>`
          : ''}
        <label class="field"><span>Team ID prefix <span class="hint">New teams get IDs like ${s.team_code_prefix}001</span></span><input class="input mono" name="team_code_prefix" id="st-prefix" value="${s.team_code_prefix}" maxlength="8" style="max-width:160px"></label>
        <label class="field"><span>Help desk contact <span class="hint">Shown on the team help desk page, e.g. organiser phone numbers</span></span>
          <textarea class="textarea" name="helpdesk_contact" id="st-contact" rows="3" maxlength="600" placeholder="Rohit: 98xxxxxx01&#10;Help desk: near the main stage">${s.helpdesk_contact}</textarea></label>
        <div class="form-error" role="alert"></div>
        <div><button type="submit" class="btn btn-primary">Save event details</button></div>
      </form>

      <div class="stack">
        <section class="card">
          <h2 class="section-title" style="margin-bottom:4px">Team portal</h2>
          ${ideathon ? '' : toggle('leaderboard_visible', 'Show leaderboard to teams', 'Totals from published rounds, visible to every team leader.')}
          ${toggle('helpdesk_open', 'Help desk open', 'Team leaders can raise new help requests.')}
          ${toggle('allow_password_change', 'Teams can change their password', 'Off keeps the passwords on your printed slips valid.')}
        </section>

        ${ideathon
          ? html`<section class="card">
              <h2 class="section-title" style="margin-bottom:4px">Idea submission</h2>
              ${toggle('submissions_enabled', 'Collect ideas through the portal', 'Teams get a “My idea” page to describe their idea and share links. Turn off if you don’t need it.')}
              ${s.submissions_enabled === '1' ? toggle('submissions_open', 'Accepting submissions', 'Off locks every idea, e.g. before the event starts or once judging begins.') : ''}
            </section>
            <section class="card">
              <h2 class="section-title" style="margin-bottom:4px">Design Thinking</h2>
              ${toggle('design_thinking_enabled', 'Design Thinking page', 'Teams get a page for the 4-5-3 method: 4 members develop a base idea for about 5 minutes each, passing ideas along over 3 iterations, which gives 12 ideas. Off hides the page.')}
            </section>`
          : ''}

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
            ${ideathon ? html`<button type="button" class="btn btn-sm" data-download="submissions">${icon('download')}Ideas CSV</button>` : ''}
            <button type="button" class="btn btn-sm" data-download="teams">${icon('download')}Teams CSV</button>
            <button type="button" class="btn btn-sm" data-download="backup">${icon('download')}Full backup</button>
          </div>
          <p class="small faint" style="margin-top:10px">${ideathon
            ? 'Download a backup before and after the event. It holds every Ideathon team, idea, result, announcement and help request (never passwords).'
            : 'Download a backup before and after each round. It holds every Hackathon team, judge, score, decision, note, announcement and help request (never passwords).'}</p>
          <hr class="divider">
          <h3 style="font-size:15px;margin-bottom:4px;color:var(--bad)">Danger zone</h3>
          <div class="clock-zone">
            <p><strong>Event clock</strong><br><span class="small muted">${clockLine(s)}</span></p>
            <div class="row">
              ${clockState(s) === 'running' ? html`<button type="button" class="btn btn-sm btn-danger" data-clock="stop">${icon('x')}Stop the clock</button>` : ''}
              ${clockState(s) !== 'unset' ? html`<button type="button" class="btn btn-sm btn-danger" data-clock="reset">${icon('refresh')}Reset the clock</button>` : ''}
            </div>
          </div>
          <p class="small muted" style="margin-bottom:12px">Use these to clear test data before the event starts.</p>
          <div class="row">
            <button type="button" class="btn btn-sm btn-danger" data-reset="scores">${RESET[comp].scores[0]}</button>
            <button type="button" class="btn btn-sm btn-danger" data-reset="everything">${RESET[comp].everything[0]}</button>
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
    if ('submission_deadline' in v) v.submission_deadline = fromLocalInput(v.submission_deadline);
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
        await ctx.refreshMeta();
        if (sw.dataset.toggle === 'submissions_enabled') ctx.rerender();
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

  $$('[data-clock]').forEach((b) =>
    b.addEventListener('click', () => {
      const stop = b.dataset.clock === 'stop';
      const word = stop ? 'STOP' : 'RESET';
      formModal({
        title: stop ? 'Stop the event clock' : 'Reset the event clock',
        submitLabel: stop ? 'Stop the clock' : 'Reset the clock',
        danger: true,
        content: html`
          <p class="muted">${stop
            ? `The ${label} countdown ends now on every screen, and teams see “Time’s up”. To run it again you’d have to reset the clock and press Start, which begins a fresh 24 hours.`
            : `The ${label} clock goes back to “Not started” and teams stop seeing a countdown. The Start button comes back on the dashboard; pressing it begins a fresh 24 hours.`}</p>
          <label class="field"><span>Type ${word} to confirm</span><input class="input mono" name="confirm" autocomplete="off" required></label>`,
        async onSubmit(v) {
          if (v.confirm !== word) throw new Error(`Type ${word} in capitals to confirm.`);
          await api('/admin/clock', { method: 'POST', body: { action: b.dataset.clock, confirm: v.confirm } });
          toast(stop ? 'The clock is stopped.' : 'The clock is reset. Press Start on the dashboard when you’re ready.', 'ok');
          await ctx.refreshMeta();
          ctx.rerender();
        },
      });
    })
  );

  $$('[data-reset]').forEach((b) =>
    b.addEventListener('click', () => {
      const everything = b.dataset.reset === 'everything';
      const [title, message, done] = RESET[comp][everything ? 'everything' : 'scores'];
      formModal({
        title,
        submitLabel: everything ? 'Delete everything' : 'Clear',
        danger: true,
        content: html`
          <p class="muted">${message}</p>
          <p class="muted">This can’t be undone. Download a backup first if you might need this data.</p>
          <label class="field"><span>Type RESET to confirm</span><input class="input mono" name="confirm" autocomplete="off" required></label>`,
        async onSubmit(v) {
          if (v.confirm !== 'RESET') throw new Error('Type RESET in capitals to confirm.');
          await api('/admin/reset', { method: 'POST', body: { confirm: v.confirm, scope: everything ? 'everything' : 'scores' } });
          toast(done, 'ok');
          ctx.rerender();
        },
      });
    })
  );
}
