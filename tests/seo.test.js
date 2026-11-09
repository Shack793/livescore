const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { start } = require('../server/index');

test('SEO: breadcrumbs, og:url, canonical, match schema, noindex on odd pages', async () => {
  const S = await start({ log: () => {}, env: { PORT: '0', DB_PATH: path.join(os.tmpdir(), 'lsn-seo-' + process.pid + '-' + Date.now() + '.db'), SYNC_ENABLED: 'false', NODE_ENV: 'test', ALLOW_CC_QUERY: 'true' } });
  const base = 'http://127.0.0.1:' + S.port;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, html: await r.text() }; };
  const ld = (h) => (h.match(/<script type="application\/ld\+json">(.*?)<\/script>/g) || []).map((x) => JSON.parse(x.replace(/<\/?script[^>]*>/g, '')));
  try {
    const home = await get('/');
    assert.ok(/<link rel="canonical" href="[^"]+"/.test(home.html) && home.html.includes('og:url'));
    assert.strictEqual((home.html.match(/<h1/g) || []).length, 1);
    assert.ok(ld(home.html).some((j) => j['@type'] === 'WebSite' && j.publisher));
    const lg = S.db.get('SELECT l.slug ls, c.slug cs, l.sport sp FROM leagues l JOIN countries c ON c.id=l.country_id LIMIT 1');
    const lp = await get('/' + lg.sp + '/' + lg.cs + '/' + lg.ls + '/');
    const bc = ld(lp.html).find((j) => j['@type'] === 'BreadcrumbList');
    assert.ok(bc && bc.itemListElement.length === 3 && bc.itemListElement[0].position === 1 && bc.itemListElement[1].item.startsWith('http'));
    const mid = S.db.get('SELECT id FROM matches LIMIT 1').id;
    const mlink = (home.html.match(/href="(\/[^"]*-vs-[^"]*\/)"/) || [])[1];
    assert.ok(mlink, 'a match link exists');
    const mp = await get(mlink);
    const ev = ld(mp.html).find((j) => j['@type'] === 'SportsEvent');
    assert.ok(ev && ev.url.includes('-vs-') && ld(mp.html).some((j) => j['@type'] === 'BreadcrumbList'));
    assert.ok(/<title>[^<]{10,75}<\/title>/.test(mp.html), 'title length is sensible');
    const nf = await get('/football/nope/nope/');
    assert.strictEqual(nf.status, 404); assert.ok(nf.html.includes('noindex'));
    const old = await get('/?date=2020-01-01');
    assert.ok(old.html.includes('noindex'));
    const robots = await (await fetch(base + '/robots.txt')).text();
    assert.ok(/Sitemap:/i.test(robots) && /Disallow: \/go\//.test(robots));
  } finally { await S.close(); }
});
