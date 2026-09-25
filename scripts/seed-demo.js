'use strict';
// Fills the database with a realistic mid-event demo so you can click around.
// Run with the server stopped:  npm run seed-demo
// Clear it afterwards from Settings → Danger zone → "Delete teams & all event data".
const { q, tx, setSettings } = require('../server/db');
const { hashPassword } = require('../server/auth');

const TEAMS = [
  ['Null Pointers', 'Asha Rao', 'HealthTech', ['Vikram S', 'Neha K', 'Arjun M']],
  ['Byte Club', 'Rahul Verma', 'FinTech', ['Priya D', 'Sam J']],
  ['Stack Smashers', 'Meera Iyer', 'EdTech', ['Kiran P', 'Dev A', 'Rhea T']],
  ['Kernel Panic', 'Aditya Nair', 'Open Innovation', ['Isha B', 'Tanmay G']],
  ['404 Found', 'Sneha Pillai', 'Smart Cities', ['Rohan V', 'Anjali S', 'Karthik R']],
  ['Merge Conflict', 'Farhan Ali', 'Sustainability', ['Zoya K', 'Nikhil D']],
  ['Quantum Quokkas', 'Divya Menon', 'HealthTech', ['Abhinav T', 'Lakshmi N', 'Omkar P']],
  ['Bit Brigade', 'Harsh Gupta', 'FinTech', ['Pooja R', 'Yash M']],
  ['Cache Me If You Can', 'Tanya Shah', 'EdTech', ['Varun K', 'Ritika J', 'Manav S']],
  ['Syntax Sorcerers', 'Arnav Joshi', 'Open Innovation', ['Kavya L', 'Siddharth B']],
  ['Hack Street Boys', 'Nitin Kumar', 'Smart Cities', ['Aman P', 'Jay R', 'Rahul S']],
  ['Lambda Llamas', 'Ira Kapoor', 'Sustainability', ['Neel D', 'Sara F']],
];

const rnd = (min, max) => Math.round((min + Math.random() * (max - min)) * 2) / 2;

