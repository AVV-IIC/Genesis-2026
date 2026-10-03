'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'genesis.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`);

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const COMPETITIONS = ['hackathon', 'ideathon'];

const ANNOUNCEMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS announcements (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  audience    TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','competing','team','judges','everyone')),
  competition TEXT NOT NULL DEFAULT 'hackathon' CHECK (competition IN ('hackathon','ideathon','both')),
  team_id     INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  pinned      INTEGER NOT NULL DEFAULT 0,
  author      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT ${NOW},
  updated_at  TEXT
);`;

const SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  role         TEXT NOT NULL CHECK (role IN ('admin','team','judge')),
  user_id      INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);`;

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  competition   TEXT NOT NULL DEFAULT 'hackathon',
  created_at    TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS teams (
  id                    INTEGER PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                  TEXT NOT NULL,
  leader_name           TEXT NOT NULL DEFAULT '',
  email                 TEXT NOT NULL DEFAULT '',
  phone                 TEXT NOT NULL DEFAULT '',
  members               TEXT NOT NULL DEFAULT '[]',
  track                 TEXT NOT NULL DEFAULT '',
  table_no              TEXT NOT NULL DEFAULT '',
  notes                 TEXT NOT NULL DEFAULT '',
  password_hash         TEXT NOT NULL,
  active                INTEGER NOT NULL DEFAULT 1,
  competition           TEXT NOT NULL DEFAULT 'hackathon',
  award                 TEXT NOT NULL DEFAULT '',
  result_note           TEXT NOT NULL DEFAULT '',
  last_login_at         TEXT,
  announcements_seen_at TEXT,
  created_at            TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS rounds (
  id             INTEGER PRIMARY KEY,
  number         INTEGER NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  is_elimination INTEGER NOT NULL DEFAULT 1,
  state          TEXT NOT NULL DEFAULT 'upcoming' CHECK (state IN ('upcoming','live','judging','completed')),
  published      INTEGER NOT NULL DEFAULT 0,
  published_at   TEXT
);

CREATE TABLE IF NOT EXISTS criteria (
  id        INTEGER PRIMARY KEY,
  round_id  INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  max_score REAL NOT NULL DEFAULT 10,
  sort      INTEGER NOT NULL DEFAULT 0
);

-- Organiser-entered marks. When present they override the judges' average.
CREATE TABLE IF NOT EXISTS scores (
  team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
  score        REAL NOT NULL,
  PRIMARY KEY (team_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS results (
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','selected','eliminated')),
  comments   TEXT NOT NULL DEFAULT '',
  award      TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT,
  PRIMARY KEY (team_id, round_id)
);

CREATE TABLE IF NOT EXISTS judges (
  id                    INTEGER PRIMARY KEY,
  username              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name          TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  active                INTEGER NOT NULL DEFAULT 1,
  last_login_at         TEXT,
  announcements_seen_at TEXT,
  created_at            TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS judge_assignments (
  judge_id INTEGER NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  team_id  INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (judge_id, round_id, team_id)
);

CREATE TABLE IF NOT EXISTS judge_scores (
  judge_id     INTEGER NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
  score        REAL NOT NULL,
  PRIMARY KEY (judge_id, team_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS judge_feedback (
  judge_id     INTEGER NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id     INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  comments     TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  updated_at   TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (judge_id, team_id, round_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  team_id    INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  problem    TEXT NOT NULL DEFAULT '',
  solution   TEXT NOT NULL DEFAULT '',
  impact     TEXT NOT NULL DEFAULT '',
  deck_url   TEXT NOT NULL DEFAULT '',
  video_url  TEXT NOT NULL DEFAULT '',
  extra_url  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

${ANNOUNCEMENTS_TABLE}

CREATE TABLE IF NOT EXISTS tickets (
  id           INTEGER PRIMARY KEY,
  team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  team_unread  INTEGER NOT NULL DEFAULT 0,
  admin_unread INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT ${NOW},
  updated_at   TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INTEGER PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('team','admin')),
  author_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS schedule (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('general','round','deadline','food','talk')),
  competition TEXT NOT NULL DEFAULT 'hackathon',
  starts_at   TEXT NOT NULL,
  ends_at     TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

${SESSIONS_TABLE}
`);

// ---- upgrade databases from the single-competition version ---------------------

const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const tableSql = (table) => (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) || {}).sql || '';

