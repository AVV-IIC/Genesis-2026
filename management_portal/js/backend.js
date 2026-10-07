// Static-hosting backend: maps the site's REST-style calls onto the Supabase
// database functions (public.api_*), keeps the session token, and turns
// Supabase Realtime broadcasts into the same live events the Node server sends.
import { CONFIG } from './config.js';

export const STATIC = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseKey);
export const HOME = STATIC ? 'index.html' : '/';

// ---------- session ------------------------------------------------------------------
const KEY = 'genesis-session';
export const session = {
  get() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  },
  set(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  },
};
const token = () => (session.get() || {}).token || '';
export const hasSession = () => Boolean(token());

/** Static mode only: send people to the sign-in page if this page isn't theirs. */
export function guardPage(role) {
  if (!STATIC) return true;
  const s = session.get();
  if (!s || !s.token || (role && s.role !== role)) {
    location.replace('index.html');
    return false;
  }
  return true;
}

// ---------- Supabase client -----------------------------------------------------------
let clientPromise = null;
function client() {
  if (!clientPromise) {
    clientPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/supabase.js', import.meta.url).href;
      s.onload = () =>
        resolve(window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          realtime: { params: { eventsPerSecond: 5 } },
        }));
      s.onerror = () => reject(new Error('Couldn’t load the database client.'));
      document.head.append(s);
    });
  }
  return clientPromise;
}

export class BackendError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function rpc(fn, args = {}, { auth = true } = {}) {
  const sb = await client();
  const { data, error } = await sb.rpc(fn, auth ? { p_token: token(), ...args } : args);
  if (error) {
    const status = /^PT\d{3}$/.test(error.code || '') ? Number(error.code.slice(2)) : 0;
    if (!status && /fetch|network|Failed/i.test(error.message || '')) {
      throw new BackendError('Can’t reach the server. Check your connection and try again.', 0);
    }
    throw new BackendError(error.message || 'Something went wrong. Try again in a moment.', status || 500, error);
  }
  if (data && data.__error) throw new BackendError(data.__error, data.status || 400, data);
  return data;
}

// ---------- CSV (import/export happen in the browser in static mode) -------------------
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const HEADER_ALIASES = {
  name: ['team_name', 'team name', 'team', 'name'],
  leader_name: ['leader_name', 'leader name', 'team leader', 'leader', 'tl', 'tl name'],
  code: ['team_id', 'team id', 'login_id', 'login id', 'code', 'username'],
  password: ['password'],
  email: ['email', 'leader email', 'email id'],
  phone: ['phone', 'mobile', 'phone number', 'contact'],
  members: ['members', 'team members', 'member names'],
  track: ['track', 'theme', 'problem statement', 'domain'],
  table_no: ['table', 'table_no', 'table no', 'table number', 'seat'],
};

