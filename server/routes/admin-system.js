'use strict';
const express = require('express');
const { q, tx, now, getSettings, setSettings, SETTING_DEFAULTS } = require('../db');
const auth = require('../auth');
const events = require('../events');
const results = require('../services/results');
const content = require('../services/content');
const { str, bool, isoDate, idParam, fail, sendCsv } = require('../util');

const router = express.Router();

const ticketCount = (comp, where) =>
  q.get(`SELECT COUNT(*) AS n FROM tickets k JOIN teams t ON t.id = k.team_id WHERE t.competition = ? AND ${where}`, comp).n;

router.get('/dashboard', (req, res) => {
  const comp = req.user.competition;
  const teams = q.all('SELECT id, code, name, leader_name, active, last_login_at FROM teams WHERE competition = ? ORDER BY code', comp);
  const rounds = results.loadRounds();
  const { resultMap } = results.loadScoreMaps();
  const active = teams.filter((t) => t.active);
  const out = comp === 'hackathon' ? active.filter((t) => results.eliminatedIn(t.id, rounds, resultMap, { publishedOnly: false }) !== null) : [];

  const extra = {};
  if (comp === 'hackathon') {
    extra.judging = {
      judges: q.get('SELECT COUNT(*) AS n FROM judges WHERE active = 1').n,
      rounds: rounds.map((r) => ({
        number: r.number,
        name: r.name,
        open: r.judging_open,
        assigned: q.get('SELECT COUNT(*) AS n FROM judge_assignments WHERE round_id = ?', r.id).n,
        done: q.get(
          `SELECT COUNT(*) AS n FROM judge_feedback jf
             JOIN judge_assignments ja ON ja.judge_id = jf.judge_id AND ja.team_id = jf.team_id AND ja.round_id = jf.round_id
            WHERE jf.round_id = ? AND jf.submitted_at IS NOT NULL`,
          r.id
        ).n,
      })),
    };
  } else {
    extra.ideathon = {
      submissions: q.get("SELECT COUNT(*) AS n FROM submissions s JOIN teams t ON t.id = s.team_id WHERE t.competition = 'ideathon' AND t.active = 1").n,
      state: results.submissionsState(),
      results_published: getSettings('ideathon').results_published === '1',
    };
  }

  res.json({
    competition: comp,
    stats: {
      teams: teams.length,
      active: active.length,
      competing: active.length - out.length,
      eliminated: out.length,
      logged_in: active.filter((t) => t.last_login_at).length,
      tickets_open: ticketCount(comp, "k.status <> 'resolved'"),
      tickets_unread: ticketCount(comp, 'k.admin_unread = 1'),
      online: events.clientCount(),
    },
    never_logged_in: active.filter((t) => !t.last_login_at).map((t) => ({ id: t.id, code: t.code, name: t.name })),
    rounds: comp === 'hackathon' ? rounds.map((r) => ({ id: r.id, number: r.number, name: r.name, state: r.state, published: r.published, is_elimination: r.is_elimination })) : [],
    tickets: q
      .all(
        `SELECT t.id, t.subject, t.category, t.status, t.updated_at, t.admin_unread, tm.name AS team_name, tm.code AS team_code
           FROM tickets t JOIN teams tm ON tm.id = t.team_id
          WHERE t.status <> 'resolved' AND tm.competition = ? ORDER BY t.updated_at DESC LIMIT 5`,
        comp
      )
      .map((t) => ({ ...t, admin_unread: !!t.admin_unread })),
    announcements: q.all(`SELECT id, title, priority, created_at, author FROM announcements WHERE competition IN (?, 'both') ORDER BY created_at DESC LIMIT 3`, comp),
    settings: getSettings(comp),
    markers: content.markers(comp),
    serverTime: now(),
    ...extra,
  });
});

// Lightweight data every console page needs: settings, badges, dial markers.
router.get('/meta', (req, res) => {
  const comp = req.user.competition;
  res.json({
    me: req.user,
    competition: comp,
    settings: getSettings(comp),
    tickets_unread: ticketCount(comp, 'k.admin_unread = 1'),
    markers: content.markers(comp),
    serverTime: now(),
  });
});

// ---- settings ------------------------------------------------------------------------

router.get('/settings', (req, res) => res.json({ settings: getSettings(req.user.competition), competition: req.user.competition }));

