// Pieces shared by the team and judge portals: announcement cards, the
// schedule timeline and the urgent-announcement bar.
import { $, html, setHTML, icon, clock, richText, timeAgo, fmtTime, fmtDayLong, dayKey, PRIORITY_LABEL } from './core.js';

export const chip = (kind, label) => html`<span class="chip chip-${kind}">${label}</span>`;
export const empty = (title, text, action = '') => html`<div class="empty"><h3>${title}</h3><p>${text}</p>${action}</div>`;

export function annItem(a, { compact = false, isNew = false } = {}) {
  return html`<article class="ann ann-${a.priority}${compact ? ' ann-compact' : ''}${isNew ? ' is-new' : ''}">
    <div class="ann-head">
      ${a.pinned ? html`<span class="pin" title="Pinned">${icon('pin')}</span>` : ''}
      ${a.priority !== 'normal' ? chip(a.priority, PRIORITY_LABEL[a.priority]) : ''}
      ${isNew ? chip('new', 'New') : ''}
      <h3>${a.title}</h3>
    </div>
    ${a.body ? html`<div class="ann-body">${compact && a.body.length > 220 ? a.body.slice(0, 220) + '…' : richText(a.body)}</div>` : ''}
    <div class="ann-meta"><span>${timeAgo(a.created_at)}</span>${a.author ? html`<span>· ${a.author}</span>` : ''}${a.updated_at ? html`<span>· edited</span>` : ''}</div>
  </article>`;
}

/** Urgent bar under the header for an unseen urgent announcement. */
export function urgentBar(host, a, onDismiss) {
  if (!a) return setHTML(host, '');
  setHTML(
    host,
    html`<div class="urgent-bar" role="alert"><div class="wrap-bar">${icon('alert')}<span>Urgent: ${a.title}</span>
      <a href="#/announcements">Read it</a>
      <button type="button" class="icon-btn" data-dismiss aria-label="Dismiss">${icon('x')}</button></div></div>`
  );
  $('[data-dismiss]', host).addEventListener('click', () => {
    onDismiss(a.id);
    setHTML(host, '');
  });
}

const KIND_LABEL = { round: 'Round', deadline: 'Deadline', food: 'Food', talk: 'Talk' };
const KIND_CHIP = { round: 'judging', deadline: 'eliminated', food: 'advanced', talk: 'pending' };

export function timeline(items) {
  const now = clock.now();
  const groups = new Map();
  for (const e of items) {
    const k = dayKey(e.starts_at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  let nextMarked = false;
  return html`<div class="timeline">${[...groups.values()].map(
    (list) => html`<section class="tl-day"><h2>${fmtDayLong(list[0].starts_at)}</h2><ol class="tl-items">${list.map((e) => {
      const start = Date.parse(e.starts_at);
      const end = e.ends_at ? Date.parse(e.ends_at) : start + 15 * 60000;
      const state = end < now ? 'is-past' : start <= now ? 'is-now' : '';
      let tag = '';
      if (state === 'is-now') tag = chip('live', 'Happening now');
      else if (!state && !nextMarked) {
        nextMarked = true;
        tag = chip('open', 'Up next');
      }
      return html`<li class="tl-item ${state} kind-${e.kind}">
        <span class="tl-time">${fmtTime(e.starts_at)}${e.ends_at ? html`<br><span class="faint">– ${fmtTime(e.ends_at)}</span>` : ''}</span>
        <div class="tl-body"><h3>${e.title}</h3>${e.details ? html`<p>${e.details}</p>` : ''}
          <div class="row">${tag}${KIND_LABEL[e.kind] ? chip(KIND_CHIP[e.kind], KIND_LABEL[e.kind]) : ''}${e.location ? html`<span class="small muted">${e.location}</span>` : ''}</div></div>
      </li>`;
    })}</ol></section>`
  )}</div>`;
}
