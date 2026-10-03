'use strict';
// Judge portal (Hackathon only): judges mark and comment on the teams the
// organisers assigned to them, while a round is open for judging.
const express = require('express');
const { q, tx, now, getSettings } = require('../db');
const results = require('../services/results');
const content = require('../services/content');
const events = require('../events');
const { str, num, bool, idParam, fail } = require('../util');

const router = express.Router();

function assignedCount(judgeId, roundId) {
  return q.get(
    `SELECT COUNT(*) AS n FROM judge_assignments ja JOIN teams t ON t.id = ja.team_id
      WHERE ja.judge_id = ? AND ja.round_id = ? AND t.active = 1`,
    judgeId,
    roundId
  ).n;
}

function doneCount(judgeId, roundId) {
  return q.get(
    `SELECT COUNT(*) AS n FROM judge_feedback jf
       JOIN judge_assignments ja ON ja.judge_id = jf.judge_id AND ja.team_id = jf.team_id AND ja.round_id = jf.round_id
      WHERE jf.judge_id = ? AND jf.round_id = ? AND jf.submitted_at IS NOT NULL`,
    judgeId,
    roundId
  ).n;
}

router.get('/overview', (req, res) => {
  const s = getSettings('hackathon');
  const judge = q.get('SELECT * FROM judges WHERE id = ?', req.user.id);
  const anns = content.announcementsForJudges();
  res.json({
    judge: { name: judge.display_name, username: judge.username },
    event: { event_name: s.event_name, tagline: s.tagline, venue: s.venue, event_start: s.event_start, event_end: s.event_end },
    rounds: results.loadRounds().map((r) => ({ ...r, assigned: assignedCount(judge.id, r.id), done: doneCount(judge.id, r.id) })),
    announcements: anns.slice(0, 3),
    unread: anns.filter((a) => !judge.announcements_seen_at || a.created_at > judge.announcements_seen_at).length,
    announcements_seen_at: judge.announcements_seen_at,
    markers: content.markers('hackathon'),
    serverTime: now(),
  });
});

router.get('/rounds/:id', (req, res) => {
  const roundId = idParam(req.params.id);
  const round = results.loadRounds().find((r) => r.id === roundId);
  if (!round) fail(404, 'That round doesn’t exist.');
  const teams = q.all(
    `SELECT t.id FROM judge_assignments ja JOIN teams t ON t.id = ja.team_id
      WHERE ja.judge_id = ? AND ja.round_id = ? AND t.active = 1 ORDER BY t.code`,
    req.user.id,
    roundId
  );
  res.json({ round, teams: teams.map((t) => results.judgeRow(req.user.id, roundId, t.id)) });
});

router.put('/rounds/:id/teams/:teamId', (req, res) => {
  const roundId = idParam(req.params.id);
  const teamId = idParam(req.params.teamId);
  const round = results.loadRounds().find((r) => r.id === roundId);
  if (!round) fail(404, 'That round doesn’t exist.');
  if (!q.get('SELECT 1 FROM judge_assignments WHERE judge_id = ? AND round_id = ? AND team_id = ?', req.user.id, roundId, teamId)) {
    fail(403, 'This team isn’t assigned to you for this round.');
  }
  if (!round.judging_open) {
    fail(409, round.published ? `Round ${round.number} results are published, so marks are locked.` : `Judging for Round ${round.number} isn’t open right now.`);
  }

  const scores = req.body.scores && typeof req.body.scores === 'object' ? req.body.scores : {};
  const updates = Object.entries(scores).map(([critId, value]) => {
    const c = round.criteria.find((x) => x.id === Number(critId));
    if (!c) fail(400, 'One of the criteria no longer exists. Reload the page.');
    return { c, value: num(value, { label: c.name, min: 0, max: c.max_score, nullable: true }) };
  });
  const ex = q.get('SELECT * FROM judge_feedback WHERE judge_id = ? AND team_id = ? AND round_id = ?', req.user.id, teamId, roundId);
  const comments = req.body.comments === undefined ? (ex ? ex.comments : '') : str(req.body.comments, { label: 'Comments', max: 4000 });
  let submitted = ex ? ex.submitted_at : null;
  if (req.body.done !== undefined) submitted = bool(req.body.done) ? submitted || now() : null;

  tx(() => {
    for (const { c, value } of updates) {
      if (value === null) q.run('DELETE FROM judge_scores WHERE judge_id = ? AND team_id = ? AND criterion_id = ?', req.user.id, teamId, c.id);
      else
        q.run(
          `INSERT INTO judge_scores (judge_id, team_id, criterion_id, score) VALUES (?, ?, ?, ?)
           ON CONFLICT(judge_id, team_id, criterion_id) DO UPDATE SET score = excluded.score`,
          req.user.id, teamId, c.id, value
        );
    }
    q.run(
      `INSERT INTO judge_feedback (judge_id, team_id, round_id, comments, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(judge_id, team_id, round_id) DO UPDATE SET comments = excluded.comments, submitted_at = excluded.submitted_at,
         updated_at = excluded.updated_at`,
      req.user.id, teamId, roundId, comments, submitted, now()
    );
  });
  events.emit('sheet', { round_id: roundId, team_id: teamId, by: req.user.name, judge: true }, 'admins:hackathon');
  res.json({ row: results.judgeRow(req.user.id, roundId, teamId) });
});

router.get('/announcements', (req, res) => {
  const seen = q.get('SELECT announcements_seen_at FROM judges WHERE id = ?', req.user.id).announcements_seen_at;
  res.json({ announcements: content.announcementsForJudges(), seen_at: seen });
});

router.post('/announcements/seen', (req, res) => {
  q.run('UPDATE judges SET announcements_seen_at = ? WHERE id = ?', now(), req.user.id);
  res.json({ ok: true });
});

router.get('/schedule', (req, res) => {
  res.json({ schedule: content.listSchedule('hackathon'), serverTime: now() });
});

module.exports = router;
