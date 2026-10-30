const test = require('node:test');
const assert = require('node:assert');
const dbmod = require('../server/db');
const seed = require('../server/seed');
const config = require('../server/config');
const providers = require('../server/providers');
const syncMod = require('../server/services/sync');
const storeMod = require('../server/store-sqlite');
const bk = require('../shared/bookmakers');
const odds = require('../shared/odds');

function setup(extra) {
  const db = dbmod.open(':memory:'); seed.run(db);
  const cfg = Object.assign(config.load('/nonexistent', { DATA_PROVIDER: 'mock' }), { syncEnabled: false }, extra || {});
  const provider = providers.create(cfg, () => {});
  const ev = { m: [], o: [], d: [] };
  const hub = { matchesChanged(ids, d) { (d ? ev.d : ev.m).push(...ids); }, oddsChanged(ids) { ev.o.push(...ids); } };
  const sync = syncMod.create({ db, provider, cfg, hub, log: () => {} });
  return { db, cfg, provider, sync, ev, store: storeMod.create(db) };
}

test('initial sync imports countries, leagues, teams, matches and odds automatically', async () => {
  const { db, sync } = setup();
  await sync.start();
  const n = (t) => db.get('SELECT COUNT(*) n FROM ' + t).n;
  assert.ok(n('countries') >= 20 && n('leagues') >= 20 && n('teams') >= 300 && n('matches') >= 500 && n('odds_current') > 1000);
  assert.ok(n('feed_bookmakers') === 5);
  assert.strictEqual(db.get("SELECT value FROM settings WHERE key='data_mode'").value, 'mock');
  // names for countries the feed only gave codes for are filled in
  assert.strictEqual(db.get("SELECT name FROM countries WHERE code='EG'").name, 'Egypt');
  // slugs unique per sport+country
  const dup = db.all('SELECT sport,country_id,slug,COUNT(*) c FROM leagues GROUP BY 1,2,3 HAVING c>1');
  assert.strictEqual(dup.length, 0);
});

test('running a job twice with identical provider output changes nothing (change detection)', async () => {
  const { sync, ev } = setup();
  await sync.start();
  ev.m.length = 0; ev.o.length = 0;
  await sync.fixtures();
  assert.strictEqual(ev.m.length, 0, 'no match changes on identical data');
});

test('score / status changes are detected and published; odds prev tracks the last value', async () => {
  const { db, sync, ev, provider } = setup();
  await sync.start();
  const m = db.get("SELECT id,ref,status,hs FROM matches WHERE status='scheduled' LIMIT 1");
  // fake a provider that now reports this match live with a score
  const real = provider.fixtures;
  provider.fixtures = async (o) => { const l = await real(o); return l.map((x) => (x.ref === m.ref ? Object.assign({}, x, { status: 'live', minute: 12, homeScore: 1, awayScore: 0 }) : x)); };
  ev.m.length = 0;
  await sync.fixtures();
  assert.deepStrictEqual(ev.m, [m.id]);
  const row = db.get('SELECT status,minute,hs,as_ FROM matches WHERE id=?', m.id);
  assert.deepStrictEqual({ ...row }, { status: 'live', minute: 12, hs: 1, as_: 0 });
  // odds: change a value, expect prev = old value and a publish
  const o = db.get('SELECT * FROM odds_current WHERE match_id IN (SELECT id FROM matches WHERE status=\'scheduled\') LIMIT 1');
  const realOdds = provider.odds;
  provider.odds = async (a) => (await realOdds(a)).map((r) => (r.matchRef && true ? r : r)).concat([]);
  db.run('UPDATE odds_current SET value=? WHERE match_id=? AND bookmaker_ref=? AND market=? AND selection=?', 1.5, o.match_id, o.bookmaker_ref, o.market, o.selection);
  ev.o.length = 0;
  await sync.odds(false);
  const after = db.get('SELECT value,prev FROM odds_current WHERE match_id=? AND bookmaker_ref=? AND market=? AND selection=?', o.match_id, o.bookmaker_ref, o.market, o.selection);
  assert.strictEqual(after.prev, 1.5);
  assert.notStrictEqual(after.value, 1.5);
  assert.ok(ev.o.includes(o.match_id));
});

test('details, standings and squads are fetched on demand and cached', async () => {
  const { db, sync, store, provider } = setup();
  await sync.start(); await sync.standings();
  const m = db.get("SELECT id FROM matches WHERE sport='football' AND status='finished' LIMIT 1");
  let calls = 0; const real = provider.matchDetail; provider.matchDetail = async (x) => { calls++; return real(x); };
  await sync.ensureDetail(m.id); await sync.ensureDetail(m.id);
  assert.strictEqual(calls, 1, 'second call served from cache');
  const d = store.detail(m.id);
  assert.ok(d.events.length > 0 && d.stats.length > 0 && d.lineups && d.h2h.length > 0);
  const lg = db.get("SELECT id FROM leagues WHERE type='league' AND sport='football' LIMIT 1");
  const st = store.standings(lg.id);
  assert.ok(st && st.groups[0].rows.length >= 10 && st.groups[0].rows.every((r) => r.teamId));
  const t = db.get('SELECT id FROM teams WHERE sport=\'football\' LIMIT 1');
  await sync.ensureSquad(t.id);
  assert.ok(store.squad(t.id).length > 10);
});

