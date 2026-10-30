const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { start } = require('../server/index');

let S, base, dbFile;
const AUTH = 'Basic ' + Buffer.from('admin:pw').toString('base64');
const H = { authorization: AUTH, 'x-lsn-admin': '1', 'content-type': 'application/json' };
const page = async (cc) => (await fetch(base + '/?cc=' + cc)).text();
const put = (id, b) => fetch(base + '/admin/api/ad-creatives/' + id, { method: 'PUT', headers: H, body: JSON.stringify(b) });

test.before(async () => {
  dbFile = path.join(os.tmpdir(), 'lsn-ads-' + process.pid + '-' + Date.now() + '.db');
  S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: dbFile, ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test' } });
  base = 'http://127.0.0.1:' + S.port;
});
test.after(async () => { await S.close(); ['', '-wal', '-shm'].forEach((x) => { try { fs.unlinkSync(dbFile + x); } catch (e) { /* ignore */ } }); });

test('regional ads: country beats region beats everywhere', async () => {
  assert.match(await page('GH'), /Ghana banner/);
  assert.doesNotMatch(await page('GH'), /West Africa banner|Global banner/);
  assert.match(await page('NG'), /West Africa banner/);      // NG is in the WEST_AFRICA region group
  assert.match(await page('DE'), /Europe banner/);
  const jp = await page('JP');
  assert.match(jp, /Global banner/);
  assert.doesNotMatch(jp, /Ghana banner|Europe banner/);
});

test('admin can add, hide and delete regional ads', async () => {
  const r = await put('new', { slot_key: 'sidebar-1', name: 'JP only', scope_type: 'country', scope_value: 'JP', ad_code: '<b>JAPAN-AD</b>' });
  assert.strictEqual(r.status, 200);
  assert.match(await page('JP'), /JAPAN-AD/);
  assert.doesNotMatch(await page('GH'), /JAPAN-AD/);
  // image + link banner
  await put('new', { slot_key: 'sidebar-1', name: 'BR img', scope_type: 'country', scope_value: 'BR', image_url: 'https://cdn.example/b.png', link_url: 'https://adv.example/x' });
  const br = await page('BR');
  assert.match(br, /src="https:\/\/cdn\.example\/b\.png"/); assert.match(br, /rel="sponsored noopener"/);
  // "show no ad" for a country
  await put('new', { slot_key: 'sidebar-1', name: 'none in NG', scope_type: 'country', scope_value: 'NG', mode: 'hide' });
  assert.doesNotMatch(await page('NG'), /West Africa banner/);
  // validation
  assert.strictEqual((await put('new', { slot_key: 'sidebar-1', scope_type: 'country', scope_value: 'XX', ad_code: 'x' })).status, 400);
  assert.strictEqual((await put('new', { slot_key: 'nope', scope_type: 'all', ad_code: 'x' })).status, 400);
  assert.strictEqual((await put('new', { slot_key: 'sidebar-1', scope_type: 'all' })).status, 400);
  assert.strictEqual((await put('new', { slot_key: 'sidebar-1', scope_type: 'all', image_url: 'javascript:alert(1)' })).status, 400);
  // delete
  const list = await (await fetch(base + '/admin/api/ad-creatives', { headers: H })).json();
  const jpAd = list.find((x) => x.name === 'JP only');
  await fetch(base + '/admin/api/ad-creatives/' + jpAd.id, { method: 'DELETE', headers: H });
  assert.doesNotMatch(await page('JP'), /JAPAN-AD/);
});

test('betting ads never show where betting is off', async () => {
  await put('new', { slot_key: 'sidebar-2', name: 'casino', scope_type: 'all', ad_code: '<i>CASINO-AD</i>', betting_related: 1 });
  assert.match(await page('GH'), /CASINO-AD/);
  assert.doesNotMatch(await page('US'), /CASINO-AD/);   // betting content is off in the US
});
