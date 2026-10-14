const test = require('node:test');
const assert = require('node:assert');
const U = require('../shared/util');
const { createWorld } = require('../shared/mock-world');

const world = createWorld();
const T0 = Date.UTC(2026, 9, 9, 0, 0) / 1000; // 2026-10-09 00:00 UTC
const DAY = 86400;

function day(ds, now) {
  const f = U.dayStart(ds, 'UTC');
  return world.fixtures({ from: f, to: f + DAY, now });
}

test('reference data is complete and unique', () => {
  const ref = world.referenceData();
  assert.strictEqual(ref.sports.length, 9);
  assert.ok(ref.leagues.length >= 18, 'leagues: ' + ref.leagues.length);
  assert.ok(ref.teams.length > 300, 'teams: ' + ref.teams.length);
  assert.strictEqual(new Set(ref.leagues.map((l) => l.ref)).size, ref.leagues.length);
  assert.strictEqual(new Set(ref.teams.map((t) => t.ref)).size, ref.teams.length);
  // every league team exists
  world.leagues.forEach((lg) => lg.teamRefs.forEach((t) => assert.ok(world.teams[t], 'missing team ' + t + ' in ' + lg.ref)));
});

test('simulation is deterministic', () => {
  const now = T0 + 15 * 3600;
  const a = JSON.stringify(day('2026-10-09', now));
  const b = JSON.stringify(createWorld().fixtures({ from: U.dayStart('2026-10-09', 'UTC'), to: U.dayStart('2026-10-10', 'UTC'), now }));
  assert.strictEqual(a, b);
});

test('every sport has fixtures across a 3 week span', () => {
  const seen = {};
  for (let i = -10; i <= 10; i++) {
    const ds = U.addDays('2026-10-09', i);
    day(ds, T0 + 15 * 3600).forEach((m) => { seen[m.sport] = (seen[m.sport] || 0) + 1; });
  }
  ['football', 'basketball', 'tennis', 'hockey', 'volleyball', 'american-football', 'baseball', 'handball', 'rugby'].forEach((s) => {
    assert.ok(seen[s] > 0, 'no fixtures for ' + s);
  });
});

test('demo clock: something is always live, football almost always, and the sim clock stays in its window', () => {
  let footballLive = 0, samples = 0;
  for (let d = 0; d < 14; d++) {
    const ds = U.addDays('2026-10-01', d), f = U.dayStart(ds, 'UTC');
    for (let h = 0; h < 24; h += 1) {
      const real = f + h * 3600 + 900;
      const sim = world.simNow(real);
      assert.ok(sim >= f + 14 * 3600 && sim < f + 21 * 3600, 'sim clock outside 14:00-21:00 at real hour ' + h);
      const ms = world.fixtures({ from: f, to: f + DAY, now: sim });
      const live = ms.filter((m) => m.status === 'live' || m.status === 'halftime');
      assert.ok(live.length > 0, 'nothing live on ' + ds + ' at real hour ' + h);
      samples++;
      if (live.some((m) => m.sport === 'football')) footballLive++;
      assert.ok(ms.filter((m) => m.sport === 'football').length >= 15, 'too few football matches on ' + ds);
    }
  }
  assert.ok(footballLive / samples >= 0.93, 'football live in only ' + Math.round(100 * footballLive / samples) + '% of samples');
});

test('football status timeline and score monotonicity', () => {
  const ms = day('2026-10-09', T0).filter((m) => m.sport === 'football' && m.status === 'scheduled');
  assert.ok(ms.length > 0);
  const m = ms[0];
  let prevH = 0, prevA = 0, sawLive = false, sawHT = false, sawFT = false;
  for (let min = -5; min <= 120; min++) {
    const s = world.fixtures({ from: m.kickoff, to: m.kickoff + 1, now: m.kickoff + min * 60 }).find((x) => x.ref === m.ref);
    if (min < 0) { assert.strictEqual(s.status, 'scheduled'); assert.strictEqual(s.homeScore, null); continue; }
    if (s.status === 'postponed') return; // rare, ignore
    if (s.status === 'live') { sawLive = true; assert.ok(s.minute >= 1 && s.minute <= 90, 'minute ' + s.minute); }
    if (s.status === 'halftime') { sawHT = true; assert.strictEqual(s.minute, 45); }
    if (s.status === 'finished') sawFT = true;
    assert.ok(s.homeScore >= prevH && s.awayScore >= prevA, 'score went backwards');
    prevH = s.homeScore; prevA = s.awayScore;
  }
  assert.ok(sawLive && sawHT && sawFT);
});

