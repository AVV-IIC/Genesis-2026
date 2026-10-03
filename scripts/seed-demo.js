'use strict';
// Fills the database with a realistic mid-event demo of both competitions so
// you can click around: 12 Hackathon teams, 3 judges, 6 Ideathon teams.
// Run with the server stopped:  npm run seed-demo
// Clear it afterwards from each console's Settings → Danger zone.
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

const IDEA_TEAMS = [
  ['Green Sparks', 'Kavitha R', 'Sustainability', ['Manoj P', 'Lina D'], ['Compost Connect', 'Restaurants throw away tonnes of food waste while urban farms buy fertiliser.', 'An app that matches restaurants with nearby urban farms for daily food-waste pickups, with route planning for volunteer riders.', 'Diverts organic waste from landfill and cuts fertiliser costs for small farms.']],
  ['Mind Matters', 'Rohan Das', 'HealthTech', ['Ayesha K', 'Prem S'], ['Peer Pulse', 'Students hesitate to ask for help with stress until it becomes a crisis.', 'Anonymous peer check-ins with trained student volunteers, plus a weekly mood pulse that nudges people towards counsellors early.', 'Earlier support and fewer drop-outs.']],
  ['Ledger Legends', 'Simran Kaur', 'FinTech', ['Ajay V', 'Mitali N'], ['Chit Chat', 'Small savings groups track contributions in notebooks, which leads to disputes.', 'A WhatsApp-first ledger for rotating savings groups with automatic reminders and a shared, tamper-proof history.', '']],
  ['Learn Loop', 'Gautam Rao', 'EdTech', ['Fatima Z', 'Chirag M'], ['Village Tutor Network', 'Rural schools lack subject teachers for higher classes.', 'Live, low-bandwidth tutoring sessions run by college volunteers, recorded for offline replay on a shared classroom tablet.', 'Access to specialist teaching for thousands of students.']],
  ['Urban Owls', 'Nisha Pillai', 'Smart Cities', ['Kabir J', 'Elena M'], null],
  ['Idea Forge', 'Vivek Shetty', 'Open Innovation', ['Ritu A', 'Sahil B'], null],
];

