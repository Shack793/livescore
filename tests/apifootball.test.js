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
  apiFootballBase: 'https://af.test'
}, extra || {});

const BOOKMAKERS = [{
  id: 4,
  bets: [
    { name: 'Match Winner', values: [{ value: 'Home', odd: '1.80' }, { value: 'Draw', odd: '3.40' }, { value: 'Away', odd: '4.20' }] },
    { name: 'Goals Over/Under', values: [{ value: 'Over 2.5', odd: '1.90' }, { value: 'Under 2.5', odd: '1.95' }] },
    { name: 'Both Teams Score', values: [{ value: 'Yes', odd: '1.70' }, { value: 'No', odd: '2.10' }] }
  ]
}];

const oddsBody = (id, paging) => ({ results: 1, errors: [], paging: paging || { current: 1, total: 1 }, response: [{ fixture: { id: Number(id) }, bookmakers: BOOKMAKERS }] });
const kickoffOn = (day, hour) => Date.UTC(2026, 10, day, hour || 12) / 1000; // 2026-11-XX

test('pre-match odds are fetched once per day and mapped to bookmaker markets', async (t) => {
  const urls = [];
  useFetch(t, async (url) => {
    const u = new URL(String(url));
    urls.push(u);
    return reply({ results: 2, errors: [], paging: { current: 1, total: 1 }, response: [
      { fixture: { id: 101 }, bookmakers: BOOKMAKERS },
      { fixture: { id: 102 }, bookmakers: BOOKMAKERS }
    ] });
  });
  const p = createApiFootball(cfg(), () => {});
  const rows = await p.odds({
    matches: [
      { ref: 'af:101', sport: 'football', status: 'scheduled', kickoff: kickoffOn(9) },
      { ref: 'af:102', sport: 'football', status: 'scheduled', kickoff: kickoffOn(9, 18) }
    ],
    live: false
  });
  assert.strictEqual(urls.length, 1, 'one call for the single day');
  assert.ok(urls[0].pathname.endsWith('/odds'), 'uses the date-paged odds endpoint');
  assert.strictEqual(urls[0].searchParams.get('date'), '2026-11-09');
  assert.strictEqual(urls[0].searchParams.get('page'), '1');
  assert.strictEqual(new Set(rows.map((r) => r.matchRef)).size, 2);
  const one = rows.filter((r) => r.matchRef === 'af:101');
  assert.ok(one.some((r) => r.market === '1x2' && r.selection === '1' && r.value === 1.8));
  assert.ok(one.some((r) => r.market === 'ou25' && r.selection === 'O'));
  assert.ok(one.some((r) => r.market === 'btts' && r.selection === 'Y'));
  assert.strictEqual(one[0].bookmaker, 'af:b4');
});

test('odds pagination is capped per day', async (t) => {
  let calls = 0;
  useFetch(t, async (url) => {
    calls++;
    const u = new URL(String(url));
    const page = Number(u.searchParams.get('page'));
    return reply({ results: 1, errors: [], paging: { current: page, total: 10 }, response: [{ fixture: { id: 201 }, bookmakers: BOOKMAKERS }] });
  });
  const p = createApiFootball(cfg(), () => {});
  const rows = await p.odds({ matches: [{ ref: 'af:201', sport: 'football', status: 'scheduled', kickoff: kickoffOn(10) }], live: false });
  assert.strictEqual(calls, 5, 'stops at ODDS_MAX_PAGES');
  assert.strictEqual(new Set(rows.map((r) => r.matchRef)).size, 1);
});

test('live odds come from /odds/live and ignore fixtures we did not ask for', async (t) => {
  const paths = [];
  useFetch(t, async (url) => {
    const u = new URL(String(url));
    paths.push(u.pathname);
    return reply({ results: 3, errors: [], response: [
      { fixture: { id: 302 }, bookmakers: BOOKMAKERS },
      { fixture: { id: 999 }, bookmakers: BOOKMAKERS },
      { fixture: { id: 303 }, odds: [{ name: 'Match Winner', values: [{ value: 'Home', odd: '2.00' }] }] }
    ] });
  });
  const p = createApiFootball(cfg(), () => {});
  const rows = await p.odds({
    matches: [
      { ref: 'af:302', sport: 'football', status: 'live', kickoff: kickoffOn(9) },
      { ref: 'af:303', sport: 'football', status: 'live', kickoff: kickoffOn(9) }
    ],
    live: true
  });
  assert.deepStrictEqual(paths, ['/odds/live']);
  assert.ok(rows.some((r) => r.matchRef === 'af:302' && r.bookmaker === 'af:b4'));
  assert.ok(rows.some((r) => r.matchRef === 'af:303' && r.bookmaker === 'af:live'));
  assert.ok(!rows.some((r) => r.matchRef === 'af:999'), 'unrequested fixture is ignored');
});

test('a fixture without a kickoff is skipped without a RangeError', async (t) => {
  let calls = 0;
  useFetch(t, async () => { calls++; return reply({ results: 0, errors: [], paging: { total: 1 }, response: [] }); });
  const p = createApiFootball(cfg(), () => {});
  const rows = await p.odds({
    matches: [
      { ref: 'af:401', sport: 'football', status: 'live' },
      { ref: 'hk:1', sport: 'hockey' }
    ],
    live: false
  });
  assert.deepStrictEqual(rows, []);
  assert.strictEqual(calls, 0, 'nothing to group by day, so no call is spent');
});