test('concurrent detail requests for one match are coalesced into a single provider call', async () => {
  const { db, sync, provider } = setup();
  await sync.start();
  const m = db.get("SELECT id FROM matches WHERE sport='football' AND status='finished' LIMIT 1");
  let calls = 0; const real = provider.matchDetail; provider.matchDetail = async (x) => { calls++; await new Promise((r) => setTimeout(r, 20)); return real(x); };
  await Promise.all([sync.ensureDetail(m.id), sync.ensureDetail(m.id), sync.ensureDetail(m.id)]);
  assert.strictEqual(calls, 1);
});

test('a failing provider call is recorded and does not crash the loop', async () => {
  const { sync, provider } = setup();
  await sync.start();
  provider.live = async () => { throw new Error('API down'); };
  const s = await sync.runJob('live');
  assert.match(s.lastError, /API down/);
  assert.ok(s.errors >= 1);
  const again = await sync.runJob('live');
  assert.match(again.lastError, /API down/);
});

test('one failing sport does not stop live updates for the other sports', async () => {
  const { sync, provider } = setup();
  await sync.start();
  const real = provider.live;
  provider.live = async ({ sport }) => {
    if (sport === 'football') throw new Error('football feed down');
    return real({ sport });
  };
  const s = await sync.runJob('live');
  assert.strictEqual(s.lastError, '');
  assert.strictEqual(s.errors, 0);
});

test('a future fixture left as live is reset to scheduled', async () => {
  const { db, sync, provider } = setup();
  await sync.start();
  provider.isMock = false;
  const m = db.get("SELECT id FROM matches WHERE status='scheduled' LIMIT 1");
  const now = Math.floor(Date.now() / 1000);
  db.run("UPDATE matches SET status='live', minute=12, hs=1, as_=0, kickoff=?, updated_at=? WHERE id=?", now + 86400 * 30, now, m.id);
  await sync.live();
  const row = db.get('SELECT status,minute,hs,as_ FROM matches WHERE id=?', m.id);
  assert.deepStrictEqual({ ...row }, { status: 'scheduled', minute: null, hs: null, as_: null });
});

test('feed bookmakers map to affiliate bookmakers by provider_ref; list odds follow region rules', async () => {
  const { db, sync, store } = setup();
  await sync.start();
  const m = db.get("SELECT id FROM matches WHERE sport='football' AND status='scheduled' AND id IN (SELECT match_id FROM odds_current WHERE market='1x2' GROUP BY match_id HAVING COUNT(DISTINCT bookmaker_ref)>=4) LIMIT 1");
  assert.ok(m, 'found a match with odds from many bookmakers');
  const rows = store.oddsRows([m.id]).get(m.id);
  const cfg = store.bookmakerConfig();
  const gh = bk.resolve(cfg, 'GH'), gb = bk.resolve(cfg, 'GB'), us = bk.resolve(cfg, 'US');
  const pGh = odds.primary(rows, gh.items, 'football'), pGb = odds.primary(rows, gb.items, 'football');
  assert.ok(pGh && gh.items.some((b) => b.id === pGh.bookmaker_id));
  assert.ok(pGb && ['GoalBet', 'StakeKing'].includes(pGb.bookmaker_name));
  assert.strictEqual(odds.primary(rows, us.items, 'football'), null);
  const cmp = odds.comparison(rows, gh.items);
  assert.ok(cmp.length >= 1 && cmp[0].lines.length >= 2);
});

test('cleanup removes old matches and their odds', async () => {
  const { db, sync } = setup();
  await sync.start();
  db.run('UPDATE matches SET kickoff = kickoff - 86400*30 WHERE id = (SELECT id FROM matches LIMIT 1)');
  const before = db.get('SELECT COUNT(*) n FROM matches').n;
  await sync.runJob('cleanup');
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM matches').n, before - 1);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM odds_current WHERE match_id NOT IN (SELECT id FROM matches)').n, 0);
});

test('sports without a configured feed are hidden from navigation', async () => {
  const { db, cfg } = setup();
  const fake = { name: 'apifootball', isMock: false, sports: ['football'], referenceData: async () => ({ countries: [], leagues: [], teams: [] }), feedBookmakers: async () => [], fixtures: async () => [], live: async () => [], odds: async () => [], standings: async () => [] };
  const s2 = syncMod.create({ db, provider: fake, cfg, hub: null, log: () => {} });
  await s2.start();
  assert.strictEqual(db.get("SELECT active FROM sports WHERE id='football'").active, 1);
  assert.strictEqual(db.get("SELECT active FROM sports WHERE id='tennis'").active, 0);
  assert.strictEqual(db.get("SELECT active FROM sports WHERE id='basketball'").active, 0);
});

test('switching from demo to a real provider purges simulated data and demo bookmakers (keeps custom ones)', async () => {
  const { db, sync, cfg } = setup();
  await sync.start();
  db.run("INSERT INTO bookmakers (name,short_code,affiliate_url,provider_ref) VALUES ('Mine','MN','https://my-partner.example/ref','af:bet365')");
  assert.ok(db.get('SELECT COUNT(*) n FROM matches').n > 0);
  const fake = { name: 'apifootball', isMock: false, sports: ['football'], referenceData: async () => ({ countries: [], leagues: [], teams: [] }), feedBookmakers: async () => [], fixtures: async () => [], live: async () => [], odds: async () => [], standings: async () => [] };
  const s2 = syncMod.create({ db, provider: fake, cfg, hub: null, log: () => {} });
  await s2.start();
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM matches').n, 0);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM teams').n, 0);
  assert.deepStrictEqual(db.all('SELECT name FROM bookmakers').map((r) => r.name), ['Mine']);
  assert.strictEqual(db.get("SELECT value FROM settings WHERE key='data_mode'").value, 'live');
});
