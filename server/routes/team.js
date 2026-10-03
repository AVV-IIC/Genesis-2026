'use strict';
const express = require('express');
const { q, tx, now, getSettings } = require('../db');
const results = require('../services/results');
const content = require('../services/content');
const events = require('../events');
const auth = require('../auth');
const { str, oneOf, idParam, fail } = require('../util');

const router = express.Router();

function eventInfo(comp) {
  const s = getSettings(comp);
  return {
    event_name: s.event_name,
    tagline: s.tagline,
    venue: s.venue,
    event_start: s.event_start,
    event_end: s.event_end,
    leaderboard_visible: comp === 'hackathon' && s.leaderboard_visible === '1',
    helpdesk_open: s.helpdesk_open === '1',
    allow_password_change: s.allow_password_change === '1',
    helpdesk_contact: s.helpdesk_contact,
  };
}

const submissionOf = (teamId) => q.get('SELECT * FROM submissions WHERE team_id = ?', teamId) || null;

router.get('/overview', (req, res) => {
  const team = q.get('SELECT * FROM teams WHERE id = ?', req.user.id);
  const comp = team.competition;
  const journey = comp === 'hackathon' ? results.teamJourney(team.id) : [];
  const announcements = content.announcementsForTeam(team.id);
  const nowIso = now();
  const schedule = content.listSchedule(comp);
  const s = getSettings(comp);
  const published = comp === 'ideathon' && s.results_published === '1';

  res.json({
    competition: comp,
    team: {
      code: team.code,
      name: team.name,
      leader_name: team.leader_name,
      email: team.email,
      phone: team.phone,
      members: JSON.parse(team.members || '[]'),
      track: team.track,
      table_no: team.table_no,
    },
    event: eventInfo(comp),
    journey,
    standing: comp === 'hackathon' ? results.standing(journey) : null,
    submission: comp === 'ideathon' ? { ...results.submissionsState(), mine: submissionOf(team.id) } : null,
    result: comp === 'ideathon' ? { published, award: published ? team.award : '', note: published ? team.result_note : '' } : null,
    announcements: announcements.slice(0, 3),
    unread: announcements.filter((a) => !team.announcements_seen_at || a.created_at > team.announcements_seen_at).length,
    announcements_seen_at: team.announcements_seen_at,
    tickets_unread: q.get('SELECT COUNT(*) AS n FROM tickets WHERE team_id = ? AND team_unread = 1', team.id).n,
    upcoming: schedule.filter((e) => (e.ends_at || e.starts_at) >= nowIso).slice(0, 4),
    markers: content.markers(comp),
    serverTime: nowIso,
  });
});

router.get('/announcements', (req, res) => {
  const seen = q.get('SELECT announcements_seen_at FROM teams WHERE id = ?', req.user.id).announcements_seen_at;
  res.json({ announcements: content.announcementsForTeam(req.user.id), seen_at: seen });
});

router.post('/announcements/seen', (req, res) => {
  q.run('UPDATE teams SET announcements_seen_at = ? WHERE id = ?', now(), req.user.id);
  res.json({ ok: true });
});

router.get('/schedule', (req, res) => {
  res.json({ schedule: content.listSchedule(req.user.competition), serverTime: now() });
});

router.get('/leaderboard', (req, res) => {
  if (req.user.competition !== 'hackathon' || getSettings('hackathon').leaderboard_visible !== '1') {
    fail(403, 'The leaderboard is hidden right now.');
  }
  res.json({ ...results.leaderboard({ publishedOnly: true }), me: req.user.id });
});

// ---- ideathon: idea submission ------------------------------------------------------

function url(value, label) {
  const v = str(value, { label, max: 500 });
  if (v && !/^https?:\/\/\S+$/i.test(v)) fail(400, `${label} must be a full link starting with https://`);
  return v;
}

router.get('/submission', auth.requireIdeathon, (req, res) => {
  res.json({ ...results.submissionsState(), submission: submissionOf(req.user.id) });
});