for (const [table, column, def] of [
  ['admins', 'competition', "TEXT NOT NULL DEFAULT 'hackathon'"],
  ['teams', 'competition', "TEXT NOT NULL DEFAULT 'hackathon'"],
  ['teams', 'award', "TEXT NOT NULL DEFAULT ''"],
  ['teams', 'result_note', "TEXT NOT NULL DEFAULT ''"],
  ['schedule', 'competition', "TEXT NOT NULL DEFAULT 'hackathon'"],
]) {
  if (!columns(table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

// Tables whose CHECK constraints changed are rebuilt (SQLite can't alter them).
function rebuild(table, createSql, copyColumns) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old`);
    db.exec(createSql);
    const cols = copyColumns.filter((c) => columns(`${table}_old`).includes(c));
    db.exec(`INSERT INTO ${table} (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM ${table}_old`);
    db.exec(`DROP TABLE ${table}_old`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
if (!tableSql('announcements').includes("'judges'")) {
  rebuild('announcements', ANNOUNCEMENTS_TABLE, ['id', 'title', 'body', 'priority', 'audience', 'competition', 'team_id', 'pinned', 'author', 'created_at', 'updated_at']);
}
if (!tableSql('sessions').includes("'judge'")) {
  rebuild('sessions', SESSIONS_TABLE, ['token_hash', 'role', 'user_id', 'created_at', 'expires_at', 'last_seen_at']);
}
// Settings became per-competition: "hackathon:event_name", "ideathon:event_name"…
db.exec(`UPDATE settings SET key = 'hackathon:' || key WHERE instr(key, ':') = 0`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_criteria_round ON criteria(round_id);
CREATE INDEX IF NOT EXISTS idx_results_round ON results(round_id);
CREATE INDEX IF NOT EXISTS idx_tickets_team ON tickets(team_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(role, user_id);
CREATE INDEX IF NOT EXISTS idx_teams_comp ON teams(competition);
CREATE INDEX IF NOT EXISTS idx_assign_round ON judge_assignments(round_id, team_id);
CREATE INDEX IF NOT EXISTS idx_jscores_team ON judge_scores(team_id, criterion_id);
`);

// ---- query helpers ---------------------------------------------------------

const cache = new Map();
function prepared(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// node:sqlite only binds null/number/string/bigint/buffer.
function bindable(params) {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

// Rows come back with a null prototype; spread them into plain objects.
const plain = (row) => (row ? { ...row } : row);

const q = {
  get: (sql, ...p) => plain(prepared(sql).get(...bindable(p))),
  all: (sql, ...p) => prepared(sql).all(...bindable(p)).map(plain),
  run: (sql, ...p) => {
    const r = prepared(sql).run(...bindable(p));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  },
};

let depth = 0;
function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const out = fn();
    depth--;
    db.exec('COMMIT');
    return out;
  } catch (err) {
    depth--;
    db.exec('ROLLBACK');
    throw err;
  }
}

const now = () => new Date().toISOString();

// ---- settings (per competition) -------------------------------------------------

const SETTING_DEFAULTS = {
  hackathon: {
    event_name: 'Genesis Hackathon',
    tagline: '24 hours to build what comes next.',
    venue: '',
    event_start: '',
    event_end: '',
    leaderboard_visible: '0',
    helpdesk_open: '1',
    allow_password_change: '0',
    helpdesk_contact: '',
    team_code_prefix: 'GEN',
  },
  ideathon: {
    event_name: 'Genesis Ideathon',
    tagline: '24 hours to shape an idea worth building.',
    venue: '',
    event_start: '',
    event_end: '',
    helpdesk_open: '1',
    allow_password_change: '0',
    helpdesk_contact: '',
    team_code_prefix: 'IDE',
    submissions_enabled: '1',
    submissions_open: '1',
    submission_deadline: '',
    results_published: '0',
  },
};

function getSettings(comp = 'hackathon') {
  const out = { ...SETTING_DEFAULTS[comp] };
  for (const row of q.all('SELECT key, value FROM settings WHERE key LIKE ?', `${comp}:%`)) {
    out[row.key.slice(comp.length + 1)] = row.value;
  }
  return out;
}

function setSettings(comp, obj) {
  tx(() => {
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in SETTING_DEFAULTS[comp])) continue;
      q.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        `${comp}:${k}`,
        String(v ?? '')
      );
    }
  });
}

const compLabel = (c) => (c === 'ideathon' ? 'Ideathon' : 'Hackathon');

// ---- seed rounds -------------------------------------------------------------

const DEFAULT_ROUNDS = [
  {
    number: 1,
    name: 'Idea review',
    description: 'Pitch the problem you picked and how you plan to solve it. Every team moves on to Round 2.',
    is_elimination: 0,
    criteria: ['Problem understanding', 'Innovation', 'Feasibility'],
  },
  {
    number: 2,
    name: 'Progress check',
    description: 'Show what you have built so far and walk the judges through your technical approach.',
    is_elimination: 1,
    criteria: ['Progress so far', 'Technical approach', 'Team coordination'],
  },
  {
    number: 3,
    name: 'Prototype demo',
    description: 'Demo a working prototype. Judges look at what works, not what is planned.',
    is_elimination: 1,
    criteria: ['Functionality', 'Technical complexity', 'Design & usability'],
  },
  {
    number: 4,
    name: 'Final pitch',
    description: 'Final presentation and Q&A in front of the jury.',
    is_elimination: 1,
    criteria: ['Impact', 'Completeness', 'Presentation', 'Q&A'],
  },
];

function seedRounds() {
  const count = q.get('SELECT COUNT(*) AS n FROM rounds').n;
  if (count > 0) return;
  tx(() => {
    for (const r of DEFAULT_ROUNDS) {
      const { id } = q.run(
        'INSERT INTO rounds (number, name, description, is_elimination) VALUES (?, ?, ?, ?)',
        r.number,
        r.name,
        r.description,
        r.is_elimination
      );
      r.criteria.forEach((name, i) =>
        q.run('INSERT INTO criteria (round_id, name, max_score, sort) VALUES (?, ?, 10, ?)', id, name, i)
      );
    }
  });
}
seedRounds();

module.exports = { db, q, tx, now, getSettings, setSettings, compLabel, COMPETITIONS, DB_PATH, SETTING_DEFAULTS };
