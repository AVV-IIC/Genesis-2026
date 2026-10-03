'use strict';
// Everything about rounds, scores, judging, eliminations and standings lives
// here so the team portal, the judge portal, the organiser sheet, the
// leaderboard and CSV export all agree. Mirrors supabase/schema.sql.

const { q, getSettings } = require('../db');

const round2 = (n) => Math.round(n * 100) / 100;

function loadRounds() {
  const rounds = q.all('SELECT * FROM rounds ORDER BY number');
  const criteria = q.all('SELECT * FROM criteria ORDER BY sort, id');
  for (const r of rounds) {
    r.is_elimination = !!r.is_elimination;
    r.published = !!r.published;
    r.judging_open = (r.state === 'live' || r.state === 'judging') && !r.published;
    r.criteria = criteria.filter((c) => c.round_id === r.id);
    r.max_total = round2(r.criteria.reduce((s, c) => s + c.max_score, 0));
  }
  return rounds;
}

/**
 * scoreMap:  "team:criterion" -> organiser mark (override)
 * judgeMap:  "team:criterion" -> average of the assigned judges' marks
 * resultMap: "team:round"     -> result row
 */
function loadScoreMaps(teamId = null) {
  const where = teamId ? ' WHERE team_id = ?' : '';
  const args = teamId ? [teamId] : [];
  const scores = q.all(`SELECT * FROM scores${where}`, ...args);
  const results = q.all(`SELECT * FROM results${where}`, ...args);
  const judged = q.all(
    `SELECT js.team_id, js.criterion_id, ROUND(AVG(js.score), 2) AS avg
       FROM judge_scores js
       JOIN criteria c ON c.id = js.criterion_id
       JOIN judge_assignments ja ON ja.judge_id = js.judge_id AND ja.team_id = js.team_id AND ja.round_id = c.round_id
      ${teamId ? 'WHERE js.team_id = ?' : ''}
      GROUP BY js.team_id, js.criterion_id`,
    ...args
  );
  return {
    scoreMap: new Map(scores.map((s) => [`${s.team_id}:${s.criterion_id}`, s.score])),
    judgeMap: new Map(judged.map((s) => [`${s.team_id}:${s.criterion_id}`, s.avg])),
    resultMap: new Map(results.map((r) => [`${r.team_id}:${r.round_id}`, r])),
  };
}

// The mark that counts: an organiser's mark if entered, otherwise the judges' average.
function official(maps, teamId, criterionId) {
  const k = `${teamId}:${criterionId}`;
  if (maps.scoreMap.has(k)) return maps.scoreMap.get(k);
  return maps.judgeMap.has(k) ? maps.judgeMap.get(k) : undefined;
}

function roundTotal(round, teamId, maps) {
  let total = 0;
  let scored = 0;
  for (const c of round.criteria) {
    const s = official(maps, teamId, c.id);
    if (s !== undefined) {
      total += s;
      scored++;
    }
  }
  return { total: scored ? round2(total) : null, scored, complete: scored === round.criteria.length && scored > 0 };
}

function effectiveStatus(round, result) {
  if (result && result.status === 'eliminated') return 'eliminated';
  if (!round.is_elimination) return 'advanced';
  return result ? result.status : 'pending';
}

function eliminatedIn(teamId, rounds, resultMap, { publishedOnly }) {
  for (const r of rounds) {
    if (publishedOnly && !r.published) continue;
    const res = resultMap.get(`${teamId}:${r.id}`);
    if (res && res.status === 'eliminated') return r.number;
  }
  return null;
}

// Judges' comments for a team in a round, anonymised as "Judge 1", "Judge 2"…
function teamFeedback(teamId, roundId) {
  return q
    .all(
      `SELECT jf.comments FROM judge_feedback jf
         JOIN judge_assignments ja ON ja.judge_id = jf.judge_id AND ja.team_id = jf.team_id AND ja.round_id = jf.round_id
        WHERE jf.team_id = ? AND jf.round_id = ? AND TRIM(jf.comments) <> ''
        ORDER BY jf.judge_id`,
      teamId,
      roundId
    )
    .map((f, i) => ({ label: `Judge ${i + 1}`, comments: f.comments }));
}

function teamJourney(teamId) {
  const rounds = loadRounds();
  const maps = loadScoreMaps(teamId);
  let outAt = null;
  return rounds.map((r) => {
    const reached = outAt === null;
    const res = maps.resultMap.get(`${teamId}:${r.id}`);
    const entry = {
      id: r.id,
      number: r.number,
      name: r.name,
      description: r.description,
      is_elimination: r.is_elimination,
      state: r.state,
      published: r.published,
      max_total: r.max_total,
      reached,
      criteria: r.criteria.map((c) => ({ id: c.id, name: c.name, max_score: c.max_score, score: null })),
      total: null,
      status: null,
      comments: '',
      award: '',
      feedback: [],
    };
    if (r.published && reached) {
      for (const c of entry.criteria) {
        const s = official(maps, teamId, c.id);
        c.score = s === undefined ? null : s;
      }
      entry.total = roundTotal(r, teamId, maps).total;
      entry.status = effectiveStatus(r, res);
      entry.comments = res ? res.comments : '';
      entry.award = res ? res.award : '';
      entry.feedback = teamFeedback(teamId, r.id);
      if (entry.status === 'eliminated') outAt = r.number;
    }
    return entry;
  });
}

