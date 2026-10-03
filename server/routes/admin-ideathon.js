'use strict';
// Organiser: Ideathon idea submissions and final results.
const express = require('express');
const { q, now, getSettings, setSettings } = require('../db');
const events = require('../events');
const results = require('../services/results');
const { str, bool, idParam, fail } = require('../util');

const router = express.Router();

router.get('/submissions', (req, res) => {
  res.json({
    ...results.submissionsState(),
    submissions: q.all(
      `SELECT s.*, t.code, t.name, t.leader_name, t.track, t.table_no FROM submissions s JOIN teams t ON t.id = s.team_id
        WHERE t.competition = 'ideathon' ORDER BY s.updated_at DESC`
    ),
    missing: q.all(
      `SELECT id AS team_id, code, name, leader_name FROM teams
        WHERE competition = 'ideathon' AND active = 1 AND id NOT IN (SELECT team_id FROM submissions) ORDER BY code`
    ),
  });
});

router.get('/results', (req, res) => {
  res.json({
    published: getSettings('ideathon').results_published === '1',
    teams: q
      .all(
        `SELECT t.id, t.code, t.name, t.leader_name, t.track, t.active, t.award, t.result_note, s.title AS submission_title
           FROM teams t LEFT JOIN submissions s ON s.team_id = t.id
          WHERE t.competition = 'ideathon' ORDER BY (t.award = ''), t.code`
      )
      .map((t) => ({ ...t, active: !!t.active })),
  });
});

router.put('/results/:teamId', (req, res) => {
  const id = idParam(req.params.teamId);
  if (!q.get("SELECT 1 FROM teams WHERE id = ? AND competition = 'ideathon'", id)) fail(404, 'That team doesn’t exist.');
  const award = str(req.body.award, { label: 'Award', max: 80 });
  const note = str(req.body.result_note, { label: 'Note', max: 1000 });
  q.run('UPDATE teams SET award = ?, result_note = ? WHERE id = ?', award, note, id);
  if (getSettings('ideathon').results_published === '1') events.emit('results', { kind: 'updated' }, `team:${id}`);
  res.json({ team: { id, award, result_note: note } });
});

router.post('/results/publish', (req, res) => {
  const published = bool(req.body.published);
  setSettings('ideathon', { results_published: published ? '1' : '0' });
  if (published && bool(req.body.announce)) {
    const name = getSettings('ideathon').event_name;
    const { id } = q.run(
      "INSERT INTO announcements (title, body, priority, audience, competition, author, created_at) VALUES (?, ?, 'important', 'all', 'ideathon', ?, ?)",
      `${name} results are out`,
      'The results are published. Open your dashboard to see how your team did. Thank you for taking part!',
      req.user.name,
      now()
    );
    events.emit('announcement', { id, title: `${name} results are out`, priority: 'important' }, 'comp:ideathon');
  }
  events.emit('results', { kind: published ? 'published' : 'unpublished' }, 'comp:ideathon');
  res.json({ published });
});

module.exports = router;
