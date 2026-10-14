const test = require('node:test');
const assert = require('node:assert');
const { GeoIP, parseCsv, saveToDb, v4ToInt, v6ToBig } = require('../server/geo/geoip');
const { resolveCountry, clean } = require('../server/geo/resolve');
const countries = require('../server/geo/countries');
const dbmod = require('../server/db');

const CSV = [
  '# comment line',
  '41.66.0.0,41.66.255.255,GH',
  '41.67.0.0,41.67.0.255,NG',
  '81.2.69.0,81.2.69.255,GB',
  '"8.8.8.0","8.8.8.255","US"',
  '2a00:1450::,2a00:1450:ffff:ffff:ffff:ffff:ffff:ffff,IE',
  '2001:4860::,2001:4860:ffff:ffff:ffff:ffff:ffff:ffff,US',
  '10.0.0.0,10.0.0.255,ZZ',
  'garbage,line,here',
  '1.2.3.4,1.2.3.9,XXX'
].join('\n');

function geo() { const g = new GeoIP(); g.load(parseCsv(CSV)); return g; }

test('parseCsv skips comments, junk and bad country codes', () => {
  const rows = parseCsv(CSV);
  assert.strictEqual(rows.length, 7);
  assert.ok(rows.every((r) => /^[A-Z]{2}$/.test(r.cc)));
});

test('IPv4 lookup incl. range boundaries', () => {
  const g = geo();
  assert.strictEqual(g.lookup('41.66.0.0'), 'GH');
  assert.strictEqual(g.lookup('41.66.200.7'), 'GH');
  assert.strictEqual(g.lookup('41.66.255.255'), 'GH');
  assert.strictEqual(g.lookup('41.67.0.1'), 'NG');
  assert.strictEqual(g.lookup('41.67.1.0'), null, 'just past the end of a range');
  assert.strictEqual(g.lookup('41.65.255.255'), null, 'just before a range');
  assert.strictEqual(g.lookup('81.2.69.160'), 'GB');
  assert.strictEqual(g.lookup('8.8.8.8'), 'US');
  assert.strictEqual(g.lookup('10.0.0.5'), null, 'ZZ ranges mean unknown');
});

test('IPv6 lookup and IPv4-mapped addresses', () => {
  const g = geo();
  assert.strictEqual(g.lookup('2a00:1450:4009:81f::200e'), 'IE');
  assert.strictEqual(g.lookup('2001:4860:4860::8888'), 'US');
  assert.strictEqual(g.lookup('2606:4700::1111'), null);
  assert.strictEqual(g.lookup('::ffff:41.66.1.1'), 'GH', 'IPv4-mapped IPv6 is treated as IPv4');
});

test('garbage input never throws', () => {
  const g = geo();
  ['', null, undefined, 'not-an-ip', '999.1.1.1', '1.2.3', '::::', 'fe80::1%eth0'].forEach((x) => assert.strictEqual(g.lookup(x), null));
});

test('v4ToInt / v6ToBig sanity', () => {
  assert.strictEqual(v4ToInt('1.2.3.4'), 16909060);
  assert.strictEqual(v4ToInt('256.1.1.1'), null);
  assert.strictEqual(v6ToBig('::1'), 1n);
  assert.strictEqual(v6ToBig('::'), 0n);
  assert.strictEqual(v6ToBig('1::'), 1n << 112n);
});

test('GeoIP survives a SQLite round trip', () => {
  const db = dbmod.open(':memory:');
  saveToDb(db, parseCsv(CSV));
  const g = new GeoIP();
  assert.strictEqual(g.loadFromDb(db), 7);
  assert.strictEqual(g.lookup('41.66.9.9'), 'GH');
  assert.strictEqual(g.lookup('2a00:1450::1'), 'IE');
  db.close();
});

/* ---------- resolveCountry ---------- */
const req = (headers, ip) => ({ headers: headers || {}, socket: { remoteAddress: ip || '41.66.1.1' } });
const url = (s) => new URL('http://x' + (s || '/'));
const cfg = (o) => Object.assign({ trustProxy: false, defaultCountry: '' }, o);

test('clean() validates and normalises codes', () => {
  assert.strictEqual(clean('gh'), 'GH');
  assert.strictEqual(clean('UK'), 'GB');
  assert.strictEqual(clean('XX'), '');
  assert.strictEqual(clean('<script>'), '');
  assert.strictEqual(clean(''), '');
});

