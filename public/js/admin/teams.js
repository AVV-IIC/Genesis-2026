import { $, $$, api, html, setHTML, icon, formModal, confirmDialog, toast, toastError, timeAgo } from '../core.js';
import { chip, empty, showCredentials } from './shared.js';

export const live = ['teams', 'rounds', 'results'];

const state = { teams: [], nextCode: '', filter: 'all', q: '' };
let lastCtx = null;

export async function render(ctx, params, seq) {
  lastCtx = ctx;
  const data = await api('/admin/teams');
  if (!ctx.isCurrent(seq)) return;
  state.teams = data.teams;
  state.nextCode = data.next_code;

  const counts = {
    all: state.teams.length,
    competing: state.teams.filter((t) => t.active && !t.eliminated_in).length,
    eliminated: state.teams.filter((t) => t.active && t.eliminated_in).length,
    disabled: state.teams.filter((t) => !t.active).length,
  };

  setHTML(
    ctx.main,
    html`
    <div class="page-head">
      <div><h1 class="page-title">Teams</h1><p>Each team leader signs in with their team ID and password. Passwords are only shown when you create or reset them.</p></div>
      <div class="row">
        <button type="button" class="btn" id="t-import">${icon('upload')}Import CSV</button>
        <button type="button" class="btn btn-primary" id="t-add">${icon('plus')}Add team</button>
      </div>
    </div>

    <div class="toolbar">
      <label class="search"><span class="sr-only">Search teams</span>${icon('search')}<input class="input" id="t-search" type="search" placeholder="Search name, ID, leader, track" value="${state.q}"></label>
      <div class="seg" role="group" aria-label="Filter teams">
        ${[['all', 'All'], ['competing', 'Competing'], ['eliminated', 'Eliminated'], ['disabled', 'Disabled']].map(
          ([k, label]) => html`<button type="button" data-filter="${k}" aria-pressed="${state.filter === k}">${label} <span class="faint">${counts[k]}</span></button>`
        )}
      </div>
      <span class="grow"></span>
      <button type="button" class="btn btn-ghost btn-sm" data-download="teams">${icon('download')}Export CSV</button>
      <button type="button" class="btn btn-ghost btn-sm" id="t-slips">${icon('printer')}New passwords for all</button>
    </div>

    <section class="card card-flush">
      ${state.teams.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Team ID</th><th>Team</th><th>Track</th><th>Table</th><th class="num">Members</th><th>Status</th><th>Last sign-in</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody id="t-body"></tbody></table></div>`
        : empty('No teams yet', 'Add teams one by one, or import them all at once from a spreadsheet.', html`<div class="row" style="justify-content:center"><button type="button" class="btn" id="t-import-2">${icon('upload')}Import CSV</button><button type="button" class="btn btn-primary" id="t-add-2">${icon('plus')}Add team</button></div>`)}
    </section>`
  );

  drawRows();
  $('#t-search').addEventListener('input', (e) => {
    state.q = e.target.value;
    drawRows();
  });
  for (const b of $$('[data-filter]')) {
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      $$('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      drawRows();
    });
  }
  const add = () => editTeam(ctx, null);
  const imp = () => importTeams(ctx);
  $('#t-add').addEventListener('click', add);
  $('#t-add-2')?.addEventListener('click', add);
  $('#t-import').addEventListener('click', imp);
  $('#t-import-2')?.addEventListener('click', imp);
  $('#t-slips').addEventListener('click', () => regenerateAll(ctx));
}

function visibleTeams() {
  const q = state.q.trim().toLowerCase();
  return state.teams.filter((t) => {
    if (state.filter === 'competing' && !(t.active && !t.eliminated_in)) return false;
    if (state.filter === 'eliminated' && !(t.active && t.eliminated_in)) return false;
    if (state.filter === 'disabled' && t.active) return false;
    if (!q) return true;
    return [t.code, t.name, t.leader_name, t.track, t.table_no, ...t.members].some((v) => String(v || '').toLowerCase().includes(q));
  });
}

function drawRows() {
  const body = $('#t-body');
  if (!body) return;
  const list = visibleTeams();
  if (!list.length) {
    setHTML(body, html`<tr><td colspan="8" class="muted" style="text-align:center;padding:28px">No teams match.</td></tr>`);
    return;
  }
  setHTML(
    body,
    list.map(
      (t) => html`<tr class="${t.active ? '' : 'is-dim'}">
        <td><span class="code-tag">${t.code}</span></td>
        <td class="team-cell"><strong>${t.name}</strong><small>${t.leader_name || 'No leader set'}${t.phone ? ` · ${t.phone}` : ''}</small></td>
        <td>${t.track || html`<span class="faint">–</span>`}</td>
        <td>${t.table_no || html`<span class="faint">–</span>`}</td>
        <td class="num">${t.members.length}</td>
        <td>${!t.active ? chip('disabled', 'Disabled') : t.eliminated_in ? chip('eliminated', `Out in R${t.eliminated_in}`) : chip('selected', 'Competing')}
          ${t.open_tickets ? html` <a href="#/help" class="chip chip-open chip-plain" title="Open help requests">${t.open_tickets} help</a>` : ''}</td>
        <td class="small ${t.last_login_at ? 'muted' : 'faint'}">${t.last_login_at ? timeAgo(t.last_login_at) : 'Never'}</td>
        <td class="actions">
          <button type="button" class="icon-btn" data-edit="${t.id}" aria-label="Edit ${t.name}" title="Edit">${icon('edit')}</button>
          <button type="button" class="icon-btn" data-reset="${t.id}" aria-label="Reset password for ${t.name}" title="Reset password">${icon('key')}</button>
          <button type="button" class="icon-btn" data-del="${t.id}" aria-label="Delete ${t.name}" title="Delete">${icon('trash')}</button>
        </td>
      </tr>`
    )
  );
  const byId = (id) => state.teams.find((t) => t.id === Number(id));
  $$('[data-edit]', body).forEach((b) => b.addEventListener('click', () => editTeam(null, byId(b.dataset.edit))));
  $$('[data-reset]', body).forEach((b) => b.addEventListener('click', () => resetPassword(byId(b.dataset.reset))));
  $$('[data-del]', body).forEach((b) => b.addEventListener('click', () => deleteTeam(byId(b.dataset.del))));
}

function eventName() {
  return lastCtx?.settings?.event_name || 'Genesis Hackathon';
}

function editTeam(ctx, team) {
  if (ctx) lastCtx = ctx;
  const t = team || { code: '', name: '', leader_name: '', email: '', phone: '', members: [], track: '', table_no: '', notes: '', active: true };
  formModal({
    title: team ? 'Edit team' : 'Add team',
    submitLabel: team ? 'Save changes' : 'Add team',
    wide: true,
    content: html`
      <div class="form-grid">
        <label class="field"><span>Team name</span><input class="input" name="name" value="${t.name}" maxlength="80" required></label>
        <label class="field"><span>Team ID (login) <span class="hint">${team ? '' : `Leave blank for ${state.nextCode}`}</span></span>
          <input class="input mono" name="code" value="${t.code}" maxlength="32" placeholder="${state.nextCode}" autocapitalize="characters" spellcheck="false"></label>
        <label class="field"><span>Team leader</span><input class="input" name="leader_name" value="${t.leader_name}" maxlength="80"></label>
        <label class="field"><span>Leader phone</span><input class="input" name="phone" value="${t.phone}" maxlength="30" inputmode="tel"></label>
        <label class="field"><span>Leader email</span><input class="input" name="email" value="${t.email}" maxlength="120" type="email"></label>
        <label class="field"><span>Track / problem statement</span><input class="input" name="track" value="${t.track}" maxlength="120"></label>
        <label class="field"><span>Table / location</span><input class="input" name="table_no" value="${t.table_no}" maxlength="20"></label>
        ${team
          ? html`<label class="field"><span>Account</span><span class="check" style="min-height:42px"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Team can sign in</span></label>`
          : html`<label class="field"><span>Password <span class="hint">Leave blank to generate one</span></span><input class="input mono" name="password" maxlength="100" autocomplete="off" spellcheck="false"></label>`}
        <label class="field span-2"><span>Members <span class="hint">One name per line, leader first</span></span><textarea class="textarea" name="members" rows="4">${t.members.join('\n')}</textarea></label>
        <label class="field span-2"><span>Organiser notes <span class="hint">Only organisers see this</span></span><textarea class="textarea" name="notes" rows="2" maxlength="1000">${t.notes}</textarea></label>
      </div>`,
    async onSubmit(v) {
      v.members = v.members.split('\n').map((m) => m.trim()).filter(Boolean);
      if (team) {
        await api(`/admin/teams/${team.id}`, { method: 'PUT', body: v });
        toast('Team saved.', 'ok');
      } else {
        const res = await api('/admin/teams', { method: 'POST', body: v });
        showCredentials([{ ...res.team, password: res.password }], { title: 'Team added', eventName: eventName() });
      }
      lastCtx?.rerender();
    },
  });
}

async function resetPassword(team) {
  const ok = await confirmDialog({
    title: 'Reset password',
    message: `Generate a new password for ${team.name}? Their current password stops working and anyone signed in is signed out.`,
    confirmLabel: 'Reset password',
  });
  if (!ok) return;
  try {
    const res = await api(`/admin/teams/${team.id}/password`, { method: 'POST', body: {} });
    showCredentials(res.credentials, { title: 'New password', eventName: eventName() });
  } catch (err) {
    toastError(err);
  }
}

async function deleteTeam(team) {
  const ok = await confirmDialog({
    title: 'Delete team',
    message: `Delete ${team.name} (${team.code})? Their scores, results and help requests are removed too. This can’t be undone. To stop them signing in but keep their data, edit the team and turn off “Team can sign in”.`,
    confirmLabel: 'Delete team',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/admin/teams/${team.id}`, { method: 'DELETE' });
    toast(`${team.name} deleted.`, 'ok');
    lastCtx?.rerender();
  } catch (err) {
    toastError(err);
  }
}

