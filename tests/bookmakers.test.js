const test = require('node:test');
const assert = require('node:assert');
const bk = require('../shared/bookmakers');
const util = require('../shared/util');
const odds = require('../shared/odds');

const regions = [
  { code: 'AFRICA', countries: ['GH', 'NG', 'ZA', 'KE'] },
  { code: 'EU', countries: ['DE', 'FR', 'IT', 'ES'] },
  { code: 'UKI', countries: ['GB', 'IE'] }
];
const mk = (id, name, extra) => Object.assign({ id, name, short_code: name.slice(0, 2), active: 1, affiliate_url: 'https://aff.example/' + id, offer: 'default offer', sort_order: id }, extra || {});
const cfgBase = () => ({
  bookmakers: [mk(1, 'Alpha'), mk(2, 'Bravo'), mk(3, 'Charlie'), mk(4, 'Delta', { active: 0 })],
  regions,
  countryRules: [],
  rules: []
});
const names = (r) => r.items.map((i) => i.name);

test('default deny: bookmaker with no rules is never shown', () => {
  const cfg = cfgBase();
  assert.deepStrictEqual(names(bk.resolve(cfg, 'GH')), []);
});

test('region allow shows only to countries inside that region', () => {
  const cfg = cfgBase();
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'region', scope_value: 'AFRICA', mode: 'allow' });
  assert.deepStrictEqual(names(bk.resolve(cfg, 'GH')), ['Alpha']);
  assert.deepStrictEqual(names(bk.resolve(cfg, 'NG')), ['Alpha']);
  assert.deepStrictEqual(names(bk.resolve(cfg, 'GB')), []);
  assert.deepStrictEqual(names(bk.resolve(cfg, 'US')), []);
});

test('country block beats region allow (most specific wins)', () => {
  const cfg = cfgBase();
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'region', scope_value: 'AFRICA', mode: 'allow' });
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'country', scope_value: 'ZA', mode: 'block' });
  assert.deepStrictEqual(names(bk.resolve(cfg, 'ZA')), []);
  assert.deepStrictEqual(names(bk.resolve(cfg, 'GH')), ['Alpha']);
});

test('country allow beats region block', () => {
  const cfg = cfgBase();
  cfg.rules.push({ bookmaker_id: 2, scope_type: 'region', scope_value: 'EU', mode: 'block' });
  cfg.rules.push({ bookmaker_id: 2, scope_type: 'country', scope_value: 'DE', mode: 'allow' });
  assert.deepStrictEqual(names(bk.resolve(cfg, 'DE')), ['Bravo']);
  assert.deepStrictEqual(names(bk.resolve(cfg, 'FR')), []);
});

test('worldwide allow + country block', () => {
  const cfg = cfgBase();
  cfg.rules.push({ bookmaker_id: 3, scope_type: 'all', scope_value: '*', mode: 'allow' });
  cfg.rules.push({ bookmaker_id: 3, scope_type: 'country', scope_value: 'US', mode: 'block' });
  assert.deepStrictEqual(names(bk.resolve(cfg, 'GH')), ['Charlie']);
  assert.deepStrictEqual(names(bk.resolve(cfg, 'US')), []);
  assert.deepStrictEqual(names(bk.resolve(cfg, '')), ['Charlie'], 'unknown country only matches worldwide rules');
});

test('block beats allow at equal specificity (country in two regions)', () => {
  const cfg = cfgBase();
  cfg.regions = regions.concat([{ code: 'COMMONWEALTH', countries: ['GH', 'GB'] }]);
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'region', scope_value: 'AFRICA', mode: 'allow' });
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'region', scope_value: 'COMMONWEALTH', mode: 'block' });
  assert.deepStrictEqual(names(bk.resolve(cfg, 'GH')), []);
  assert.deepStrictEqual(names(bk.resolve(cfg, 'NG')), ['Alpha']);
});

test('inactive bookmakers never show', () => {
  const cfg = cfgBase();
  cfg.rules.push({ bookmaker_id: 4, scope_type: 'all', scope_value: '*', mode: 'allow' });
  assert.deepStrictEqual(names(bk.resolve(cfg, 'GH')), []);
});

test('per-country overrides: affiliate url, offer and sort order', () => {
  const cfg = cfgBase();
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'region', scope_value: 'AFRICA', mode: 'allow', sort_order: 5 });
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'country', scope_value: 'GH', mode: 'allow', affiliate_url: 'https://gh.example/alpha', offer: 'GHS 200 bonus', sort_order: 1 });
  cfg.rules.push({ bookmaker_id: 2, scope_type: 'country', scope_value: 'GH', mode: 'allow', sort_order: 2 });
  const gh = bk.resolve(cfg, 'GH');
  assert.deepStrictEqual(names(gh), ['Alpha', 'Bravo']);
  assert.strictEqual(gh.items[0].affiliate_url, 'https://gh.example/alpha');
  assert.strictEqual(gh.items[0].offer, 'GHS 200 bonus');
  const ng = bk.resolve(cfg, 'NG');
  assert.strictEqual(ng.items[0].affiliate_url, 'https://aff.example/1');
  assert.strictEqual(ng.items[0].offer, 'default offer');
});

test('ordering uses rule sort_order, then bookmaker order', () => {
  const cfg = cfgBase();
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'all', scope_value: '*', mode: 'allow', sort_order: 30 });
  cfg.rules.push({ bookmaker_id: 2, scope_type: 'all', scope_value: '*', mode: 'allow', sort_order: 10 });
  cfg.rules.push({ bookmaker_id: 3, scope_type: 'all', scope_value: '*', mode: 'allow', sort_order: 20 });
  assert.deepStrictEqual(names(bk.resolve(cfg, 'GH')), ['Bravo', 'Charlie', 'Alpha']);
});

