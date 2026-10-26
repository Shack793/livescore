const test = require('node:test');
const assert = require('node:assert');
const createApiSports = require('../server/providers/apisports');

const realFetch = global.fetch;

function reply(body, headers) {
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || null },
    json: async () => body
  };
}

function useFetch(t, handler) {
  global.fetch = handler;
  t.after(() => { global.fetch = realFetch; });
}

const cfg = (sport, base) => ({
  apiSportsKey: 'test-key',
  [sport + 'Base']: base,
  apiSportsMinGapMs: 250,
  apiSportsFixturesSec: 300,
  apiSportsLiveSec: 30,
  apiSportsOdds: true,
  apiSportsOddsSec: 600,
  apiSportsOddsMax: 6
});

test('baseball games map totals, innings and finished status', async (t) => {
  useFetch(t, async () => reply({ results: 1, errors: [], response: [{
    id: 1, timestamp: 1792972800, status: { short: 'FT', long: 'Finished' },
    country: { name: 'USA', code: 'US' }, league: { id: 1, name: 'MLB', type: 'League', season: 2026, logo: 'l.png' },
    teams: { home: { id: 10, name: 'Home', logo: 'h.png' }, away: { id: 11, name: 'Away', logo: 'a.png' } },
    scores: { home: { total: 5, innings: { 1: 1, 2: 0, 3: 2, 4: 2 } }, away: { total: 3, innings: { 1: 0, 2: 2, 3: 1 } } }
  }] }));
  const p = createApiSports('baseball', cfg('baseball', 'https://baseball.test'), () => {});
  const list = await p.fixtures({ from: 1792972800, to: 1792972800 + 86400 });
  assert.strictEqual(list.length, 1);
  const m = list[0];
  assert.strictEqual(m.ref, 'bs:1');
  assert.strictEqual(m.leagueRef, 'bs:l1');
  assert.strictEqual(m.status, 'finished');
  assert.strictEqual(m.homeScore, 5);
  assert.strictEqual(m.awayScore, 3);
  assert.deepStrictEqual(m.periods, [{ home: 1, away: 0 }, { home: 0, away: 2 }, { home: 2, away: 1 }, { home: 2, away: 0 }]);
});

test('hockey live games map periods and period number', async (t) => {
  useFetch(t, async () => reply({ results: 1, errors: [], response: [{
    id: 2, timestamp: Math.floor(Date.now() / 1000), status: { short: 'P3', long: '3rd Period' },
    country: { name: 'USA', code: 'US' }, league: { id: 57, name: 'NHL', type: 'League', season: 2026 },
    teams: { home: { id: 20, name: 'Home', logo: '' }, away: { id: 21, name: 'Away', logo: '' } },
    scores: { home: 4, away: 1 }, periods: { first: '1-0', second: '2-0', third: '1-1', overtime: null, penalties: null }
  }] }));
  const p = createApiSports('hockey', cfg('hockey', 'https://hockey.test'), () => {});
  const list = await p.live();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].status, 'live');
  assert.strictEqual(list[0].period, 3);
  assert.deepStrictEqual(list[0].periods, [{ home: 1, away: 0 }, { home: 2, away: 0 }, { home: 1, away: 1 }]);
});