function standing(journey) {
  if (!journey.length) {
    return { kind: 'waiting', round: null, title: 'You’re in', text: 'Your results will appear here after each round. Keep an eye on announcements.' };
  }
  const last = journey[journey.length - 1];
  let lastPublished = null;
  for (const r of journey) {
    if (!r.published || !r.reached) continue;
    if (r.status === 'eliminated') {
      return {
        kind: 'eliminated',
        round: r.number,
        title: `Not selected after Round ${r.number}`,
        text: 'Thank you for building with us. Your scores and the judges’ notes are in your scorecard.',
      };
    }
    lastPublished = r;
  }
  const active = journey.find((r) => r.state === 'live' || r.state === 'judging');
  if (!lastPublished) {
    return {
      kind: 'waiting',
      round: active ? active.number : journey[0].number,
      title: active ? `Round ${active.number} ${active.state === 'judging' ? 'is being judged' : 'is on'}` : 'You’re in',
      text: active
        ? `${active.name}. Results will appear here as soon as the organisers publish them.`
        : 'Your results will appear here after each round. Keep an eye on announcements.',
    };
  }
  if (lastPublished.status === 'pending') {
    return {
      kind: 'pending',
      round: lastPublished.number,
      title: `Round ${lastPublished.number} result pending`,
      text: 'The judges haven’t finalised your result for this round yet.',
    };
  }
  if (lastPublished === last) {
    return {
      kind: 'finished',
      round: last.number,
      title: lastPublished.award || 'Selected in the final round',
      text: 'You made it through every round. Congratulations to the whole team.',
      award: lastPublished.award || '',
    };
  }
  const next = journey.find((r) => r.number > lastPublished.number);
  const nextRound = next ? next.number : lastPublished.number + 1;
  return {
    kind: 'advancing',
    round: lastPublished.number,
    next: nextRound,
    title: lastPublished.is_elimination ? `Selected for Round ${nextRound}` : `Through to Round ${nextRound}`,
    text: next ? `Next up: ${next.name}.` : '',
    award: lastPublished.award || '',
  };
}

function isCompeting(teamId) {
  const rounds = loadRounds();
  const { resultMap } = loadScoreMaps(teamId);
  return eliminatedIn(teamId, rounds, resultMap, { publishedOnly: true }) === null;
}

function leaderboard({ publishedOnly }) {
  const allRounds = loadRounds();
  const rounds = allRounds.filter((r) => !publishedOnly || r.published);
  const teams = q.all("SELECT id, code, name, track FROM teams WHERE active = 1 AND competition = 'hackathon' ORDER BY name");
  const maps = loadScoreMaps();

  const rows = teams.map((t) => {
    const out = eliminatedIn(t.id, publishedOnly ? rounds : allRounds, maps.resultMap, { publishedOnly });
    let cumulative = 0;
    let any = false;
    const perRound = rounds.map((r) => {
      if (out !== null && r.number > out) return { round: r.number, total: null };
      const { total } = roundTotal(r, t.id, maps);
      if (total !== null) {
        cumulative += total;
        any = true;
      }
      return { round: r.number, total };
    });
    const awards = rounds
      .map((r) => maps.resultMap.get(`${t.id}:${r.id}`))
      .filter((res) => res && res.award)
      .map((res) => res.award);
    return { team_id: t.id, code: t.code, name: t.name, track: t.track, rounds: perRound, total: any ? round2(cumulative) : null, eliminated_in: out, awards };
  });

  rows.sort((a, b) => {
    const sa = a.eliminated_in ?? Infinity;
    const sb = b.eliminated_in ?? Infinity;
    if (sa !== sb) return sb - sa;
    if ((b.total ?? -1) !== (a.total ?? -1)) return (b.total ?? -1) - (a.total ?? -1);
    return a.name.localeCompare(b.name);
  });
  let rank = 0;
  let prev = null;
  rows.forEach((row, i) => {
    const key = `${row.eliminated_in ?? 'in'}|${row.total}`;
    if (key !== prev) rank = i + 1;
    prev = key;
    row.rank = rank;
  });

  return {
    rounds: rounds.map((r) => ({ number: r.number, name: r.name, max_total: r.max_total, published: r.published })),
    rows,
  };
}