test('country with betting_content=0 shows nothing, even with worldwide allow', () => {
  const cfg = cfgBase();
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'all', scope_value: '*', mode: 'allow' });
  cfg.countryRules.push({ country_code: 'XX', betting_content: 0, min_age: 18 });
  const r = bk.resolve(cfg, 'XX');
  assert.deepStrictEqual(names(r), []);
  assert.strictEqual(r.compliance.betting_allowed, false);
});

test('compliance info: country min age and text, defaults otherwise', () => {
  const cfg = cfgBase();
  cfg.countryRules.push({ country_code: 'US', betting_content: 1, min_age: 21, rg_text: 'Call the helpline.', rg_url: 'https://x.example' });
  const us = bk.resolve(cfg, 'US').compliance;
  assert.strictEqual(us.min_age, 21);
  assert.strictEqual(us.rg_text, 'Call the helpline.');
  const gh = bk.resolve(cfg, 'GH').compliance;
  assert.strictEqual(gh.min_age, 18);
  assert.ok(gh.rg_text.length > 10);
});

test('publicItems never exposes affiliate urls', () => {
  const cfg = cfgBase();
  cfg.rules.push({ bookmaker_id: 1, scope_type: 'all', scope_value: '*', mode: 'allow' });
  const pub = bk.publicItems(bk.resolve(cfg, 'GH').items);
  assert.ok(!JSON.stringify(pub).includes('aff.example'));
});

/* ---------- odds helpers ---------- */

test('odds formats', () => {
  assert.strictEqual(util.formatOdd(2.5, 'decimal'), '2.50');
  assert.strictEqual(util.formatOdd(2.5, 'fractional'), '3/2');
  assert.strictEqual(util.formatOdd(1.85, 'fractional'), '17/20');
  assert.strictEqual(util.formatOdd(3.6, 'fractional'), '13/5');
  assert.strictEqual(util.formatOdd(3.0, 'american'), '+200');
  assert.strictEqual(util.formatOdd(1.5, 'american'), '-200');
  assert.strictEqual(util.formatOdd(null, 'decimal'), '–');
});

test('primary odds come from the first visible bookmaker that has the market', () => {
  const rows = [
    { bookmaker_ref: 'f2', market: '1x2', selection: '1', value: 2.0, prev: 2.1 },
    { bookmaker_ref: 'f2', market: '1x2', selection: 'X', value: 3.3, prev: 3.3 },
    { bookmaker_ref: 'f2', market: '1x2', selection: '2', value: 3.8, prev: 3.7 },
    { bookmaker_ref: 'f3', market: '1x2', selection: '1', value: 2.05, prev: null },
    { bookmaker_ref: 'f3', market: '1x2', selection: 'X', value: 3.2, prev: null },
    { bookmaker_ref: 'f3', market: '1x2', selection: '2', value: 3.9, prev: null }
  ];
  const visible = [{ id: 1, name: 'A', provider_ref: 'f1' }, { id: 2, name: 'B', provider_ref: 'f2' }, { id: 3, name: 'C', provider_ref: 'f3' }];
  const p = odds.primary(rows, visible, 'football');
  assert.strictEqual(p.bookmaker_id, 2, 'skips A (no feed odds), uses B');
  assert.deepStrictEqual(p.cells.map((c) => c.trend), ['down', '', 'up']);
  assert.strictEqual(odds.primary(rows, [{ id: 9, name: 'Z', provider_ref: 'nope' }], 'football'), null);
  assert.strictEqual(odds.primary(rows, [], 'football'), null);
});

test('comparison highlights best price per selection and only lists visible bookmakers', () => {
  const rows = [];
  const add = (ref, sel, v) => rows.push({ bookmaker_ref: ref, market: '1x2', selection: sel, value: v, prev: null });
  add('f1', '1', 2.0); add('f1', 'X', 3.0); add('f1', '2', 4.0);
  add('f2', '1', 2.2); add('f2', 'X', 2.9); add('f2', '2', 4.1);
  const cmp = odds.comparison(rows, [{ id: 1, name: 'A', provider_ref: 'f1' }, { id: 2, name: 'B', provider_ref: 'f2' }]);
  assert.strictEqual(cmp.length, 1);
  assert.deepStrictEqual(cmp[0].best, [2.2, 3.0, 4.1]);
  const onlyA = odds.comparison(rows, [{ id: 1, name: 'A', provider_ref: 'f1' }]);
  assert.strictEqual(onlyA[0].lines.length, 1);
});

/* ---------- util: time zones ---------- */

test('timezone helpers handle offsets and DST', () => {
  assert.strictEqual(util.dateStr(Date.UTC(2026, 9, 9, 23, 30) / 1000, 'Africa/Accra'), '2026-10-09');
  assert.strictEqual(util.dateStr(Date.UTC(2026, 9, 9, 23, 30) / 1000, 'Asia/Tokyo'), '2026-10-10');
  const r = util.dayRange('2026-10-09', 'Africa/Accra');
  assert.strictEqual(r[1] - r[0], 86400);
  const dst = util.dayRange('2026-03-29', 'Europe/London'); // clocks go forward: 23h day
  assert.strictEqual(dst[1] - dst[0], 23 * 3600);
  assert.strictEqual(util.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(util.fmtTime(Date.UTC(2026, 9, 9, 15, 5) / 1000, 'Africa/Accra'), '15:05');
});

test('slugify strips accents and symbols', () => {
  assert.strictEqual(util.slugify('Atlético Madrid'), 'atletico-madrid');
  assert.strictEqual(util.slugify("Hearts of Oak"), 'hearts-of-oak');
  assert.strictEqual(util.slugify('Bosnia & Herzegovina'), 'bosnia-and-herzegovina');
});
