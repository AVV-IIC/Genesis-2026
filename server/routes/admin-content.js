'use strict';
const express = require('express');
const { q, tx, now } = require('../db');
const events = require('../events');
const content = require('../services/content');
const { str, bool, oneOf, idParam, isoDate, fail } = require('../util');

const router = express.Router();

// ---- announcements ------------------------------------------------------------------

const AUDIENCES = { hackathon: ['all', 'competing', 'team', 'judges', 'everyone'], ideathon: ['all', 'team', 'everyone'] };

function readAnnouncement(comp, body) {
  const audience = oneOf(body.audience || 'all', AUDIENCES[comp], 'Audience');
  let teamId = null;
  if (audience === 'team') {
    teamId = Number(body.team_id);
    if (!q.get('SELECT 1 FROM teams WHERE id = ? AND competition = ?', teamId, comp)) fail(400, 'Pick the team this announcement is for.');
  }
  return {
    title: str(body.title, { label: 'Title', max: 140, required: true }),
    body: str(body.body, { label: 'Message', max: 5000 }),
    priority: oneOf(body.priority || 'normal', ['normal', 'important', 'urgent'], 'Priority'),
    audience,
    competition: audience === 'everyone' ? 'both' : comp,
    team_id: teamId,
    pinned: bool(body.pinned),
  };
}

function target(comp, a) {
  return { all: `comp:${comp}`, team: `team:${a.team_id}`, judges: 'judges', everyone: 'all', competing: 'competing' }[a.audience];
}

const ownAnnouncement = (req, id) => {
  const a = q.get(`SELECT * FROM announcements WHERE id = ? AND competition IN (?, 'both')`, id, req.user.competition);
  if (!a) fail(404, 'That announcement doesn’t exist.');
  return a;
};

router.get('/announcements', (req, res) => {
  const list = q.all(
    `SELECT a.*, t.name AS team_name, t.code AS team_code FROM announcements a
       LEFT JOIN teams t ON t.id = a.team_id
      WHERE a.competition IN (?, 'both') ORDER BY a.pinned DESC, a.created_at DESC`,
    req.user.competition
  );
  res.json({ announcements: list.map((a) => ({ ...a, pinned: !!a.pinned })) });
});

router.post('/announcements', (req, res) => {
  const comp = req.user.competition;
  const a = readAnnouncement(comp, req.body);
  const { id } = q.run(
    'INSERT INTO announcements (title, body, priority, audience, competition, team_id, pinned, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    a.title, a.body, a.priority, a.audience, a.competition, a.team_id, a.pinned, req.user.name, now()
  );
  const payload = { id, title: a.title, priority: a.priority };
  events.emit('announcement', payload, target(comp, a));
  // 'all' and 'everyone' already reach this competition's organisers (and judges).
  if (a.audience !== 'everyone' && a.audience !== 'all') events.emit('announcement', payload, `admins:${comp}`);
  res.json({ id });
});

router.put('/announcements/:id', (req, res) => {
  const id = idParam(req.params.id);
  ownAnnouncement(req, id);
  const a = readAnnouncement(req.user.competition, req.body);
  q.run(
    'UPDATE announcements SET title = ?, body = ?, priority = ?, audience = ?, competition = ?, team_id = ?, pinned = ?, updated_at = ? WHERE id = ?',
    a.title, a.body, a.priority, a.audience, a.competition, a.team_id, a.pinned, now(), id
  );
  events.emit('announcements', {}, 'all');
  res.json({ ok: true });
});

router.delete('/announcements/:id', (req, res) => {
  q.run(`DELETE FROM announcements WHERE id = ? AND competition IN (?, 'both')`, idParam(req.params.id), req.user.competition);
  events.emit('announcements', {}, 'all');
  res.json({ ok: true });
});

// ---- help desk ------------------------------------------------------------------------

function ownTicket(req) {
  const t = content.ticketWithMessages(idParam(req.params.id));
  if (!t || t.competition !== req.user.competition) fail(404, 'That request doesn’t exist.');
  return t;
}

router.get('/tickets', (req, res) => {
  const tickets = q.all(
    `SELECT t.*, tm.code AS team_code, tm.name AS team_name, tm.table_no,
            (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM tickets t JOIN teams tm ON tm.id = t.team_id
      WHERE tm.competition = ?
      ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.updated_at DESC`,
    req.user.competition
  );
  res.json({ tickets: tickets.map((t) => ({ ...t, admin_unread: !!t.admin_unread, team_unread: !!t.team_unread })) });
});

