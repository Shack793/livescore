const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { start } = require('../server/index');

let S, base, dbFile;
const AUTH = 'Basic ' + Buffer.from('admin:pw123').toString('base64');
async function get(p, opts) { const r = await fetch(base + p, Object.assign({ redirect: 'manual' }, opts)); return { status: r.status, headers: r.headers, text: await r.text() }; }

test.before(async () => {
  dbFile = path.join(os.tmpdir(), 'lsn-test-' + process.pid + '-' + Date.now() + '.db');
  S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: dbFile, ADMIN_PASS: 'pw123', SYNC_ENABLED: 'false', NODE_ENV: 'test', DATA_PROVIDER: 'mock', ALLOW_CC_QUERY: 'true' } });
  base = 'http://127.0.0.1:' + S.port;
});
test.after(async () => { await S.close(); ['', '-wal', '-shm'].forEach((x) => { try { fs.unlinkSync(dbFile + x); } catch (e) { /* ignore */ } }); });

test('home page renders with scores', async () => {
  const r = await get('/');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /LiveScoreNow/);
  assert.match(r.text, /class="mrow/);
  assert.match(r.headers.get('content-type'), /text\/html/);
});

test('GEO: different countries see different bookmakers', async () => {
  const names = async (cc) => (await (await fetch(base + '/api/geo?cc=' + cc)).json());
  const gh = await names('GH'), gb = await names('GB'), de = await names('DE'), us = await names('US');
  assert.ok(gh.bookmakers.includes('BetWave') && !gb.bookmakers.includes('BetWave'));
  assert.ok(gb.bookmakers.includes('GoalBet') && !gb.bookmakers.includes('PariLine'), 'PariLine is blocked in GB');
  assert.ok(de.bookmakers.includes('PariLine'));
  assert.deepStrictEqual(us.bookmakers, []);
  assert.strictEqual(us.betting, false);
});

