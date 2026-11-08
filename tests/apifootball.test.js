const test = require('node:test');
const assert = require('node:assert');
const createApiFootball = require('../server/providers/apifootball');

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

const cfg = (extra) => Object.assign({
  apiFootballKey: 'test-key',
  apiFootballBase: 'https://af.test',
  footballOdds: true,
  footballOddsSec: 600,
  footballOddsMax: 10
}, extra || {});

const BOOKMAKERS = [{
  id: 4,
  bets: [
    { name: 'Match Winner', values: [{ value: 'Home', odd: '1.80' }, { value: 'Draw', odd: '3.40' }, { value: 'Away', odd: '4.20' }] },
    { name: 'Goals Over/Under', values: [{ value: 'Over 2.5', odd: '1.90' }, { value: 'Under 2.5', odd: '1.95' }] },
    { name: 'Both Teams Score', values: [{ value: 'Yes', odd: '1.70' }, { value: 'No', odd: '2.10' }] }
  ]
}];

const oddsBody = (id) => ({ results: 1, errors: [], response: [{ fixture: { id: Number(id) }, bookmakers: BOOKMAKERS }] });

test('per-fixture odds are fetched even when kickoff is missing (no RangeError)', async (t) => {
  const seen = [];
  useFetch(t, async (url) => {
    const u = new URL(String(url));
    assert.ok(u.pathname.endsWith('/odds'), 'uses the per-fixture odds endpoint');
    seen.push(u.searchParams.get('fixture'));
    return reply(oddsBody(u.searchParams.get('fixture')));
  });
  const p = createApiFootball(cfg(), () => {});
  const rows = await p.odds({
    matches: [
      { ref: 'af:101', sport: 'football', status: 'scheduled' },
      { ref: 'af:102', sport: 'football', status: 'live' }
    ],
    live: false
  });
  assert.deepStrictEqual(seen.sort(), ['101', '102']);
  assert.strictEqual(new Set(rows.map((r) => r.matchRef)).size, 2);
  const one = rows.filter((r) => r.matchRef === 'af:101');
  assert.ok(one.some((r) => r.market === '1x2' && r.selection === '1' && r.value === 1.8));
  assert.ok(one.some((r) => r.market === 'ou25' && r.selection === 'O'));
  assert.ok(one.some((r) => r.market === 'btts' && r.selection === 'Y'));
  assert.strictEqual(one[0].bookmaker, 'af:b4');
});

test('odds cache avoids refetching and a capped pass covers the rest next time', async (t) => {
  let calls = 0;
  useFetch(t, async (url) => {
    calls++;
    return reply(oddsBody(new URL(String(url)).searchParams.get('fixture')));
  });
  const p = createApiFootball(cfg({ footballOddsMax: 2 }), () => {});
  const matches = ['201', '202', '203', '204'].map((id) => ({ ref: 'af:' + id, sport: 'football', status: 'scheduled', kickoff: 1794337200 + Number(id) }));

  const first = await p.odds({ matches, live: false });
  assert.strictEqual(calls, 2, 'cap respected');
  assert.strictEqual(new Set(first.map((r) => r.matchRef)).size, 2);

  const second = await p.odds({ matches, live: false });
  assert.strictEqual(calls, 4, 'cached refs are free; only the two uncached are fetched');
  assert.strictEqual(new Set(second.map((r) => r.matchRef)).size, 4);

  const third = await p.odds({ matches, live: false });
  assert.strictEqual(calls, 4, 'everything is served from cache');
  assert.strictEqual(new Set(third.map((r) => r.matchRef)).size, 4);
});

test('odds ignore other feeds and finished matches; live pass makes no calls', async (t) => {
  let calls = 0;
  useFetch(t, async () => { calls++; return reply({ results: 0, errors: [], response: [] }); });
  const p = createApiFootball(cfg(), () => {});
  const rows = await p.odds({
    matches: [
      { ref: 'hk:1', sport: 'hockey' },
      { ref: 'af:301', sport: 'football', status: 'finished' },
      { ref: 'af:302', sport: 'football', status: 'scheduled' }
    ],
    live: false
  });
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(rows, []);
  const liveRows = await p.odds({ matches: [{ ref: 'af:302', sport: 'football', status: 'live' }], live: true });
  assert.deepStrictEqual(liveRows, []);
  assert.strictEqual(calls, 1, 'live pass does not spend API calls');
});
