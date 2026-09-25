'use strict';
const express = require('express');
const { q, tx, now } = require('../db');
const events = require('../events');
const results = require('../services/results');
const content = require('../services/content');
const { str, bool, oneOf, idParam, isoDate, fail } = require('../util');

const router = express.Router();

// ---- announcements ------------------------------------------------------------------

function readAnnouncement(body) {
  const audience = oneOf(body.audience || 'all', ['all', 'competing', 'team'], 'Audience');
  let teamId = null;
  if (audience === 'team') {
    teamId = Number(body.team_id);
    if (!q.get('SELECT 1 FROM teams WHERE id = ?', teamId)) fail(400, 'Pick the team this announcement is for.');
  }
  return {
    title: str(body.title, { label: 'Title', max: 140, required: true }),
    body: str(body.body, { label: 'Message', max: 5000 }),
    priority: oneOf(body.priority || 'normal', ['normal', 'important', 'urgent'], 'Priority'),
    audience,
    team_id: teamId,
    pinned: bool(body.pinned),
  };
}

function recipients(a) {
  if (a.audience === 'all') return 'teams';
  if (a.audience === 'team') return { teamId: a.team_id };
  const ids = q.all('SELECT id FROM teams WHERE active = 1').map((t) => t.id).filter((id) => results.isCompeting(id));
  return { teamIds: ids };
}

router.get('/announcements', (req, res) => {
  const list = q.all(
    `SELECT a.*, t.name AS team_name, t.code AS team_code FROM announcements a
       LEFT JOIN teams t ON t.id = a.team_id ORDER BY a.pinned DESC, a.created_at DESC`
  );
  res.json({ announcements: list.map((a) => ({ ...a, pinned: !!a.pinned })) });
});

router.post('/announcements', (req, res) => {
  const a = readAnnouncement(req.body);
  const { id } = q.run(
    'INSERT INTO announcements (title, body, priority, audience, team_id, pinned, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    a.title,
    a.body,
    a.priority,
    a.audience,
    a.team_id,
    a.pinned,
    req.user.name,
    now()
  );
  const payload = { id, title: a.title, priority: a.priority };
  events.emit('announcement', payload, recipients(a));
  events.emit('announcement', payload, 'admins');
  res.json({ id });
});

router.put('/announcements/:id', (req, res) => {
  const id = idParam(req.params.id);
  if (!q.get('SELECT 1 FROM announcements WHERE id = ?', id)) fail(404, 'That announcement doesn’t exist.');
  const a = readAnnouncement(req.body);
  q.run(
    'UPDATE announcements SET title = ?, body = ?, priority = ?, audience = ?, team_id = ?, pinned = ?, updated_at = ? WHERE id = ?',
    a.title,
    a.body,
    a.priority,
    a.audience,
    a.team_id,
    a.pinned,
    now(),
    id
  );
  events.emit('announcements', {}, 'all');
  res.json({ ok: true });
});

router.delete('/announcements/:id', (req, res) => {
  q.run('DELETE FROM announcements WHERE id = ?', idParam(req.params.id));
  events.emit('announcements', {}, 'all');
  res.json({ ok: true });
});

// ---- help desk ------------------------------------------------------------------------

router.get('/tickets', (req, res) => {
  const tickets = q.all(
    `SELECT t.*, tm.code AS team_code, tm.name AS team_name, tm.table_no,
            (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM tickets t JOIN teams tm ON tm.id = t.team_id
      ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.updated_at DESC`
  );
  res.json({ tickets: tickets.map((t) => ({ ...t, admin_unread: !!t.admin_unread, team_unread: !!t.team_unread })) });
});

router.get('/tickets/:id', (req, res) => {
  const t = content.ticketWithMessages(idParam(req.params.id));
  if (!t) fail(404, 'That request doesn’t exist.');
  if (t.admin_unread) {
    q.run('UPDATE tickets SET admin_unread = 0 WHERE id = ?', t.id);
    events.emit('ticket', { id: t.id, kind: 'read' }, 'admins');
  }
  res.json({ ticket: { ...t, admin_unread: false } });
});