router.put('/submission', auth.requireIdeathon, (req, res) => {
  const st = results.submissionsState();
  if (!st.enabled) fail(403, 'Idea submissions are turned off for this Ideathon.');
  if (!st.open) fail(403, 'Submissions are closed, so your idea can no longer be changed.');
  const b = req.body || {};
  const v = {
    title: str(b.title, { label: 'Idea title', max: 120, required: true }),
    problem: str(b.problem, { label: 'Problem', max: 2000, required: true }),
    solution: str(b.solution, { label: 'Solution', max: 3000, required: true }),
    impact: str(b.impact, { label: 'Impact', max: 1500 }),
    deck_url: url(b.deck_url, 'Pitch deck link'),
    video_url: url(b.video_url, 'Video link'),
    extra_url: url(b.extra_url, 'Other link'),
  };
  const ts = now();
  q.run(
    `INSERT INTO submissions (team_id, title, problem, solution, impact, deck_url, video_url, extra_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(team_id) DO UPDATE SET title = excluded.title, problem = excluded.problem, solution = excluded.solution,
       impact = excluded.impact, deck_url = excluded.deck_url, video_url = excluded.video_url, extra_url = excluded.extra_url,
       updated_at = excluded.updated_at`,
    req.user.id, v.title, v.problem, v.solution, v.impact, v.deck_url, v.video_url, v.extra_url, ts, ts
  );
  events.emit('submission', { team_id: req.user.id }, 'admins:ideathon');
  res.json({ submission: submissionOf(req.user.id) });
});

// ---- help desk -----------------------------------------------------------------

router.get('/tickets', (req, res) => {
  const tickets = q.all(
    `SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM tickets t WHERE t.team_id = ? ORDER BY t.updated_at DESC`,
    req.user.id
  );
  const s = getSettings(req.user.competition);
  res.json({
    tickets: tickets.map((t) => ({ ...t, team_unread: !!t.team_unread, admin_unread: !!t.admin_unread })),
    categories: content.TICKET_CATEGORIES,
    open: s.helpdesk_open === '1',
    contact: s.helpdesk_contact,
  });
});

router.post('/tickets', (req, res) => {
  if (getSettings(req.user.competition).helpdesk_open !== '1') fail(403, 'The help desk is closed right now. Find an organiser in person.');
  const category = oneOf(req.body.category, content.TICKET_CATEGORIES, 'Category');
  const subject = str(req.body.subject, { label: 'Subject', max: 120, required: true });
  const body = str(req.body.message, { label: 'Message', max: 3000, required: true });
  const openCount = q.get("SELECT COUNT(*) AS n FROM tickets WHERE team_id = ? AND status <> 'resolved'", req.user.id).n;
  if (openCount >= 10) fail(429, 'You have 10 open requests. Wait for replies before raising more.');

  const id = tx(() => {
    const ts = now();
    const { id } = q.run(
      'INSERT INTO tickets (team_id, category, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      req.user.id, category, subject, ts, ts
    );
    q.run(
      "INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'team', ?, ?, ?)",
      id, req.user.leader || req.user.name, body, ts
    );
    return id;
  });
  events.emit('ticket', { id, kind: 'new', team: req.user.name, subject }, `admins:${req.user.competition}`);
  res.json({ ticket: content.ticketWithMessages(id) });
});

function ownTicket(req) {
  const t = content.ticketWithMessages(idParam(req.params.id));
  if (!t || t.team_id !== req.user.id) fail(404, 'That request doesn’t exist.');
  return t;
}

router.get('/tickets/:id', (req, res) => {
  const t = ownTicket(req);
  if (t.team_unread) q.run('UPDATE tickets SET team_unread = 0 WHERE id = ?', t.id);
  res.json({ ticket: { ...t, team_unread: false } });
});

router.post('/tickets/:id/messages', (req, res) => {
  const t = ownTicket(req);
  const body = str(req.body.message, { label: 'Message', max: 3000, required: true });
  const ts = now();
  tx(() => {
    q.run(
      "INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'team', ?, ?, ?)",
      t.id, req.user.leader || req.user.name, body, ts
    );
    q.run(
      "UPDATE tickets SET updated_at = ?, admin_unread = 1, status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END WHERE id = ?",
      ts, t.id
    );
  });
  events.emit('ticket', { id: t.id, kind: 'reply', team: req.user.name, subject: t.subject }, `admins:${req.user.competition}`);
  res.json({ ticket: content.ticketWithMessages(t.id) });
});

module.exports = router;
