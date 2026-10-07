// Genesis Ideathon Teams: loads the team list from Supabase and renders search, cards, table and a single-team spotlight.
(() => {
  'use strict';

  const cfg = window.GENESIS_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const els = {
    q: $('#q'),
    sort: $('#sort'),
    results: $('#results'),
    count: $('#count'),
    updated: $('#updated'),
    toast: $('#toast'),
  };
  const state = { teams: [], q: '', sort: 'id', view: 'cards', loaded: false };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  };

  // ---- display clean-up (the stored data is left exactly as entered) ----
  function cleanRoll(v) {
    let s = String(v || '').trim();
    const at = s.indexOf('@');
    if (at > 0) s = s.slice(0, at); // someone typed their email in the roll field
    return s.toUpperCase().replace(/\s*\.\s*/g, '.').replace(/\s+/g, '.');
  }
  function cleanName(v) {
    const s = String(v || '').trim().replace(/\s+/g, ' ');
    if (!s || (s !== s.toUpperCase() && s !== s.toLowerCase())) return s; // mixed case: keep as typed
    return s.toLowerCase().replace(/(^|[\s.\-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }
  // Search ignores case, spaces, dots and dashes, so "cb.en.u4" finds "CB. EN. U4".
  const norm = (v) => String(v || '').toLowerCase().replace(/@.*$/, '').replace(/[\s.\-_]+/g, '');

  function toTeam(r) {
    const people = [{ role: 'Team leader', name: cleanName(r.tl_name), roll: cleanRoll(r.tl_roll), lead: true }];
    for (const n of [1, 2, 3]) {
      const name = cleanName(r[`m${n}_name`]);
      const roll = cleanRoll(r[`m${n}_roll`]);
      if (name || roll) people.push({ role: `Member ${n}`, name, roll, lead: false });
    }
    const id = String(r.team_id || '').trim();
    const name = String(r.team_name || '').trim();
    const hay = [id, name, ...people.flatMap((p) => [p.name, p.roll])].map(norm).join('|');
    return { id, name, people, updated: r.updated_at || null, hay };
  }

  // ---- markup helpers ----
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  function hi(text, q) {
    const s = String(text || '');
    const needle = q.trim();
    if (!needle) return esc(s);
    const i = s.toLowerCase().indexOf(needle.toLowerCase());
    if (i < 0) return esc(s);
    return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + needle.length)) + '</mark>' + esc(s.slice(i + needle.length));
  }
  const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const copyBtn = (id) => `<button type="button" class="copy" data-copy="${esc(id)}" aria-label="Copy Team ID ${esc(id)}" title="Copy Team ID">${ICON_COPY}</button>`;
  const teamName = (t, q) => hi(t.name || 'Unnamed team', q);

  function rosterHTML(t, q) {
    return '<ul class="roster">' + t.people.map((p) =>
      `<li${p.lead ? ' class="is-lead"' : ''}><span class="role">${p.role}</span>` +
      `<span class="pname">${hi(p.name || '—', q)}</span>` +
      (p.roll ? `<span class="proll">${hi(p.roll, q)}</span>` : '') + '</li>'
    ).join('') + '</ul>';
  }
  function cardHTML(t, q) {
    return `<article class="card"><div class="card-head"><span class="tid">${hi(t.id, q)}</span>${copyBtn(t.id)}</div>` +
      `<h2 class="team-name">${teamName(t, q)}</h2>${rosterHTML(t, q)}</article>`;
  }
  function spotHTML(t, q) {
    return `<article class="spot" aria-label="Team ${esc(t.id)}">` +
      `<div class="spot-head"><div><p class="spot-eyebrow">Team found</p><p class="spot-id">${esc(t.id)}</p>` +
      `<h2 class="spot-name">${teamName(t, q)}</h2></div>` +
      `<button type="button" class="btn-copy" data-copy="${esc(t.id)}">${ICON_COPY}<span>Copy Team ID</span></button></div>` +
      `${rosterHTML(t, q)}</article>` +
      '<p class="spot-foot"><button type="button" class="link" data-clear>Show all teams</button></p>';
  }
  function tableHTML(list, q) {
    const cell = (p) => p
      ? `<span class="pname">${hi(p.name || '—', q)}</span>` + (p.roll ? `<span class="proll">${hi(p.roll, q)}</span>` : '')
      : '<span class="faint">—</span>';
    const rows = list.map((t) => {
      const member = (n) => t.people.find((p) => p.role === `Member ${n}`);
      return `<tr><td><span class="tid">${hi(t.id, q)}</span></td><td class="tname">${teamName(t, q)}</td>` +
        `<td>${cell(t.people[0])}</td><td>${cell(member(1))}</td><td>${cell(member(2))}</td><td>${cell(member(3))}</td>` +
        `<td class="tcopy">${copyBtn(t.id)}</td></tr>`;
    }).join('');
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th scope="col">Team ID</th><th scope="col">Team name</th><th scope="col">Team leader</th>' +
      '<th scope="col">Member 1</th><th scope="col">Member 2</th><th scope="col">Member 3</th>' +
      '<th scope="col"><span class="sr-only">Copy</span></th>' +
      `</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---- filter, sort, render ----
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  function visible() {
    const nq = norm(state.q);
    const list = nq ? state.teams.filter((t) => t.hay.includes(nq)) : state.teams.slice();
    if (state.sort === 'name') list.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id));
    else list.sort((a, b) => collator.compare(a.id, b.id));
    return list;
  }

  function render() {
    if (!state.loaded) return;
    const q = state.q;
    const shown = q.trim();
    const total = state.teams.length;
    if (!total) {
      els.count.textContent = 'No teams yet';
      els.results.innerHTML = '<div class="state"><h2>No teams published yet</h2><p>The team list will appear here once it is added.</p></div>';
      return;
    }
    const list = visible();
    if (!list.length) {
      els.results.innerHTML = `<div class="state"><h2>No teams found</h2><p>Nothing matches “${esc(shown)}”. Check the spelling, or search by roll number.</p>` +
        '<button type="button" class="btn-ghost" data-clear>Clear search</button></div>';
    } else if (shown && list.length === 1) {
      els.results.innerHTML = spotHTML(list[0], q);
    } else if (state.view === 'table') {
      els.results.innerHTML = tableHTML(list, q);
    } else {
      els.results.innerHTML = `<div class="grid">${list.map((t) => cardHTML(t, q)).join('')}</div>`;
    }
    els.count.innerHTML = shown
      ? `<b>${list.length}</b> ${list.length === 1 ? 'team matches' : 'teams match'} “${esc(shown)}”`
      : `Showing all <b>${total}</b> teams`;
  }

  const fmtDate = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
  function renderStats() {
    const teams = state.teams;
    const sizes = teams.map((t) => t.people.length);
    const people = sizes.reduce((a, b) => a + b, 0);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    $('#st-teams').textContent = teams.length.toLocaleString('en-IN');
    $('#st-people').textContent = people.toLocaleString('en-IN');
    $('#st-size').textContent = !teams.length ? '—' : min === max ? String(max) : `${min}–${max}`;
    const latest = teams.map((t) => t.updated).filter(Boolean).sort().pop();
    const d = latest ? new Date(latest) : null;
    els.updated.textContent = d && !Number.isNaN(d.getTime()) ? `Updated ${fmtDate.format(d)} IST` : '';
  }

  function skeleton() {
    els.results.innerHTML = '<div class="grid" aria-hidden="true">' + '<div class="skel"></div>'.repeat(9) + '</div>';
  }
  function showError() {
    els.count.textContent = 'Could not load teams';
    els.results.innerHTML = '<div class="state"><h2>Couldn’t load the team list</h2>' +
      '<p>Check your internet connection and try again.</p>' +
      '<button type="button" class="btn-ghost" data-retry>Try again</button></div>';
  }

  const COLS = 'team_id,team_name,tl_name,tl_roll,m1_name,m1_roll,m2_name,m2_roll,m3_name,m3_roll,updated_at';
  async function load() {
    skeleton();
    els.count.textContent = 'Loading teams…';
    try {
      const url = `${cfg.supabaseUrl}/rest/v1/${cfg.table}?select=${COLS}&order=team_id.asc`;
      const res = await fetch(url, { headers: { apikey: cfg.supabaseKey }, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      state.teams = rows.map(toTeam).filter((t) => t.id);
      state.loaded = true;
      renderStats();
      render();
    } catch (err) {
      console.error('Genesis teams: could not load the team list', err);
      showError();
    }
  }

  // ---- copy + toast ----
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2000);
  }
  async function copyId(id, btn) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(id);
      ok = true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = id;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    toast(ok ? `Copied ${id}` : `Team ID: ${id}`);
    if (!ok || !btn) return;
    const label = btn.querySelector('span');
    btn.classList.add('copied');
    btn.querySelector('svg').outerHTML = ICON_CHECK;
    if (label) label.textContent = 'Copied';
    setTimeout(() => {
      btn.classList.remove('copied');
      const svg = btn.querySelector('svg');
      if (svg) svg.outerHTML = ICON_COPY;
      if (label) label.textContent = 'Copy Team ID';
    }, 1600);
  }

  // ---- events ----
  let urlTimer;
  function syncURL() {
    const q = state.q.trim();
    try { history.replaceState(null, '', q ? `${location.pathname}?q=${encodeURIComponent(q)}` : location.pathname); } catch { /* ignore */ }
  }
  function setQuery(v) {
    els.q.value = v;
    state.q = v;
    render();
    clearTimeout(urlTimer);
    urlTimer = setTimeout(syncURL, 300);
  }
  function setView(v) {
    state.view = v === 'table' ? 'table' : 'cards';
    $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    store.set('gi-view', state.view);
    render();
  }

  els.q.addEventListener('input', () => setQuery(els.q.value));
  els.sort.addEventListener('change', () => {
    state.sort = els.sort.value;
    store.set('gi-sort', state.sort);
    render();
  });
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  els.results.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { copyId(c.dataset.copy, c); return; }
    if (e.target.closest('[data-clear]')) { setQuery(''); els.q.focus(); return; }
    if (e.target.closest('[data-retry]')) load();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    e.preventDefault();
    els.q.focus();
    els.q.select();
  });

  // ---- start ----
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { els.q.value = q0; state.q = q0; }
  const savedSort = store.get('gi-sort');
  if (savedSort === 'id' || savedSort === 'name') { state.sort = savedSort; els.sort.value = savedSort; }
  setView(store.get('gi-view') || 'cards');

  if (!cfg.supabaseUrl || !cfg.supabaseKey || !cfg.table) showError();
  else load();
})();
