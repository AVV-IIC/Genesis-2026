// HTTP tests for the Node (laptop) server: upgrade from the old version, then
// Hackathon + Ideathon + judges. Usage: node tests/node.test.mjs [oldServerDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = process.argv[2]; // optional checkout of the previous version for the upgrade test
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-node-test-'));
const PORT = 3990;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let failN = 0;
const ok = (c, msg, extra) => {
  if (c) pass++;
  else {
    failN++;
    console.log('  FAIL:', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : '');
  }
};

function start(dir) {
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: dir,
    env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), TRUST_PROXY: '0', ADMIN1_PASSWORD: 'hack-admin-1', ADMIN2_PASSWORD: 'hack-admin-2', IDEA_ADMIN1_PASSWORD: 'idea-admin-1', IDEA_ADMIN2_PASSWORD: 'idea-admin-2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  proc.log = () => log;
  return proc;
}
async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await sleep(150);
  }
  throw new Error('server did not start');
}
async function stop(proc) {
  proc.kill();
  await new Promise((r) => proc.once('exit', r));
}

// A tiny cookie-keeping client per signed-in user.
function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const r = await fetch(BASE + '/api' + p, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Genesis': '1', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
    return { status: r.status, data };
  };
  const c = {
    call,
    get: (p) => call('GET', p),
    data: async (method, p, body) => {
      const r = await call(method, p, body);
      if (r.status !== 200) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(r.data)}`);
      return r.data;
    },
  };
  c.login = async (competition, role, username, password) => c.data('POST', '/auth/login', { competition, role, username, password });
  return c;
}

let srv = null;
try {
  // ---------------------------------------------------------------- upgrade
  if (OLD) {
    console.log('- upgrade from the previous laptop version');
    srv = start(OLD);
    await waitUp();
    const old = client();
    await old.data('POST', '/auth/login', { role: 'admin', username: 'admin1', password: 'hack-admin-1' });
    const t = await old.data('POST', '/admin/teams', { name: 'Legacy Team', leader_name: 'Old Leader' });
    await old.data('PUT', '/admin/settings', { event_name: 'Genesis 2026', venue: 'Pandal' });
    await old.data('POST', '/admin/announcements', { title: 'Old news', audience: 'all' });
    const r1 = (await old.data('GET', '/admin/rounds')).rounds[0];
    await old.data('PUT', `/admin/rounds/${r1.id}/sheet/${t.team.id}`, { scores: { [r1.criteria[0].id]: 7 }, comments: 'Kept' });
    await old.data('POST', `/admin/rounds/${r1.id}/publish`, { published: true });
    await stop(srv);

    srv = start(ROOT);
    await waitUp();
    const tm = client();
    await tm.login('hackathon', 'team', t.team.code, t.password);
    const ov = await tm.data('GET', '/team/overview');
    ok(ov.competition === 'hackathon' && ov.event.event_name === 'Genesis 2026' && ov.event.venue === 'Pandal', 'settings carried over', ov.event);
    ok(ov.journey[0].criteria[0].score === 7 && ov.journey[0].comments === 'Kept', 'scores and notes carried over', ov.journey[0]);
    ok(ov.announcements.some((a) => a.title === 'Old news'), 'announcements carried over');
    ok(/ideathon\s+ideaadmin1/.test(srv.log()), 'ideathon organisers created on upgrade', srv.log());
    await stop(srv);
    srv = null;
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    fs.mkdirSync(DATA, { recursive: true });
  }

  // ---------------------------------------------------------------- fresh
  console.log('- fresh database: competitions, judges, ideathon');
  srv = start(ROOT);
  await waitUp();
  const HA = client();
  const IA = client();
  let r = await HA.call('POST', '/auth/login', { competition: 'ideathon', role: 'admin', username: 'admin1', password: 'hack-admin-1' });
  ok(r.status === 403 && /belongs to the Hackathon/.test(r.data.error), 'hackathon organiser under Ideathon told to switch', r.data);
  r = await HA.call('POST', '/auth/login', { competition: 'ideathon', role: 'judge', username: 'x', password: 'y' });
  ok(r.status === 400, 'no judges under Ideathon', r.data);
  await HA.login('hackathon', 'admin', 'admin1', 'hack-admin-1');
  await IA.login('ideathon', 'admin', 'ideaadmin1', 'idea-admin-1');
  r = await HA.data('GET', '/public/info');
  ok(r.competitions.hackathon.event_name === 'Genesis Hackathon' && r.competitions.ideathon.event_name === 'Genesis Ideathon', 'public info for both');

  const h1 = await HA.data('POST', '/admin/teams', { name: 'Null Pointers', leader_name: 'Asha' });
  const imp = await HA.data('POST', '/admin/teams/import', { csv: 'team_name\nByte Club\nStack Smash\n' });
  const i1 = await IA.data('POST', '/admin/teams', { name: 'Idea Forge' });
  ok(h1.team.code === 'GEN001' && imp.credentials[1].code === 'GEN003' && i1.team.code === 'IDE001', 'per-competition codes', [h1.team.code, i1.team.code]);
  r = await IA.data('GET', '/admin/teams');
  ok(r.teams.length === 1 && r.competition === 'ideathon', 'ideathon organiser sees only ideathon teams', r.teams.map((t) => t.code));
  r = await IA.call('PUT', `/admin/teams/${h1.team.id}`, { code: 'GEN001', name: 'x' });
  ok(r.status === 404, 'cannot edit the other competition’s team');
  r = await IA.call('PUT', '/admin/settings', { team_code_prefix: 'GEN' });
  ok(r.status === 400, 'prefix clash blocked', r.data);
  for (const p of ['/admin/rounds', '/admin/judges', '/admin/leaderboard']) {
    r = await IA.get(p);
    ok(r.status === 403, `ideathon organiser blocked from ${p}`, r.status);
  }
  for (const p of ['/admin/submissions', '/admin/results']) {
    r = await HA.get(p);
    ok(r.status === 403, `hackathon organiser blocked from ${p}`, r.status);
  }

  const T1 = client();
  r = await T1.call('POST', '/auth/login', { competition: 'ideathon', role: 'team', username: 'GEN001', password: h1.password });
  ok(r.status === 403 && /Hackathon team/.test(r.data.error), 'hackathon team under Ideathon told to switch', r.data);
  await T1.login('hackathon', 'team', 'gen001', h1.password);
  const IT = client();
  await IT.login('ideathon', 'team', 'IDE001', i1.password);

  // judges
  const j1 = await HA.data('POST', '/admin/judges', { display_name: 'Dr. Priya' });
  const j2 = await HA.data('POST', '/admin/judges', { display_name: 'Mr. Kumar' });
  ok(j1.judge.username === 'JDG001' && j2.judge.username === 'JDG002', 'judge usernames');
  const J1 = client();
  const J2 = client();
  await J1.login('hackathon', 'judge', 'jdg001', j1.password);
  await J2.login('hackathon', 'judge', 'JDG002', j2.password);
  r = await J1.get('/admin/teams');
  ok(r.status === 403, 'judge blocked from organiser API');
  const rounds = (await HA.data('GET', '/admin/rounds')).rounds;
  const R1 = rounds[0];
  const c1 = R1.criteria.map((c) => c.id);
  await HA.data('PUT', `/admin/rounds/${R1.id}/assignments`, { pairs: [[j1.judge.id, h1.team.id], [j2.judge.id, h1.team.id], [j1.judge.id, i1.team.id]] });
  r = await HA.data('GET', `/admin/rounds/${R1.id}/assignments`);
  ok(r.pairs.length === 2 && r.teams.length === 3, 'assignments saved, ideathon team ignored', r.pairs);
  r = await J1.data('GET', `/judge/rounds/${R1.id}`);
  ok(r.teams.length === 1 && r.teams[0].code === 'GEN001' && r.round.judging_open === false, 'judge sees assigned teams', r.teams.map((t) => t.code));
  r = await J1.call('PUT', `/judge/rounds/${R1.id}/teams/${h1.team.id}`, { scores: { [c1[0]]: 8 } });
  ok(r.status === 409, 'judging closed until live/judging', r.data);
  await HA.data('PUT', `/admin/rounds/${R1.id}`, { name: R1.name, description: R1.description, state: 'judging' });
  r = await J1.data('PUT', `/judge/rounds/${R1.id}/teams/${h1.team.id}`, { scores: { [c1[0]]: 8, [c1[1]]: 6, [c1[2]]: 9 }, comments: 'Strong framing.', done: true });
  ok(r.row.total === 23 && r.row.done, 'judge saves and marks done', r.row);
  await J2.data('PUT', `/judge/rounds/${R1.id}/teams/${h1.team.id}`, { scores: { [c1[0]]: 6, [c1[1]]: 7 }, comments: 'Clearer demo plan please.' });
  r = await J2.call('PUT', `/judge/rounds/${R1.id}/teams/${imp.credentials[0].id}`, { scores: { [c1[0]]: 5 } });
  ok(r.status === 403, 'judge cannot score unassigned team');
  r = await HA.data('GET', `/admin/rounds/${R1.id}/sheet`);
  let row = r.rows.find((x) => x.code === 'GEN001');
  ok(row.judge_avg[c1[0]] === 7 && row.judge_avg[c1[1]] === 6.5 && row.total === 22.5 && row.judges.assigned === 2 && row.judges.done === 1, 'official = judges’ average', row);
  r = await HA.data('GET', `/admin/rounds/${R1.id}/sheet/${h1.team.id}/judges`);
  ok(r.judges.length === 2 && r.judges.some((j) => j.judge_name === 'Mr. Kumar'), 'judge breakdown', r.judges.map((j) => j.judge_name));
  r = await HA.data('PUT', `/admin/rounds/${R1.id}/sheet/${h1.team.id}`, { scores: { [c1[1]]: 10 } });
  ok(r.row.total === 26, 'organiser override', r.row.total);
  await HA.data('POST', `/admin/rounds/${R1.id}/publish`, { published: true });
  r = await T1.data('GET', '/team/overview');
  ok(r.journey[0].total === 26 && r.journey[0].feedback.length === 2 && r.journey[0].feedback[0].label === 'Judge 1' && !JSON.stringify(r).includes('Kumar'), 'team sees average + anonymous comments', r.journey[0]);
  r = await J1.call('PUT', `/judge/rounds/${R1.id}/teams/${h1.team.id}`, { comments: 'late' });
  ok(r.status === 409, 'published round locks judges');
  r = await HA.data('GET', '/admin/leaderboard');
  ok(r.rows.every((x) => x.code.startsWith('GEN')), 'leaderboard only hackathon teams');

  // announcements & schedule across competitions
  await HA.data('POST', '/admin/announcements', { title: 'Judges only', audience: 'judges' });
  await HA.data('POST', '/admin/announcements', { title: 'Dinner for everyone', audience: 'everyone' });
  await IA.data('POST', '/admin/announcements', { title: 'Ideathon only', audience: 'all' });
  r = await J1.data('GET', '/judge/announcements');
  ok(r.announcements.some((a) => a.title === 'Judges only') && !r.announcements.some((a) => a.title === 'Ideathon only'), 'judge announcements', r.announcements.map((a) => a.title));
  r = await IT.data('GET', '/team/announcements');
  ok(r.announcements.map((a) => a.title).sort().join('|') === 'Dinner for everyone|Ideathon only', 'ideathon team announcements', r.announcements.map((a) => a.title));
  await HA.data('POST', '/admin/schedule', { title: 'Lunch', kind: 'food', starts_at: '2026-10-05T07:00:00Z', scope: 'both' });
  await IA.data('POST', '/admin/schedule', { title: 'Pitch deadline', kind: 'deadline', starts_at: '2026-10-05T10:00:00Z' });
  r = await T1.data('GET', '/team/schedule');
  ok(r.schedule.map((x) => x.title).join() === 'Lunch', 'hackathon schedule', r.schedule.map((x) => x.title));

  // ideathon submissions & results
  r = await IT.data('GET', '/team/overview');
  ok(r.competition === 'ideathon' && r.submission.enabled && r.submission.mine === null && r.journey.length === 0, 'ideathon overview', r.submission);
  r = await IT.call('PUT', '/team/submission', { title: 'Kisan', problem: 'p', solution: 's', deck_url: 'nope' });
  ok(r.status === 400, 'links must be https', r.data);
  r = await IT.data('PUT', '/team/submission', { title: 'Kisan Connect', problem: 'p', solution: 's', deck_url: 'https://example.com/d' });
  ok(r.submission.title === 'Kisan Connect', 'submission saved');
  r = await T1.call('PUT', '/team/submission', { title: 'x', problem: 'p', solution: 's' });
  ok(r.status === 403, 'hackathon teams cannot submit ideas');
  await IA.data('PUT', '/admin/settings', { submissions_enabled: false });
  r = await IT.call('PUT', '/team/submission', { title: 'x', problem: 'p', solution: 's' });
  ok(r.status === 403 && /turned off/.test(r.data.error), 'organiser can switch submissions off', r.data);
  await IA.data('PUT', '/admin/settings', { submissions_enabled: true });
  r = await IA.data('GET', '/admin/submissions');
  ok(r.submissions.length === 1 && r.missing.length === 0, 'organiser sees submissions');
  await IA.data('PUT', `/admin/results/${i1.team.id}`, { award: 'Winner', result_note: 'Great pitch' });
  r = await IT.data('GET', '/team/overview');
  ok(r.result.published === false && r.result.award === '', 'award hidden before publish');
  await IA.data('POST', '/admin/results/publish', { published: true, announce: true });
  r = await IT.data('GET', '/team/overview');
  ok(r.result.award === 'Winner' && r.announcements[0].title.includes('results are out'), 'award visible after publish', r.result);

  // help desk scoping
  const tk = (await T1.data('POST', '/team/tickets', { category: 'Other', subject: 'Hack ticket', message: 'm' })).ticket.id;
  r = await IA.data('GET', '/admin/tickets');
  ok(r.tickets.length === 0, 'ideathon organiser does not see hackathon tickets');
  r = await IA.call('GET', `/admin/tickets/${tk}`);
  ok(r.status === 404, 'cannot open the other competition’s ticket');

  // exports, dashboard, reset
  r = await IA.call('GET', '/admin/export/results.csv');
  ok(r.status === 200 && String(r.data).includes('Winner') && !String(r.data).includes('GEN001'), 'ideathon results CSV', String(r.data).slice(0, 120));
  r = await HA.call('GET', '/admin/backup');
  ok(r.status === 200 && r.data.judges.length === 2 && !JSON.stringify(r.data).includes('password_hash') && !JSON.stringify(r.data).includes('Kisan'), 'hackathon backup is scoped and hash-free');
  r = await HA.data('GET', '/admin/dashboard');
  ok(r.competition === 'hackathon' && r.judging.judges === 2 && r.stats.teams === 3, 'hackathon dashboard', r.stats);
  r = await IA.data('GET', '/admin/dashboard');
  ok(r.competition === 'ideathon' && r.ideathon.submissions === 1, 'ideathon dashboard', r.ideathon);
  await IA.data('POST', '/admin/reset', { confirm: 'RESET', scope: 'everything' });
  r = await HA.data('GET', '/admin/teams');
  ok(r.teams.length === 3, 'ideathon reset leaves hackathon teams alone');
  r = await IA.data('GET', '/admin/teams');
  ok(r.teams.length === 0, 'ideathon reset clears ideathon teams');

  // pages
  r = await fetch(`${BASE}/judge.html`, { redirect: 'manual' });
  ok(r.status === 302, 'judge page requires a judge session');

  await stop(srv);
  srv = null;
} catch (err) {
  failN++;
  console.log('  ERROR:', err.message);
} finally {
  if (srv) await stop(srv);
  fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
