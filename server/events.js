'use strict';
// Server-Sent Events hub: pushes live updates (announcements, results, help desk
// replies, schedule changes) to every open portal tab.

const clients = new Set();

function handler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  const client = { res, role: req.user.role, id: req.user.id };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}

/**
 * @param {string} type  event name
 * @param {object} data  payload
 * @param {'all'|'admins'|'teams'|{teamId:number}|{teamIds:Set<number>|number[]}} to
 */
function emit(type, data = {}, to = 'all') {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const teamIds = to && to.teamIds ? new Set(to.teamIds) : null;
  for (const c of clients) {
    let ok = false;
    if (to === 'all') ok = true;
    else if (to === 'admins') ok = c.role === 'admin';
    else if (to === 'teams') ok = c.role === 'team';
    else if (to && to.teamId !== undefined) ok = c.role === 'team' && c.id === to.teamId;
    else if (teamIds) ok = c.role === 'team' && teamIds.has(c.id);
    if (ok) c.res.write(payload);
  }
}

// Forcefully sign a team's open tabs out (password reset, account disabled).
function kickTeam(teamId) {
  emit('signed-out', {}, { teamId });
}

setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 25000).unref();

module.exports = { handler, emit, kickTeam, clientCount: () => clients.size };