/** Which hackathon teams are in a round, and why not if they aren't. */
function roundEligibility(round, rounds, resultMap) {
  const earlier = rounds.filter((r) => r.number < round.number);
  const prev = earlier[earlier.length - 1];
  const teams = q.all("SELECT * FROM teams WHERE competition = 'hackathon' ORDER BY code");
  return teams.map((t) => {
    const out = eliminatedIn(t.id, earlier, resultMap, { publishedOnly: false });
    const prevRes = prev ? resultMap.get(`${t.id}:${prev.id}`) : null;
    const awaiting = out === null && prev && prev.is_elimination && !(prevRes && prevRes.status === 'selected') ? prev.number : null;
    return { team: t, eligible: !!t.active && out === null && awaiting === null, out, awaiting };
  });
}

function judgingCounts(roundId, teamId) {
  const assigned = q.get('SELECT COUNT(*) AS n FROM judge_assignments WHERE round_id = ? AND team_id = ?', roundId, teamId).n;
  const done = q.get(
    `SELECT COUNT(*) AS n FROM judge_feedback jf
       JOIN judge_assignments ja ON ja.judge_id = jf.judge_id AND ja.team_id = jf.team_id AND ja.round_id = jf.round_id
      WHERE jf.round_id = ? AND jf.team_id = ? AND jf.submitted_at IS NOT NULL`,
    roundId,
    teamId
  ).n;
  return { assigned, done };
}

/** Organiser score sheet for one round. */
function roundSheet(roundId) {
  const rounds = loadRounds();
  const round = rounds.find((r) => r.id === roundId);
  if (!round) return null;
  const maps = loadScoreMaps();

  const rows = roundEligibility(round, rounds, maps.resultMap).map(({ team: t, eligible, out, awaiting }) => {
    const res = maps.resultMap.get(`${t.id}:${round.id}`);
    const scores = {};
    const judgeAvg = {};
    for (const c of round.criteria) {
      const k = `${t.id}:${c.id}`;
      if (maps.scoreMap.has(k)) scores[c.id] = maps.scoreMap.get(k);
      if (maps.judgeMap.has(k)) judgeAvg[c.id] = maps.judgeMap.get(k);
    }
    const { total, complete } = roundTotal(round, t.id, maps);
    return {
      team_id: t.id,
      code: t.code,
      name: t.name,
      leader_name: t.leader_name,
      track: t.track,
      table_no: t.table_no,
      active: !!t.active,
      eligible,
      eliminated_in: out,
      awaiting_round: awaiting,
      scores,
      judge_avg: judgeAvg,
      judges: judgingCounts(round.id, t.id),
      total,
      complete,
      status: res ? res.status : 'pending',
      comments: res ? res.comments : '',
      award: res ? res.award : '',
      updated_by: res ? res.updated_by : null,
      updated_at: res ? res.updated_at : null,
    };
  });
  return { round, rows };
}

/** What one judge entered for one team in one round. */
function judgeRow(judgeId, roundId, teamId) {
  const t = q.get('SELECT * FROM teams WHERE id = ?', teamId);
  if (!t) return null;
  const marks = q.all(
    `SELECT js.criterion_id, js.score FROM judge_scores js JOIN criteria c ON c.id = js.criterion_id
      WHERE js.judge_id = ? AND js.team_id = ? AND c.round_id = ?`,
    judgeId,
    teamId,
    roundId
  );
  const fb = q.get('SELECT * FROM judge_feedback WHERE judge_id = ? AND team_id = ? AND round_id = ?', judgeId, teamId, roundId);
  return {
    team_id: t.id,
    code: t.code,
    name: t.name,
    leader_name: t.leader_name,
    track: t.track,
    table_no: t.table_no,
    members: JSON.parse(t.members || '[]'),
    scores: Object.fromEntries(marks.map((m) => [m.criterion_id, m.score])),
    total: marks.length ? round2(marks.reduce((s, m) => s + m.score, 0)) : null,
    comments: fb ? fb.comments : '',
    done: !!(fb && fb.submitted_at),
    submitted_at: fb ? fb.submitted_at : null,
    updated_at: fb ? fb.updated_at : null,
  };
}

/** Ideathon: may teams save their submission right now? */
function submissionsState() {
  const s = getSettings('ideathon');
  const enabled = s.submissions_enabled === '1';
  const deadlineOk = !s.submission_deadline || Date.now() < Date.parse(s.submission_deadline);
  return { enabled, open: enabled && s.submissions_open === '1' && deadlineOk, deadline: s.submission_deadline, accepting: s.submissions_open === '1' };
}

module.exports = {
  loadRounds,
  loadScoreMaps,
  official,
  roundTotal,
  effectiveStatus,
  eliminatedIn,
  teamJourney,
  teamFeedback,
  standing,
  isCompeting,
  leaderboard,
  roundEligibility,
  roundSheet,
  judgeRow,
  judgingCounts,
  submissionsState,
  round2,
};
