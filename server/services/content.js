'use strict';
// Announcements, schedule and help desk helpers shared by team and admin routes.

const { q } = require('../db');
const { isCompeting } = require('./results');

function announcementsForTeam(teamId) {
  const competing = isCompeting(teamId);
  return q
    .all('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC')
    .filter(
      (a) =>
        a.audience === 'all' ||
        (a.audience === 'team' && a.team_id === teamId) ||
        (a.audience === 'competing' && competing)
    )
    .map(publicAnnouncement);
}

function publicAnnouncement(a) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    priority: a.priority,
    pinned: !!a.pinned,
    audience: a.audience,
    author: a.author,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

function unreadCount(teamId, seenAt) {
  return announcementsForTeam(teamId).filter((a) => !seenAt || a.created_at > seenAt).length;
}

const listSchedule = () => q.all('SELECT * FROM schedule ORDER BY starts_at, id');

function ticketWithMessages(ticketId) {
  const t = q.get(
    `SELECT t.*, tm.code AS team_code, tm.name AS team_name, tm.table_no
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

module.exports = { announcementsForTeam, publicAnnouncement, unreadCount, listSchedule, ticketWithMessages, TICKET_CATEGORIES };
