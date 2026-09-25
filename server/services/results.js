'use strict';
// Everything about rounds, scores, eliminations and standings lives here so the
// team portal, the admin sheet, the leaderboard and CSV export all agree.

const { q } = require('../db');

const round2 = (n) => Math.round(n * 100) / 100;

function loadRounds() {
  const rounds = q.all('SELECT * FROM rounds ORDER BY number');
  const criteria = q.all('SELECT * FROM criteria ORDER BY sort, id');
  for (const r of rounds) {
    r.is_elimination = !!r.is_elimination;
    r.published = !!r.published;
    r.criteria = criteria.filter((c) => c.round_id === r.id);
    r.max_total = round2(r.criteria.reduce((s, c) => s + c.max_score, 0));
  }
  return rounds;
}

// Map "teamId:criterionId" -> score and "teamId:roundId" -> result row.
function loadScoreMaps(teamId = null) {
  const scores = teamId
    ? q.all('SELECT * FROM scores WHERE team_id = ?', teamId)
    : q.all('SELECT * FROM scores');
  const results = teamId
    ? q.all('SELECT * FROM results WHERE team_id = ?', teamId)
    : q.all('SELECT * FROM results');
  const scoreMap = new Map(scores.map((s) => [`${s.team_id}:${s.criterion_id}`, s.score]));
  const resultMap = new Map(results.map((r) => [`${r.team_id}:${r.round_id}`, r]));
  return { scoreMap, resultMap };
}

function roundTotal(round, teamId, scoreMap) {
  let total = 0;
  let scored = 0;
  for (const c of round.criteria) {
    const s = scoreMap.get(`${teamId}:${c.id}`);
    if (s !== undefined) {
      total += s;
      scored++;
    }
  }
  return { total: scored ? round2(total) : null, scored, complete: scored === round.criteria.length && scored > 0 };
}

// The status a team sees for a round. Non-elimination rounds advance everyone
// unless the organisers explicitly eliminated (e.g. disqualified) a team.
function effectiveStatus(round, result) {
  if (result && result.status === 'eliminated') return 'eliminated';
  if (!round.is_elimination) return 'advanced';
  return result ? result.status : 'pending';
}

/**
 * The first round (by number) in which a team was eliminated.
 * publishedOnly: only count rounds whose results teams can see.
 */
function eliminatedIn(teamId, rounds, resultMap, { publishedOnly }) {
  for (const r of rounds) {
    if (publishedOnly && !r.published) continue;
    const res = resultMap.get(`${teamId}:${r.id}`);
    if (res && res.status === 'eliminated') return r.number;
  }
  return null;
}

function teamJourney(teamId) {
  const rounds = loadRounds();
  const { scoreMap, resultMap } = loadScoreMaps(teamId);
  let outAt = null;
  const journey = rounds.map((r) => {
    const reached = outAt === null;
    const res = resultMap.get(`${teamId}:${r.id}`);
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
    };
    if (r.published && reached) {
      for (const c of entry.criteria) {
        const s = scoreMap.get(`${teamId}:${c.id}`);
        c.score = s === undefined ? null : s;
      }
      entry.total = roundTotal(r, teamId, scoreMap).total;
      entry.status = effectiveStatus(r, res);
      entry.comments = res ? res.comments : '';
      entry.award = res ? res.award : '';
      if (entry.status === 'eliminated') outAt = r.number;
    }
    return entry;
  });
  return journey;
}

function standing(journey) {
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
    const first = journey[0];
    return {
      kind: 'waiting',
      round: active ? active.number : first ? first.number : null,
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

// Is the team still in the competition, as far as teams can see?
function isCompeting(teamId) {
  const rounds = loadRounds();
  const { resultMap } = loadScoreMaps(teamId);
  return eliminatedIn(teamId, rounds, resultMap, { publishedOnly: true }) === null;
}

function leaderboard({ publishedOnly }) {
  const rounds = loadRounds().filter((r) => !publishedOnly || r.published);
  const allRounds = loadRounds();
  const teams = q.all('SELECT id, code, name, track FROM teams WHERE active = 1 ORDER BY name');
  const { scoreMap, resultMap } = loadScoreMaps();

  const rows = teams.map((t) => {
    const out = eliminatedIn(t.id, publishedOnly ? rounds : allRounds, resultMap, { publishedOnly });
    let cumulative = 0;
    let any = false;
    const perRound = rounds.map((r) => {
      // Don't count rounds after the team was eliminated.
      if (out !== null && r.number > out) return { round: r.number, total: null };
      const { total } = roundTotal(r, t.id, scoreMap);
      if (total !== null) {
        cumulative += total;
        any = true;
      }
      return { round: r.number, total };
    });
    const awards = rounds
      .map((r) => resultMap.get(`${t.id}:${r.id}`))
      .filter((res) => res && res.award)
      .map((res) => res.award);
    return {
      team_id: t.id,
      code: t.code,
      name: t.name,
      track: t.track,
      rounds: perRound,
      total: any ? round2(cumulative) : null,
      eliminated_in: out,
      awards,
    };
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

/** Admin score sheet for one round. */
function roundSheet(roundId) {
  const rounds = loadRounds();
  const round = rounds.find((r) => r.id === roundId);
  if (!round) return null;
  const earlier = rounds.filter((r) => r.number < round.number);
  const teams = q.all('SELECT id, code, name, leader_name, track, table_no, active FROM teams ORDER BY code');
  const { scoreMap, resultMap } = loadScoreMaps();

  const prev = earlier[earlier.length - 1];

  const rows = teams.map((t) => {
    const out = eliminatedIn(t.id, earlier, resultMap, { publishedOnly: false });
    // After an elimination round, only teams marked "selected" move on.
    const prevRes = prev ? resultMap.get(`${t.id}:${prev.id}`) : null;
    const awaiting = out === null && prev && prev.is_elimination && !(prevRes && prevRes.status === 'selected') ? prev.number : null;
    const res = resultMap.get(`${t.id}:${round.id}`);
    const scores = {};
    for (const c of round.criteria) {
      const s = scoreMap.get(`${t.id}:${c.id}`);
      if (s !== undefined) scores[c.id] = s;
    }
    const { total, complete } = roundTotal(round, t.id, scoreMap);
    return {
      team_id: t.id,
      code: t.code,
      name: t.name,
      leader_name: t.leader_name,
      track: t.track,
      table_no: t.table_no,
      active: !!t.active,
      eligible: !!t.active && out === null && awaiting === null,
      eliminated_in: out,
      awaiting_round: awaiting,
      scores,
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

module.exports = {
  loadRounds,
  loadScoreMaps,
  roundTotal,
  effectiveStatus,
  eliminatedIn,
  teamJourney,
  standing,
  isCompeting,
  leaderboard,
  roundSheet,
  round2,
};