router.get('/tickets/:id', (req, res) => {
  const t = ownTicket(req);
  if (t.admin_unread) {
    q.run('UPDATE tickets SET admin_unread = 0 WHERE id = ?', t.id);
    events.emit('ticket', { id: t.id, kind: 'read' }, `admins:${req.user.competition}`);
  }
  res.json({ ticket: { ...t, admin_unread: false } });
});

router.post('/tickets/:id/messages', (req, res) => {
  const t = ownTicket(req);
  const body = str(req.body.message, { label: 'Reply', max: 3000, required: true });
  const status = req.body.status ? oneOf(req.body.status, ['open', 'in_progress', 'resolved'], 'Status') : t.status === 'open' ? 'in_progress' : t.status;
  const ts = now();
  tx(() => {
    q.run("INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'admin', ?, ?, ?)", t.id, req.user.name, body, ts);
    q.run('UPDATE tickets SET status = ?, updated_at = ?, team_unread = 1, admin_unread = 0 WHERE id = ?', status, ts, t.id);
  });
  events.emit('ticket', { id: t.id, subject: t.subject, kind: 'reply' }, `team:${t.team_id}`);
  events.emit('ticket', { id: t.id, kind: 'update' }, `admins:${req.user.competition}`);
  res.json({ ticket: content.ticketWithMessages(t.id) });
});

router.put('/tickets/:id', (req, res) => {
  const t = ownTicket(req);
  const status = oneOf(req.body.status, ['open', 'in_progress', 'resolved'], 'Status');
  q.run('UPDATE tickets SET status = ?, updated_at = ?, team_unread = 1 WHERE id = ?', status, now(), t.id);
  events.emit('ticket', { id: t.id, subject: t.subject, kind: 'status', status }, `team:${t.team_id}`);
  events.emit('ticket', { id: t.id, kind: 'update' }, `admins:${req.user.competition}`);
  res.json({ ticket: content.ticketWithMessages(t.id) });
});

// ---- schedule ---------------------------------------------------------------------------

function readScheduleItem(comp, body) {
  const starts = isoDate(body.starts_at, { label: 'Start time' });
  const ends = isoDate(body.ends_at, { label: 'End time', nullable: true });
  if (ends && ends < starts) fail(400, 'End time must be after the start time.');
  return {
    title: str(body.title, { label: 'Title', max: 120, required: true }),
    details: str(body.details, { label: 'Details', max: 1000 }),
    location: str(body.location, { label: 'Location', max: 120 }),
    kind: oneOf(body.kind || 'general', ['general', 'round', 'deadline', 'food', 'talk'], 'Type'),
    competition: body.scope === 'both' ? 'both' : comp,
    starts_at: starts,
    ends_at: ends,
  };
}

router.get('/schedule', (req, res) => res.json({ schedule: content.listSchedule(req.user.competition) }));

router.post('/schedule', (req, res) => {
  const s = readScheduleItem(req.user.competition, req.body);
  const { id } = q.run(
    'INSERT INTO schedule (title, details, location, kind, competition, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    s.title, s.details, s.location, s.kind, s.competition, s.starts_at, s.ends_at
  );
  events.emit('schedule', {}, 'all');
  res.json({ id });
});

router.put('/schedule/:id', (req, res) => {
  const id = idParam(req.params.id);
  if (!q.get(`SELECT 1 FROM schedule WHERE id = ? AND competition IN (?, 'both')`, id, req.user.competition)) {
    fail(404, 'That schedule item doesn’t exist.');
  }
  const s = readScheduleItem(req.user.competition, req.body);
  q.run(
    'UPDATE schedule SET title = ?, details = ?, location = ?, kind = ?, competition = ?, starts_at = ?, ends_at = ? WHERE id = ?',
    s.title, s.details, s.location, s.kind, s.competition, s.starts_at, s.ends_at, id
  );
  events.emit('schedule', {}, 'all');
  res.json({ ok: true });
});

router.delete('/schedule/:id', (req, res) => {
  q.run(`DELETE FROM schedule WHERE id = ? AND competition IN (?, 'both')`, idParam(req.params.id), req.user.competition);
  events.emit('schedule', {}, 'all');
  res.json({ ok: true });
});

module.exports = router;
