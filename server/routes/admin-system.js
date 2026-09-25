'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { db, q, tx, now, getSettings, setSettings, SETTING_DEFAULTS } = require('../db');
const { DATA_DIR } = require('../config');
const auth = require('../auth');
const events = require('../events');
const results = require('../services/results');
const { str, bool, isoDate, idParam, fail, sendCsv } = require('../util');

const router = express.Router();

router.get('/dashboard', (req, res) => {
  const teams = q.all('SELECT id, code, name, leader_name, active, last_login_at FROM teams ORDER BY code');
  const rounds = results.loadRounds();
  const { resultMap } = results.loadScoreMaps();
  const active = teams.filter((t) => t.active);
  const out = active.filter((t) => results.eliminatedIn(t.id, rounds, resultMap, { publishedOnly: false }) !== null);

  const ticketCounts = q.get(
    "SELECT SUM(status = 'open') AS open, SUM(status = 'in_progress') AS in_progress, SUM(admin_unread) AS unread FROM tickets"
  );
  const recentTickets = q.all(
    `SELECT t.id, t.subject, t.category, t.status, t.updated_at, t.admin_unread, tm.name AS team_name, tm.code AS team_code
       FROM tickets t JOIN teams tm ON tm.id = t.team_id
      WHERE t.status <> 'resolved' ORDER BY t.updated_at DESC LIMIT 5`
  );

  res.json({
    stats: {
      teams: teams.length,
      active: active.length,
      competing: active.length - out.length,
      eliminated: out.length,
      logged_in: active.filter((t) => t.last_login_at).length,
      tickets_open: (ticketCounts.open || 0) + (ticketCounts.in_progress || 0),
      tickets_unread: ticketCounts.unread || 0,
      online: events.clientCount(),
    },
    never_logged_in: active.filter((t) => !t.last_login_at).map((t) => ({ id: t.id, code: t.code, name: t.name })),
    rounds: rounds.map((r) => ({ id: r.id, number: r.number, name: r.name, state: r.state, published: r.published, is_elimination: r.is_elimination })),
    tickets: recentTickets.map((t) => ({ ...t, admin_unread: !!t.admin_unread })),
    announcements: q.all('SELECT id, title, priority, created_at, author FROM announcements ORDER BY created_at DESC LIMIT 3'),
    settings: getSettings(),
    markers: q.all("SELECT title, starts_at FROM schedule WHERE kind IN ('round','deadline') ORDER BY starts_at"),
    serverTime: now(),
  });
});

// Lightweight data every console page needs: settings, badges, dial markers.
router.get('/meta', (req, res) => {
  res.json({
    me: req.user,
    settings: getSettings(),
    tickets_unread: q.get('SELECT COUNT(*) AS n FROM tickets WHERE admin_unread = 1').n,
    markers: q.all("SELECT title, starts_at FROM schedule WHERE kind IN ('round','deadline') ORDER BY starts_at"),
    serverTime: now(),
  });
});

// ---- settings ------------------------------------------------------------------------

router.get('/settings', (req, res) => res.json({ settings: getSettings() }));

router.put('/settings', (req, res) => {
  const b = req.body || {};
  const out = {};
  const text = { event_name: 80, tagline: 160, venue: 160, helpdesk_contact: 600 };
  for (const [k, max] of Object.entries(text)) if (b[k] !== undefined) out[k] = str(b[k], { label: k.replace('_', ' '), max });
  if (b.event_name !== undefined && !out.event_name) fail(400, 'Event name is required.');
  for (const k of ['event_start', 'event_end']) if (b[k] !== undefined) out[k] = isoDate(b[k], { label: k === 'event_start' ? 'Start time' : 'End time', nullable: true }) || '';
  for (const k of ['leaderboard_visible', 'helpdesk_open', 'allow_password_change']) if (b[k] !== undefined) out[k] = bool(b[k]) ? '1' : '0';
  if (b.team_code_prefix !== undefined) {
    const p = str(b.team_code_prefix, { label: 'Team ID prefix', max: 8 }).toUpperCase();
    if (p && !/^[A-Z0-9]+$/.test(p)) fail(400, 'Team ID prefix can only use letters and numbers.');
    out.team_code_prefix = p || SETTING_DEFAULTS.team_code_prefix;
  }
  const merged = { ...getSettings(), ...out };
  if (merged.event_start && merged.event_end && merged.event_end <= merged.event_start) fail(400, 'The end time must be after the start time.');
  setSettings(out);
  events.emit('settings', {}, 'all');
  res.json({ settings: getSettings() });
});