test('GEO: page HTML differs by country and never leaks affiliate URLs', async () => {
  const gh = await get('/?cc=GH'), gb = await get('/?cc=GB'), us = await get('/?cc=US');
  assert.match(gh.text, /BetWave/); assert.doesNotMatch(gb.text, /BetWave/);
  assert.doesNotMatch(us.text, /\/go\//, 'no betting links at all where betting is switched off');
  assert.doesNotMatch(us.text, /class="odd/);
  for (const t of [gh.text, gb.text]) { assert.doesNotMatch(t, /example\.com\/(betwave|stakeking|goalbet)/); assert.match(t, /\/go\/\d+/); }
});

test('GEO: cookie chosen in the country picker is honoured and sets region', async () => {
  const sr = await get('/set-region?cc=NG&next=/football/', {});
  assert.strictEqual(sr.status, 302);
  const ck = sr.headers.get('set-cookie');
  assert.match(ck, /lsn_cc=NG/);
  const r = await get('/', { headers: { cookie: 'lsn_cc=NG' } });
  assert.match(r.text, /Top bookmakers in Nigeria/);
});

test('set-region rejects open redirects', async () => {
  for (const n of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
    const r = await get('/set-region?cc=GH&next=' + encodeURIComponent(n));
    assert.strictEqual(r.headers.get('location'), '/', n);
  }
});

test('/go redirects to the per-country affiliate URL and logs the click', async () => {
  const before = S.db.get('SELECT COUNT(*) n FROM clicks').n;
  const r = await get('/go/1?cc=GH&p=list&m=5', { headers: { 'user-agent': 'Mozilla/5.0 Test' } });
  assert.strictEqual(r.status, 302);
  const loc = r.headers.get('location');
  assert.match(loc, /^https:\/\/example\.com\/betwave\?aff=YOUR_ID&sub=lsn-list-5&c=GH$/);
  assert.strictEqual(S.db.get('SELECT COUNT(*) n FROM clicks').n, before + 1);
  const row = S.db.get('SELECT * FROM clicks ORDER BY id DESC LIMIT 1');
  assert.strictEqual(row.country, 'GH'); assert.strictEqual(row.match_id, 5); assert.strictEqual(row.placement, 'list');
});

test('/go refuses bookmakers that are not available in the visitor country', async () => {
  const us = await get('/go/1?cc=US'); assert.strictEqual(us.headers.get('location'), '/');
  const gb = await get('/go/4?cc=GB'); assert.strictEqual(gb.headers.get('location'), '/', 'PariLine is blocked in GB');
  const za = await get('/go/1?cc=ZA'); assert.strictEqual(za.headers.get('location'), '/', 'BetWave blocked in ZA (country beats region)');
  const bot = await get('/go/1?cc=GH', { headers: { 'user-agent': 'Googlebot/2.1' } });
  assert.strictEqual(bot.status, 302);
  assert.strictEqual(S.db.get("SELECT COUNT(*) n FROM clicks WHERE country='ZA' OR country='US'").n, 0);
});

test('country-specific override: BetWave in Ghana uses the GH offer text', async () => {
  const gh = await get('/?cc=GH'); assert.match(gh.text, /GHS 500 welcome bonus \+ free spins/);
  const ng = await get('/?cc=NG'); assert.doesNotMatch(ng.text, /free spins/);
});

test('match page, redirect to canonical slug, 404s', async () => {
  const m = S.db.get("SELECT id FROM matches WHERE status='finished' LIMIT 1");
  const home = await get('/');
  const link = home.text.match(/href="(\/match\/[^"]+\/\d+\/)"/)[1];
  const r = await get(link + '?cc=GH'); assert.strictEqual(r.status, 200); assert.match(r.text, /id="mh"/);
  const id = link.match(/\/(\d+)\/$/)[1];
  const bad = await get('/match/wrong-slug/' + id + '/'); assert.strictEqual(bad.status, 301); assert.ok(bad.headers.get('location').endsWith(link));
  assert.strictEqual((await get('/match/x-vs-y/99999999/')).status, 404);
  assert.strictEqual((await get('/nope/nope/')).status, 404);
  assert.strictEqual((await get('/football/england/not-a-league/')).status, 404);
  assert.ok(m);
});

test('league, country, team, search, static and favorites pages', async () => {
  for (const p of ['/football/england/premier-league/', '/football/england/premier-league/results/', '/football/england/premier-league/fixtures/', '/football/england/', '/basketball/', '/search/?q=arsenal', '/about/', '/terms/', '/responsible-gambling/', '/favorites/']) {
    const r = await get(p); assert.strictEqual(r.status, 200, p);
  }
  const t = S.db.get("SELECT id,slug FROM teams WHERE name='Arsenal'");
  const r = await get('/team/' + t.slug + '/' + t.id + '/'); assert.strictEqual(r.status, 200);
  assert.strictEqual((await get('/team/' + t.slug + '/' + t.id + '/squad/')).status, 200);
  const f = await get('/frag/favorites/?teams=' + t.id); assert.strictEqual(f.status, 200); assert.match(f.text, /Arsenal/);
});

test('search output is HTML-escaped (XSS)', async () => {
  const r = await get('/search/?q=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.doesNotMatch(r.text, /<script>alert\(1\)<\/script>/);
  assert.match(r.text, /&lt;script&gt;/);
});

test('sitemap, robots, healthz, static assets and path traversal', async () => {
  assert.match((await get('/sitemap.xml')).text, /<urlset[\s\S]+premier-league/);
  assert.match((await get('/robots.txt')).text, /Disallow: \/go\//);
  assert.strictEqual(JSON.parse((await get('/healthz')).text).ok, true);
  assert.strictEqual((await get('/assets/style.css')).status, 200);
  assert.strictEqual((await get('/assets/..%2f..%2fserver%2fconfig.js')).status, 404);
  assert.strictEqual((await get('/assets/%2e%2e/server/config.js')).status, 404);
});

test('ADMIN: needs auth, CSRF header, and rule changes take effect immediately', async () => {
  assert.strictEqual((await get('/admin/api/bookmakers')).status, 401);
  assert.strictEqual((await get('/admin/api/bookmakers', { headers: { authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') } })).status, 401);
  const list = JSON.parse((await get('/admin/api/bookmakers', { headers: { authorization: AUTH } })).text);
  assert.strictEqual(list.length, 5);
  const bw = list.find((b) => b.name === 'BetWave');
  // POST without the custom header is refused
  const noHdr = await get('/admin/api/bookmakers/' + bw.id, { method: 'PUT', headers: { authorization: AUTH, 'content-type': 'application/json' }, body: JSON.stringify(bw) });
  assert.strictEqual(noHdr.status, 403);
  // hide BetWave in Ghana
  const rules = bw.rules.filter((r) => !(r.scope_type === 'country' && r.scope_value === 'GH')).concat([{ scope_type: 'country', scope_value: 'GH', mode: 'block' }]);
  const put = await get('/admin/api/bookmakers/' + bw.id, { method: 'PUT', headers: { authorization: AUTH, 'x-lsn-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({}, bw, { rules })) });
  assert.strictEqual(put.status, 200, put.text);
  const gh = await (await fetch(base + '/api/geo?cc=GH')).json();
  assert.ok(!gh.bookmakers.includes('BetWave'));
  const ng = await (await fetch(base + '/api/geo?cc=NG')).json();
  assert.ok(ng.bookmakers.includes('BetWave'));
  // validation
  const bad = await get('/admin/api/bookmakers/' + bw.id, { method: 'PUT', headers: { authorization: AUTH, 'x-lsn-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({}, bw, { affiliate_url: 'javascript:alert(1)' })) });
  assert.strictEqual(bad.status, 400);
  const badRule = await get('/admin/api/bookmakers/' + bw.id, { method: 'PUT', headers: { authorization: AUTH, 'x-lsn-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({}, bw, { rules: [{ scope_type: 'country', scope_value: 'XX', mode: 'allow' }] })) });
  assert.strictEqual(badRule.status, 400);
  const res = JSON.parse((await get('/admin/api/resolve?cc=NG', { headers: { authorization: AUTH } })).text);
  assert.ok(res.bookmakers.length >= 3);
  assert.strictEqual((await get('/admin/', { headers: { authorization: AUTH } })).status, 200);
  assert.strictEqual((await get('/admin/')).status, 401);
});

test('ADMIN: ad slot with betting_related is hidden where betting is off; custom ad code is emitted in a template', async () => {
  const put = (k, b) => get('/admin/api/ad-slots/' + k, { method: 'PUT', headers: { authorization: AUTH, 'x-lsn-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const r = await put('leaderboard', { label: 'Top', placement: 'header', width: 728, height: 90, ad_code: '<div id="my-ad">AD123</div>', betting_related: 1, active: 1, sort_order: 1 });
  assert.strictEqual(r.status, 200);
  const gh = await get('/?cc=GH'); assert.match(gh.text, /<template class="ad-code"><div id="my-ad">AD123<\/div><\/template>/);
  const us = await get('/?cc=US'); assert.doesNotMatch(us.text, /AD123/);
  await put('leaderboard', { label: 'Top', placement: 'header', width: 728, height: 90, ad_code: '<div>X</div>', betting_related: 0, countries_exclude: 'GH', active: 1, sort_order: 1 });
  assert.doesNotMatch((await get('/?cc=GH')).text, /<div>X<\/div>/);
  assert.match((await get('/?cc=NG')).text, /<div>X<\/div>/);
  const consent = await get('/?cc=DE'); assert.match(consent.text, /id="consent"/); assert.match(consent.text, /data-consent="1"/);
  assert.doesNotMatch((await get('/?cc=GH')).text, /id="consent"/);
});

test('SSE stream connects and says hello', async () => {
  const open = () => new Promise((resolve, reject) => {
    const req = http.get(base + '/api/stream?cc=GH', (res) => { let buf = ''; res.on('data', (d) => { buf += d; if (buf.includes('event: hello')) resolve({ res, req, buf }); }); });
    req.on('error', reject);
  });
  const a = await open();
  assert.match(a.res.headers['content-type'], /text\/event-stream/);
  assert.match(a.buf, /event: hello/);
  assert.strictEqual(S.hub.size(), 1);
  a.req.destroy();
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(S.hub.size(), 0);
});

test('hub pushes per-country odds: GH client never receives PariLine data', async () => {
  const got = { GH: '', GB: '' };
  const conns = await Promise.all(['GH', 'GB'].map((cc) => new Promise((resolve) => {
    const req = http.get(base + '/api/stream?cc=' + cc, (res) => { res.on('data', (d) => { got[cc] += d; }); setTimeout(resolve, 150, req); });
  })));
  const live = S.db.all("SELECT id FROM matches WHERE sport='football' AND kickoff > strftime('%s','now') LIMIT 3").map((r) => r.id);
  S.db.run("UPDATE odds_current SET value = value + 0.5, prev = value WHERE match_id IN (" + live.join(',') + ")");
  S.hub.setFlushMs(20); S.hub.oddsChanged(live);
  await new Promise((r) => setTimeout(r, 500));
  conns.forEach((c) => c.destroy());
  assert.match(got.GH, /event: o/); assert.match(got.GB, /event: o/);
  const parse = (t) => t.split('\n\n').filter((b) => b.includes('event: o')).map((b) => JSON.parse(b.split('data: ')[1])).flat();
  const bkNames = (t) => new Set(parse(t).map((i) => i.bn).filter(Boolean));
  assert.ok(!bkNames(got.GH).has('PariLine') && !bkNames(got.GB).has('PariLine'), 'PariLine is never first for GH; blocked in GB');
  const gb = bkNames(got.GB); gb.forEach((n) => assert.ok(['GoalBet', 'StakeKing'].includes(n), 'GB got ' + n));
});

test('SSE per-IP connection cap returns 429', async () => {
  const reqs = [];
  const open = () => new Promise((resolve, reject) => { const req = http.get(base + '/api/stream', (res) => { reqs.push(req); res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  const codes = [];
  for (let i = 0; i < S.cfg.sseMaxPerIp + 2; i++) codes.push(await open());
  reqs.forEach((r) => r.destroy());
  assert.strictEqual(codes.filter((c) => c === 200).length, S.cfg.sseMaxPerIp);
  assert.strictEqual(codes.filter((c) => c === 429).length, 2);
});

test('icons, manifest, service worker and /api/teams (used to move "My teams" between devices)', async () => {
  for (const f of ['favicon.ico', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'og-image.png', 'mark.svg', 'logo.svg']) assert.strictEqual((await get('/assets/' + f)).status, 200, f);
  const mf = JSON.parse((await get('/manifest.webmanifest')).text);
  assert.ok(mf.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  const sw = await get('/sw.js'); assert.strictEqual(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/);
  const t = S.db.all('SELECT id,name FROM teams LIMIT 3');
  const r = JSON.parse((await get('/api/teams?ids=' + t.map((x) => x.id).join(',') + ',abc,-1')).text);
  assert.deepStrictEqual(r.map((x) => x.name).sort(), t.map((x) => x.name).sort());
  assert.match((await get('/')).text, /rel="apple-touch-icon"/);
});