test('precedence: query > cookie > header > ip > default', () => {
  const g = geo();
  const c = cfg({ trustProxy: true, defaultCountry: 'FR' });
  const r = req({ cookie: 'lsn_cc=NG', 'cf-ipcountry': 'DE' }, '41.66.1.1');
  assert.deepStrictEqual(resolveCountry(r, url('/?cc=us'), c, g), { code: 'US', source: 'query' });
  assert.deepStrictEqual(resolveCountry(r, url('/'), c, g), { code: 'NG', source: 'cookie' });
  assert.deepStrictEqual(resolveCountry(req({ 'cf-ipcountry': 'DE' }, '41.66.1.1'), url('/'), c, g), { code: 'DE', source: 'header' });
  assert.deepStrictEqual(resolveCountry(req({}, '41.66.1.1'), url('/'), c, g), { code: 'GH', source: 'ip' });
  assert.deepStrictEqual(resolveCountry(req({}, '203.0.113.9'), url('/'), c, g), { code: 'FR', source: 'default' });
  assert.deepStrictEqual(resolveCountry(req({}, '203.0.113.9'), url('/'), cfg(), g), { code: 'ZZ', source: 'unknown' });
});

test('SECURITY: geo headers are ignored unless TRUST_PROXY is on (they can be spoofed)', () => {
  const g = geo();
  const spoofed = req({ 'cf-ipcountry': 'US', 'x-country-code': 'US' }, '41.66.1.1');
  assert.strictEqual(resolveCountry(spoofed, url('/'), cfg({ trustProxy: false }), g).code, 'GH', 'must use the real IP, not the header');
  assert.strictEqual(resolveCountry(spoofed, url('/'), cfg({ trustProxy: true }), g).code, 'US');
});

test('x-forwarded-for only used when trusted; invalid/Cloudflare special codes fall through', () => {
  const g = geo();
  const r = req({ 'x-forwarded-for': '81.2.69.5, 10.0.0.1' }, '127.0.0.1');
  assert.strictEqual(resolveCountry(r, url('/'), cfg({ trustProxy: true }), g).code, 'GB');
  assert.strictEqual(resolveCountry(r, url('/'), cfg({ trustProxy: false }), g).code, 'ZZ');
  // Cloudflare sends XX (unknown) and T1 (Tor): neither is a real country
  assert.strictEqual(resolveCountry(req({ 'cf-ipcountry': 'XX' }, '41.66.1.1'), url('/'), cfg({ trustProxy: true }), g).code, 'GH');
  assert.strictEqual(resolveCountry(req({ 'cf-ipcountry': 'T1' }, '41.66.1.1'), url('/'), cfg({ trustProxy: true }), g).code, 'GH');
});

test('junk cookie / query values are ignored', () => {
  const g = geo();
  assert.strictEqual(resolveCountry(req({ cookie: 'lsn_cc=<b>' }, '41.66.1.1'), url('/?cc=ZZZ'), cfg(), g).code, 'GH');
});

/* ---------- country list ---------- */
test('ISO list: 250 unique codes, all resolve to a real name', () => {
  assert.strictEqual(countries.ISO.length, 250);
  assert.strictEqual(new Set(countries.ISO).size, 250);
  const list = countries.list();
  list.forEach((c) => assert.ok(c.name && c.name !== c.code, 'no name for ' + c.code));
  assert.strictEqual(countries.nameOf('GH'), 'Ghana');
  assert.strictEqual(countries.nameOf('XK'), 'Kosovo');
  assert.ok(countries.isValid('ng') && !countries.isValid('EU') && !countries.isValid('ZZ'));
});

test('region groups only contain valid, de-duplicated country codes', () => {
  countries.REGIONS.forEach((r) => {
    assert.strictEqual(new Set(r.countries).size, r.countries.length, 'duplicates in ' + r.code);
    r.countries.forEach((c) => assert.ok(countries.isValid(c), r.code + ' contains invalid ' + c));
  });
  const west = countries.REGIONS.find((r) => r.code === 'WEST_AFRICA').countries;
  const africa = countries.REGIONS.find((r) => r.code === 'AFRICA').countries;
  west.forEach((c) => assert.ok(africa.includes(c), c + ' in WEST_AFRICA but not AFRICA'));
  assert.ok(countries.REGIONS.find((r) => r.code === 'EU27').countries.length === 27);
  assert.ok(africa.includes('GH') && !africa.includes('GB'));
});
