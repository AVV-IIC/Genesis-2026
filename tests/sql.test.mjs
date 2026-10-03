// Tests for supabase/schema.sql (Hackathon + Ideathon + judges) on PGlite.
//   node tests/sql.test.mjs
import { freshDb, rpcFor, SCHEMA, SCHEMA_V1 } from './pg.mjs';

let pass = 0;
let failN = 0;
const ok = (cond, msg, extra) => {
  if (cond) pass++;
  else {
    failN++;
    console.log('  FAIL:', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : '');
  }
};
const section = (s) => console.log(`- ${s}`);

function api(rpc) {
  const call = (fn, args) => rpc(fn, args);
  const data = async (fn, args) => {
    const r = await rpc(fn, args);
    if (r.status !== 200 || (r.body && r.body.__error)) throw new Error(`${fn} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return { call, data };
}

// =============================================================================
section('upgrade from the live single-competition schema keeps all data');
{
  const db = await freshDb();
  await db.exec(SCHEMA_V1);
  const rpc = rpcFor(db);
  const { data } = api(rpc);
  await db.query(`select genesis.create_admin('admin1', 'Organiser 1', 'old-admin-pass')`);
  const A = (await data('api_login', { p_role: 'admin', p_username: 'admin1', p_password: 'old-admin-pass' })).token;
  const team = await data('api_admin_team_create', { p_token: A, p_body: { name: 'Legacy Team', leader_name: 'Old Leader' } });
  await data('api_admin_settings_save', { p_token: A, p_body: { event_name: 'Genesis 2026', venue: 'Pandal', leaderboard_visible: true } });
  await data('api_admin_announcement_create', { p_token: A, p_body: { title: 'Old news', audience: 'all' } });
  await data('api_admin_schedule_create', { p_token: A, p_body: { title: 'Round 1', kind: 'round', starts_at: '2026-10-05T04:30:00Z' } });
  const r1 = (await data('api_admin_rounds', { p_token: A })).rounds[0];
  await data('api_admin_sheet_save', { p_token: A, p_round: r1.id, p_team: team.team.id, p_body: { scores: { [r1.criteria[0].id]: 7 }, comments: 'Kept' } });
  await data('api_admin_publish', { p_token: A, p_round: r1.id, p_body: { published: true } });

  await db.exec(SCHEMA);
  await db.exec(SCHEMA); // re-runnable
  rpc.reload();
  const T = (await data('api_login', { p_competition: 'hackathon', p_role: 'team', p_username: team.team.code, p_password: team.password })).token;
  const ov = await data('api_team_overview', { p_token: T });
  ok(ov.competition === 'hackathon' && ov.event.event_name === 'Genesis 2026' && ov.event.venue === 'Pandal' && ov.event.leaderboard_visible, 'settings migrated to hackathon', ov.event);
  ok(ov.journey[0].criteria[0].score === 7 && ov.journey[0].comments === 'Kept', 'scores and notes kept', ov.journey[0]);
  ok(ov.announcements.some((a) => a.title === 'Old news'), 'announcements kept');
  ok(ov.markers.length === 1, 'schedule kept');
  const r = await rpc('api_admin_teams', { p_token: A });
  ok(r.status === 200 && r.body.teams.length === 1 && r.body.competition === 'hackathon', 'old admin session still valid and hackathon', r.body);
  const keys = (await db.query(`select key from genesis.settings order by key`)).rows.map((x) => x.key);
  ok(keys.every((k) => k.startsWith('hackathon:')), 'settings keys prefixed', keys);
}

// =============================================================================
section('fresh database: competitions, judges, ideathon');
const db = await freshDb();
await db.exec(SCHEMA);
const rpc = rpcFor(db);
const { call, data } = api(rpc);
const sent = async () => (await db.query(`select payload from realtime.sent order by id`)).rows.map((x) => x.payload);
const clearSent = () => db.query('delete from realtime.sent');
const login = async (comp, role, user, pw) => (await data('api_login', { p_competition: comp, p_role: role, p_username: user, p_password: pw })).token;

await db.query(`select genesis.create_admin('admin1', 'Hack Organiser', 'hack-admin-1')`);
await db.query(`select genesis.create_admin('ideaadmin1', 'Idea Organiser', 'idea-admin-1', 'ideathon')`);

// ---- sign in
let r = await call('api_login', { p_competition: 'ideathon', p_role: 'admin', p_username: 'admin1', p_password: 'hack-admin-1' });
ok(r.body.__error && /belongs to the Hackathon/.test(r.body.__error), 'hackathon organiser under Ideathon is told to switch', r.body);
r = await call('api_login', { p_competition: 'ideathon', p_role: 'judge', p_username: 'x', p_password: 'y' });
ok(r.body.__error && /Judges sign in under the Hackathon/.test(r.body.__error), 'no judge login under Ideathon', r.body);
r = await call('api_login', { p_competition: 'nope', p_role: 'team', p_username: 'x', p_password: 'y' });
ok(r.body.__error && r.body.status === 400, 'competition required', r.body);
const HA = await login('hackathon', 'admin', 'admin1', 'hack-admin-1');
const IA = await login('ideathon', 'admin', 'ideaadmin1', 'idea-admin-1');
r = await data('api_public_info', {});
ok(r.competitions.hackathon.event_name === 'Genesis Hackathon' && r.competitions.ideathon.event_name === 'Genesis Ideathon', 'public info for both', r);

// ---- teams are separated
const h1 = await data('api_admin_team_create', { p_token: HA, p_body: { name: 'Null Pointers', leader_name: 'Asha' } });
const imp = await data('api_admin_teams_import', { p_token: HA, p_rows: [{ line: 2, name: 'Byte Club' }, { line: 3, name: 'Stack Smash' }, { line: 4, name: 'Kernel Panic' }] });
const i1 = await data('api_admin_team_create', { p_token: IA, p_body: { name: 'Idea Forge', leader_name: 'Ira' } });
const i2 = await data('api_admin_team_create', { p_token: IA, p_body: { name: 'Think Tank' } });
ok(h1.team.code === 'GEN001' && imp.credentials[2].code === 'GEN004' && i1.team.code === 'IDE001' && i1.team.competition === 'ideathon', 'per-competition team IDs', [h1.team.code, i1.team.code]);
r = await data('api_admin_teams', { p_token: IA });
ok(r.teams.length === 2 && r.teams.every((t) => t.competition === 'ideathon') && r.next_code === 'IDE003', 'ideathon organiser sees only ideathon teams', r.teams.map((t) => t.code));
r = await call('api_admin_team_update', { p_token: IA, p_id: h1.team.id, p_body: { code: 'GEN001', name: 'Hijack' } });
ok(r.status === 404, 'ideathon organiser cannot edit a hackathon team', r);
r = await call('api_admin_team_password', { p_token: IA, p_id: h1.team.id, p_body: {} });
ok(r.status === 404, 'ideathon organiser cannot reset a hackathon team password', r);
r = await call('api_admin_settings_save', { p_token: IA, p_body: { team_code_prefix: 'gen' } });
ok(r.status === 400 && /already uses GEN/.test(r.body.message), 'prefix clash between competitions blocked', r.body);
r = await call('api_login', { p_competition: 'hackathon', p_role: 'team', p_username: 'IDE001', p_password: i1.password });
ok(r.body.__error && /Ideathon team/.test(r.body.__error), 'ideathon team under Hackathon is told to switch', r.body);
const T1 = await login('hackathon', 'team', 'GEN001', h1.password);
const T2 = await login('hackathon', 'team', 'GEN002', imp.credentials[0].password);
const T3 = await login('hackathon', 'team', 'GEN003', imp.credentials[1].password);
const IT1 = await login('ideathon', 'team', 'ide001', i1.password);
const IT2 = await login('ideathon', 'team', 'IDE002', i2.password);

// ---- ideathon organiser cannot reach hackathon-only functions and vice versa
for (const fn of ['api_admin_rounds', 'api_admin_judges', 'api_admin_leaderboard']) {
  r = await call(fn, { p_token: IA });
  ok(r.status === 403, `ideathon organiser blocked from ${fn}`, r);
}
for (const fn of ['api_admin_submissions', 'api_admin_results']) {
  r = await call(fn, { p_token: HA });
  ok(r.status === 403, `hackathon organiser blocked from ${fn}`, r);
}
r = await call('api_team_leaderboard', { p_token: IT1 });
ok(r.status === 403, 'ideathon team has no leaderboard', r);
r = await call('api_team_submission', { p_token: T1 });
ok(r.status === 403, 'hackathon team has no submission', r);

// ---- judges
const j1 = await data('api_admin_judge_create', { p_token: HA, p_body: { display_name: 'Dr. Priya' } });
const j2 = await data('api_admin_judge_create', { p_token: HA, p_body: { display_name: 'Mr. Kumar', username: 'kumar' } });
const j3 = await data('api_admin_judge_create', { p_token: HA, p_body: { display_name: 'Ms. Sen' } });
ok(j1.judge.username === 'JDG001' && j2.judge.username === 'KUMAR' && j3.judge.username === 'JDG002', 'judge usernames', [j1.judge.username, j2.judge.username, j3.judge.username]);
r = await call('api_admin_judge_create', { p_token: IA, p_body: { display_name: 'X' } });
ok(r.status === 403, 'ideathon organiser cannot add judges', r);
const J1 = await login('hackathon', 'judge', 'jdg001', j1.password);
const J2 = await login('hackathon', 'judge', 'KUMAR', j2.password);
const J3 = await login('hackathon', 'judge', 'JDG002', j3.password);
r = await call('api_admin_teams', { p_token: J1 });
ok(r.status === 403, 'judge cannot call organiser functions', r);
r = await call('api_team_overview', { p_token: J1 });
ok(r.status === 403, 'judge cannot call team functions', r);

const rounds = (await data('api_admin_rounds', { p_token: HA })).rounds;
const [R1, R2] = rounds;
const id = (code) => [h1.team, ...imp.credentials].find((t) => t.code === code).id;
// Round 1: judge1 + judge2 on GEN001, GEN002; judge3 on GEN003.
await data('api_admin_assignments_save', { p_token: HA, p_round: R1.id, p_body: { pairs: [
  [j1.judge.id, id('GEN001')], [j2.judge.id, id('GEN001')], [j1.judge.id, id('GEN002')], [j2.judge.id, id('GEN002')], [j3.judge.id, id('GEN003')],
  [j1.judge.id, i1.team.id], // an ideathon team must be ignored
] } });
r = await data('api_admin_assignments', { p_token: HA, p_round: R1.id });
ok(r.pairs.length === 5 && r.teams.length === 4 && r.judges.length === 3, 'assignments saved (ideathon team ignored)', { pairs: r.pairs.length, teams: r.teams.length });
r = await data('api_judge_overview', { p_token: J1 });
ok(r.rounds[0].assigned === 2 && r.rounds[1].assigned === 0 && r.judge.name === 'Dr. Priya', 'judge overview counts', r.rounds.map((x) => x.assigned));
r = await data('api_judge_round', { p_token: J1, p_round: R1.id });
ok(r.teams.map((t) => t.code).join() === 'GEN001,GEN002' && r.round.judging_open === false, 'judge sees only assigned teams', r.teams.map((t) => t.code));
const c1 = R1.criteria.map((c) => c.id);
r = await call('api_judge_save', { p_token: J1, p_round: R1.id, p_team: id('GEN001'), p_body: { scores: { [c1[0]]: 8 } } });
ok(r.status === 409 && /isn’t open/.test(r.body.message), 'judging closed until round is live/judging', r.body);
await data('api_admin_round_update', { p_token: HA, p_id: R1.id, p_body: { name: R1.name, description: R1.description, state: 'judging' } });
await clearSent();
r = await data('api_judge_save', { p_token: J1, p_round: R1.id, p_team: id('GEN001'), p_body: { scores: { [c1[0]]: 8, [c1[1]]: 6, [c1[2]]: 9 }, comments: 'Strong problem framing.', done: true } });
ok(r.row.total === 23 && r.row.done && r.row.comments === 'Strong problem framing.', 'judge saves marks + marks done', r.row);
const s1 = await sent();
ok(s1.length === 1 && s1[0].type === 'sheet' && s1[0].target === 'admins:hackathon' && !JSON.stringify(s1[0]).includes('Strong') && !('scores' in s1[0].data), 'judge save broadcast carries no marks/comments', s1);
await data('api_judge_save', { p_token: J2, p_round: R1.id, p_team: id('GEN001'), p_body: { scores: { [c1[0]]: 6, [c1[1]]: 7 }, comments: 'Needs a clearer demo plan.' } });
r = await call('api_judge_save', { p_token: J3, p_round: R1.id, p_team: id('GEN001'), p_body: { scores: { [c1[0]]: 1 } } });
ok(r.status === 403, 'judge cannot score an unassigned team', r);
r = await call('api_judge_save', { p_token: J1, p_round: R1.id, p_team: id('GEN001'), p_body: { scores: { [c1[0]]: 11 } } });
ok(r.status === 400, 'judge mark above max rejected', r);
r = await data('api_judge_round', { p_token: J2, p_round: R1.id });
ok(r.teams[0].scores[c1[0]] === 6 && r.teams[0].done === false, 'judges only see their own marks', r.teams[0]);

// Official = average of assigned judges; organiser can override.
r = await data('api_admin_sheet', { p_token: HA, p_round: R1.id });
let row = r.rows.find((x) => x.code === 'GEN001');
ok(row.judge_avg[c1[0]] === 7 && row.judge_avg[c1[1]] === 6.5 && row.judge_avg[c1[2]] === 9 && row.total === 22.5 && row.complete, 'official total = judges average', row);
ok(row.judges.assigned === 2 && row.judges.done === 1 && Object.keys(row.scores).length === 0, 'judging progress per team', row.judges);
r = await data('api_admin_sheet_judges', { p_token: HA, p_round: R1.id, p_team: id('GEN001') });
ok(r.judges.length === 2 && r.judges[0].judge_name && r.judges.some((j) => j.comments === 'Needs a clearer demo plan.'), 'organiser sees each judge breakdown', r.judges.map((j) => [j.judge_name, j.total]));
r = await data('api_admin_sheet_save', { p_token: HA, p_round: R1.id, p_team: id('GEN001'), p_body: { scores: { [c1[1]]: 10 } } });
ok(r.row.total === 26 && r.row.scores[c1[1]] === 10, 'organiser override replaces the average for that criterion', r.row);
r = await call('api_admin_criterion_update', { p_token: HA, p_id: c1[2], p_body: { name: 'F', max_score: 8 } });
ok(r.status === 400 && /at least 9/.test(r.body.message), 'max cannot drop below a judge mark', r.body);
// Unassigning a judge drops their marks from the average.
await data('api_admin_assignments_save', { p_token: HA, p_round: R1.id, p_body: { pairs: [
  [j1.judge.id, id('GEN001')], [j1.judge.id, id('GEN002')], [j2.judge.id, id('GEN002')], [j3.judge.id, id('GEN003')],
] } });
row = (await data('api_admin_sheet_row', { p_token: HA, p_round: R1.id, p_team: id('GEN001') })).row;
ok(row.judge_avg[c1[0]] === 8 && row.judges.assigned === 1, 'unassigned judge no longer counts', row);
await data('api_admin_assignments_save', { p_token: HA, p_round: R1.id, p_body: { pairs: [
  [j1.judge.id, id('GEN001')], [j2.judge.id, id('GEN001')], [j1.judge.id, id('GEN002')], [j2.judge.id, id('GEN002')], [j3.judge.id, id('GEN003')],
] } });

// Publish: teams see averages + anonymised comments; judges get locked.
r = await data('api_team_overview', { p_token: T1 });
ok(r.journey[0].total === null && r.journey[0].feedback.length === 0, 'nothing visible before publish', r.journey[0]);
await data('api_admin_publish', { p_token: HA, p_round: R1.id, p_body: { published: true, announce: true } });
r = await data('api_team_overview', { p_token: T1 });
const j = r.journey[0];
ok(j.total === 26 && j.criteria[0].score === 7, 'team sees official marks', j);
ok(j.feedback.length === 2 && j.feedback[0].label === 'Judge 1' && !JSON.stringify(j).includes('Priya') && !JSON.stringify(j).includes('Kumar'), 'judge comments anonymised', j.feedback);
r = await call('api_judge_save', { p_token: J1, p_round: R1.id, p_team: id('GEN001'), p_body: { comments: 'late' } });
ok(r.status === 409 && /locked/.test(r.body.message), 'published round locks judges', r.body);

// Round 2 eligibility + leaderboard excludes ideathon.
r = await data('api_admin_assignments', { p_token: HA, p_round: R2.id });
ok(r.teams.length === 4 && r.teams.every((t) => t.eligible), 'R2 assignable teams = R1 (no eliminations)', r.teams.length);
r = await data('api_admin_leaderboard', { p_token: HA });
ok(r.rows.length === 4 && r.rows.every((x) => x.code.startsWith('GEN')), 'leaderboard only hackathon teams', r.rows.map((x) => x.code));
r = await data('api_admin_judges', { p_token: HA });
ok(r.judges.find((x) => x.username === 'JDG001').rounds[0].assigned === 2 && r.next_username === 'JDG003', 'judges list with progress', r.judges[0]);

// Disable / delete judge.
await data('api_admin_judge_update', { p_token: HA, p_id: j3.judge.id, p_body: { username: 'JDG002', display_name: 'Ms. Sen', active: false } });
r = await call('api_judge_overview', { p_token: J3 });
ok(r.status === 401, 'disabled judge signed out', r);
r = await call('api_login', { p_competition: 'hackathon', p_role: 'judge', p_username: 'JDG002', p_password: j3.password });
ok(r.body.__error && /disabled/.test(r.body.__error), 'disabled judge cannot sign in', r.body);
r = await data('api_admin_judge_password', { p_token: HA, p_id: j2.judge.id });
ok(r.credentials[0].code === 'KUMAR' && r.credentials[0].password, 'reset judge password');
r = await call('api_judge_overview', { p_token: J2 });
ok(r.status === 401, 'reset signs the judge out', r);
await data('api_admin_judge_delete', { p_token: HA, p_id: j3.judge.id });
r = await data('api_admin_sheet_row', { p_token: HA, p_round: R1.id, p_team: id('GEN003') });
ok(r.row.judges.assigned === 0, 'deleting a judge removes their assignments', r.row.judges);

// ---- announcements across competitions
await clearSent();
await data('api_admin_announcement_create', { p_token: HA, p_body: { title: 'Judges: meet in Room 4', audience: 'judges' } });
await data('api_admin_announcement_create', { p_token: HA, p_body: { title: 'Dinner for everyone', audience: 'everyone', priority: 'important' } });
await data('api_admin_announcement_create', { p_token: IA, p_body: { title: 'Ideathon only', audience: 'all' } });
r = await call('api_admin_announcement_create', { p_token: IA, p_body: { title: 'x', audience: 'judges' } });
ok(r.status === 400, 'ideathon cannot target judges', r);
const s2 = await sent();
ok(s2.every((p) => !JSON.stringify(p).includes('Room 4') && !JSON.stringify(p).includes('Dinner')), 'announcement broadcasts carry no text', s2);
ok(s2.some((p) => p.target === 'judges') && s2.some((p) => p.target === 'all') && s2.some((p) => p.target === 'teams:ideathon'), 'announcement targets', s2.map((p) => p.target));
r = await data('api_judge_announcements', { p_token: J1 });
ok(r.announcements.some((a) => a.title === 'Judges: meet in Room 4') && r.announcements.some((a) => a.title === 'Dinner for everyone') && !r.announcements.some((a) => a.title === 'Ideathon only'), 'judge announcements', r.announcements.map((a) => a.title));
r = await data('api_team_announcements', { p_token: T1 });
ok(!r.announcements.some((a) => a.title.startsWith('Judges')) && r.announcements.some((a) => a.title === 'Dinner for everyone') && !r.announcements.some((a) => a.title === 'Ideathon only'), 'hackathon team announcements', r.announcements.map((a) => a.title));
r = await data('api_team_announcements', { p_token: IT1 });
ok(r.announcements.map((a) => a.title).sort().join('|') === 'Dinner for everyone|Ideathon only', 'ideathon team announcements', r.announcements.map((a) => a.title));
r = await data('api_admin_announcements', { p_token: IA });
ok(r.announcements.length === 2 && r.announcements.some((a) => a.competition === 'both'), 'ideathon organiser sees own + shared', r.announcements.map((a) => a.title));

// ---- schedule across competitions
await data('api_admin_schedule_create', { p_token: IA, p_body: { title: 'Idea pitch deadline', kind: 'deadline', starts_at: '2026-10-05T10:00:00Z' } });
await data('api_admin_schedule_create', { p_token: HA, p_body: { title: 'Lunch', kind: 'food', starts_at: '2026-10-05T07:00:00Z', scope: 'both' } });
r = await data('api_team_schedule', { p_token: IT1 });
ok(r.schedule.map((x) => x.title).join() === 'Lunch,Idea pitch deadline', 'ideathon schedule = own + shared', r.schedule.map((x) => x.title));
r = await data('api_team_schedule', { p_token: T1 });
ok(r.schedule.map((x) => x.title).join() === 'Lunch', 'hackathon schedule excludes ideathon items', r.schedule.map((x) => x.title));
r = await data('api_public_info', {});
ok(r.competitions.ideathon.markers.length === 1 && r.competitions.hackathon.markers.length === 0, 'dial markers per competition');

// ---- ideathon submissions & results
r = await data('api_team_overview', { p_token: IT1 });
ok(r.competition === 'ideathon' && r.journey.length === 0 && r.standing === null && r.submission.enabled && r.submission.open && r.submission.mine === null && r.result.published === false, 'ideathon overview', r);
r = await call('api_team_submission_save', { p_token: IT1, p_body: { title: 'Kisan Connect', problem: 'Farmers lack price data', solution: 'SMS price alerts', deck_url: 'not-a-link' } });
ok(r.status === 400 && /https/.test(r.body.message), 'links must be https', r.body);
await clearSent();
r = await data('api_team_submission_save', { p_token: IT1, p_body: { title: 'Kisan Connect', problem: 'Farmers lack price data', solution: 'SMS price alerts', deck_url: 'https://example.com/deck' } });
ok(r.submission.title === 'Kisan Connect', 'submission saved');
const s3 = await sent();
ok(s3.length === 1 && s3[0].target === 'admins:ideathon' && !JSON.stringify(s3).includes('Kisan'), 'submission broadcast is private-safe', s3);
r = await data('api_team_submission_save', { p_token: IT1, p_body: { title: 'Kisan Connect v2', problem: 'p', solution: 's' } });
ok(r.submission.title === 'Kisan Connect v2', 'submission editable while open');
r = await data('api_admin_submissions', { p_token: IA });
ok(r.submissions.length === 1 && r.missing.length === 1 && r.missing[0].code === 'IDE002', 'organiser sees submissions + missing', r);
await data('api_admin_settings_save', { p_token: IA, p_body: { submission_deadline: '2020-01-01T00:00:00Z' } });
r = await call('api_team_submission_save', { p_token: IT2, p_body: { title: 'Late', problem: 'p', solution: 's' } });
ok(r.status === 403 && /closed/.test(r.body.message), 'deadline closes submissions', r.body);
await data('api_admin_settings_save', { p_token: IA, p_body: { submission_deadline: '', submissions_enabled: false } });
r = await call('api_team_submission_save', { p_token: IT2, p_body: { title: 'x', problem: 'p', solution: 's' } });
ok(r.status === 403 && /turned off/.test(r.body.message), 'organiser can switch submissions off', r.body);
r = await data('api_team_overview', { p_token: IT2 });
ok(r.submission.enabled === false, 'team sees submissions off');
await data('api_admin_settings_save', { p_token: IA, p_body: { submissions_enabled: true } });
r = await call('api_admin_settings_save', { p_token: HA, p_body: { submission_deadline: '2030-01-01T00:00:00Z' } });
ok(r.status === 200 && !('submission_deadline' in r.body.settings), 'hackathon settings ignore ideathon-only keys', r.body.settings);

await data('api_admin_result_save', { p_token: IA, p_team: i1.team.id, p_body: { award: 'Winner', result_note: 'Brilliant pitch' } });
r = await call('api_admin_result_save', { p_token: IA, p_team: h1.team.id, p_body: { award: 'x' } });
ok(r.status === 404, 'ideathon results only for ideathon teams', r);
r = await data('api_team_overview', { p_token: IT1 });
ok(r.result.published === false && r.result.award === '', 'award hidden before publish', r.result);
r = await data('api_admin_results', { p_token: IA });
ok(r.teams[0].award === 'Winner' && r.teams[0].submission_title === 'Kisan Connect v2' && r.published === false, 'organiser results list', r.teams[0]);
await data('api_admin_results_publish', { p_token: IA, p_body: { published: true, announce: true } });
r = await data('api_team_overview', { p_token: IT1 });
ok(r.result.published && r.result.award === 'Winner' && r.result.note === 'Brilliant pitch', 'award visible after publish', r.result);
ok(r.announcements[0].title === 'Genesis Ideathon results are out', 'results announcement posted', r.announcements[0]);

// ---- help desk scoped per competition
const tk = (await data('api_team_ticket_create', { p_token: T1, p_body: { category: 'Other', subject: 'Hack ticket', message: 'm' } })).ticket.id;
await data('api_team_ticket_create', { p_token: IT1, p_body: { category: 'Other', subject: 'Idea ticket', message: 'm' } });
r = await data('api_admin_tickets', { p_token: IA });
ok(r.tickets.length === 1 && r.tickets[0].subject === 'Idea ticket', 'ideathon organiser sees only ideathon tickets', r.tickets);
r = await call('api_admin_ticket', { p_token: IA, p_id: tk });
ok(r.status === 404, 'ideathon organiser cannot open a hackathon ticket', r);
r = await call('api_admin_ticket_reply', { p_token: IA, p_id: tk, p_body: { message: 'x' } });
ok(r.status === 404, 'or reply to it', r);

// ---- dashboards and meta
r = await data('api_admin_dashboard', { p_token: HA });
ok(r.competition === 'hackathon' && r.stats.teams === 4 && r.judging.judges === 2 && r.rounds.length === 4, 'hackathon dashboard', r.stats);
r = await data('api_admin_dashboard', { p_token: IA });
ok(r.competition === 'ideathon' && r.stats.teams === 2 && r.ideathon.submissions === 1 && r.ideathon.results_published && r.rounds.length === 0, 'ideathon dashboard', r.ideathon);
r = await data('api_admin_meta', { p_token: IA });
ok(r.competition === 'ideathon' && r.tickets_unread === 1 && r.settings.event_name === 'Genesis Ideathon', 'ideathon meta', r);
r = await data('api_admin_admins', { p_token: IA });
ok(r.admins.length === 1 && r.admins[0].username === 'ideaadmin1', 'organiser list per competition', r.admins);
r = await call('api_admin_admin_password', { p_token: IA, p_id: (await data('api_admin_admins', { p_token: HA })).admins[0].id });
ok(r.status === 404, 'cannot reset the other competition organiser', r);

// ---- exports & backup per competition
r = await data('api_admin_export', { p_token: IA });
ok(r.teams.length === 2 && r.submissions.length === 1 && r.leaderboard === null, 'ideathon export', { teams: r.teams.length });
r = await data('api_admin_backup', { p_token: HA });
ok(r.teams.length === 4 && r.judges.length === 2 && !JSON.stringify(r).includes('password_hash') && !JSON.stringify(r).includes('Kisan'), 'hackathon backup excludes hashes and ideathon data', { teams: r.teams.length });

// ---- password change for judges
r = await data('api_change_password', { p_token: J1, p_body: { current: j1.password, next: 'judge-new-pass' } });
ok(r.ok, 'judge can change own password');
r = await call('api_change_password', { p_token: IT1, p_body: { current: i1.password, next: 'whatever123' } });
ok(r.status === 403, 'team password change still off by default', r);

// ---- reset is per competition
await data('api_admin_reset', { p_token: IA, p_body: { confirm: 'RESET', scope: 'everything' } });
r = await data('api_admin_teams', { p_token: IA });
ok(r.teams.length === 0, 'ideathon reset clears ideathon teams');
r = await data('api_admin_teams', { p_token: HA });
ok(r.teams.length === 4, 'hackathon teams untouched by ideathon reset', r.teams.length);
r = await data('api_admin_sheet_row', { p_token: HA, p_round: R1.id, p_team: id('GEN001') });
ok(r.row.total === 26, 'hackathon scores untouched by ideathon reset');
r = await data('api_admin_announcements', { p_token: HA });
ok(r.announcements.some((a) => a.title === 'Dinner for everyone'), 'shared announcement kept');
await data('api_admin_reset', { p_token: HA, p_body: { confirm: 'RESET', scope: 'scores' } });
r = await data('api_admin_sheet_row', { p_token: HA, p_round: R1.id, p_team: id('GEN001') });
ok(r.row.total === null && r.row.judges.assigned === 2, 'hackathon score reset clears marks, keeps assignments', r.row);

// ---- grants
const priv = await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'api\\_%' and not p.prosecdef`);
ok(priv.rows[0].n === 0, 'every api function is security definer');

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