// ---- admin accounts ---------------------------------------------------------------------

router.get('/admins', (req, res) => {
  res.json({ admins: q.all('SELECT id, username, display_name, created_at FROM admins ORDER BY id'), me: req.user.id });
});

router.put('/admins/:id', (req, res) => {
  const id = idParam(req.params.id);
  if (!q.get('SELECT 1 FROM admins WHERE id = ?', id)) fail(404, 'That organiser account doesn’t exist.');
  const name = str(req.body.display_name, { label: 'Display name', max: 60, required: true });
  q.run('UPDATE admins SET display_name = ? WHERE id = ?', name, id);
  res.json({ ok: true });
});

// Reset another organiser's password (e.g. they forgot it).
router.post('/admins/:id/password', async (req, res) => {
  const id = idParam(req.params.id);
  if (id === req.user.id) fail(400, 'Use “Change my password” for your own account.');
  const a = q.get('SELECT id, username FROM admins WHERE id = ?', id);
  if (!a) fail(404, 'That organiser account doesn’t exist.');
  const password = `${auth.generatePassword()}-${auth.generatePassword().slice(0, 4)}`;
  q.run('UPDATE admins SET password_hash = ? WHERE id = ?', await auth.hashPassword(password), id);
  auth.destroyUserSessions('admin', id);
  res.json({ username: a.username, password });
});

// ---- exports & backup ----------------------------------------------------------------------

router.get('/export/results.csv', (req, res) => {
  const board = results.leaderboard({ publishedOnly: false });
  const rounds = results.loadRounds();
  const teams = new Map(q.all('SELECT * FROM teams').map((t) => [t.id, t]));
  const { resultMap } = results.loadScoreMaps();
  const header = ['rank', 'team_id', 'team_name', 'leader_name', 'track', 'table'];
  for (const r of rounds) header.push(`r${r.number}_total (/${r.max_total})`, `r${r.number}_status`, `r${r.number}_comments`, `r${r.number}_award`);
  header.push('cumulative_total', 'eliminated_in_round');
  const rows = board.rows.map((row) => {
    const t = teams.get(row.team_id);
    const cells = [row.rank, t.code, t.name, t.leader_name, t.track, t.table_no];
    for (const r of rounds) {
      const res = resultMap.get(`${t.id}:${r.id}`);
      const tot = row.rounds.find((x) => x.round === r.number);
      const status = results.effectiveStatus(r, res);
      const reached = row.eliminated_in === null || r.number <= row.eliminated_in;
      cells.push(tot ? tot.total ?? '' : '', reached ? status : '', res ? res.comments : '', res ? res.award : '');
    }
    cells.push(row.total ?? '', row.eliminated_in ?? '');
    return cells;
  });
  sendCsv(res, 'genesis-results.csv', [header, ...rows]);
});

router.get('/backup', (req, res) => {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `genesis-${stamp}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  res.download(file, `genesis-backup-${stamp}.db`, () => fs.rm(file, { force: true }, () => {}));
});

// ---- reset -------------------------------------------------------------------------------------

router.post('/reset', (req, res) => {
  if (req.body.confirm !== 'RESET') fail(400, 'Type RESET to confirm.');
  const scope = req.body.scope === 'everything' ? 'everything' : 'scores';
  tx(() => {
    q.run('DELETE FROM scores');
    q.run('DELETE FROM results');
    q.run("UPDATE rounds SET published = 0, published_at = NULL, state = 'upcoming'");
    if (scope === 'everything') {
      q.run("DELETE FROM sessions WHERE role = 'team'");
      q.run('DELETE FROM ticket_messages');
      q.run('DELETE FROM tickets');
      q.run('DELETE FROM announcements');
      q.run('DELETE FROM schedule');
      q.run('DELETE FROM teams');
    }
  });
  if (scope === 'everything') events.emit('signed-out', {}, 'teams');
  events.emit('results', { kind: 'reset' }, 'all');
  events.emit('teams', {}, 'admins');
  res.json({ ok: true, scope });
});

module.exports = router;
