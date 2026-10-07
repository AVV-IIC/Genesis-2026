// Bits shared by several organiser views.
import { $, html, setHTML, icon, openModal, copyText, downloadText, esc, COMP_LABEL } from '../core.js';

export const chip = (kind, label) => html`<span class="chip chip-${kind}">${label}</span>`;
export const empty = (title, text, action = '') => html`<div class="empty"><h3>${title}</h3><p>${text}</p>${action}</div>`;

// Which competition this console runs (set by main.js once /admin/meta loads).
export const scope = { comp: 'hackathon', eventName: 'Genesis' };

/** Sign-in page address; the #hackathon / #ideathon hash preselects the competition. */
export function portalUrl(comp = scope.comp) {
  const base = new URL('./', location.href).href.replace(/\/$/, '');
  return `${base}/#${comp}`;
}

const signInHint = (c) =>
  c.judge ? `Choose “${COMP_LABEL.hackathon}”, then “Judge”.` : `Choose “${COMP_LABEL[scope.comp]}”, then “Team leader”.`;

function credentialsCsv(creds) {
  const judges = creds.some((c) => c.judge);
  const rows = judges
    ? [['judge_id', 'judge_name', 'password', 'portal']]
    : [['team_id', 'team_name', 'leader_name', 'table', 'password', 'portal']];
  for (const c of creds) {
    rows.push(judges ? [c.code, c.name, c.password, portalUrl('hackathon')] : [c.code, c.name, c.leader_name || '', c.table_no || '', c.password, portalUrl()]);
  }
  return '﻿' + rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
}

export function printSlips(creds, eventName = scope.eventName) {
  const area = $('#print-area');
  setHTML(
    area,
    creds.map(
      (c) => html`<div class="slip">
        <img src="img/logo-sm.png" alt="">
        <div><h3>${eventName}</h3>
        <div class="team">${c.judge ? `${c.name} · Judge` : `${c.name}${c.table_no ? ` · Table ${c.table_no}` : ''}`}</div>
        <dl><dt>Portal</dt><dd>${portalUrl(c.judge ? 'hackathon' : scope.comp)}</dd><dt>${c.judge ? 'Judge ID' : 'Team ID'}</dt><dd>${c.code}</dd><dt>Password</dt><dd>${c.password}</dd></dl></div>
        <small>${c.judge ? '' : `Team leader${c.leader_name ? `: ${c.leader_name}` : ''}. `}${signInHint(c)} Keep this slip private.</small>
      </div>`
    )
  );
  window.print();
}

/** Shows freshly generated passwords once, with copy / CSV / print. */
export function showCredentials(creds, { title = 'Login details', eventName = scope.eventName, intro } = {}) {
  const single = creds.length === 1 ? creds[0] : null;
  const judge = creds.some((c) => c.judge);
  const idLabel = judge ? 'Judge ID' : 'Team ID';
  openModal({
    title,
    wide: !single,
    form: false,
    content: html`
      <div class="callout callout-warn">${icon('alert')}<span>${intro || 'Passwords are shown only now. Print the slips or download the CSV before closing this window. You can always reset a password later.'}</span></div>
      ${single
        ? html`<dl class="cred">
            <dt>${judge ? 'Judge' : 'Team'}</dt><dd style="color:var(--text);font-family:var(--f-body)">${single.name}</dd><span></span>
            <dt>${idLabel}</dt><dd>${single.code}</dd><button type="button" class="icon-btn" data-copy="${single.code}" aria-label="Copy ${idLabel}">${icon('copy')}</button>
            <dt>Password</dt><dd>${single.password}</dd><button type="button" class="icon-btn" data-copy="${single.password}" aria-label="Copy password">${icon('copy')}</button>
          </dl>
          <p class="small muted">${signInHint(single)}</p>`
        : html`<div class="table-wrap" style="max-height:46vh"><table class="table">
            <thead><tr><th>${idLabel}</th><th>${judge ? 'Judge' : 'Team'}</th>${judge ? '' : html`<th>Leader</th>`}<th>Password</th></tr></thead>
            <tbody>${creds.map((c) => html`<tr><td><span class="code-tag">${c.code}</span></td><td>${c.name}</td>${judge ? '' : html`<td class="muted">${c.leader_name || '–'}</td>`}<td class="mono">${c.password}</td></tr>`)}</tbody>
          </table></div>`}`,
    footer: html`
      ${single ? html`<button type="button" class="btn" data-copy-all>${icon('copy')}Copy all</button>` : ''}
      <button type="button" class="btn" data-csv>${icon('download')}Download CSV</button>
      <button type="button" class="btn" data-print>${icon('printer')}Print ${single ? 'slip' : 'slips'}</button>
      <button type="button" class="btn btn-primary" data-close>Done</button>`,
    onMount(dlg) {
      dlg.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
      dlg.querySelector('[data-copy-all]')?.addEventListener('click', () =>
        copyText(`${eventName}\nPortal: ${portalUrl(single.judge ? 'hackathon' : scope.comp)}\n${idLabel}: ${single.code}\nPassword: ${single.password}\n${signInHint(single)}`)
      );
      dlg.querySelector('[data-csv]').addEventListener('click', () => downloadText(`genesis-${judge ? 'judge' : scope.comp}-credentials-${Date.now()}.csv`, credentialsCsv(creds)));
      dlg.querySelector('[data-print]').addEventListener('click', () => printSlips(creds, eventName));
    },
  });
}

export const teamLabel = (t) => `${t.code} · ${t.name}`;
export const escAttr = esc;
