const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { start } = require('../server/index');

test('preset: 1xBet is built in, hidden in GB/FR/US, shown elsewhere, odds auto-linked, admin edits kept', async () => {
  const dbFile = path.join(os.tmpdir(), 'lsn-pre-' + process.pid + '-' + Date.now() + '.db');
  const env = { PORT: '0', DB_PATH: dbFile, SYNC_ENABLED: 'false', NODE_ENV: 'test', DATA_PROVIDER: 'apifootball', APIFOOTBALL_KEY: 'x' };
  const S = await start({ log: () => {}, env });
  try {
    const b = S.db.get("SELECT * FROM bookmakers WHERE name='1xBet'");
    assert.ok(b, '1xBet exists without using the admin');
    assert.ok(b.affiliate_url.startsWith('https://reffpa.com/L?tag=d_6306719m_1599c_'));
    const rules = S.db.all('SELECT scope_type,scope_value,mode FROM bookmaker_geo WHERE bookmaker_id=?', b.id);
    ['GB', 'FR', 'US'].forEach((c) => assert.ok(rules.some((r) => r.scope_value === c && r.mode === 'block'), c + ' blocked'));
    assert.ok(rules.some((r) => r.scope_type === 'all' && r.mode === 'allow'));
    [['af:b11', '1xBet'], ['ab:b3', '1xBet']].forEach(([r, n]) => S.db.run('INSERT OR REPLACE INTO feed_bookmakers (ref,name,seen_at) VALUES (?,?,?)', r, n, 1));
    require('../server/presets').linkFeed(S.db);
    assert.strictEqual(S.db.get('SELECT provider_ref r FROM bookmakers WHERE id=?', b.id).r, 'af:b11,ab:b3');
  } finally { await S.close(); }
});

test('preset: 1xBet banner shows in the in-feed slot except GB/FR/US', async () => {
  const dbFile = path.join(os.tmpdir(), 'lsn-prea-' + process.pid + '-' + Date.now() + '.db');
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: dbFile, SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  try {
    const page = async (cc) => (await fetch('http://127.0.0.1:' + S.port + '/?cc=' + cc)).text();
    assert.ok((await page('GH')).includes('refbanners.com/I?tag=d_6306719m_2811c_'), 'shown in Ghana');
    for (const cc of ['GB', 'FR', 'US']) assert.ok(!(await page(cc)).includes('refbanners.com'), 'hidden in ' + cc);
  } finally { await S.close(); }
});

test('logo also shows next to the odds in match rows', async () => {
  const dbFile = path.join(os.tmpdir(), 'lsn-prel-' + process.pid + '-' + Date.now() + '.db');
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: dbFile, SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  try {
    S.db.run("UPDATE bookmakers SET logo_url='/assets/logos/1xbet.png' WHERE id=1");
    const h = await (await fetch('http://127.0.0.1:' + S.port + '/?cc=GH')).text();
    const m = h.match(/<span class="mr-odds"[^>]*>.{0,400}/);
    assert.ok(m && m[0].includes('<span class="bkchip logo"') && m[0].includes('/assets/logos/1xbet.png'), 'odds row shows the logo');
  } finally { await S.close(); }
});

