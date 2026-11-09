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
  const want = ['AU', 'CW', 'FR', 'NL', 'ES', 'US', 'GB', 'AW', 'BQ', 'AL', 'AM', 'CL', 'CO', 'HR', 'CY', 'CZ', 'EE', 'GI', 'GR', 'IT', 'LV', 'LT', 'MT', 'MD', 'MK', 'PL', 'RO', 'UY'];
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