(async () => {
  const force = process.argv.includes('--force');
  if (q.get('SELECT COUNT(*) AS n FROM teams').n > 0 && !force) {
    console.log('\n  Teams already exist. Run with --force to add demo data anyway:  npm run seed-demo -- --force\n');
    process.exit(1);
  }

  const now = Date.now();
  const H = 3600000;
  const start = new Date(Math.floor((now - 9 * H) / (30 * 60000)) * 30 * 60000);
  const at = (h) => new Date(start.getTime() + h * H).toISOString();

  setSettings({
    event_name: 'Genesis Hackathon',
    tagline: '24 hours to build what comes next.',
    venue: 'Main Auditorium, Block A',
    event_start: at(0),
    event_end: at(24),
    helpdesk_contact: 'Organiser desk: next to the main stage\nRohit (lead organiser): +91 98xxxxxx01',
  });

  const password = 'demo-pass';
  const hash = await hashPassword(password);

  tx(() => {
    const rounds = q.all('SELECT * FROM rounds ORDER BY number');
    const crit = (roundId) => q.all('SELECT * FROM criteria WHERE round_id = ? ORDER BY sort', roundId);

    const ids = TEAMS.map(([name, leader, track, members], i) => {
      const code = `GEN${String(i + 1).padStart(3, '0')}`;
      const { id } = q.run(
        `INSERT INTO teams (code, name, leader_name, email, phone, members, track, table_no, password_hash, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        code,
        name,
        leader,
        `${leader.split(' ')[0].toLowerCase()}@example.com`,
        `98${String(10000000 + i * 734521).slice(0, 8)}`,
        JSON.stringify([leader, ...members]),
        track,
        `${String.fromCharCode(65 + Math.floor(i / 6))}${(i % 6) + 1}`,
        hash,
        i < 9 ? new Date(now - (i + 1) * 17 * 60000).toISOString() : null
      );
      return id;
    });

    const score = (teamId, roundId, lo, hi) => {
      for (const c of crit(roundId)) q.run('INSERT OR REPLACE INTO scores (team_id, criterion_id, score) VALUES (?, ?, ?)', teamId, c.id, Math.min(c.max_score, rnd(lo, hi)));
    };
    const total = (teamId, roundId) => q.get('SELECT SUM(s.score) AS t FROM scores s JOIN criteria c ON c.id = s.criterion_id WHERE s.team_id = ? AND c.round_id = ?', teamId, roundId).t;
    const setResult = (teamId, roundId, status, comments) =>
      q.run("INSERT OR REPLACE INTO results (team_id, round_id, status, comments, updated_by, updated_at) VALUES (?, ?, ?, ?, 'Organiser 1', ?)", teamId, roundId, status, comments, new Date().toISOString());

    // Round 1: everyone scored and published.
    const [r1, r2, r3] = rounds;
    for (const id of ids) {
      score(id, r1.id, 5, 9.5);
      setResult(id, r1.id, 'pending', 'Clear problem statement. Narrow the scope so you can ship a working demo by Round 3.');
    }
    q.run("UPDATE rounds SET state = 'completed', published = 1, published_at = ? WHERE id = ?", at(4), r1.id);

    // Round 2: scored, top 8 selected, published.
    for (const id of ids) score(id, r2.id, 4, 9.5);
    const ranked = [...ids].sort((a, b) => total(b, r2.id) - total(a, r2.id));
    ranked.forEach((id, i) =>
      setResult(
        id,
        r2.id,
        i < 8 ? 'selected' : 'eliminated',
        i < 8 ? 'Solid progress. The judges want to see the core flow working end to end in the demo.' : 'Good idea, but the build was too early-stage for this round. The problem framing was strong.'
      )
    );
    q.run("UPDATE rounds SET state = 'completed', published = 1, published_at = ? WHERE id = ?", at(9), r2.id);

    // Round 3 is live.
    q.run("UPDATE rounds SET state = 'live' WHERE id = ?", r3.id);

    const sched = [
      ['Check-in & team setup', 'general', -1, 0, 'Registration desk', 'Collect your credential slip and find your table.'],
      ['Opening ceremony', 'talk', 0, 0.5, 'Main stage', ''],
      ['Hacking begins', 'general', 0.5, null, '', 'The clock starts. Good luck!'],
      ['Round 1 · Idea review', 'round', 3, 4, 'Judging rooms 1–3', 'Five-minute pitch per team. No eliminations.'],
      ['Lunch', 'food', 4.5, 5.5, 'Cafeteria', ''],
      ['Workshop: shipping a demo in 12 hours', 'talk', 6, 7, 'Seminar hall', ''],
      ['Round 2 · Progress check', 'round', 8, 9, 'Judging rooms 1–3', 'Top teams move on to Round 3.'],
      ['Dinner', 'food', 10.5, 11.5, 'Cafeteria', ''],
      ['Round 3 · Prototype demo', 'round', 16, 17.5, 'Judging rooms 1–2', 'Working demos only.'],
      ['Midnight snacks', 'food', 15, 15.5, 'Cafeteria', ''],
      ['Code freeze', 'deadline', 22, null, '', 'Push your final commit. No changes after this.'],
      ['Round 4 · Final pitch', 'round', 22.5, 23.5, 'Main stage', 'Finalists pitch to the jury.'],
      ['Closing & prizes', 'talk', 24, 25, 'Main stage', ''],
    ];
    for (const [title, kind, s, e, location, details] of sched) {
      q.run('INSERT INTO schedule (title, kind, starts_at, ends_at, location, details) VALUES (?, ?, ?, ?, ?, ?)', title, kind, at(s), e === null ? null : at(e), location, details);
    }

    const ann = [
      ['Welcome to Genesis!', 'The hackathon is officially on. Keep this portal open. Results, announcements and the schedule update here live.', 'normal', 1, 0.6],
      ['Round 1 results are out', 'Scores and judges’ notes for Round 1 are in your scorecard. Every team moves on to Round 2.', 'important', 0, 4.1],
      ['Round 2 results are out', 'Results for Round 2 have been published. Open your scorecard to see whether your team is selected for Round 3.', 'important', 0, 9.1],
      ['Round 3 judging starts at hour 16', 'Selected teams: have your demo ready on a laptop. Judges will come to your table. **No slides needed.**', 'urgent', 0, 9.3],
    ];
    for (const [title, body, priority, pinned, h] of ann) {
      q.run("INSERT INTO announcements (title, body, priority, pinned, author, created_at) VALUES (?, ?, ?, ?, 'Organiser 1', ?)", title, body, priority, pinned, at(h));
    }

    const t1 = q.run(
      "INSERT INTO tickets (team_id, category, subject, status, created_at, updated_at, admin_unread, team_unread) VALUES (?, 'Mentor request', 'Need help with our ML model accuracy', 'in_progress', ?, ?, 0, 1)",
      ids[0],
      at(8.6),
      at(8.8)
    ).id;
    q.run("INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'team', 'Asha Rao', 'Our classifier is stuck at 60% accuracy. Could a mentor look at our data pipeline?', ?)", t1, at(8.6));
    q.run("INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'admin', 'Organiser 1', 'A mentor will reach you in about 10 minutes.', ?)", t1, at(8.8));
    const t2 = q.run(
      "INSERT INTO tickets (team_id, category, subject, status, created_at, updated_at) VALUES (?, 'Wi-Fi / power', 'Power socket at table A4 not working', 'open', ?, ?)",
      ids[3],
      new Date(now - 6 * 60000).toISOString(),
      new Date(now - 6 * 60000).toISOString()
    ).id;
    q.run("INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'team', 'Aditya Nair', 'The extension board at our table stopped working. Two laptops are on battery.', ?)", t2, new Date(now - 6 * 60000).toISOString());
  });

  console.log('\n  Demo data added: 12 teams, Round 1 & 2 published, Round 3 live.');
  console.log('  Every demo team uses the password: demo-pass   (e.g. team ID GEN001)\n');
  process.exit(0);
})();
