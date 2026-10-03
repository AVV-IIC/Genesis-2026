'use strict';
// Server-Sent Events hub: pushes live updates (announcements, results, help desk
// replies, schedule changes) to every open portal tab.
//
// Targets use the same grammar as the Supabase version:
//   all | comp:<c> | admins:<c> | teams:<c> | team:<id> | judges | competing

const clients = new Set();

function handler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  const client = { res, role: req.user.role, id: req.user.id, competition: req.user.competition };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}

function matches(c, target) {
  if (!target || target === 'all') return true;
  const [kind, value] = String(target).split(':');
  switch (kind) {
    case 'comp':
      return c.competition === value;
    case 'admins':
      return c.role === 'admin' && c.competition === value;
    case 'teams':
      return c.role === 'team' && c.competition === value;
    case 'team':
      return c.role === 'team' && c.id === Number(value);
    case 'judges':
      return c.role === 'judge';
    case 'competing':
      return c.role === 'team' && c.competition === 'hackathon';
    default:
      return false;
  }
}

function emit(type, data = {}, target = 'all') {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (matches(c, target)) c.res.write(payload);
}

// Forcefully sign a team's open tabs out (password reset, account disabled).
function kickTeam(teamId) {
  emit('signed-out', {}, `team:${teamId}`);
}

setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 25000).unref();

module.exports = { handler, emit, kickTeam, matches, clientCount: () => clients.size };
