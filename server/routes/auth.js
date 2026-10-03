'use strict';
const express = require('express');
const { q, now, getSettings, compLabel } = require('../db');
const auth = require('../auth');
const { str, oneOf, fail } = require('../util');

const router = express.Router();

const TABLES = { admin: 'admins', team: 'teams', judge: 'judges' };
const PAGES = { admin: '/admin', team: '/team', judge: '/judge' };

router.post('/login', async (req, res) => {
  const competition = req.body.competition;
  if (!['hackathon', 'ideathon'].includes(competition)) fail(400, 'Choose Hackathon or Ideathon first.');
  const role = oneOf(req.body.role, ['team', 'admin', 'judge'], 'Role');
  if (role === 'judge' && competition !== 'hackathon') fail(400, 'Judges sign in under the Hackathon.');
  const username = str(req.body.username, { label: role === 'team' ? 'Team ID' : 'Username', max: 64, required: true });
  const password = str(req.body.password, { label: 'Password', max: 200, required: true, trim: false });
  const account = `${role}:${username.toLowerCase()}`;
  auth.throttle.check(account, req.ip);

  let user;
  if (role === 'admin') user = q.get('SELECT id, password_hash, competition, 1 AS active FROM admins WHERE username = ?', username);
  else if (role === 'judge') user = q.get("SELECT id, password_hash, active, 'hackathon' AS competition FROM judges WHERE username = ?", username);
  else user = q.get('SELECT id, password_hash, active, competition FROM teams WHERE code = ?', username);

  const ok = await auth.verifyPassword(password, user ? user.password_hash : auth.getDummyHash());
  if (!user || !ok) {
    auth.throttle.failed(account, req.ip);
    fail(
      401,
      role === 'team'
        ? 'That team ID and password don’t match. Check your credential slip or ask the organisers.'
        : 'That username and password don’t match.'
    );
  }
  if (user.competition !== competition) {
    const other = compLabel(user.competition);
    fail(
      403,
      role === 'team'
        ? `${username.toUpperCase()} is a ${other} team. Go back and choose ${other}.`
        : `This account belongs to the ${other}. Go back and choose ${other}.`
    );
  }
  if (!user.active) {
    fail(403, role === 'judge' ? 'This judge account is disabled. Contact the organisers.' : 'This team account is disabled. Contact the organisers.');
  }

  auth.throttle.clear(account);
  auth.createSession(req, res, role, user.id);
  if (role === 'team') q.run('UPDATE teams SET last_login_at = ? WHERE id = ?', now(), user.id);
  if (role === 'judge') q.run('UPDATE judges SET last_login_at = ? WHERE id = ?', now(), user.id);
  res.json({ ok: true, redirect: PAGES[role], role, competition });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: req.user });
});

router.post('/password', auth.requireAuth, async (req, res) => {
  const { role, id, competition } = req.user;
  if (role === 'team' && getSettings(competition).allow_password_change !== '1') {
    fail(403, 'Password changes are turned off. Ask the organisers if you need a new password.');
  }
  const current = str(req.body.current, { label: 'Current password', max: 200, required: true, trim: false });
  const next = str(req.body.next, { label: 'New password', max: 200, required: true, trim: false });
  if (next.length < 8) fail(400, 'New password must be at least 8 characters.');

  const table = TABLES[role];
  const row = q.get(`SELECT password_hash FROM ${table} WHERE id = ?`, id);
  if (!row || !(await auth.verifyPassword(current, row.password_hash))) fail(400, 'Current password is incorrect.');

  q.run(`UPDATE ${table} SET password_hash = ? WHERE id = ?`, await auth.hashPassword(next), id);
  auth.destroyUserSessions(role, id, req);
  res.json({ ok: true });
});

module.exports = router;
