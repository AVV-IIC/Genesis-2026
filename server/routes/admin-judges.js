'use strict';
// Organiser: judge accounts and judge-to-team assignments (Hackathon only).
const express = require('express');
const { q, tx, now } = require('../db');
const auth = require('../auth');
const events = require('../events');
const results = require('../services/results');
const { str, bool, idParam, fail } = require('../util');

const router = express.Router();
const USER_RE = /^[A-Za-z0-9_-]{2,32}$/;

function shapeJudge(j) {
  return { id: j.id, username: j.username, display_name: j.display_name, active: !!j.active, last_login_at: j.last_login_at, created_at: j.created_at };
}

function nextUsername() {
  let max = 0;
  for (const { username } of q.all('SELECT username FROM judges')) {
    const m = /^JDG(\d+)$/i.exec(username);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `JDG${String(max + 1).padStart(3, '0')}`;
}

router.get('/judges', (req, res) => {
  const rounds = results.loadRounds();
  const judges = q.all('SELECT * FROM judges ORDER BY username').map((j) => ({
    ...shapeJudge(j),
    rounds: rounds.map((r) => ({
      number: r.number,
      assigned: q.get('SELECT COUNT(*) AS n FROM judge_assignments WHERE judge_id = ? AND round_id = ?', j.id, r.id).n,
      done: q.get(
        `SELECT COUNT(*) AS n FROM judge_feedback jf
           JOIN judge_assignments ja ON ja.judge_id = jf.judge_id AND ja.team_id = jf.team_id AND ja.round_id = jf.round_id
          WHERE jf.judge_id = ? AND jf.round_id = ? AND jf.submitted_at IS NOT NULL`,
        j.id,
        r.id
      ).n,
    })),
  }));
  res.json({ judges, next_username: nextUsername() });
});

router.post('/judges', async (req, res) => {
  const name = str(req.body.display_name, { label: 'Judge name', max: 80, required: true });
  let username = str(req.body.username, { label: 'Username', max: 32 }).toUpperCase();
  if (username && !USER_RE.test(username)) fail(400, 'Username can only use letters, numbers, - and _ (2–32 characters).');
  if (username && q.get('SELECT 1 FROM judges WHERE username = ?', username)) fail(409, `Username ${username} is already taken.`);
  if (!username) username = nextUsername();
  const pw = str(req.body.password, { label: 'Password', max: 100, trim: false });
  if (pw && pw.length < 6) fail(400, 'Password must be at least 6 characters.');
  const password = pw || auth.generatePassword();
  const { id } = q.run(
    'INSERT INTO judges (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)',
    username, name, await auth.hashPassword(password), now()
  );
  events.emit('judges', {}, 'admins:hackathon');
  res.json({ judge: shapeJudge(q.get('SELECT * FROM judges WHERE id = ?', id)), password });
});

router.put('/judges/:id', (req, res) => {
  const id = idParam(req.params.id);
  const ex = q.get('SELECT * FROM judges WHERE id = ?', id);
  if (!ex) fail(404, 'That judge doesn’t exist.');
  const username = str(req.body.username, { label: 'Username', max: 32, required: true }).toUpperCase();
  if (!USER_RE.test(username)) fail(400, 'Username can only use letters, numbers, - and _ (2–32 characters).');
  if (q.get('SELECT 1 FROM judges WHERE username = ? AND id <> ?', username, id)) fail(409, `Username ${username} is already taken.`);
  const name = str(req.body.display_name, { label: 'Judge name', max: 80, required: true });
  const active = req.body.active === undefined ? !!ex.active : bool(req.body.active);
  q.run('UPDATE judges SET username = ?, display_name = ?, active = ? WHERE id = ?', username, name, active, id);
  if (!active && ex.active) auth.destroyUserSessions('judge', id);
  events.emit('judges', {}, 'admins:hackathon');
  res.json({ judge: shapeJudge(q.get('SELECT * FROM judges WHERE id = ?', id)) });
});

router.delete('/judges/:id', (req, res) => {
  const id = idParam(req.params.id);
  if (!q.get('SELECT 1 FROM judges WHERE id = ?', id)) fail(404, 'That judge doesn’t exist.');
  tx(() => {
    q.run("DELETE FROM sessions WHERE role = 'judge' AND user_id = ?", id);
    q.run('DELETE FROM judges WHERE id = ?', id);
  });
  events.emit('judges', {}, 'admins:hackathon');
  events.emit('rounds', {}, 'admins:hackathon');
  res.json({ ok: true });
});

router.post('/judges/:id/password', async (req, res) => {
  const id = idParam(req.params.id);
  const j = q.get('SELECT * FROM judges WHERE id = ?', id);
  if (!j) fail(404, 'That judge doesn’t exist.');
  const password = auth.generatePassword();
  q.run('UPDATE judges SET password_hash = ? WHERE id = ?', await auth.hashPassword(password), id);
  auth.destroyUserSessions('judge', id);
  res.json({ credentials: [{ id: j.id, code: j.username, name: j.display_name, password, judge: true }] });
});

// ---- assignments ----------------------------------------------------------------------

router.get('/rounds/:id/assignments', (req, res) => {
  const roundId = idParam(req.params.id);
  const rounds = results.loadRounds();
  const round = rounds.find((r) => r.id === roundId);
  if (!round) fail(404, 'That round doesn’t exist.');
  const { resultMap } = results.loadScoreMaps();
  const pairs = q.all('SELECT judge_id, team_id FROM judge_assignments WHERE round_id = ?', roundId);
  const assignedTeams = new Set(pairs.map((p) => p.team_id));
  const teams = results
    .roundEligibility(round, rounds, resultMap)
    .filter((e) => e.eligible || assignedTeams.has(e.team.id))
    .map(({ team: t, eligible }) => ({ team_id: t.id, code: t.code, name: t.name, track: t.track, table_no: t.table_no, eligible }));
  res.json({
    round,
    judges: q.all('SELECT * FROM judges ORDER BY username').map(shapeJudge),
    teams,
    pairs: pairs.map((p) => [p.judge_id, p.team_id]),
    done: q
      .all('SELECT judge_id, team_id FROM judge_feedback WHERE round_id = ? AND submitted_at IS NOT NULL', roundId)
      .map((p) => [p.judge_id, p.team_id]),
  });
});

router.put('/rounds/:id/assignments', (req, res) => {
  const roundId = idParam(req.params.id);
  if (!q.get('SELECT 1 FROM rounds WHERE id = ?', roundId)) fail(404, 'That round doesn’t exist.');
  if (!Array.isArray(req.body.pairs)) fail(400, 'Send the list of judge–team pairs.');
  let saved = 0;
  tx(() => {
    q.run('DELETE FROM judge_assignments WHERE round_id = ?', roundId);
    for (const pr of req.body.pairs) {
      const judgeId = Number(Array.isArray(pr) ? pr[0] : NaN);
      const teamId = Number(Array.isArray(pr) ? pr[1] : NaN);
      if (!q.get('SELECT 1 FROM judges WHERE id = ?', judgeId)) continue;
      if (!q.get("SELECT 1 FROM teams WHERE id = ? AND competition = 'hackathon'", teamId)) continue;
      q.run('INSERT OR IGNORE INTO judge_assignments (judge_id, round_id, team_id) VALUES (?, ?, ?)', judgeId, roundId, teamId);
      saved++;
    }
  });
  events.emit('assignments', { round_id: roundId }, 'judges');
  events.emit('rounds', {}, 'admins:hackathon');
  res.json({ ok: true, saved });
});

module.exports = router;