test('football detail: events match the score, stats are consistent', () => {
  const ms = day('2026-10-08', T0 + 15 * 3600).filter((m) => m.sport === 'football' && m.status === 'finished');
  assert.ok(ms.length > 0);
  ms.forEach((m) => {
    const d = world.detail(m.ref, T0 + 15 * 3600);
    const gh = d.events.filter((e) => e.type === 'goal' && e.side === 'home').length;
    const ga = d.events.filter((e) => e.type === 'goal' && e.side === 'away').length;
    assert.strictEqual(gh, m.homeScore); assert.strictEqual(ga, m.awayScore);
    const poss = d.stats.find((s) => s.key === 'possession');
    assert.strictEqual(poss.home + poss.away, 100);
    const sot = d.stats.find((s) => s.key === 'sot'), shots = d.stats.find((s) => s.key === 'shots');
    assert.ok(sot.home <= shots.home && sot.away <= shots.away);
    assert.ok(d.lineups && d.lineups.home.starters.length === 11 && d.lineups.away.starters.length === 11);
    assert.strictEqual(d.h2h.length, 5);
    // subs and goalscorers are on the pitch (starters or subs)
    const names = new Set(d.lineups.home.starters.concat(d.lineups.home.subs, d.lineups.away.starters, d.lineups.away.subs).map((p) => p.name));
    d.events.forEach((e) => assert.ok(names.has(e.player), 'event player not in squad: ' + e.player));
  });
});

test('tennis and volleyball produce valid set scores', () => {
  let checked = 0;
  for (let i = -6; i <= 0; i++) {
    day(U.addDays('2026-10-09', i), T0 + 20 * 3600).filter((m) => (m.sport === 'tennis' || m.sport === 'volleyball') && m.status === 'finished').forEach((m) => {
      checked++;
      const toWin = m.sport === 'volleyball' ? 3 : 2;
      assert.ok(Math.max(m.homeScore, m.awayScore) === toWin, m.sport + ' winner needs ' + toWin + ' sets, got ' + m.homeScore + '-' + m.awayScore);
      assert.ok(Math.min(m.homeScore, m.awayScore) < toWin);
      assert.strictEqual(m.periods.length, m.homeScore + m.awayScore);
      m.periods.forEach((s, idx) => {
        const hi = Math.max(s.home, s.away), lo = Math.min(s.home, s.away);
        if (m.sport === 'tennis') assert.ok((hi === 6 && lo <= 4) || hi === 7 && (lo === 5 || lo === 6), 'bad tennis set ' + s.home + '-' + s.away);
        else { const target = idx === 4 ? 15 : 25; assert.ok(hi >= target && hi - lo >= 2 && (hi === target || hi - lo === 2), 'bad volleyball set ' + s.home + '-' + s.away); }
      });
    });
  }
  assert.ok(checked > 5, 'checked ' + checked);
});

test('period sports: finished scores equal sum of periods, live shows period', () => {
  let fin = 0, live = 0;
  for (let h = 12; h < 22; h++) {
    day('2026-10-09', T0 + h * 3600).filter((m) => ['basketball', 'hockey', 'american-football', 'baseball', 'handball', 'rugby'].includes(m.sport)).forEach((m) => {
      if (m.status === 'finished') {
        fin++;
        assert.strictEqual(m.periods.reduce((a, p) => a + p.home, 0), m.homeScore);
        assert.strictEqual(m.periods.reduce((a, p) => a + p.away, 0), m.awayScore);
      }
      if (m.status === 'live') { live++; assert.ok(m.period >= 1 && m.minute >= 1); }
    });
  }
  assert.ok(fin > 0 && live > 0, 'fin ' + fin + ' live ' + live);
});

test('basketball and football scores are realistic', () => {
  const bs = [], fs = [];
  for (let i = -8; i <= -1; i++) day(U.addDays('2026-10-09', i), T0 + 20 * 3600).forEach((m) => {
    if (m.status !== 'finished') return;
    if (m.sport === 'basketball') bs.push(m.homeScore + m.awayScore);
    if (m.sport === 'football') fs.push(m.homeScore + m.awayScore);
  });
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(bs.length > 10 && avg(bs) > 170 && avg(bs) < 290, 'basketball total avg ' + avg(bs));
  assert.ok(fs.length > 20 && avg(fs) > 1.8 && avg(fs) < 4.0, 'football total goals avg ' + avg(fs));
});

