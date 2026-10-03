'use strict';
const express = require('express');
const { q, tx, now } = require('../db');
const events = require('../events');
const results = require('../services/results');
const { str, num, int, bool, oneOf, idParam, fail } = require('../util');

const router = express.Router();

function getRound(id) {
  const r = results.loadRounds().find((x) => x.id === id);
  if (!r) fail(404, 'That round doesn’t exist.');
  return r;
}

function roundProgress() {
  return results.loadRounds().map((r) => {
    const sheet = results.roundSheet(r.id);
    const eligible = sheet.rows.filter((x) => x.eligible);
    return {
      ...r,
      eligible: eligible.length,
      scored: eligible.filter((x) => x.complete).length,
      decided: r.is_elimination
        ? eligible.filter((x) => x.status !== 'pending').length
        : eligible.length,
      selected: eligible.filter((x) => x.status === 'selected').length,
      eliminated: eligible.filter((x) => x.status === 'eliminated').length,
      judging: {
        assigned: q.get('SELECT COUNT(*) AS n FROM judge_assignments WHERE round_id = ?', r.id).n,
        done: q.get(
          `SELECT COUNT(*) AS n FROM judge_feedback jf
             JOIN judge_assignments ja ON ja.judge_id = jf.judge_id AND ja.team_id = jf.team_id AND ja.round_id = jf.round_id
            WHERE jf.round_id = ? AND jf.submitted_at IS NOT NULL`,
          r.id
        ).n,
      },
    };
  });
}

router.get('/rounds', (req, res) => {
  res.json({ rounds: roundProgress() });
});

router.put('/rounds/:id', (req, res) => {
  const r = getRound(idParam(req.params.id));
  const name = str(req.body.name, { label: 'Round name', max: 80, required: true });
  const description = str(req.body.description, { label: 'Description', max: 1000 });
  const isElim = req.body.is_elimination === undefined ? r.is_elimination : bool(req.body.is_elimination);
  const state = req.body.state === undefined ? r.state : oneOf(req.body.state, ['upcoming', 'live', 'judging', 'completed'], 'State');
  q.run('UPDATE rounds SET name = ?, description = ?, is_elimination = ?, state = ? WHERE id = ?', name, description, isElim, state, r.id);
  events.emit('rounds', { round: r.number }, 'comp:hackathon');
  res.json({ round: getRound(r.id) });
});

router.post('/rounds/:id/criteria', (req, res) => {
  const r = getRound(idParam(req.params.id));
  const name = str(req.body.name, { label: 'Criterion name', max: 80, required: true });
  const max = num(req.body.max_score, { label: 'Maximum score', min: 1, max: 1000 });
  if (r.criteria.length >= 12) fail(400, 'A round can have up to 12 criteria.');
  const sort = r.criteria.length ? Math.max(...r.criteria.map((c) => c.sort)) + 1 : 0;
  q.run('INSERT INTO criteria (round_id, name, max_score, sort) VALUES (?, ?, ?, ?)', r.id, name, max, sort);
  events.emit('rounds', { round: r.number }, 'comp:hackathon');
  res.json({ round: getRound(r.id) });
});

router.put('/criteria/:id', (req, res) => {
  const id = idParam(req.params.id);
  const c = q.get('SELECT * FROM criteria WHERE id = ?', id);
  if (!c) fail(404, 'That criterion doesn’t exist.');
  const name = str(req.body.name, { label: 'Criterion name', max: 80, required: true });
  const max = num(req.body.max_score, { label: 'Maximum score', min: 1, max: 1000 });
  const highest = q.get(
    'SELECT MAX(x) AS m FROM (SELECT score AS x FROM scores WHERE criterion_id = ? UNION ALL SELECT score FROM judge_scores WHERE criterion_id = ?)',
    id,
    id
  ).m;
  if (highest !== null && highest > max) fail(400, `Some teams already scored ${highest} here. Set the maximum to at least ${highest}.`);
  q.run('UPDATE criteria SET name = ?, max_score = ? WHERE id = ?', name, max, id);
  events.emit('rounds', {}, 'comp:hackathon');
  res.json({ round: getRound(c.round_id) });
});

router.delete('/criteria/:id', (req, res) => {
  const id = idParam(req.params.id);
  const c = q.get('SELECT * FROM criteria WHERE id = ?', id);
  if (!c) fail(404, 'That criterion doesn’t exist.');
  q.run('DELETE FROM criteria WHERE id = ?', id);
  events.emit('rounds', {}, 'comp:hackathon');
  res.json({ round: getRound(c.round_id) });
});

router.get('/rounds/:id/sheet', (req, res) => {
  const sheet = results.roundSheet(idParam(req.params.id));
  if (!sheet) fail(404, 'That round doesn’t exist.');
  res.json(sheet);
});

router.get('/rounds/:id/sheet/:teamId', (req, res) => {
  const sheet = results.roundSheet(idParam(req.params.id));
  if (!sheet) fail(404, 'That round doesn’t exist.');
  res.json({ row: sheet.rows.find((r) => r.team_id === idParam(req.params.teamId)) || null });
});

// Each assigned judge's marks and comments for one team in one round.
router.get('/rounds/:id/sheet/:teamId/judges', (req, res) => {
  const round = getRound(idParam(req.params.id));
  const teamId = idParam(req.params.teamId);
  const team = q.get("SELECT id, code, name FROM teams WHERE id = ? AND competition = 'hackathon'", teamId);
  if (!team) fail(404, 'That team doesn’t exist.');
  const judges = q.all(
    `SELECT j.id, j.display_name, j.username FROM judge_assignments ja JOIN judges j ON j.id = ja.judge_id
      WHERE ja.round_id = ? AND ja.team_id = ? ORDER BY j.username`,
    round.id,
    teamId
  );
  res.json({
    round,
    team,
    judges: judges.map((j) => ({ ...results.judgeRow(j.id, round.id, teamId), judge_id: j.id, judge_name: j.display_name, judge_username: j.username })),
  });
});

