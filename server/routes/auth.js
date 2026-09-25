'use strict';
const express = require('express');
const { q, now, getSettings } = require('../db');
const auth = require('../auth');
const { str, oneOf, fail } = require('../util');

const router = express.Router();

router.post('/login', async (req, res) => {
  const role = oneOf(req.body.role, ['team', 'admin'], 'Role');
  const username = str(req.body.username, { label: role === 'team' ? 'Team ID' : 'Username', max: 64, required: true });
  const password = str(req.body.password, { label: 'Password', max: 200, required: true, trim: false });
  const account = `${role}:${username.toLowerCase()}`;
  auth.throttle.check(account, req.ip);

  const user =
    role === 'admin'
      ? q.get('SELECT id, password_hash FROM admins WHERE username = ?', username)
      : q.get('SELECT id, password_hash, active FROM teams WHERE code = ?', username);

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
  if (role === 'team' && !user.active) fail(403, 'This team account is disabled. Contact the organisers.');

  auth.throttle.clear(account);
  auth.createSession(req, res, role, user.id);
  if (role === 'team') q.run('UPDATE teams SET last_login_at = ? WHERE id = ?', now(), user.id);
  res.json({ ok: true, redirect: role === 'admin' ? '/admin' : '/team' });
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
  const { role, id } = req.user;
  if (role === 'team' && getSettings().allow_password_change !== '1') {
    fail(403, 'Password changes are turned off. Ask the organisers if you need a new password.');
  }
  const current = str(req.body.current, { label: 'Current password', max: 200, required: true, trim: false });
  const next = str(req.body.next, { label: 'New password', max: 200, required: true, trim: false });
  if (next.length < 8) fail(400, 'New password must be at least 8 characters.');

  const table = role === 'admin' ? 'admins' : 'teams';
  const row = q.get(`SELECT password_hash FROM ${table} WHERE id = ?`, id);
  if (!row || !(await auth.verifyPassword(current, row.password_hash))) fail(400, 'Current password is incorrect.');

  q.run(`UPDATE ${table} SET password_hash = ? WHERE id = ?`, await auth.hashPassword(next), id);
  auth.destroyUserSessions(role, id, req);
  res.json({ ok: true });
});

module.exports = router;