function csvToRows(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new BackendError('The CSV needs a header row and at least one team.', 400);
  if (rows.length > 501) throw new BackendError('Import up to 500 teams at a time.', 400);
  const cols = {};
  rows[0].forEach((h, i) => {
    const key = h.trim().toLowerCase();
    for (const [f, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(key) && cols[f] === undefined) cols[f] = i;
  });
  if (cols.name === undefined) throw new BackendError('The CSV needs a “team_name” column. Download the template to see the format.', 400);
  return rows.slice(1).map((r, i) => {
    const out = { line: i + 2 };
    for (const f of Object.keys(HEADER_ALIASES)) out[f] = cols[f] === undefined ? '' : (r[cols[f]] || '').trim();
    return out;
  });
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function saveFile(name, text, type) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

const TEMPLATE = [
  ['team_name', 'leader_name', 'email', 'phone', 'members', 'track', 'table', 'team_id', 'password'],
  ['Null Pointers', 'Asha Rao', 'asha@example.com', '9876543210', 'Asha Rao; Vikram S; Neha K; Arjun M', 'HealthTech', 'A1', '', ''],
  ['Byte Club', 'Rahul Verma', 'rahul@example.com', '9123456780', 'Rahul Verma; Priya D; Sam J', 'FinTech', 'A2', '', ''],
];

const statusFor = (round, res) =>
  res && res.status === 'eliminated' ? 'eliminated' : !round.is_elimination ? 'advanced' : res ? res.status : 'pending';

/** Downloads: teams / template / results / backup. */
export async function download(kind) {
  if (!STATIC) {
    const url = {
      teams: '/api/admin/teams/export.csv',
      template: '/api/admin/teams/template.csv',
      results: '/api/admin/export/results.csv',
      submissions: '/api/admin/export/submissions.csv',
      backup: '/api/admin/backup',
    }[kind];
    location.href = url;
    return;
  }
  if (kind === 'template') return saveFile('genesis-teams-template.csv', toCsv(TEMPLATE), 'text/csv');
  if (kind === 'backup') {
    const data = await rpc('api_admin_backup');
    return saveFile(`genesis-${data.competition || 'event'}-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(data, null, 2), 'application/json');
  }
  const ex = await rpc('api_admin_export');
  const comp = ex.competition || 'hackathon';
  if (kind === 'submissions') {
    const teamsById = new Map(ex.teams.map((t) => [t.id, t]));
    return saveFile('genesis-ideathon-submissions.csv', toCsv([
      ['team_id', 'team_name', 'leader_name', 'title', 'problem', 'solution', 'impact', 'deck_url', 'video_url', 'other_url', 'updated_at'],
      ...ex.submissions.map((s) => {
        const t = teamsById.get(s.team_id) || {};
        return [t.code, t.name, t.leader_name, s.title, s.problem, s.solution, s.impact, s.deck_url, s.video_url, s.extra_url, s.updated_at];
      }),
    ]), 'text/csv');
  }
  if (kind === 'results' && comp === 'ideathon') {
    const titles = new Map(ex.submissions.map((s) => [s.team_id, s.title]));
    const sorted = [...ex.teams].sort((a, b) => (a.award === '') - (b.award === '') || a.code.localeCompare(b.code));
    return saveFile('genesis-ideathon-results.csv', toCsv([
      ['team_id', 'team_name', 'leader_name', 'track', 'table', 'idea_title', 'award', 'note'],
      ...sorted.map((t) => [t.code, t.name, t.leader_name, t.track, t.table_no, titles.get(t.id) || '', t.award, t.result_note]),
    ]), 'text/csv');
  }
  if (kind === 'teams') {
    return saveFile(`genesis-${comp}-teams.csv`, toCsv([
      ['team_id', 'team_name', 'leader_name', 'email', 'phone', 'members', 'track', 'table', 'active', 'last_login'],
      ...ex.teams.map((t) => [t.code, t.name, t.leader_name, t.email, t.phone, (t.members || []).join('; '), t.track, t.table_no, t.active ? 'yes' : 'no', t.last_login_at || '']),
    ]), 'text/csv');
  }
  // results
  const teams = new Map(ex.teams.map((t) => [t.id, t]));
  const res = new Map(ex.results.map((r) => [`${r.team_id}:${r.round_id}`, r]));
  const header = ['rank', 'team_id', 'team_name', 'leader_name', 'track', 'table'];
  for (const r of ex.rounds) header.push(`r${r.number}_total (/${r.max_total})`, `r${r.number}_status`, `r${r.number}_comments`, `r${r.number}_award`);
  header.push('cumulative_total', 'eliminated_in_round');
  const rows = ex.leaderboard.rows.map((row) => {
    const t = teams.get(row.team_id);
    const cells = [row.rank, t.code, t.name, t.leader_name, t.track, t.table_no];
    for (const r of ex.rounds) {
      const rr = res.get(`${t.id}:${r.id}`);
      const tot = row.rounds.find((x) => x.round === r.number);
      const reached = row.eliminated_in === null || r.number <= row.eliminated_in;
      cells.push(tot ? tot.total ?? '' : '', reached ? statusFor(r, rr) : '', rr ? rr.comments : '', rr ? rr.award : '');
    }
    cells.push(row.total ?? '', row.eliminated_in ?? '');
    return cells;
  });
  saveFile('genesis-hackathon-results.csv', toCsv([header, ...rows]), 'text/csv');
}

// ---------- REST-style path -> database function ------------------------------------------
const n = Number;
const ROUTES = [
  ['POST', /^\/auth\/login$/, async (m, b) => {
    const res = await rpc('api_login', { p_competition: b.competition, p_role: b.role, p_username: b.username, p_password: b.password }, { auth: false });
    session.set({ token: res.token, role: res.role, competition: res.competition });
    return { ok: true, role: res.role, competition: res.competition, redirect: { admin: 'admin.html', judge: 'judge.html' }[res.role] || 'team.html' };
  }],
  ['POST', /^\/auth\/logout$/, async () => {
    try { await rpc('api_logout'); } finally { session.clear(); }
    return { ok: true };
  }],
  ['GET', /^\/auth\/me$/, () => rpc('api_me')],
  ['POST', /^\/auth\/password$/, (m, b) => rpc('api_change_password', { p_body: b })],
  ['GET', /^\/public\/info$/, () => rpc('api_public_info', {}, { auth: false })],

  ['GET', /^\/team\/overview$/, () => rpc('api_team_overview')],
  ['GET', /^\/team\/announcements$/, () => rpc('api_team_announcements')],
  ['POST', /^\/team\/announcements\/seen$/, () => rpc('api_team_announcements_seen')],
  ['GET', /^\/team\/schedule$/, () => rpc('api_team_schedule')],
  ['GET', /^\/team\/leaderboard$/, () => rpc('api_team_leaderboard')],
  ['GET', /^\/team\/tickets$/, () => rpc('api_team_tickets')],
  ['POST', /^\/team\/tickets$/, (m, b) => rpc('api_team_ticket_create', { p_body: b })],
  ['GET', /^\/team\/tickets\/(\d+)$/, (m) => rpc('api_team_ticket', { p_id: n(m[1]) })],
  ['POST', /^\/team\/tickets\/(\d+)\/messages$/, (m, b) => rpc('api_team_ticket_reply', { p_id: n(m[1]), p_body: b })],
  ['GET', /^\/team\/submission$/, () => rpc('api_team_submission')],
  ['PUT', /^\/team\/submission$/, (m, b) => rpc('api_team_submission_save', { p_body: b })],

  ['GET', /^\/judge\/overview$/, () => rpc('api_judge_overview')],
  ['GET', /^\/judge\/rounds\/(\d+)$/, (m) => rpc('api_judge_round', { p_round: n(m[1]) })],
  ['PUT', /^\/judge\/rounds\/(\d+)\/teams\/(\d+)$/, (m, b) => rpc('api_judge_save', { p_round: n(m[1]), p_team: n(m[2]), p_body: b })],
  ['GET', /^\/judge\/announcements$/, () => rpc('api_judge_announcements')],
  ['POST', /^\/judge\/announcements\/seen$/, () => rpc('api_judge_announcements_seen')],
  ['GET', /^\/judge\/schedule$/, () => rpc('api_judge_schedule')],

  ['GET', /^\/admin\/meta$/, () => rpc('api_admin_meta')],
  ['GET', /^\/admin\/dashboard$/, () => rpc('api_admin_dashboard')],
  ['GET', /^\/admin\/settings$/, () => rpc('api_admin_settings')],
  ['PUT', /^\/admin\/settings$/, (m, b) => rpc('api_admin_settings_save', { p_body: b })],
  ['GET', /^\/admin\/admins$/, () => rpc('api_admin_admins')],
  ['PUT', /^\/admin\/admins\/(\d+)$/, (m, b) => rpc('api_admin_admin_rename', { p_id: n(m[1]), p_body: b })],
  ['POST', /^\/admin\/admins\/(\d+)\/password$/, (m) => rpc('api_admin_admin_password', { p_id: n(m[1]) })],

  ['GET', /^\/admin\/teams$/, () => rpc('api_admin_teams')],
  ['POST', /^\/admin\/teams$/, (m, b) => rpc('api_admin_team_create', { p_body: b })],
  ['POST', /^\/admin\/teams\/import$/, (m, b) => rpc('api_admin_teams_import', { p_rows: csvToRows(b.csv || '') })],
  ['POST', /^\/admin\/teams\/passwords$/, (m, b) => rpc('api_admin_teams_passwords', { p_body: b })],
  ['PUT', /^\/admin\/teams\/(\d+)$/, (m, b) => rpc('api_admin_team_update', { p_id: n(m[1]), p_body: b })],
  ['DELETE', /^\/admin\/teams\/(\d+)$/, (m) => rpc('api_admin_team_delete', { p_id: n(m[1]) })],
  ['POST', /^\/admin\/teams\/(\d+)\/password$/, (m, b) => rpc('api_admin_team_password', { p_id: n(m[1]), p_body: b })],

  ['GET', /^\/admin\/rounds$/, () => rpc('api_admin_rounds')],
  ['PUT', /^\/admin\/rounds\/(\d+)$/, (m, b) => rpc('api_admin_round_update', { p_id: n(m[1]), p_body: b })],
  ['POST', /^\/admin\/rounds\/(\d+)\/criteria$/, (m, b) => rpc('api_admin_criterion_create', { p_round: n(m[1]), p_body: b })],
  ['PUT', /^\/admin\/criteria\/(\d+)$/, (m, b) => rpc('api_admin_criterion_update', { p_id: n(m[1]), p_body: b })],
  ['DELETE', /^\/admin\/criteria\/(\d+)$/, (m) => rpc('api_admin_criterion_delete', { p_id: n(m[1]) })],
  ['GET', /^\/admin\/rounds\/(\d+)\/sheet$/, (m) => rpc('api_admin_sheet', { p_round: n(m[1]) })],
  ['GET', /^\/admin\/rounds\/(\d+)\/sheet\/(\d+)$/, (m) => rpc('api_admin_sheet_row', { p_round: n(m[1]), p_team: n(m[2]) })],
  ['GET', /^\/admin\/rounds\/(\d+)\/sheet\/(\d+)\/judges$/, (m) => rpc('api_admin_sheet_judges', { p_round: n(m[1]), p_team: n(m[2]) })],
  ['GET', /^\/admin\/rounds\/(\d+)\/assignments$/, (m) => rpc('api_admin_assignments', { p_round: n(m[1]) })],
  ['PUT', /^\/admin\/rounds\/(\d+)\/assignments$/, (m, b) => rpc('api_admin_assignments_save', { p_round: n(m[1]), p_body: b })],
  ['PUT', /^\/admin\/rounds\/(\d+)\/sheet\/(\d+)$/, (m, b) => rpc('api_admin_sheet_save', { p_round: n(m[1]), p_team: n(m[2]), p_body: b })],
  ['POST', /^\/admin\/rounds\/(\d+)\/auto-select$/, (m, b) => rpc('api_admin_auto_select', { p_round: n(m[1]), p_body: b })],
  ['POST', /^\/admin\/rounds\/(\d+)\/publish$/, (m, b) => rpc('api_admin_publish', { p_round: n(m[1]), p_body: b })],
  ['GET', /^\/admin\/leaderboard$/, () => rpc('api_admin_leaderboard')],

  ['GET', /^\/admin\/judges$/, () => rpc('api_admin_judges')],
  ['POST', /^\/admin\/judges$/, (m, b) => rpc('api_admin_judge_create', { p_body: b })],
  ['PUT', /^\/admin\/judges\/(\d+)$/, (m, b) => rpc('api_admin_judge_update', { p_id: n(m[1]), p_body: b })],
  ['DELETE', /^\/admin\/judges\/(\d+)$/, (m) => rpc('api_admin_judge_delete', { p_id: n(m[1]) })],
  ['POST', /^\/admin\/judges\/(\d+)\/password$/, (m) => rpc('api_admin_judge_password', { p_id: n(m[1]) })],

  ['GET', /^\/admin\/submissions$/, () => rpc('api_admin_submissions')],
  ['GET', /^\/admin\/results$/, () => rpc('api_admin_results')],
  ['PUT', /^\/admin\/results\/(\d+)$/, (m, b) => rpc('api_admin_result_save', { p_team: n(m[1]), p_body: b })],
  ['POST', /^\/admin\/results\/publish$/, (m, b) => rpc('api_admin_results_publish', { p_body: b })],

  ['GET', /^\/admin\/announcements$/, () => rpc('api_admin_announcements')],
  ['POST', /^\/admin\/announcements$/, (m, b) => rpc('api_admin_announcement_create', { p_body: b })],
  ['PUT', /^\/admin\/announcements\/(\d+)$/, (m, b) => rpc('api_admin_announcement_update', { p_id: n(m[1]), p_body: b })],
  ['DELETE', /^\/admin\/announcements\/(\d+)$/, (m) => rpc('api_admin_announcement_delete', { p_id: n(m[1]) })],

  ['GET', /^\/admin\/tickets$/, () => rpc('api_admin_tickets')],
  ['GET', /^\/admin\/tickets\/(\d+)$/, (m) => rpc('api_admin_ticket', { p_id: n(m[1]) })],
  ['POST', /^\/admin\/tickets\/(\d+)\/messages$/, (m, b) => rpc('api_admin_ticket_reply', { p_id: n(m[1]), p_body: b })],
  ['PUT', /^\/admin\/tickets\/(\d+)$/, (m, b) => rpc('api_admin_ticket_status', { p_id: n(m[1]), p_body: b })],

  ['GET', /^\/admin\/schedule$/, () => rpc('api_admin_schedule')],
  ['POST', /^\/admin\/schedule$/, (m, b) => rpc('api_admin_schedule_create', { p_body: b })],
  ['PUT', /^\/admin\/schedule\/(\d+)$/, (m, b) => rpc('api_admin_schedule_update', { p_id: n(m[1]), p_body: b })],
  ['DELETE', /^\/admin\/schedule\/(\d+)$/, (m) => rpc('api_admin_schedule_delete', { p_id: n(m[1]) })],

  ['POST', /^\/admin\/reset$/, (m, b) => rpc('api_admin_reset', { p_body: b })],
];

export async function request(method, path, body) {
  for (const [verb, re, fn] of ROUTES) {
    if (verb !== method) continue;
    const m = re.exec(path);
    if (m) return fn(m, body || {});
  }
  throw new BackendError(`Not available: ${method} ${path}`, 404);
}

// ---------- live updates ----------------------------------------------------------------------
/**
 * Same contract as the Node server's event stream: handlers[type](data), plus
 * handlers.reconnect() after a gap. Falls back to periodic refresh if Realtime
 * isn't reachable.
 */
export async function live(handlers, indicators) {
  // Without Realtime the page still refreshes itself, so say so rather than
  // looking broken.
  const setState = (on) => {
    for (const el of indicators) {
      el.classList.toggle('is-on', on);
      el.textContent = on ? 'Live' : 'Auto-refresh';
      el.title = on ? 'Updates appear instantly' : 'Checking for updates every 45 seconds';
    }
  };
  let me = null;
  try { me = (await rpc('api_me')).user; } catch { /* page handles auth errors */ }
  // Targets: all | comp:<c> | admins:<c> | teams:<c> | team:<id> | judges | competing
  const matches = (target) => {
    if (!target || target === 'all') return true;
    if (!me) return false;
    const [kind, value] = String(target).split(':');
    switch (kind) {
      case 'comp': return me.competition === value;
      case 'admins': return me.role === 'admin' && me.competition === value;
      case 'teams': return me.role === 'team' && me.competition === value;
      case 'team': return me.role === 'team' && Number(value) === Number(me.id);
      case 'judges': return me.role === 'judge';
      case 'competing': return me.role === 'team' && me.competition === 'hackathon';
      default: return false;
    }
  };

  let connected = false;
  let wasDown = false;
  let poll = null;
  const startPolling = () => {
    if (!poll) poll = setInterval(() => handlers.reconnect?.(), 45000);
  };
  const stopPolling = () => { clearInterval(poll); poll = null; };

  try {
    const sb = await client();
    const channel = sb.channel('genesis');
    channel.on('broadcast', { event: 'change' }, ({ payload }) => {
      const { type, target, data } = payload || {};
      if (!type || !matches(target)) return;
      const h = handlers[type];
      if (h) h(data || {});
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        connected = true;
        setState(true);
        stopPolling();
        if (wasDown) handlers.reconnect?.();
        wasDown = false;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        connected = false;
        wasDown = true;
        setState(false);
        startPolling();
      }
    });
  } catch {
    setState(false);
    startPolling();
  }
  setTimeout(() => { if (!connected) { setState(false); startPolling(); } }, 8000);
  // Safety net: even while live, refresh occasionally in case a signal was missed.
  setInterval(() => { if (connected && document.visibilityState === 'visible') handlers.reconnect?.(); }, 180000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handlers.reconnect?.();
  });
}