router.put('/rounds/:id/sheet/:teamId', (req, res) => {
  const round = getRound(idParam(req.params.id));
  const teamId = idParam(req.params.teamId);
  const team = q.get("SELECT id, name FROM teams WHERE id = ? AND competition = 'hackathon'", teamId);
  if (!team) fail(404, 'That team doesn’t exist.');

  const scores = req.body.scores && typeof req.body.scores === 'object' ? req.body.scores : {};
  const updates = [];
  for (const [critId, value] of Object.entries(scores)) {
    const c = round.criteria.find((x) => x.id === Number(critId));
    if (!c) fail(400, 'One of the criteria no longer exists. Reload the page.');
    updates.push({ c, value: num(value, { label: c.name, min: 0, max: c.max_score, nullable: true }) });
  }

  const existing = q.get('SELECT * FROM results WHERE team_id = ? AND round_id = ?', teamId, round.id) || {
    status: 'pending',
    comments: '',
    award: '',
  };
  const status = req.body.status === undefined ? existing.status : oneOf(req.body.status, ['pending', 'selected', 'eliminated'], 'Status');
  const comments = req.body.comments === undefined ? existing.comments : str(req.body.comments, { label: 'Judges’ comments', max: 4000 });
  const award = req.body.award === undefined ? existing.award : str(req.body.award, { label: 'Award', max: 80 });

  tx(() => {
    for (const { c, value } of updates) {
      if (value === null) q.run('DELETE FROM scores WHERE team_id = ? AND criterion_id = ?', teamId, c.id);
      else
        q.run(
          'INSERT INTO scores (team_id, criterion_id, score) VALUES (?, ?, ?) ON CONFLICT(team_id, criterion_id) DO UPDATE SET score = excluded.score',
          teamId,
          c.id,
          value
        );
    }
    q.run(
      `INSERT INTO results (team_id, round_id, status, comments, award, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, round_id) DO UPDATE SET status = excluded.status, comments = excluded.comments, award = excluded.award,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      teamId,
      round.id,
      status,
      comments,
      award,
      req.user.name,
      now()
    );
  });

  const row = results.roundSheet(round.id).rows.find((r) => r.team_id === teamId);
  events.emit('sheet', { round_id: round.id, team_id: teamId, by: req.user.name, row }, 'admins:hackathon');
  if (round.published) events.emit('results', { round: round.number, kind: 'updated' }, `team:${teamId}`);
  // Status changes in earlier rounds change who is eligible later on.
  if (req.body.status !== undefined && req.body.status !== existing.status) events.emit('rounds', {}, 'admins:hackathon');
  res.json({ row });
});

// Mark the top N eligible teams as selected and the rest as eliminated.
router.post('/rounds/:id/auto-select', (req, res) => {
  const round = getRound(idParam(req.params.id));
  if (!round.is_elimination) fail(400, 'This round has no eliminations, so everyone moves on.');
  const top = int(req.body.top, { label: 'Number of teams', min: 1, max: 10000 });
  const sheet = results.roundSheet(round.id);
  const eligible = sheet.rows.filter((r) => r.eligible).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  if (!eligible.length) fail(400, 'No teams are eligible for this round.');

  const cutoff = eligible[Math.min(top, eligible.length) - 1].total;
  const ts = now();
  let selected = 0;
  tx(() => {
    for (const [i, r] of eligible.entries()) {
      // Teams tied with the last qualifying score all go through.
      const status = i < top || (r.total !== null && r.total === cutoff) ? 'selected' : 'eliminated';
      if (status === 'selected') selected++;
      q.run(
        `INSERT INTO results (team_id, round_id, status, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(team_id, round_id) DO UPDATE SET status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        r.team_id,
        round.id,
        status,
        req.user.name,
        ts
      );
    }
  });
  events.emit('rounds', {}, 'admins:hackathon');
  if (round.published) events.emit('results', { round: round.number, kind: 'updated' }, 'teams:hackathon');
  res.json({ selected, eliminated: eligible.length - selected, ties: selected - Math.min(top, eligible.length) });
});

router.post('/rounds/:id/publish', (req, res) => {
  const round = getRound(idParam(req.params.id));
  const published = bool(req.body.published);
  q.run(
    `UPDATE rounds SET published = ?, published_at = ?, state = CASE WHEN ? = 1 THEN 'completed' ELSE state END WHERE id = ?`,
    published,
    published ? now() : null,
    published,
    round.id
  );
  if (published && bool(req.body.announce)) {
    const title = `Round ${round.number} results are out`;
    const body = round.is_elimination
      ? `Results for Round ${round.number} (${round.name}) have been published. Open your scorecard to see whether your team is selected for the next round, along with your scores and the judges’ notes.`
      : `Scores for Round ${round.number} (${round.name}) are published. Open your scorecard for your scores and the judges’ notes.`;
    const { id } = q.run(
      "INSERT INTO announcements (title, body, priority, audience, competition, author, created_at) VALUES (?, ?, 'important', 'all', 'hackathon', ?, ?)",
      title,
      body,
      req.user.name,
      now()
    );
    events.emit('announcement', { id, title, priority: 'important' }, 'comp:hackathon');
  }
  events.emit('results', { round: round.number, kind: published ? 'published' : 'unpublished' }, 'comp:hackathon');
  res.json({ round: getRound(round.id) });
});

router.get('/leaderboard', (req, res) => {
  res.json(results.leaderboard({ publishedOnly: false }));
});

module.exports = router;