test('standings are sorted and internally consistent', () => {
  world.leagues.filter((l) => l.type === 'league').forEach((lg) => {
    const g = world.standings(lg.ref, T0 + 15 * 3600)[0];
    assert.strictEqual(g.rows.length, lg.teamRefs.length);
    g.rows.forEach((r, i) => {
      assert.strictEqual(r.rank, i + 1);
      assert.strictEqual(r.won + (r.drawn || 0) + r.lost, r.played, lg.ref + ' ' + r.teamRef);
      if (lg.sport === 'football') assert.strictEqual(r.points, r.won * 3 + r.drawn);
      if (i > 0 && lg.sport === 'football') {
        const p = g.rows[i - 1];
        assert.ok(p.points >= r.points, 'not sorted by points in ' + lg.ref);
      }
    });
  });
  assert.deepStrictEqual(world.standings('football:europe:champions-league', T0), [], 'cups have no table');
});

test('odds: live odds react to the score, probabilities are coherent', () => {
  const sched = day('2026-10-09', T0).filter((m) => m.sport === 'football' && m.status === 'scheduled' && !m.status.postponed)[0];
  const rows0 = world.odds({ matches: [sched], now: T0 });
  assert.ok(rows0.length > 0);
  const b = rows0.filter((r) => r.market === '1x2' && r.bookmaker === rows0[0].bookmaker);
  assert.strictEqual(b.length, 3);
  const implied = b.reduce((a, r) => a + 1 / r.value, 0);
  assert.ok(implied > 1.0 && implied < 1.2, 'overround ' + implied);
  rows0.forEach((r) => assert.ok(r.value >= 1.01 && r.value <= 250));
  // finished matches have no odds
  const fin = day('2026-10-08', T0 + 15 * 3600).filter((m) => m.status === 'finished').slice(0, 3);
  assert.strictEqual(world.odds({ matches: fin, now: T0 + 15 * 3600 }).length, 0);
  // two-way sports have 'ml' only
  const nba = day('2026-10-09', T0).find((m) => m.sport === 'basketball' && m.status === 'scheduled');
  const nr = world.odds({ matches: [nba], now: T0 });
  assert.ok(nr.length && nr.every((r) => r.market === 'ml'));
});

test('a goal moves the live odds the right way', () => {
  // find a live football match where the home side just took the lead
  let found = null;
  outer: for (let i = 0; i < 12 && !found; i++) {
    const ms = day(U.addDays('2026-10-09', -i), T0).filter((m) => m.sport === 'football');
    for (const m of ms) {
      if (m.postponed) continue;
      const det = world.detail(m.ref, m.kickoff + 200 * 60);
      const g = det.events.find((e) => e.type === 'goal' && e.min >= 20 && e.min <= 44);
      if (!g) continue;
      const side = g.side;
      const before = world.fixtures({ from: m.kickoff, to: m.kickoff + 1, now: m.kickoff + (g.min - 2) * 60 + 30 })[0];
      const after = world.fixtures({ from: m.kickoff, to: m.kickoff + 1, now: m.kickoff + (g.min - 1) * 60 + 30 })[0];
      if (!before || !after || before.ref !== m.ref) continue;
      found = { m, side, before, after, min: g.min };
      break outer;
    }
  }
  assert.ok(found, 'no suitable goal found');
  const pick = (st, now) => world.odds({ matches: [st], now }).filter((r) => r.market === '1x2' && r.selection === (found.side === 'home' ? '1' : '2'));
  assert.strictEqual(found.after.homeScore + found.after.awayScore, found.before.homeScore + found.before.awayScore + 1, 'exactly one goal between snapshots');
  const b = pick(found.before, found.m.kickoff + (found.min - 2) * 60 + 30);
  const a = pick(found.after, found.m.kickoff + (found.min - 1) * 60 + 30);
  assert.ok(b.length && a.length, 'odds present before and after');
  const avg = (x) => x.reduce((s, r) => s + r.value, 0) / x.length;
  assert.ok(avg(a) < avg(b), 'scoring side odds should shorten: ' + avg(b).toFixed(2) + ' -> ' + avg(a).toFixed(2));
});

test('no exceptions anywhere: all sports, 3 weeks, every sim hour', () => {
  let n = 0;
  for (let i = -10; i <= 10; i++) {
    const ds = U.addDays('2026-10-09', i);
    for (const h of [0, 14, 17, 20, 23]) {
      const ms = day(ds, T0 + h * 3600);
      n += ms.length;
      world.odds({ matches: ms, now: T0 + h * 3600 });
    }
  }
  assert.ok(n > 1000, 'matches simulated: ' + n);
});