async function regenerateAll(ctx) {
  lastCtx = ctx;
  const n = state.teams.filter((t) => t.active).length;
  if (!n) return toast('Add teams first.', 'warn');
  const ok = await confirmDialog({
    title: 'New passwords for all teams',
    message: `This creates new passwords for all ${n} active teams so you can print credential slips. Every team’s old password stops working and they are signed out.`,
    confirmLabel: 'Generate passwords',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api('/admin/teams/passwords', { method: 'POST', body: {} });
    showCredentials(res.credentials, { title: 'New passwords', eventName: eventName() });
  } catch (err) {
    toastError(err);
  }
}

function importTeams(ctx) {
  lastCtx = ctx;
  formModal({
    title: 'Import teams',
    submitLabel: 'Import teams',
    wide: true,
    content: html`
      <p class="muted">Upload a CSV exported from Excel or Google Sheets. Only <span class="code-tag">team_name</span> is required. Team IDs and passwords are generated when left blank. Separate members with semicolons.</p>
      <p><button type="button" class="btn btn-sm" data-download="template">${icon('download')}Download template</button></p>
      <label class="drop" id="drop"><input type="file" id="csv-file" accept=".csv,text/csv" class="sr-only">
        <strong>Choose a CSV file</strong> or drop it here<br><span class="small faint" id="csv-name">Columns: team_name, leader_name, email, phone, members, track, table, team_id, password</span></label>
      <label class="field"><span>Or paste CSV</span><textarea class="textarea mono" name="csv" id="csv-text" rows="6" style="font-size:12px" placeholder="team_name,leader_name,members&#10;Null Pointers,Asha Rao,Asha Rao; Vikram S"></textarea></label>`,
    onMount(dlg) {
      const file = $('#csv-file', dlg);
      const drop = $('#drop', dlg);
      const load = async (f) => {
        if (!f) return;
        $('#csv-text', dlg).value = await f.text();
        $('#csv-name', dlg).textContent = `${f.name} loaded`;
      };
      file.addEventListener('change', () => load(file.files[0]));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); load(e.dataTransfer.files[0]); });
    },
    async onSubmit(v) {
      if (!v.csv.trim()) throw new Error('Choose a CSV file or paste the rows first.');
      const res = await api('/admin/teams/import', { method: 'POST', body: { csv: v.csv } });
      showCredentials(res.credentials, { title: `${res.credentials.length} teams imported`, eventName: eventName() });
      ctx.rerender();
    },
  });
}

