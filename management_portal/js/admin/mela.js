// Ideathon: Innovation Mela (12-13 Nov 2026, nasscom foundation x thingQbator with Amrita and IIC).
// Teams with the "Shortlisted for Innovation Mela" award, and outside teams added here, say whether they registered
// and give their 4 members' registered name, mobile number and email. Organisers see it all here and export it.
import { $, $$, api, html, setHTML, icon, toast, toastError, formModal, fmtDateTime, timeAgo, plural, downloadText } from '../core.js';
import { chip, empty, showCredentials } from './shared.js';

export const live = ['mela', 'teams', 'settings', 'results'];

const S = { q: '', tab: 'all' };
const statusOf = (t) => (!t.registration ? 'none' : t.registration.registered ? 'yes' : 'no');
const STATUS = {
  yes: () => chip('selected', 'Registered'),
  no: () => chip('eliminated', 'Not registered'),
  none: () => chip('upcoming', 'No answer yet'),
};

export async function render(ctx, params, seq) {
  const d = await api('/admin/mela');
  if (!ctx.isCurrent(seq)) return;
  const n = { all: d.teams.length, yes: 0, no: 0, none: 0 };
  for (const t of d.teams) n[statusOf(t)] += 1;
  const outside = d.teams.filter((t) => t.only).length;
  const q = S.q.trim().toLowerCase();
  const list = d.teams.filter((t) => (S.tab === 'all' || statusOf(t) === S.tab)
    && (!q || `${t.code} ${t.name} ${t.leader_name} ${(t.registration?.members || []).map((m) => `${m.name} ${m.mobile} ${m.email}`).join(' ')}`.toLowerCase().includes(q)));

  setHTML(
    ctx.main,
    html`<div data-mela-root>
    <div class="page-head">
      <div><h1 class="page-title">Innovation Mela</h1>
        <p>12–13 November 2026, by nasscom foundation and thingQbator with Amrita Vishwa Vidyapeetham, Coimbatore and IIC.
          Teams with the “Shortlisted for Innovation Mela” award (Results page), and outside teams you add here, get an Innovation Mela tab where they tell you whether they registered, with all 4 members’ details.</p></div>
      <div class="row">
        <button type="button" class="btn" data-mela-export ${d.teams.length ? '' : 'disabled'}>${icon('download')}Export CSV</button>
        <button type="button" class="btn btn-primary" data-mela-add>${icon('plus')}Add outside team</button>
      </div>
    </div>
    <div style="margin-bottom:16px">${d.enabled
      ? html`<div class="callout">${icon('check')}<span><strong>Teams can see the Innovation Mela tab.</strong> <button type="button" class="btn btn-sm" data-set="0">Turn it off</button></span></div>`
      : html`<div class="callout callout-warn">${icon('eyeOff')}<span><strong>The Innovation Mela tab is turned off.</strong> Teams don’t see it. <button type="button" class="btn btn-sm" data-set="1">Turn it on</button></span></div>`}</div>
    <div class="stats mela-stats">
      <div class="card stat"><b>${n.all}</b><span>${plural(n.all, 'team')}${outside ? ` · ${outside} outside` : ''}</span></div>
      <div class="card stat"><b>${n.yes}</b><span>Registered</span></div>
      <div class="card stat"><b>${n.no}</b><span>Not registered</span></div>
      <div class="card stat"><b>${n.none}</b><span>No answer yet</span></div>
    </div>
    <div class="toolbar">
      <label class="search"><span class="sr-only">Search</span>${icon('search')}<input class="input" id="mela-search" type="search" placeholder="Search team, name, mobile or email" value="${S.q}"></label>
      <div class="seg" role="group" aria-label="Show">
        ${[['all', 'All'], ['yes', 'Registered'], ['no', 'Not registered'], ['none', 'No answer']].map(([k, label]) =>
          html`<button type="button" data-tab="${k}" aria-pressed="${String(S.tab === k)}">${label} <span class="faint">${n[k]}</span></button>`)}
      </div>
    </div>
    <section class="card card-flush">
      ${list.length
        ? html`<div class="table-wrap"><table class="table mela-table">
            <thead><tr><th>Team</th><th>Status</th><th>Members (as registered)</th><th>Updated</th></tr></thead>
            <tbody>${list.map(row)}</tbody></table></div>`
        : empty(d.teams.length ? 'No teams match' : 'No teams yet',
            d.teams.length ? 'Try a different search or filter.' : 'Give teams the “Shortlisted for Innovation Mela” award on the Results page, or add outside teams here.')}
    </section>
    <p class="small muted" style="margin-top:12px">Outside teams sign in on the portal under <strong>Ideathon → Team leader</strong> and only see the Innovation Mela tab. Edit them, reset their password or turn them off on the <a href="#/teams">Teams</a> page.</p>
    </div>`
  );

  const root = $('[data-mela-root]', ctx.main);
  $('#mela-search', root).addEventListener('input', (e) => {
    S.q = e.target.value;
    ctx.rerender();
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) {
      S.tab = b.dataset.tab;
      ctx.rerender();
    } else if (b.dataset.set !== undefined) {
      try {
        await api('/admin/settings', { method: 'PUT', body: { mela_enabled: b.dataset.set === '1' } });
        toast(b.dataset.set === '1' ? 'Teams can now see Innovation Mela.' : 'Innovation Mela is hidden from teams.', 'ok');
        await ctx.refreshMeta();
        ctx.rerender();
      } catch (err) {
        toastError(err);
      }
    } else if (b.hasAttribute('data-mela-add')) {
      addOutsideTeam(ctx, d.next_code);
    } else if (b.hasAttribute('data-mela-export')) {
      exportCsv(d.teams);
    }
  });
}