router.put('/settings', (req, res) => {
  const comp = req.user.competition;
  const b = req.body || {};
  const out = {};
  const text = { event_name: 80, tagline: 160, venue: 160, helpdesk_contact: 600 };
  for (const [k, max] of Object.entries(text)) if (b[k] !== undefined) out[k] = str(b[k], { label: k.replace('_', ' '), max });
  if (b.event_name !== undefined && !out.event_name) fail(400, 'Event name is required.');
  const times = comp === 'ideathon' ? ['event_start', 'event_end', 'submission_deadline'] : ['event_start', 'event_end'];
  const label = { event_start: 'Start time', event_end: 'End time', submission_deadline: 'Submission deadline' };
  for (const k of times) if (b[k] !== undefined) out[k] = isoDate(b[k], { label: label[k], nullable: true }) || '';
  const flags = comp === 'ideathon'
    ? ['helpdesk_open', 'allow_password_change', 'submissions_enabled', 'submissions_open']
    : ['leaderboard_visible', 'helpdesk_open', 'allow_password_change'];
  for (const k of flags) if (b[k] !== undefined) out[k] = bool(b[k]) ? '1' : '0';
  if (b.team_code_prefix !== undefined) {
    const p = str(b.team_code_prefix, { label: 'Team ID prefix', max: 8 }).toUpperCase();
    if (p && !/^[A-Z0-9]+$/.test(p)) fail(400, 'Team ID prefix can only use letters and numbers.');
    const other = getSettings(comp === 'hackathon' ? 'ideathon' : 'hackathon').team_code_prefix.toUpperCase();
    if (p && p === other) fail(400, `The other competition already uses ${p}. Pick a different prefix so team IDs never clash.`);
    out.team_code_prefix = p || SETTING_DEFAULTS[comp].team_code_prefix;
  }
  const merged = { ...getSettings(comp), ...out };
  if (merged.event_start && merged.event_end && merged.event_end <= merged.event_start) fail(400, 'The end time must be after the start time.');
  setSettings(comp, out);
  events.emit('settings', {}, `comp:${comp}`);
  res.json({ settings: getSettings(comp) });
});

// ---- organiser accounts (own competition only) -----------------------------------------

router.get('/admins', (req, res) => {
  res.json({
    admins: q.all('SELECT id, username, display_name, created_at FROM admins WHERE competition = ? ORDER BY id', req.user.competition),
    me: req.user.id,
  });
});

router.put('/admins/:id', (req, res) => {
  const id = idParam(req.params.id);
  if (!q.get('SELECT 1 FROM admins WHERE id = ? AND competition = ?', id, req.user.competition)) fail(404, 'That organiser account doesn’t exist.');
  const name = str(req.body.display_name, { label: 'Display name', max: 60, required: true });
  q.run('UPDATE admins SET display_name = ? WHERE id = ?', name, id);
  res.json({ ok: true });
});

router.post('/admins/:id/password', async (req, res) => {
  const id = idParam(req.params.id);
  if (id === req.user.id) fail(400, 'Use “Change my password” for your own account.');
  const a = q.get('SELECT id, username FROM admins WHERE id = ? AND competition = ?', id, req.user.competition);
  if (!a) fail(404, 'That organiser account doesn’t exist.');
  const password = `${auth.generatePassword()}-${auth.generatePassword().slice(0, 4)}`;
  q.run('UPDATE admins SET password_hash = ? WHERE id = ?', await auth.hashPassword(password), id);
  auth.destroyUserSessions('admin', id);
  res.json({ username: a.username, password });
});

// ---- exports & backup ----------------------------------------------------------------------

router.get('/export/results.csv', (req, res) => {
  if (req.user.competition === 'ideathon') {
    const teams = q.all(
      `SELECT t.*, s.title AS idea_title FROM teams t LEFT JOIN submissions s ON s.team_id = t.id
        WHERE t.competition = 'ideathon' ORDER BY (t.award = ''), t.code`
    );
    return sendCsv(res, 'genesis-ideathon-results.csv', [
      ['team_id', 'team_name', 'leader_name', 'track', 'table', 'idea_title', 'award', 'note'],
      ...teams.map((t) => [t.code, t.name, t.leader_name, t.track, t.table_no, t.idea_title || '', t.award, t.result_note]),
    ]);
  }
  const board = results.leaderboard({ publishedOnly: false });
  const rounds = results.loadRounds();
  const teams = new Map(q.all("SELECT * FROM teams WHERE competition = 'hackathon'").map((t) => [t.id, t]));
  const { resultMap } = results.loadScoreMaps();
  const header = ['rank', 'team_id', 'team_name', 'leader_name', 'track', 'table'];
  for (const r of rounds) header.push(`r${r.number}_total (/${r.max_total})`, `r${r.number}_status`, `r${r.number}_comments`, `r${r.number}_award`);
  header.push('cumulative_total', 'eliminated_in_round');
  const rows = board.rows.map((row) => {
    const t = teams.get(row.team_id);
    const cells = [row.rank, t.code, t.name, t.leader_name, t.track, t.table_no];
    for (const r of rounds) {
      const rr = resultMap.get(`${t.id}:${r.id}`);
      const tot = row.rounds.find((x) => x.round === r.number);
      const reached = row.eliminated_in === null || r.number <= row.eliminated_in;
      cells.push(tot ? tot.total ?? '' : '', reached ? results.effectiveStatus(r, rr) : '', rr ? rr.comments : '', rr ? rr.award : '');
    }
    cells.push(row.total ?? '', row.eliminated_in ?? '');
    return cells;
  });
  sendCsv(res, 'genesis-hackathon-results.csv', [header, ...rows]);
});

