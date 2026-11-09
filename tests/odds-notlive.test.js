const test = require('node:test');
const assert = require('node:assert');
const O = require('../shared/odds');

const rows = (seen) => ['1', 'X', '2'].map((s) => ({ bookmaker_ref: 'af:b11', market: '1x2', selection: s, value: 2, prev: 2, seen_at: seen }));
const bk = [{ id: 1, name: '1xBet', provider_ref: 'af:b11' }];

test('odds not live: only flagged once a match is in play and no live pull confirmed them recently', () => {
  const now = 10000;
  const p = (seen) => O.primary(rows(seen), bk, 'football');
  assert.strictEqual(O.liveAge({ status: 'scheduled' }, p(0), now), null, 'before kick-off nothing is flagged');
  assert.strictEqual(O.liveAge({ status: 'finished' }, p(0), now), null);
  assert.strictEqual(O.liveAge({ status: 'live' }, p(0), now), 99999, 'live match, never confirmed live');
  assert.ok(O.liveAge({ status: 'live' }, p(now - 30), now) <= O.STALE_SEC, 'recently confirmed = live');
  assert.ok(O.liveAge({ status: 'halftime' }, p(now - 900), now) > O.STALE_SEC, 'confirmed long ago = not live');
  const demo = O.primary(rows(undefined).map((r) => { delete r.seen_at; return r; }), bk, 'football');
  assert.strictEqual(O.liveAge({ status: 'live' }, demo, now), null, 'demo data that does not track it is never flagged');
});

const os = require('os');
const path = require('path');
const { start } = require('../server/index');
test('pages: live match rows carry the pre-match label, scheduled rows with no odds say "Odds soon"', async () => {
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: path.join(os.tmpdir(), 'lsn-nl-' + process.pid + '-' + Date.now() + '.db'), SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  try {
    const t = Math.floor(Date.now() / 1000);
    const live = S.db.get("SELECT id FROM matches WHERE status='live' LIMIT 1");
    const sch = S.db.get("SELECT id FROM matches WHERE status='scheduled' LIMIT 1");
    assert.ok(live && sch, 'demo data has live and scheduled matches');
    S.db.run('DELETE FROM odds_current WHERE match_id=?', sch.id);
    const html = await (await fetch('http://127.0.0.1:' + S.port + '/?cc=GH')).text();
    const row = (id) => (html.match(new RegExp('<div class="mrow[^>]*id="m' + id + '".*?(?=<div class="mrow|$)', 's')) || [''])[0];
    const rl = row(live.id), rs = row(sch.id);
    assert.ok(/class="mr-odds stale"/.test(rl) && rl.includes('class="otag"'), 'live row without live confirmation shows Pre-match: ' + rl.slice(0, 300));
    assert.ok(rs.includes('Odds soon'), 'scheduled row without odds says Odds soon');
    S.db.run('UPDATE odds_current SET seen_at=? WHERE match_id=?', t, live.id);
    const html2 = await (await fetch('http://127.0.0.1:' + S.port + '/?cc=GH')).text();
    const rl2 = (html2.match(new RegExp('<div class="mrow[^>]*id="m' + live.id + '".*?(?=<div class="mrow|$)', 's')) || [''])[0];
    assert.ok(!/class="mr-odds stale"/.test(rl2), 'confirmed live odds are not flagged');
  } finally { await S.close(); }
});