function row(t) {
  const st = statusOf(t);
  const members = st === 'yes' ? t.registration.members : [];
  return html`<tr class="${t.active ? '' : 'is-dim'}">
    <td class="team-cell"><strong>${t.name}</strong><small>${t.code}${t.leader_name ? ` · ${t.leader_name}` : ''}${t.active ? '' : ' · disabled'}</small>
      ${t.only ? html`<span class="chip chip-pending chip-plain">Outside team</span>` : ''}</td>
    <td>${STATUS[st]()}</td>
    <td>${members.length
      ? html`<ol class="mela-list">${members.map((m) => html`<li><strong>${m.name}</strong><span class="mono">${m.mobile}</span><a href="mailto:${m.email}">${m.email}</a></li>`)}</ol>`
      : html`<span class="faint">${st === 'no' ? 'Said they haven’t registered' : '–'}</span>`}</td>
    <td class="small muted">${t.registration ? html`<span title="${fmtDateTime(t.registration.updated_at)}">${timeAgo(t.registration.updated_at)}</span>` : '–'}</td>
  </tr>`;
}

function addOutsideTeam(ctx, nextCode) {
  formModal({
    title: 'Add an outside team',
    submitLabel: 'Add team',
    wide: true,
    content: html`
      <p class="muted">For Innovation Mela participants who aren’t in Genesis. They get an Ideathon login that only shows the Innovation Mela tab.</p>
      <div class="form-grid">
        <label class="field"><span>Team name</span><input class="input" name="name" maxlength="80" required></label>
        <label class="field"><span>Team ID (login) <span class="hint">Leave blank for ${nextCode}</span></span><input class="input mono" name="code" maxlength="32" placeholder="${nextCode}" autocapitalize="characters" spellcheck="false"></label>
        <label class="field"><span>Team leader</span><input class="input" name="leader_name" maxlength="80"></label>
        <label class="field"><span>Leader phone</span><input class="input" name="phone" maxlength="30" inputmode="tel"></label>
        <label class="field"><span>Leader email</span><input class="input" name="email" type="email" maxlength="120"></label>
        <label class="field"><span>Password <span class="hint">Leave blank to generate one</span></span><input class="input mono" name="password" maxlength="100" autocomplete="off" spellcheck="false"></label>
        <label class="field span-2"><span>Members <span class="hint">Optional · one name per line, leader first</span></span><textarea class="textarea" name="members" rows="4"></textarea></label>
      </div>`,
    async onSubmit(v) {
      if (!v.name.trim()) throw new Error('Give the team a name.');
      v.members = v.members.split('\n').map((m) => m.trim()).filter(Boolean);
      const res = await api('/admin/mela/teams', { method: 'POST', body: v });
      showCredentials([{ ...res.team, password: res.password }], {
        title: 'Outside team added',
        intro: 'Passwords are shown only now. Share these privately: the team signs in under Ideathon → Team leader and only sees the Innovation Mela tab.',
      });
      ctx.rerender();
    },
  });
}

function exportCsv(teams) {
  const cell = (v) => {
    const s = String(v ?? '');
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [['team_id', 'team_name', 'team_type', 'registered', 'member', 'registered_name', 'mobile', 'email', 'updated_at']];
  for (const t of teams) {
    const st = statusOf(t);
    const reg = st === 'yes' ? 'yes' : st === 'no' ? 'no' : 'no answer';
    const type = t.only ? 'outside' : 'genesis';
    if (st === 'yes') t.registration.members.forEach((m, i) => rows.push([t.code, t.name, type, reg, i + 1, m.name, m.mobile, m.email, t.registration.updated_at]));
    else rows.push([t.code, t.name, type, reg, '', '', '', '', t.registration ? t.registration.updated_at : '']);
  }
  downloadText('genesis-innovation-mela.csv', '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
}