test('handball halves and volleyball sets map correctly', async (t) => {
  const responses = {
    'https://handball.test/games': { results: 1, errors: [], response: [{
      id: 3, timestamp: Math.floor(Date.now() / 1000), status: { short: 'H2', long: '2nd Half' },
      country: { name: 'Germany', code: 'DE' }, league: { id: 39, name: 'Bundesliga', type: 'League', season: 2026 },
      teams: { home: { id: 30, name: 'Home', logo: '' }, away: { id: 31, name: 'Away', logo: '' } },
      scores: { home: 20, away: 18 }, periods: { first: { home: 12, away: 10 }, second: { home: 8, away: 8 } }
    }] },
    'https://volleyball.test/games': { results: 1, errors: [], response: [{
      id: 4, timestamp: Math.floor(Date.now() / 1000), status: { short: 'S2', long: '2nd Set' },
      country: { name: 'Italy', code: 'IT' }, league: { id: 97, name: 'SuperLega', type: 'League', season: 2026 },
      teams: { home: { id: 40, name: 'Home', logo: '' }, away: { id: 41, name: 'Away', logo: '' } },
      scores: { home: 1, away: 1 }, periods: { first: { home: 25, away: 20 }, second: { home: 18, away: 22 } }
    }] }
  };
  useFetch(t, async (url) => {
    const key = String(url).split('?')[0];
    return reply(responses[key] || { results: 0, errors: [], response: [] });
  });
  const handball = createApiSports('handball', cfg('handball', 'https://handball.test'), () => {});
  const volleyball = createApiSports('volleyball', cfg('volleyball', 'https://volleyball.test'), () => {});
  const h = await handball.live();
  const v = await volleyball.live();
  assert.strictEqual(h[0].period, 2);
  assert.deepStrictEqual(h[0].periods, [{ home: 12, away: 10 }, { home: 8, away: 8 }]);
  assert.strictEqual(v[0].period, 2);
  assert.deepStrictEqual(v[0].periods, [{ home: 25, away: 20 }, { home: 18, away: 22 }]);
});

test('American football games unwrap game, date, scores and quarters', async (t) => {
  useFetch(t, async () => reply({ results: 1, errors: [], response: [{
    game: { id: 5, stage: 'Regular Season', week: 'Week 7', date: { timestamp: Math.floor(Date.now() / 1000) }, status: { short: 'Q2', long: '2nd Quarter' } },
    league: { id: 1, name: 'NFL', season: '2026', country: { name: 'USA', code: 'US' } },
    teams: { home: { id: 50, name: 'Home', logo: '' }, away: { id: 51, name: 'Away', logo: '' } },
    scores: { home: { quarter_1: 3, quarter_2: 7, total: 10 }, away: { quarter_1: 0, quarter_2: 3, total: 3 } }
  }] }));
  const p = createApiSports('american-football', cfg('americanFootball', 'https://nfl.test'), () => {});
  const list = await p.live();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].ref, 'nf:5');
  assert.strictEqual(list[0].status, 'live');
  assert.strictEqual(list[0].period, 2);
  assert.strictEqual(list[0].homeScore, 10);
  assert.deepStrictEqual(list[0].periods, [{ home: 3, away: 0 }, { home: 7, away: 3 }]);
});

test('reference data, standings and winner odds use the sport prefix', async (t) => {
  useFetch(t, async (url) => {
    const path = String(url).split('?')[0];
    if (path.endsWith('/leagues')) return reply({ results: 1, errors: [], response: [{
      id: 1, name: 'MLB', type: 'League', logo: 'l.png', country: { name: 'USA', code: 'US' },
      seasons: [{ season: 2026, current: true, start: '2026-03-01', end: '2026-11-01' }]
    }] });
    if (path.endsWith('/standings')) return reply({ results: 1, errors: [], response: [[{
      position: 1, group: { name: '' }, team: { id: 10, name: 'Home' },
      games: { played: 10, win: { total: 8 }, lose: { total: 2 } }, points: { for: 66, against: 39 }, form: 'WWLWW'
    }]] });
    if (path.endsWith('/odds')) return reply({ results: 1, errors: [], response: [{
      bookmakers: [{ id: 4, name: 'Bet365', bets: [{ name: 'Home/Away', values: [{ value: 'Home', odd: '1.80' }, { value: 'Away', odd: '2.00' }] }] }]
    }] });
    return reply({ results: 0, errors: [], response: [] });
  });
  const p = createApiSports('baseball', cfg('baseball', 'https://baseball.test'), () => {});
  const ref = await p.referenceData();
  assert.strictEqual(ref.leagues[0].ref, 'bs:l1');
  assert.strictEqual(ref.leagues[0].top, 1);
  const groups = await p.standings({ ref: 'bs:l1', season: '2026' });
  assert.strictEqual(groups[0].rows[0].teamRef, 'bs:t10');
  assert.strictEqual(groups[0].rows[0].points, 8);
  const odds = await p.odds({ matches: [{ ref: 'bs:10' }], live: false });
  assert.strictEqual(odds.length, 2);
  assert.strictEqual(odds[0].bookmaker, 'bs:b4');
  assert.strictEqual(odds[0].market, 'ml');
});