router.post('/tickets/:id/messages', (req, res) => {
  const t = content.ticketWithMessages(idParam(req.params.id));
  if (!t) fail(404, 'That request doesn’t exist.');
  const body = str(req.body.message, { label: 'Reply', max: 3000, required: true });
  const status = req.body.status ? oneOf(req.body.status, ['open', 'in_progress', 'resolved'], 'Status') : t.status === 'open' ? 'in_progress' : t.status;
  const ts = now();
  tx(() => {
    q.run(
      "INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'admin', ?, ?, ?)",
      t.id,
      req.user.name,
      body,
      ts
    );
    q.run('UPDATE tickets SET status = ?, updated_at = ?, team_unread = 1, admin_unread = 0 WHERE id = ?', status, ts, t.id);
  });
  events.emit('ticket', { id: t.id, subject: t.subject, kind: 'reply' }, { teamId: t.team_id });
  events.emit('ticket', { id: t.id, kind: 'update' }, 'admins');
  res.json({ ticket: content.ticketWithMessages(t.id) });
});

router.put('/tickets/:id', (req, res) => {
  const t = content.ticketWithMessages(idParam(req.params.id));
  if (!t) fail(404, 'That request doesn’t exist.');
  const status = oneOf(req.body.status, ['open', 'in_progress', 'resolved'], 'Status');
  q.run('UPDATE tickets SET status = ?, updated_at = ?, team_unread = 1 WHERE id = ?', status, now(), t.id);
  events.emit('ticket', { id: t.id, subject: t.subject, kind: 'status', status }, { teamId: t.team_id });
  events.emit('ticket', { id: t.id, kind: 'update' }, 'admins');
  res.json({ ticket: content.ticketWithMessages(t.id) });
});

// ---- schedule ---------------------------------------------------------------------------

function readScheduleItem(body) {
  const starts = isoDate(body.starts_at, { label: 'Start time' });
  const ends = isoDate(body.ends_at, { label: 'End time', nullable: true });
  if (ends && ends < starts) fail(400, 'End time must be after the start time.');
  return {
    title: str(body.title, { label: 'Title', max: 120, required: true }),
    details: str(body.details, { label: 'Details', max: 1000 }),
    location: str(body.location, { label: 'Location', max: 120 }),
    kind: oneOf(body.kind || 'general', ['general', 'round', 'deadline', 'food', 'talk'], 'Type'),
    starts_at: starts,
    ends_at: ends,
  };
}

router.get('/schedule', (req, res) => res.json({ schedule: content.listSchedule() }));

router.post('/schedule', (req, res) => {
  const s = readScheduleItem(req.body);
  const { id } = q.run(
    'INSERT INTO schedule (title, details, location, kind, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)',
    s.title,
    s.details,
    s.location,
    s.kind,
    s.starts_at,
    s.ends_at
  );
  events.emit('schedule', {}, 'all');
  res.json({ id });
});

router.put('/schedule/:id', (req, res) => {
  const id = idParam(req.params.id);
  if (!q.get('SELECT 1 FROM schedule WHERE id = ?', id)) fail(404, 'That schedule item doesn’t exist.');
  const s = readScheduleItem(req.body);
  q.run(
    'UPDATE schedule SET title = ?, details = ?, location = ?, kind = ?, starts_at = ?, ends_at = ? WHERE id = ?',
    s.title,
    s.details,
    s.location,
    s.kind,
    s.starts_at,
    s.ends_at,
    id
  );
  events.emit('schedule', {}, 'all');
  res.json({ ok: true });
});

router.delete('/schedule/:id', (req, res) => {
  q.run('DELETE FROM schedule WHERE id = ?', idParam(req.params.id));
  events.emit('schedule', {}, 'all');
  res.json({ ok: true });
});

module.exports = router;