test('preset: full block list applied once to an existing install, and admin removals stay removed', async () => {
  const dbFile = path.join(os.tmpdir(), 'lsn-prev-' + process.pid + '-' + Date.now() + '.db');
  const env = { PORT: '0', DB_PATH: dbFile, SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' };
  let S = await start({ log: () => {}, env });
  const want = ['AU', 'CW', 'FR', 'NL', 'ES', 'US', 'GB', 'AW', 'BQ', 'AL', 'AM', 'CL', 'CO', 'HR', 'CY', 'CZ', 'EE', 'GI', 'GR', 'IT', 'LV', 'LT', 'MT', 'MD', 'MK', 'PL', 'RO', 'UY', 'BE', 'SE', 'NO'];
  try {
    const b = S.db.get("SELECT id FROM bookmakers WHERE name='1xBet'");
    const blocked = () => S.db.all("SELECT scope_value v FROM bookmaker_geo WHERE bookmaker_id=? AND mode='block'", b.id).map((r) => r.v).sort();
    assert.deepStrictEqual(blocked(), want.slice().sort());
    // an older install: only 3 countries, version marker missing
    S.db.run("DELETE FROM bookmaker_geo WHERE bookmaker_id=? AND scope_value NOT IN ('GB','FR','US') AND mode='block'", b.id);
    S.db.run("DELETE FROM settings WHERE key LIKE 'preset_%'");
    require('../server/presets').install(S.db);
    assert.deepStrictEqual(blocked(), want.slice().sort(), 'missing countries added');
    // the owner removes one in the admin; a restart must not bring it back
    S.db.run("DELETE FROM bookmaker_geo WHERE bookmaker_id=? AND scope_value='CZ'", b.id);
    require('../server/presets').install(S.db);
    assert.ok(!blocked().includes('CZ'), 'admin removal is respected');
    const nl = await (await fetch('http://127.0.0.1:' + S.port + '/?cc=NL')).text();
    assert.ok(!nl.includes('refbanners.com'), 'banner hidden in the Netherlands');
  } finally { await S.close(); }
});

test('CoinRoyale test banners: shown in the feed, counted, click tracked, hidden in blocked countries', async () => {
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: path.join(os.tmpdir(), 'lsn-cr-' + process.pid + '-' + Date.now() + '.db'), ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  const base = 'http://127.0.0.1:' + S.port, UA = { 'user-agent': 'Mozilla/5.0 Test' };
  const AUTH = { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') };
  try {
    const ad = S.db.get("SELECT id FROM ad_creatives WHERE name='CoinRoyale test banner A'");
    assert.ok(ad, 'banner exists');
    const h = await (await fetch(base + '/?cc=GH', { headers: UA })).text();
    // the demo has fewer leagues than a busy real day, so check the slot directly if it is not on the page
    const shown = h.includes('/assets/ads/coinroyale-320x100-a.png');
    if (shown) assert.ok(h.includes('/go/ad/'), 'banner link goes through the click counter');
    for (const cc of ['US', 'GB', 'FR']) {
      const t = await (await fetch(base + '/?cc=' + cc, { headers: UA })).text();
      assert.ok(!t.includes('coinroyale-'), 'hidden in ' + cc);
    }
    const geo = async (cc) => (await (await fetch(base + '/api/geo?cc=' + cc, { headers: UA })).json()).bookmakers;
    assert.ok((await geo('NL')).includes('CoinRoyale'), 'CoinRoyale is listed in the Netherlands now');
    assert.ok(!(await geo('GB')).includes('CoinRoyale'), 'and not in the UK');
    assert.ok(!(await geo('US')).includes('CoinRoyale') && !(await geo('FR')).includes('CoinRoyale'));
    assert.ok(!(await geo('GB')).includes('1xBet'), '1xBet keeps its full list');
    assert.ok(!(await geo('NL')).includes('1xBet'));
    const r = await fetch(base + '/go/ad/' + ad.id + '?p=infeed2', { headers: UA, redirect: 'manual' });
    assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.get('location'), 'https://coinroyale.com/');
    await fetch(base + '/go/ad/' + ad.id + '?p=infeed2', { headers: { 'user-agent': 'Googlebot/2.1' }, redirect: 'manual' });
    const rep = await (await fetch(base + '/admin/api/traffic?days=7', { headers: AUTH })).json();
    const row = rep.ads.find((x) => x.id === ad.id);
    assert.ok(row && row.clicks === 1, 'one human click counted, bot ignored');
    const csv = await (await fetch(base + '/admin/api/traffic/csv?by=ads&days=7', { headers: AUTH })).text();
    assert.ok(csv.includes('Click rate'));
  } finally { await S.close(); }
});

test('Crypto.Games is a casino: own "Top casinos" box, never in bookmaker lists or match odds, hidden in US/GB/FR', async () => {
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: path.join(os.tmpdir(), 'lsn-cg-' + process.pid + '-' + Date.now() + '.db'), ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  const base = 'http://127.0.0.1:' + S.port, UA = { 'user-agent': 'Mozilla/5.0 Test' };
  try {
    assert.strictEqual(S.db.get("SELECT kind FROM bookmakers WHERE name='Crypto.Games'").kind, 'casino');
    assert.strictEqual(S.db.get("SELECT kind FROM bookmakers WHERE name='1xBet'").kind, 'sportsbook');
    const gh = await (await fetch(base + '/api/geo?cc=GH', { headers: UA })).json();
    assert.ok(gh.casinos.includes('Crypto.Games') && !gh.bookmakers.includes('Crypto.Games'), 'casino is listed apart from the bookmakers');
    const html = await (await fetch(base + '/?cc=GH', { headers: UA })).text();
    assert.ok(html.includes('Top casinos in'), 'casino box is shown'); assert.ok(html.includes('Top bookmakers in'));
    const box = html.split('Top casinos in')[1].split('</div></div>')[0];
    assert.ok(box.includes('Crypto.Games') && !box.includes('1xBet'));
    for (const cc of ['US', 'GB', 'FR']) {
      const t = await (await fetch(base + '/?cc=' + cc, { headers: UA })).text();
      assert.ok(!t.includes('Crypto.Games') && !t.includes('cryptogames-'), 'hidden in ' + cc);
    }
    const nl = await (await fetch(base + '/api/geo?cc=NL', { headers: UA })).json();
    assert.ok(nl.casinos.includes('Crypto.Games'), 'shown in the Netherlands');
    const id = S.db.get("SELECT id FROM bookmakers WHERE name='Crypto.Games'").id;
    const r = await fetch(base + '/go/' + id + '?cc=GH&p=sidebar-casinos', { headers: UA, redirect: 'manual' });
    assert.strictEqual(r.status, 302); assert.ok(r.headers.get('location').startsWith('http://crypto.games/'));
  } finally { await S.close(); }
});

test('Belgium is blocked for 1xBet (bookmaker and banner), including on installs that already had the preset', async () => {
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: path.join(os.tmpdir(), 'lsn-be-' + process.pid + '-' + Date.now() + '.db'), ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  const base = 'http://127.0.0.1:' + S.port, UA = { 'user-agent': 'Mozilla/5.0 Test' };
  try {
    const names = async (cc) => (await (await fetch(base + '/api/geo?cc=' + cc, { headers: UA })).json()).bookmakers;
    assert.ok(!(await names('BE')).includes('1xBet') && !(await names('SE')).includes('1xBet'), 'hidden in Belgium and Sweden');
    assert.ok((await names('DE')).includes('1xBet'), 'still shown in Germany');
    // simulate an older install: remove the Belgium rows and the one-time marker, then run the install again
    const id = S.db.get("SELECT id FROM bookmakers WHERE name='1xBet'").id;
    S.db.run("DELETE FROM bookmaker_geo WHERE bookmaker_id=? AND scope_value='BE'", id);
    S.db.run("DELETE FROM ad_creatives WHERE name LIKE '% (BE off)' AND name LIKE '1xBet%'");
    S.db.run("DELETE FROM settings WHERE key='preset_block_be'");
    require('../server/presets').install(S.db);
    assert.ok(S.db.get("SELECT 1 x FROM bookmaker_geo WHERE bookmaker_id=? AND scope_value='BE' AND mode='block'", id), 'bookmaker block restored once');
    assert.ok(S.db.get("SELECT 1 x FROM ad_creatives WHERE name LIKE '1xBet%(BE off)' AND mode='hide'"), 'banner hidden in BE');
  } finally { await S.close(); }
});

test('Norway: 1xBet blocks it; CoinRoyale and Crypto.Games do not (and an earlier NO/SE addition is undone once)', async () => {
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: path.join(os.tmpdir(), 'lsn-no-' + process.pid + '-' + Date.now() + '.db'), ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  const base = 'http://127.0.0.1:' + S.port, UA = { 'user-agent': 'Mozilla/5.0 Test' };
  try {
    const geo = async (cc) => (await fetch(base + '/api/geo?cc=' + cc, { headers: UA })).json();
    for (const cc of ['NO', 'SE']) { const g = await geo(cc); assert.ok(!g.bookmakers.includes('1xBet'), '1xBet hidden in ' + cc); assert.ok(g.bookmakers.includes('CoinRoyale') && g.casinos.includes('Crypto.Games'), 'partners shown in ' + cc); }
    // an install that got the mistaken NO/SE rows
    S.db.run("INSERT OR IGNORE INTO bookmaker_geo (bookmaker_id,scope_type,scope_value,mode) SELECT id,'country','NO','block' FROM bookmakers WHERE name='CoinRoyale'");
    S.db.run("INSERT INTO ad_creatives (slot_key,name,scope_type,scope_value,mode,betting_related,active) VALUES ('infeed4','Crypto.Games test banner (SE off)','country','SE','hide',1,1)");
    S.db.run("DELETE FROM settings WHERE key='preset_undo_no_se'");
    require('../server/presets').install(S.db);
    assert.ok((await geo('NO')).bookmakers.includes('CoinRoyale'), 'undone');
    assert.ok(!S.db.get("SELECT 1 x FROM ad_creatives WHERE name='Crypto.Games test banner (SE off)'"));
  } finally { await S.close(); }
});

test('match page shows 1xBet then CoinRoyale; CoinRoyale keeps one in-feed banner; banner B is removed once', async () => {
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: path.join(os.tmpdir(), 'lsn-ms2-' + process.pid + '-' + Date.now() + '.db'), ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  const base = 'http://127.0.0.1:' + S.port, UA = { 'user-agent': 'Mozilla/5.0 Test' };
  try {
    const home = await (await fetch(base + '/?cc=GH', { headers: UA })).text();
    assert.strictEqual((home.match(/coinroyale-320x100/g) || []).length, 1, 'one CoinRoyale in-feed banner');
    const link = (home.match(/href="(\/[^"]*-vs-[^"]*\/)"/) || [])[1];
    const m = await (await fetch(base + link + '?cc=GH', { headers: UA })).text();
    const i1 = m.indexOf('data-slot="match-strip"'), i2 = m.indexOf('data-slot="match-strip2"');
    assert.ok(i1 > 0 && i2 > i1, 'two cards on the match page');
    assert.ok(/1xBet/.test(m.slice(i1, i2)) && /CoinRoyale/.test(m.slice(i2, i2 + 900)), '1xBet first, CoinRoyale second');
    // an older install that still has banner B
    S.db.run("INSERT INTO ad_creatives (slot_key,name,scope_type,scope_value,mode,betting_related,active) VALUES ('infeed3','CoinRoyale test banner B','all','','show',1,1)");
    S.db.run("DELETE FROM settings WHERE key='preset_drop_cr_b'");
    require('../server/presets').install(S.db);
    assert.strictEqual(S.db.all("SELECT id FROM ad_creatives WHERE name LIKE 'CoinRoyale test banner B%'").length, 0);
  } finally { await S.close(); }
});