const JUDGES = [['JDG001', 'Dr. Meera Krishnan'], ['JDG002', 'Arvind Rao'], ['JDG003', 'Sana Qureshi']];

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

  setSettings('hackathon', {
    event_name: 'Genesis Hackathon',
    tagline: '24 hours to build what comes next.',
    venue: 'Main Auditorium, Block A',
    event_start: at(0),
    event_end: at(24),
    helpdesk_contact: 'Organiser desk: next to the main stage\nRohit (lead organiser): +91 98xxxxxx01',
  });
  setSettings('ideathon', {
    event_name: 'Genesis Ideathon',
    tagline: '24 hours to shape an idea worth building.',
    venue: 'Seminar Hall, Block B',
    event_start: at(0),
    event_end: at(24),
    helpdesk_contact: 'Ideathon desk: Seminar Hall entrance',
    submissions_enabled: '1',
    submissions_open: '1',
    submission_deadline: at(20),
  });

  const password = 'demo-pass';
  const hash = await hashPassword(password);

  tx(() => {
    const rounds = q.all('SELECT * FROM rounds ORDER BY number');
    const crit = (roundId) => q.all('SELECT * FROM criteria WHERE round_id = ? ORDER BY sort', roundId);

    const ids = TEAMS.map(([name, leader, track, members], i) => {
      const code = `GEN${String(i + 1).padStart(3, '0')}`;
      const { id } = q.run(
        `INSERT INTO teams (code, name, leader_name, email, phone, members, track, table_no, password_hash, last_login_at, competition)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hackathon')`,
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

    // Round 3 is live, and the judges are scoring it.
    q.run("UPDATE rounds SET state = 'live' WHERE id = ?", r3.id);
    const judgeIds = JUDGES.map(([username, name], i) =>
      q.run('INSERT INTO judges (username, display_name, password_hash, last_login_at) VALUES (?, ?, ?, ?)', username, name, hash, i < 2 ? new Date(now - (i + 2) * 11 * 60000).toISOString() : null).id
    );
    const finalists = ranked.slice(0, 8);
    finalists.forEach((teamId, i) => {
      for (let k = 0; k < 2; k++) q.run('INSERT INTO judge_assignments (judge_id, round_id, team_id) VALUES (?, ?, ?)', judgeIds[(i * 2 + k) % judgeIds.length], r3.id, teamId);
    });
    // Judge 1 has finished two teams and started a third.
    const mine = q.all('SELECT team_id FROM judge_assignments WHERE judge_id = ? AND round_id = ? ORDER BY team_id', judgeIds[0], r3.id).map((r) => r.team_id);
    mine.slice(0, 3).forEach((teamId, i) => {
      for (const c of crit(r3.id)) q.run('INSERT INTO judge_scores (judge_id, team_id, criterion_id, score) VALUES (?, ?, ?, ?)', judgeIds[0], teamId, c.id, Math.min(c.max_score, rnd(5, 9.5)));
      q.run(
        'INSERT INTO judge_feedback (judge_id, team_id, round_id, comments, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        judgeIds[0], teamId, r3.id,
        i < 2 ? 'The demo works end to end. Spend the remaining time on onboarding: the first screen is confusing.' : '',
        i < 2 ? new Date(now - (20 - i * 5) * 60000).toISOString() : null,
        new Date(now - (20 - i * 5) * 60000).toISOString()
      );
    });

    // Ideathon: 6 teams, 4 have submitted an idea.
    IDEA_TEAMS.forEach(([name, leader, track, members, idea], i) => {
      const { id } = q.run(
        `INSERT INTO teams (code, name, leader_name, email, members, track, table_no, password_hash, last_login_at, competition)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ideathon')`,
        `IDE${String(i + 1).padStart(3, '0')}`,
        name,
        leader,
        `${leader.split(' ')[0].toLowerCase()}@example.com`,
        JSON.stringify([leader, ...members]),
        track,
        `S${i + 1}`,
        hash,
        i < 5 ? new Date(now - (i + 1) * 23 * 60000).toISOString() : null
      );
      if (idea) {
        const [title, problem, solution, impact] = idea;
        const ts = new Date(now - (i + 1) * 41 * 60000).toISOString();
        q.run(
          'INSERT INTO submissions (team_id, title, problem, solution, impact, deck_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          id, title, problem, solution, impact, i % 2 ? '' : 'https://example.com/deck', ts, ts
        );
      }
    });

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
    // Shared moments (opening, meals, closing) show in both competitions.
    const SHARED = new Set(['Opening ceremony', 'Lunch', 'Dinner', 'Midnight snacks', 'Closing & prizes']);
    for (const [title, kind, s, e, location, details] of sched) {
      q.run('INSERT INTO schedule (title, kind, starts_at, ends_at, location, details, competition) VALUES (?, ?, ?, ?, ?, ?, ?)', title, kind, at(s), e === null ? null : at(e), location, details, SHARED.has(title) ? 'both' : 'hackathon');
    }
    const ideaSched = [
      ['Ideathon kick-off & problem statements', 'talk', 0.5, 1, 'Seminar hall', 'Pick a problem statement and start shaping your idea.'],
      ['Mentor rounds', 'general', 6, 9, 'Seminar hall', 'Mentors visit every table for feedback.'],
      ['Idea submission closes', 'deadline', 20, null, '', 'Your idea in the portal locks at this time.'],
      ['Final pitches', 'talk', 21, 23.5, 'Seminar hall', 'Three minutes per team.'],
    ];
    for (const [title, kind, s, e, location, details] of ideaSched) {
      q.run("INSERT INTO schedule (title, kind, starts_at, ends_at, location, details, competition) VALUES (?, ?, ?, ?, ?, ?, 'ideathon')", title, kind, at(s), e === null ? null : at(e), location, details);
    }

    const ann = [
      ['Welcome to Genesis!', 'The hackathon is officially on. Keep this portal open. Results, announcements and the schedule update here live.', 'normal', 1, 0.6],
      ['Round 1 results are out', 'Scores and judges’ notes for Round 1 are in your scorecard. Every team moves on to Round 2.', 'important', 0, 4.1],
      ['Round 2 results are out', 'Results for Round 2 have been published. Open your scorecard to see whether your team is selected for Round 3.', 'important', 0, 9.1],
      ['Round 3 judging starts at hour 16', 'Selected teams: have your demo ready on a laptop. Judges will come to your table. **No slides needed.**', 'urgent', 0, 9.3],
    ];
    for (const [title, body, priority, pinned, h] of ann) {
      q.run("INSERT INTO announcements (title, body, priority, pinned, author, created_at, competition) VALUES (?, ?, ?, ?, 'Organiser 1', ?, 'hackathon')", title, body, priority, pinned, at(h));
    }
    q.run(
      "INSERT INTO announcements (title, body, priority, audience, author, created_at, competition) VALUES (?, ?, 'important', 'judges', 'Organiser 1', ?, 'hackathon')",
      'Judges: Round 3 scoring is open',
      'Your assigned teams are in the Evaluate tab. Please mark each team done by hour 18.',
      at(8.9)
    );
    q.run(
      "INSERT INTO announcements (title, body, priority, audience, author, created_at, competition) VALUES (?, ?, 'normal', 'everyone', 'Organiser 1', ?, 'both')",
      'Dinner at 7:30 in the cafeteria',
      'Hackathon and Ideathon teams, judges and volunteers: dinner is served from hour 10.5.',
      at(9.5)
    );
    q.run(
      "INSERT INTO announcements (title, body, priority, pinned, author, created_at, competition) VALUES (?, ?, 'normal', 1, 'Ideathon Organiser 1', ?, 'ideathon')",
      'Welcome to the Genesis Ideathon!',
      'Shape your idea through the day and submit it in **My idea** before hour 20. You can keep editing until then.',
      at(0.7)
    );

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

  console.log('\n  Demo data added:');
  console.log('    Hackathon: 12 teams (GEN001–GEN012), Rounds 1 & 2 published, Round 3 live');
  console.log('    Judges:    JDG001–JDG003, assigned to the Round 3 teams');
  console.log('    Ideathon:  6 teams (IDE001–IDE006), 4 ideas submitted');
  console.log('  Every demo team and judge uses the password: demo-pass\n');
  process.exit(0);
})();
