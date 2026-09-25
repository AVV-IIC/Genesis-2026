'use strict';
// Reset (or create) an organiser account from the command line.
//   npm run reset-admin -- admin1                 -> generates a new password
//   npm run reset-admin -- admin1 "MyNewPass123"  -> sets this password
//   npm run reset-admin -- list                   -> lists organiser accounts
const crypto = require('node:crypto');
const { q } = require('../server/db');
const { hashPassword } = require('../server/auth');

(async () => {
  const [username, password] = process.argv.slice(2);
  if (!username) {
    console.log('Usage: npm run reset-admin -- <username> [new-password]\n       npm run reset-admin -- list');
    process.exit(1);
  }
  if (username === 'list') {
    for (const a of q.all('SELECT username, display_name FROM admins ORDER BY id')) console.log(`  ${a.username.padEnd(14)} ${a.display_name}`);
    process.exit(0);
  }
  if (password && password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  const pw = password || crypto.randomBytes(9).toString('base64url');
  const hash = await hashPassword(pw);
  const existing = q.get('SELECT id FROM admins WHERE username = ?', username);
  if (existing) {
    q.run('UPDATE admins SET password_hash = ? WHERE id = ?', hash, existing.id);
    q.run("DELETE FROM sessions WHERE role = 'admin' AND user_id = ?", existing.id);
    console.log(`\n  Password reset for ${username}`);
  } else {
    q.run('INSERT INTO admins (username, display_name, password_hash) VALUES (?, ?, ?)', username, username, hash);
    console.log(`\n  Created organiser account ${username}`);
  }
  console.log(`  Password: ${pw}\n`);
  process.exit(0);
})();