router.get('/export/submissions.csv', auth.requireIdeathon, (req, res) => {
  const rows = q.all(
    `SELECT t.code, t.name, t.leader_name, s.* FROM submissions s JOIN teams t ON t.id = s.team_id
      WHERE t.competition = 'ideathon' ORDER BY t.code`
  );
  sendCsv(res, 'genesis-ideathon-submissions.csv', [
    ['team_id', 'team_name', 'leader_name', 'title', 'problem', 'solution', 'impact', 'deck_url', 'video_url', 'other_url', 'updated_at'],
    ...rows.map((r) => [r.code, r.name, r.leader_name, r.title, r.problem, r.solution, r.impact, r.deck_url, r.video_url, r.extra_url, r.updated_at]),
  ]);
});

// Everything for this competition except password hashes and sessions, as JSON.
router.get('/backup', (req, res) => {
  const comp = req.user.competition;
  const teams = q.all('SELECT * FROM teams WHERE competition = ? ORDER BY id', comp).map(({ password_hash, ...t }) => t);
  const teamIds = new Set(teams.map((t) => t.id));
  const data = {
    exported_at: now(),
    competition: comp,
    settings: getSettings(comp),
    teams,
    announcements: q.all(`SELECT * FROM announcements WHERE competition IN (?, 'both') ORDER BY id`, comp),
    tickets: q.all('SELECT id FROM tickets ORDER BY id').map((t) => content.ticketWithMessages(t.id)).filter((t) => teamIds.has(t.team_id)),
    schedule: content.listSchedule(comp),
  };
  if (comp === 'hackathon') {
    Object.assign(data, {
      rounds: results.loadRounds(),
      scores: q.all('SELECT * FROM scores'),
      results: q.all('SELECT * FROM results'),
      judges: q.all('SELECT id, username, display_name, active, last_login_at, created_at FROM judges ORDER BY id'),
      judge_assignments: q.all('SELECT * FROM judge_assignments'),
      judge_scores: q.all('SELECT * FROM judge_scores'),
      judge_feedback: q.all('SELECT * FROM judge_feedback'),
    });
  } else {
    data.submissions = q.all("SELECT s.* FROM submissions s JOIN teams t ON t.id = s.team_id WHERE t.competition = 'ideathon'");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="genesis-${comp}-backup-${stamp}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

// ---- reset (own competition only) --------------------------------------------------------------

router.post('/reset', (req, res) => {
  if (req.body.confirm !== 'RESET') fail(400, 'Type RESET to confirm.');
  const comp = req.user.competition;
  const scope = req.body.scope === 'everything' ? 'everything' : 'scores';
  tx(() => {
    if (comp === 'hackathon') {
      q.run('DELETE FROM scores');
      q.run('DELETE FROM results');
      q.run('DELETE FROM judge_scores');
      q.run('DELETE FROM judge_feedback');
      q.run("UPDATE rounds SET published = 0, published_at = NULL, state = 'upcoming'");
    } else {
      q.run("UPDATE teams SET award = '', result_note = '' WHERE competition = 'ideathon'");
      q.run("DELETE FROM submissions WHERE team_id IN (SELECT id FROM teams WHERE competition = 'ideathon')");
      setSettings('ideathon', { results_published: '0' });
    }
    if (scope === 'everything') {
      q.run("DELETE FROM sessions WHERE role = 'team' AND user_id IN (SELECT id FROM teams WHERE competition = ?)", comp);
      q.run('DELETE FROM tickets WHERE team_id IN (SELECT id FROM teams WHERE competition = ?)', comp);
      q.run('DELETE FROM announcements WHERE competition = ?', comp);
      q.run('DELETE FROM schedule WHERE competition = ?', comp);
      q.run('DELETE FROM teams WHERE competition = ?', comp);
      if (comp === 'hackathon') {
        q.run("DELETE FROM sessions WHERE role = 'judge'");
        q.run('DELETE FROM judges');
      }
    }
  });
  if (scope === 'everything') events.emit('signed-out', {}, `teams:${comp}`);
  events.emit('results', { kind: 'reset' }, `comp:${comp}`);
  events.emit('teams', {}, `admins:${comp}`);
  res.json({ ok: true, scope });
});

module.exports = router;
