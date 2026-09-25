'use strict';
const express = require('express');
const { q, tx, now, getSettings } = require('../db');
const auth = require('../auth');
const events = require('../events');
const results = require('../services/results');
const { str, bool, idParam, fail, parseCsv, sendCsv, parseMembers } = require('../util');

const router = express.Router();

const CODE_RE = /^[A-Za-z0-9_-]{2,32}$/;

function shapeTeam(t) {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    leader_name: t.leader_name,
    email: t.email,
    phone: t.phone,
    members: JSON.parse(t.members || '[]'),
    track: t.track,
    table_no: t.table_no,
    notes: t.notes,
    active: !!t.active,
    last_login_at: t.last_login_at,
    created_at: t.created_at,
  };
}

function readTeamFields(body) {
  return {
    name: str(body.name, { label: 'Team name', max: 80, required: true }),
    leader_name: str(body.leader_name, { label: 'Team leader name', max: 80 }),
    email: str(body.email, { label: 'Email', max: 120 }),
    phone: str(body.phone, { label: 'Phone', max: 30 }),
    members: parseMembers(body.members),
    track: str(body.track, { label: 'Track', max: 120 }),
    table_no: str(body.table_no, { label: 'Table', max: 20 }),
    notes: str(body.notes, { label: 'Notes', max: 1000 }),
  };
}

function nextCodes(count, taken = new Set()) {
  const prefix = (getSettings().team_code_prefix || 'GEN').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'GEN';
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
  let max = 0;
  for (const { code } of q.all('SELECT code FROM teams')) {
    const m = re.exec(code);
    if (m) max = Math.max(max, Number(m[1]));
    taken.add(code.toUpperCase());
  }
  const out = [];
  while (out.length < count) {
    max++;
    const code = `${prefix}${String(max).padStart(3, '0')}`;
    if (!taken.has(code)) {
      out.push(code);
      taken.add(code);
    }
  }
  return out;
}

function checkPassword(pw) {
  if (pw && pw.length < 6) fail(400, 'Password must be at least 6 characters.');
  return pw;
}

router.get('/teams', (req, res) => {
  const rounds = results.loadRounds();
  const { resultMap } = results.loadScoreMaps();
  const tickets = new Map(
    q.all("SELECT team_id, COUNT(*) AS n FROM tickets WHERE status <> 'resolved' GROUP BY team_id").map((r) => [r.team_id, r.n])
  );
  const teams = q.all('SELECT * FROM teams ORDER BY code').map((t) => ({
    ...shapeTeam(t),
    eliminated_in: results.eliminatedIn(t.id, rounds, resultMap, { publishedOnly: false }),
    open_tickets: tickets.get(t.id) || 0,
  }));
  res.json({ teams, next_code: nextCodes(1)[0] });
});

