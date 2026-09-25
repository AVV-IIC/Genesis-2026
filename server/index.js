'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const express = require('express');
const { q } = require('./db');
const auth = require('./auth');
const events = require('./events');
const { HttpError } = require('./util');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', /^\d+$/.test(String(config.TRUST_PROXY)) ? Number(config.TRUST_PROXY) : config.TRUST_PROXY);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(auth.loadSession);

// ---- API ----------------------------------------------------------------------------------
app.use('/api', auth.csrfGuard, (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/public', require('./routes/public'));
app.use('/api/team', auth.requireRole('team'), require('./routes/team'));
app.use(
  '/api/admin',
  auth.requireRole('admin'),
  require('./routes/admin-teams'),
  require('./routes/admin-rounds'),
  require('./routes/admin-content'),
  require('./routes/admin-system')
);
app.get('/api/events', auth.requireAuth, events.handler);
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---- pages ---------------------------------------------------------------------------------
const page = (name) => path.join(config.PUBLIC_DIR, name);
const noCache = (res) => res.setHeader('Cache-Control', 'no-cache');

// Pages link to each other with relative *.html URLs (so the same files also
// work on static hosting), so serve both forms.
app.get(['/', '/index.html'], (req, res) => {
  if (req.user && !req.query.expired && !req.query.signedout) return res.redirect(req.user.role === 'admin' ? '/admin' : '/team');
  noCache(res);
  res.sendFile(page('index.html'));
});
app.get(['/team', '/team.html'], (req, res) => {
  if (!req.user || req.user.role !== 'team') return res.redirect('/');
  noCache(res);
  res.sendFile(page('team.html'));
});
app.get(['/admin', '/admin.html'], (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.redirect('/');
  noCache(res);
  res.sendFile(page('admin.html'));
});

app.use('/fonts', express.static(path.join(config.PUBLIC_DIR, 'fonts'), { maxAge: '30d', immutable: true }));
app.use(express.static(config.PUBLIC_DIR, { index: false, maxAge: 0 }));
app.use((req, res) => res.status(404).sendFile(page('404.html')));

// ---- errors ----------------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body isn’t valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That’s too much data in one go.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again in a moment.' });
});

// ---- first-run admin accounts -------------------------------------------------------------
async function ensureAdmins() {
  const created = [];
  for (const a of config.admins) {
    if (q.get('SELECT 1 FROM admins WHERE username = ?', a.username)) continue;
    const password = a.password || crypto.randomBytes(9).toString('base64url');
    q.run(
      'INSERT INTO admins (username, display_name, password_hash) VALUES (?, ?, ?)',
      a.username,
      a.name,
      await auth.hashPassword(password)
    );
    created.push({ username: a.username, password, fromEnv: !!a.password });
  }
  if (created.length) {
    console.log('\n  Organiser accounts created:');
    for (const c of created) {
      console.log(`    ${c.username.padEnd(12)} ${c.fromEnv ? '(password from .env)' : c.password}`);
    }
    console.log('  Save these now. Change them after signing in (Settings → Change my password).\n');
  }
}

ensureAdmins().then(() => {
  app.listen(config.PORT, config.HOST, () => {
    console.log(`  Genesis Hackathon portal running on http://localhost:${config.PORT}`);
  });
});
