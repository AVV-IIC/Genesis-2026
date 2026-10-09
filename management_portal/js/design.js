// Ideathon "Design Thinking": the 4-5-3 brainwriting sheet, shared by the team page and the organiser console.
// 4 members develop a base idea for about 5 minutes each, over 3 iterations, passing ideas along: 12 ideas.
// Sheet s in iteration i is written by member ((s - 1 + i - 1) mod 4) + 1, so in iterations 2 and 3 every member
// builds on the idea the previous member wrote. The timing is a guide only; nothing locks.
import { html, richText, fmtDateTime } from './core.js';

export const SHEETS = 4;
export const ITERATIONS = 3;
export const TOTAL = SHEETS * ITERATIONS;
export const MAX_TEXT = 1000;

/** Member number (1-4) who writes sheet s in iteration i. */
export const writer = (sheet, iteration) => ((sheet - 1 + iteration - 1) % SHEETS) + 1;
/** Sheet that member m writes on in iteration i. */
export const sheetFor = (member, iteration) => ((((member - 1) - (iteration - 1)) % SHEETS) + SHEETS) % SHEETS + 1;

/** The 4 writers' names: leader first (if not already listed), padded with "Member n". */
export function roster(leader, members) {
  const list = (members || []).map((m) => String(m).trim()).filter(Boolean);
  const lead = String(leader || '').trim();
  if (lead && !list.some((m) => m.toLowerCase() === lead.toLowerCase())) list.unshift(lead);
  return Array.from({ length: SHEETS }, (_, k) => list[k] || `Member ${k + 1}`);
}

export const cellKey = (iteration, sheet) => `${iteration}:${sheet}`;
export function cells(ideas) {
  return new Map((ideas || []).map((x) => [cellKey(x.iteration, x.sheet), x]));
}
export const filled = (x) => Boolean(x && String(x.body || '').trim());
export const countFilled = (ideas) => (ideas || []).filter(filled).length;

/** Read-only view of a whole sheet: the base idea, then 4 idea chains of 3 steps each. */
export function chainsHTML(sheet, names, { emptyText = 'Not written yet' } = {}) {
  const map = cells(sheet.ideas);
  const chain = (s) => html`<section class="dt-chain">
    <h3 class="dt-chain-head">Sheet ${s} <span>started by ${names[writer(s, 1) - 1]}</span></h3>
    <ol class="dt-steps">${Array.from({ length: ITERATIONS }, (_, k) => {
      const i = k + 1;
      const x = map.get(cellKey(i, s));
      return html`<li class="${filled(x) ? '' : 'is-empty'}">
        <span class="dt-step-meta"><b>Iteration ${i}</b> · ${names[writer(s, i) - 1]}</span>
        ${filled(x) ? html`<div class="dt-step-body">${richText(x.body)}</div>` : html`<p class="faint small">${emptyText}</p>`}
      </li>`;
    })}</ol>
  </section>`;
  return html`<div class="dt-base-view"><span class="label">Base idea</span>${sheet.base_idea ? html`<div>${richText(sheet.base_idea)}</div>` : html`<p class="faint">No base idea yet.</p>`}</div>
    <div class="dt-chains">${Array.from({ length: SHEETS }, (_, k) => chain(k + 1))}</div>
    ${sheet.updated_at ? html`<p class="small muted" style="margin-top:12px">Last saved ${fmtDateTime(sheet.updated_at)}</p>` : ''}`;
}

/** The method in four lines, for the team page and the organiser page. */
export const RULES = [
  ['Write the base idea', 'Agree on one starting idea as a team and write it in the box below.'],
  ['Iteration 1', 'All 4 members develop the base idea at the same time, each in their own box. About 5 minutes.'],
  ['Iterations 2 and 3', 'Pass it along: build on the idea the previous member wrote, shown above your box. About 5 minutes each.'],
  ['12 ideas', '4 members × 3 iterations. The 5 minutes is a guide, not a hard limit. Everything saves as you type.'],
];