router.post('/teams', async (req, res) => {
  const fields = readTeamFields(req.body);
  let code = str(req.body.code, { label: 'Team ID', max: 32 }).toUpperCase();
  if (code && !CODE_RE.test(code)) fail(400, 'Team ID can only use letters, numbers, - and _ (2–32 characters).');
  if (code && q.get('SELECT 1 FROM teams WHERE code = ?', code)) fail(409, `Team ID ${code} is already taken.`);
  if (!code) code = nextCodes(1)[0];
  const password = checkPassword(str(req.body.password, { label: 'Password', max: 100, trim: false })) || auth.generatePassword();

  const hash = await auth.hashPassword(password);
  const { id } = q.run(
    `INSERT INTO teams (code, name, leader_name, email, phone, members, track, table_no, notes, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    code,
    fields.name,
    fields.leader_name,
    fields.email,
    fields.phone,
    JSON.stringify(fields.members),
    fields.track,
    fields.table_no,
    fields.notes,
    hash,
    now()
  );
  events.emit('teams', {}, 'admins');
  res.json({ team: shapeTeam(q.get('SELECT * FROM teams WHERE id = ?', id)), password });
});

router.put('/teams/:id', (req, res) => {
  const id = idParam(req.params.id);
  const existing = q.get('SELECT * FROM teams WHERE id = ?', id);
  if (!existing) fail(404, 'That team doesn’t exist.');
  const fields = readTeamFields(req.body);
  let code = str(req.body.code, { label: 'Team ID', max: 32, required: true }).toUpperCase();
  if (!CODE_RE.test(code)) fail(400, 'Team ID can only use letters, numbers, - and _ (2–32 characters).');
  if (q.get('SELECT 1 FROM teams WHERE code = ? AND id <> ?', code, id)) fail(409, `Team ID ${code} is already taken.`);
  const active = req.body.active === undefined ? !!existing.active : bool(req.body.active);

  q.run(
    `UPDATE teams SET code = ?, name = ?, leader_name = ?, email = ?, phone = ?, members = ?, track = ?, table_no = ?, notes = ?, active = ?
     WHERE id = ?`,
    code,
    fields.name,
    fields.leader_name,
    fields.email,
    fields.phone,
    JSON.stringify(fields.members),
    fields.track,
    fields.table_no,
    fields.notes,
    active,
    id
  );
  if (!active && existing.active) {
    auth.destroyUserSessions('team', id);
    events.kickTeam(id);
  }
  events.emit('teams', {}, 'admins');
  events.emit('profile', {}, { teamId: id });
  res.json({ team: shapeTeam(q.get('SELECT * FROM teams WHERE id = ?', id)) });
});

router.delete('/teams/:id', (req, res) => {
  const id = idParam(req.params.id);
  const t = q.get('SELECT id FROM teams WHERE id = ?', id);
  if (!t) fail(404, 'That team doesn’t exist.');
  tx(() => {
    q.run("DELETE FROM sessions WHERE role = 'team' AND user_id = ?", id);
    q.run('DELETE FROM teams WHERE id = ?', id);
  });
  events.kickTeam(id);
  events.emit('teams', {}, 'admins');
  res.json({ ok: true });
});

router.post('/teams/:id/password', async (req, res) => {
  const id = idParam(req.params.id);
  const t = q.get('SELECT id, code, name, leader_name, table_no FROM teams WHERE id = ?', id);
  if (!t) fail(404, 'That team doesn’t exist.');
  const password = checkPassword(str(req.body.password, { label: 'Password', max: 100, trim: false })) || auth.generatePassword();
  q.run('UPDATE teams SET password_hash = ? WHERE id = ?', await auth.hashPassword(password), id);
  auth.destroyUserSessions('team', id);
  events.kickTeam(id);
  res.json({ credentials: [{ ...t, password }] });
});

// Regenerate passwords for many teams at once (for printing credential slips).
router.post('/teams/passwords', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  const teams = ids.length
    ? q.all(`SELECT id, code, name, leader_name, table_no FROM teams WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY code`, ...ids)
    : q.all('SELECT id, code, name, leader_name, table_no FROM teams WHERE active = 1 ORDER BY code');
  if (!teams.length) fail(400, 'No teams to generate passwords for.');
  const creds = [];
  for (const t of teams) {
    const password = auth.generatePassword();
    creds.push({ ...t, password, hash: await auth.hashPassword(password) });
  }
  tx(() => {
    for (const c of creds) {
      q.run('UPDATE teams SET password_hash = ? WHERE id = ?', c.hash, c.id);
      q.run("DELETE FROM sessions WHERE role = 'team' AND user_id = ?", c.id);
    }
  });
  for (const c of creds) events.kickTeam(c.id);
  res.json({ credentials: creds.map(({ hash, ...c }) => c) });
});

// ---- CSV import / export ------------------------------------------------------------

const HEADER_ALIASES = {
  name: ['team_name', 'team name', 'team', 'name'],
  leader_name: ['leader_name', 'leader name', 'team leader', 'leader', 'tl', 'tl name'],
  code: ['team_id', 'team id', 'login_id', 'login id', 'code', 'username'],
  password: ['password'],
  email: ['email', 'leader email', 'email id'],
  phone: ['phone', 'mobile', 'phone number', 'contact'],
  members: ['members', 'team members', 'member names'],
  track: ['track', 'theme', 'problem statement', 'domain'],
  table_no: ['table', 'table_no', 'table no', 'table number', 'seat'],
};

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && map[field] === undefined) map[field] = i;
    }
  });
  return map;
}

router.post('/teams/import', async (req, res) => {
  const text = str(req.body.csv, { label: 'CSV', max: 500000, required: true, trim: false });
  const rows = parseCsv(text);
  if (rows.length < 2) fail(400, 'The CSV needs a header row and at least one team.');
  if (rows.length > 501) fail(400, 'Import up to 500 teams at a time.');
  const cols = mapHeaders(rows[0]);
  if (cols.name === undefined) fail(400, 'The CSV needs a “team_name” column. Download the template to see the format.');

  const errors = [];
  const parsed = [];
  const fileCodes = new Set();
  const cell = (row, f) => (cols[f] === undefined ? '' : (row[cols[f]] || '').trim());

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const name = cell(row, 'name');
    const code = cell(row, 'code').toUpperCase();
    const password = cell(row, 'password');
    if (!name) errors.push({ line, message: 'Team name is empty.' });
    if (name.length > 80) errors.push({ line, message: 'Team name is longer than 80 characters.' });
    if (code) {
      if (!CODE_RE.test(code)) errors.push({ line, message: `Team ID “${code}” can only use letters, numbers, - and _.` });
      else if (fileCodes.has(code)) errors.push({ line, message: `Team ID ${code} appears twice in the file.` });
      else if (q.get('SELECT 1 FROM teams WHERE code = ?', code)) errors.push({ line, message: `Team ID ${code} already exists.` });
      fileCodes.add(code);
    }
    if (password && password.length < 6) errors.push({ line, message: 'Password must be at least 6 characters.' });
    parsed.push({
      name: name.slice(0, 80),
      code,
      password,
      leader_name: cell(row, 'leader_name').slice(0, 80),
      email: cell(row, 'email').slice(0, 120),
      phone: cell(row, 'phone').slice(0, 30),
      members: parseMembers(cell(row, 'members')),
      track: cell(row, 'track').slice(0, 120),
      table_no: cell(row, 'table_no').slice(0, 20),
    });
  });

  if (errors.length) return res.status(400).json({ error: `Fix ${errors.length} problem${errors.length === 1 ? '' : 's'} in the CSV and try again. Nothing was imported.`, errors });

  const autoCodes = nextCodes(parsed.filter((p) => !p.code).length, new Set(fileCodes));
  for (const p of parsed) {
    if (!p.code) p.code = autoCodes.shift();
    if (!p.password) p.password = auth.generatePassword();
    p.hash = await auth.hashPassword(p.password);
  }

  const created = tx(() =>
    parsed.map((p) => {
      const { id } = q.run(
        `INSERT INTO teams (code, name, leader_name, email, phone, members, track, table_no, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.code,
        p.name,
        p.leader_name,
        p.email,
        p.phone,
        JSON.stringify(p.members),
        p.track,
        p.table_no,
        p.hash,
        now()
      );
      return { id, code: p.code, name: p.name, leader_name: p.leader_name, table_no: p.table_no, password: p.password };
    })
  );
  events.emit('teams', {}, 'admins');
  res.json({ credentials: created });
});

router.get('/teams/template.csv', (req, res) => {
  sendCsv(res, 'genesis-teams-template.csv', [
    ['team_name', 'leader_name', 'email', 'phone', 'members', 'track', 'table', 'team_id', 'password'],
    ['Null Pointers', 'Asha Rao', 'asha@example.com', '9876543210', 'Asha Rao; Vikram S; Neha K; Arjun M', 'HealthTech', 'A1', '', ''],
    ['Byte Club', 'Rahul Verma', 'rahul@example.com', '9123456780', 'Rahul Verma; Priya D; Sam J', 'FinTech', 'A2', '', ''],
  ]);
});

router.get('/teams/export.csv', (req, res) => {
  const teams = q.all('SELECT * FROM teams ORDER BY code');
  sendCsv(res, 'genesis-teams.csv', [
    ['team_id', 'team_name', 'leader_name', 'email', 'phone', 'members', 'track', 'table', 'active', 'last_login'],
    ...teams.map((t) => [
      t.code,
      t.name,
      t.leader_name,
      t.email,
      t.phone,
      JSON.parse(t.members || '[]').join('; '),
      t.track,
      t.table_no,
      t.active ? 'yes' : 'no',
      t.last_login_at || '',
    ]),
  ]);
});

module.exports = router;
