'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { q, now } = require('./db');
const { SESSION_DAYS } = require('./config');
const { fail } = require('./util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'gh_sid';
const SCRYPT = { N: 16384, r: 8, p: 1 };

// ---- passwords ------------------------------------------------------------------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// Readable, phone-friendly: no 0/o/1/l/i.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function generatePassword() {
  const pick = () => ALPHABET[crypto.randomInt(ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `${group()}-${group()}`;
}

// A hash to compare against when the account doesn't exist, so response time
// doesn't reveal which login IDs are real.
let dummyHash = null;
hashPassword(crypto.randomBytes(12).toString('hex')).then((h) => (dummyHash = h));

// ---- login throttling -----------------------------------------------------------

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_ACCOUNT = 8;
const MAX_PER_IP = 60; // generous: a whole venue may share one public IP
const attempts = new Map();

function throttleKeyCheck(key, max) {
  const a = attempts.get(key);
  if (!a) return;
  if (Date.now() - a.first > WINDOW_MS) return attempts.delete(key);
  if (a.count >= max) {
    const mins = Math.ceil((WINDOW_MS - (Date.now() - a.first)) / 60000);
    fail(429, `Too many failed sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}
function throttleKeyFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}

const throttle = {
  check(account, ip) {
    throttleKeyCheck(`acct:${account}`, MAX_PER_ACCOUNT);
    throttleKeyCheck(`ip:${ip}`, MAX_PER_IP);
  },
  failed(account, ip) {
    throttleKeyFail(`acct:${account}`);
    throttleKeyFail(`ip:${ip}`);
  },
  clear(account) {
    attempts.delete(`acct:${account}`);
  },
};
setInterval(() => {
  for (const [k, a] of attempts) if (Date.now() - a.first > WINDOW_MS) attempts.delete(k);
}, WINDOW_MS).unref();

// ---- sessions ---------------------------------------------------------------------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(req, res, value, maxAgeSec) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function createSession(req, res, role, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ts = now();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  q.run(
    'INSERT INTO sessions (token_hash, role, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    sha256(token),
    role,
    userId,
    ts,
    expires,
    ts
  );
  setCookie(req, res, token, SESSION_DAYS * 86400);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) q.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  setCookie(req, res, '', 0);
}

function destroyUserSessions(role, userId, exceptReq) {
  const keep = exceptReq ? sha256(parseCookies(exceptReq.headers.cookie)[COOKIE] || '') : '';
  q.run('DELETE FROM sessions WHERE role = ? AND user_id = ? AND token_hash <> ?', role, userId, keep);
}

function loadSession(req, res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return next();
  const hash = sha256(token);
  const s = q.get('SELECT * FROM sessions WHERE token_hash = ?', hash);
  if (!s) return next();
  if (s.expires_at < now()) {
    q.run('DELETE FROM sessions WHERE token_hash = ?', hash);
    return next();
  }
  if (s.role === 'admin') {
    const a = q.get('SELECT id, username, display_name, competition FROM admins WHERE id = ?', s.user_id);
    if (a) req.user = { role: 'admin', id: a.id, username: a.username, name: a.display_name, competition: a.competition };
  } else if (s.role === 'judge') {
    const j = q.get('SELECT id, username, display_name, active FROM judges WHERE id = ?', s.user_id);
    if (j && j.active) req.user = { role: 'judge', id: j.id, username: j.username, name: j.display_name, competition: 'hackathon' };
  } else {
    const t = q.get('SELECT id, code, name, leader_name, active, competition FROM teams WHERE id = ?', s.user_id);
    if (t && t.active) {
      req.user = { role: 'team', id: t.id, username: t.code, name: t.name, leader: t.leader_name, competition: t.competition };
    }
  }
  if (!req.user) {
    q.run('DELETE FROM sessions WHERE token_hash = ?', hash);
    return next();
  }
  // Touch at most every 5 minutes.
  if (Date.now() - Date.parse(s.last_seen_at) > 5 * 60000) {
    q.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', now(), hash);
  }
  next();
}

setInterval(() => q.run('DELETE FROM sessions WHERE expires_at < ?', now()), 3600000).unref();

// ---- guards --------------------------------------------------------------------------

// Mutating API calls must carry a custom header. Browsers won't attach one to a
// cross-site request without a CORS preflight (which we never approve), so this
// blocks CSRF on top of SameSite cookies.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Genesis') !== '1') return res.status(403).json({ error: 'Request blocked.' });
  next();
}

const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Your session has ended. Sign in again.' });
  if (req.user.role !== role) return res.status(403).json({ error: 'You don’t have access to this.' });
  next();
};

const requireAuth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Your session has ended. Sign in again.' });
  next();
};

const requireHackathon = (req, res, next) => {
  if (req.user.competition !== 'hackathon') {
    return res.status(403).json({ error: 'Rounds, scoring and judges are only part of the Hackathon.' });
  }
  next();
};

const requireIdeathon = (req, res, next) => {
  if (req.user.competition !== 'ideathon') return res.status(403).json({ error: 'This is only part of the Ideathon.' });
  next();
};

module.exports = {
  requireHackathon,
  requireIdeathon,
  hashPassword,
  verifyPassword,
  generatePassword,
  getDummyHash: () => dummyHash,
  throttle,
  createSession,
  destroySession,
  destroyUserSessions,
  loadSession,
  csrfGuard,
  requireRole,
  requireAuth,
};
