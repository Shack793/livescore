const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { start } = require('../server/index');

test('analytics: counts visits per country/day/week/month, ignores bots, stores no IPs, CSV + auth', async () => {
  const dbFile = path.join(os.tmpdir(), 'lsn-an-' + process.pid + '-' + Date.now() + '.db');
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: dbFile, ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  const base = 'http://127.0.0.1:' + S.port;
  const AUTH = { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') };
  const UA = (n) => ({ 'user-agent': 'Mozilla/5.0 Test' + n, referer: n === 1 ? 'https://www.google.com/search?q=x' : '' });
  try {
    await fetch(base + '/?cc=GH', { headers: UA(1) });
    await fetch(base + '/?cc=GH', { headers: UA(1) });           // same visitor, 2nd view
    await fetch(base + '/basketball/?cc=GH', { headers: UA(2) });  // another visitor
    await fetch(base + '/?cc=NG', { headers: UA(3) });
    await fetch(base + '/?cc=GH', { headers: { 'user-agent': 'Googlebot/2.1' } }); // bot: ignored
    const rep = await (await fetch(base + '/admin/api/traffic?days=7', { headers: AUTH })).json();
    assert.strictEqual(rep.totals.views, 4);
    assert.strictEqual(rep.totals.visitors, 3);
    assert.strictEqual(rep.byDay.length, 1);
    assert.strictEqual(rep.byWeek.length, 1);
    assert.strictEqual(rep.byMonth.length, 1);
    const gh = rep.byCountry.find((x) => x.code === 'GH');
    assert.strictEqual(gh.views, 3); assert.strictEqual(gh.visitors, 2); assert.strictEqual(gh.country, 'Ghana');
    assert.ok(rep.referrers.some((x) => x.host === 'google.com'));
    assert.ok(rep.pages.some((x) => x.page === '/basketball/'));
    // no raw IP anywhere in the analytics tables
    const dump = JSON.stringify(['traffic_daily', 'visitors_seen', 'pages_daily', 'refs_daily'].map((t) => S.db.all('SELECT * FROM ' + t)));
    assert.ok(!/127\.0\.0\.1|::1/.test(dump), 'no IP stored');
    const sum = await (await fetch(base + '/admin/api/traffic/summary', { headers: AUTH })).json();
    assert.strictEqual(sum.today.visitors, 3);
    const csv = await (await fetch(base + '/admin/api/traffic/csv?by=country&days=7', { headers: AUTH })).text();
    assert.ok(csv.includes('Ghana,GH,3,2,0'));
    assert.strictEqual((await fetch(base + '/admin/api/traffic?days=7')).status, 401);
  } finally { await S.close(); ['', '-wal', '-shm'].forEach((x) => { try { fs.unlinkSync(dbFile + x); } catch (e) { /* ignore */ } }); }
});

test('admin sign out: /admin/logout makes the browser forget the password', async () => {
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: path.join(os.tmpdir(), 'lsn-lo-' + process.pid + '-' + Date.now() + '.db'), ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test' } });
  const base = 'http://127.0.0.1:' + S.port;
  try {
    const withAuth = await fetch(base + '/admin/logout', { headers: { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') } });
    assert.strictEqual(withAuth.status, 401);
    assert.ok(withAuth.headers.get('www-authenticate'));
    assert.ok((await withAuth.text()).includes('signed out'));
    const without = await fetch(base + '/admin/logout');
    assert.strictEqual(without.status, 200);
    assert.ok((await (await fetch(base + '/admin/', { headers: { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') } })).text()).includes('Sign out'), 'button is in the admin header');
  } finally { await S.close(); }
});
