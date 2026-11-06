const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const O = require('../shared/odds');
const { start } = require('../server/index');

test('odds: a bookmaker with several feed references uses the one the match has odds for', () => {
  const rows = [{ bookmaker_ref: 'ab:b3', market: 'ml', selection: '1', value: 1.9 }, { bookmaker_ref: 'ab:b3', market: 'ml', selection: '2', value: 1.95 }];
  const items = [{ id: 7, name: '1xBet', provider_ref: 'af:b11,ab:b3,hk:b8' }];
  const p = O.primary(rows, items, 'basketball');
  assert.ok(p, 'found odds through the second reference');
  assert.strictEqual(p.bookmaker_name, '1xBet');
  assert.strictEqual(O.primary(rows, [{ id: 8, name: 'Other', provider_ref: 'af:b99' }], 'basketball'), null);
});

test('admin: choosing one 1xBet feed entry connects all of its sport feeds', async () => {
  const dbFile = path.join(os.tmpdir(), 'lsn-mr-' + process.pid + '-' + Date.now() + '.db');
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: dbFile, ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test' } });
  try {
    [['af:b11', '1xBet'], ['ab:b3', '1xBet'], ['bs:b1', '1xbet'], ['af:b8', 'Bet365']].forEach(([r, n]) => S.db.run('INSERT OR REPLACE INTO feed_bookmakers (ref,name,seen_at) VALUES (?,?,?)', r, n, 1));
    const H = { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64'), 'x-lsn-admin': '1', 'content-type': 'application/json' };
    S.db.run("DELETE FROM bookmakers WHERE name='1xBet'");
    const r = await fetch('http://127.0.0.1:' + S.port + '/admin/api/bookmakers', { method: 'POST', headers: H, body: JSON.stringify({ name: '1xBet', provider_ref: 'af:b11', affiliate_url: 'https://aff.example', active: 1, rules: [] }) }); // the built-in preset is replaced by this admin save
    assert.strictEqual(r.status, 200);
    const ref = S.db.get("SELECT provider_ref FROM bookmakers WHERE name='1xBet'").provider_ref.split(',').sort();
    assert.deepStrictEqual(ref, ['ab:b3', 'af:b11', 'bs:b1']);
  } finally { await S.close(); ['', '-wal', '-shm'].forEach((x) => { try { fs.unlinkSync(dbFile + x); } catch (e) { /* ignore */ } }); }
});
