'use strict';
// Announcements, schedule and help desk helpers shared by the team, judge and
// organiser routes. Everything is scoped by competition.

const { q } = require('../db');
const { isCompeting } = require('./results');

function publicAnnouncement(a) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    priority: a.priority,
    pinned: !!a.pinned,
    audience: a.audience,
    competition: a.competition,
    author: a.author,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

function announcementsForTeam(teamId) {
  const team = q.get('SELECT competition FROM teams WHERE id = ?', teamId);
  if (!team) return [];
  const comp = team.competition;
  let competing = null;
  return q
    .all(
      `SELECT * FROM announcements WHERE competition IN (?, 'both') ORDER BY pinned DESC, created_at DESC`,
      comp
    )
    .filter((a) => {
      if (a.audience === 'all' || a.audience === 'everyone') return true;
      if (a.audience === 'team') return a.team_id === teamId;
      if (a.audience === 'competing' && comp === 'hackathon') {
        if (competing === null) competing = isCompeting(teamId);
        return competing;
      }
      return false;
    })
    .map(publicAnnouncement);
}

function announcementsForJudges() {
  return q
    .all(
      `SELECT * FROM announcements WHERE competition IN ('hackathon', 'both') AND audience IN ('all', 'everyone', 'judges')
        ORDER BY pinned DESC, created_at DESC`
    )
    .map(publicAnnouncement);
}

const listSchedule = (comp) => q.all(`SELECT * FROM schedule WHERE competition IN (?, 'both') ORDER BY starts_at, id`, comp);

const markers = (comp) =>
  q.all(`SELECT title, starts_at FROM schedule WHERE kind IN ('round','deadline') AND competition IN (?, 'both') ORDER BY starts_at`, comp);

function ticketWithMessages(ticketId) {
  const t = q.get(
    `SELECT t.*, tm.code AS team_code, tm.name AS team_name, tm.table_no, tm.competition
       FROM tickets t JOIN teams tm ON tm.id = t.team_id WHERE t.id = ?`,
    ticketId
  );
  if (!t) return null;
  t.messages = q.all('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, id', ticketId);
  t.team_unread = !!t.team_unread;
  t.admin_unread = !!t.admin_unread;
  return t;
}

const TICKET_CATEGORIES = ['Technical help', 'Mentor request', 'Wi-Fi / power', 'Food & logistics', 'Evaluation query', 'Other'];

module.exports = {
  announcementsForTeam,
  announcementsForJudges,
  publicAnnouncement,
  listSchedule,
  markers,
  ticketWithMessages,
  TICKET_CATEGORIES,
};
