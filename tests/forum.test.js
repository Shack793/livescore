const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { start } = require('../server/index');

async function boot(extra) {
  const dbFile = path.join(os.tmpdir(), 'lsn-forum-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.db');
  const S = await start({ log: () => {}, env: Object.assign({ PORT: '0', DB_PATH: dbFile, ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test', DATA_PROVIDER: 'mock', ALLOW_CC_QUERY: 'true' }, extra) });
  const base = 'http://127.0.0.1:' + S.port;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, headers: r.headers, text: await r.text() }; };
  const close = async () => { await S.close(); ['', '-wal', '-shm'].forEach((x) => { try { fs.unlinkSync(dbFile + x); } catch (e) { /* ignore */ } }); };
  return { get, close };
}

test('forum links appear only when FORUM_URL is set', async () => {
  const off = await boot({});
  const on = await boot({ FORUM_URL: 'https://pitchside.test/', FORUM_NAME: 'Pitchside Forum' });
  try {
    const a = await off.get('/'), b = await on.get('/');
    assert.doesNotMatch(a.text, /pitchside\.test/);
    assert.match(b.text, /https:\/\/pitchside\.test/);
    assert.match(b.text, /Pitchside Forum/);
  } finally { await off.close(); await on.close(); }
});

test('match rows open in a new tab', async () => {
  const s = await boot({});
  try {
    const r = await s.get('/');
    assert.match(r.text, /class="mr-teams"[^>]*target="_blank"[^>]*rel="noopener"/);
  } finally { await s.close(); }
});

test('embed widgets: frameable, no betting/ads by default', async () => {
  const s = await boot({ FORUM_URL: 'https://pitchside.test', EMBED_ORIGINS: 'https://other.test' });
  try {
    for (const p of ['/embed/live/', '/embed/football/?limit=5&theme=dark']) {
      const r = await s.get(p + (p.includes('?') ? '&' : '?') + 'cc=GH');
      assert.strictEqual(r.status, 200, p);
      assert.strictEqual(r.headers.get('x-frame-options'), null);
      const csp = r.headers.get('content-security-policy') || '';
      assert.match(csp, /frame-ancestors/);
      assert.match(csp, /pitchside\.test/);
      assert.match(csp, /other\.test/);
      assert.doesNotMatch(r.text, /BetWave|class="ad-slot/);
    }
    const normal = await s.get('/');
    assert.notStrictEqual(normal.headers.get('x-frame-options'), null);
  } finally { await s.close(); }
});

test('sport bar order: requested order, extra sports under More', async () => {
  const s = await boot({});
  try {
    const r = await s.get('/');
    const names = [...r.text.matchAll(/<a class="stab(?: xtra)?(?: on)?" href="\/([a-z-]*)\/?"/g)].map((m) => m[1] || 'football');
    const want = ['football', 'basketball', 'tennis', 'volleyball', 'handball', 'american-football', 'baseball', 'hockey', 'rugby'];
    // sports without a data feed (e.g. tennis) are hidden by the sync, so compare the relative order of what is shown
    assert.deepStrictEqual(names, want.filter((x) => names.includes(x)));
    assert.strictEqual(names[0], 'football');
    assert.match(r.text, /class="morebox/);
  } finally { await s.close(); }
});
