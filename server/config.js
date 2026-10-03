'use strict';
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Load .env if present (Node's built-in loader; real environment variables win).
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* no .env file — that's fine */
}

const env = process.env;

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DATA_DIR: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
  PORT: Number(env.PORT) || 3000,
  HOST: env.HOST || '0.0.0.0',
  // Number of reverse proxies in front of the app (Railway/Render/nginx = 1).
  TRUST_PROXY: env.TRUST_PROXY === undefined ? 1 : env.TRUST_PROXY,
  SESSION_DAYS: Number(env.SESSION_DAYS) || 7,
  // Organiser logins created on first start. Hackathon and Ideathon organisers
  // are separate accounts and only see their own competition.
  admins: [
    { competition: 'hackathon', username: env.ADMIN1_USERNAME || 'admin1', password: env.ADMIN1_PASSWORD || '', name: env.ADMIN1_NAME || 'Organiser 1' },
    { competition: 'hackathon', username: env.ADMIN2_USERNAME || 'admin2', password: env.ADMIN2_PASSWORD || '', name: env.ADMIN2_NAME || 'Organiser 2' },
    { competition: 'ideathon', username: env.IDEA_ADMIN1_USERNAME || 'ideaadmin1', password: env.IDEA_ADMIN1_PASSWORD || '', name: env.IDEA_ADMIN1_NAME || 'Ideathon Organiser 1' },
    { competition: 'ideathon', username: env.IDEA_ADMIN2_USERNAME || 'ideaadmin2', password: env.IDEA_ADMIN2_PASSWORD || '', name: env.IDEA_ADMIN2_NAME || 'Ideathon Organiser 2' },
  ],
};
