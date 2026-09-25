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
  admins: [
    {
      username: env.ADMIN1_USERNAME || 'admin1',
      password: env.ADMIN1_PASSWORD || '',
      name: env.ADMIN1_NAME || 'Organiser 1',
    },
    {
      username: env.ADMIN2_USERNAME || 'admin2',
      password: env.ADMIN2_PASSWORD || '',
      name: env.ADMIN2_NAME || 'Organiser 2',
    },
  ],
};
