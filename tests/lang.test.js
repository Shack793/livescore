const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { start } = require('../server/index');

async function boot(extra) {
  const dbFile = path.join(os.tmpdir(), 'lsn-lang-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.db');
  const S = await start({ log: () => {}, env: Object.assign({ PORT: '0', DB_PATH: dbFile, ADMIN_PASS: 'pw', SYNC_ENABLED: 'false', NODE_ENV: 'test', DATA_PROVIDER: 'mock', ALLOW_CC_QUERY: 'true' }, extra) });
  const base = 'http://127.0.0.1:' + S.port;
  const get = async (p) => { const r = await fetch(base + p, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 Test' } }); return { status: r.status, headers: r.headers, text: await r.text() }; };
  const raw = async (p, h) => (await (await fetch(base + p, { headers: Object.assign({ 'user-agent': 'Mozilla/5.0 Test' }, h) })).text());
  const close = async () => { await S.close(); ['', '-wal', '-shm'].forEach((x) => { try { fs.unlinkSync(dbFile + x); } catch (e) { /* ignore */ } }); };
  return { get, raw, base, close };
}

test('every language opens, sets lang/dir, and keeps links inside the language', async () => {
  const s = await boot({});
  try {
    const dir = { es: 'ltr', pt: 'ltr', ar: 'rtl', zh: 'ltr', ko: 'ltr', ja: 'ltr', de: 'ltr', nl: 'ltr', fr: 'ltr', hi: 'ltr', bn: 'ltr', id: 'ltr', ur: 'rtl' };
    for (const l of Object.keys(dir)) {
      const r = await s.get('/' + l + '/?cc=NL');
      assert.strictEqual(r.status, 200, l);
      assert.match(r.text, new RegExp('<html lang="' + l + '" dir="' + dir[l] + '"'), l);
      assert.match(r.text, new RegExp('<link rel="canonical" href="[^"]*/' + l + '/">'), l + ' canonical');
      assert.match(r.text, new RegExp('href="/' + l + '/football/'), l + ' links stay in language');
      assert.doesNotMatch(r.text, new RegExp('href="/' + l + '/' + l + '/'), l + ' no double prefix');
      assert.doesNotMatch(r.text, new RegExp('href="/' + l + '/(assets|go|api)/'), l + ' assets and redirects are not prefixed');
      assert.doesNotMatch(r.text, /<title>[^<]*(Live Scores, Results)/, l + ' title translated');
    }
    const en = await s.get('/?cc=NL');
    assert.match(en.text, /<html lang="en"/);
    assert.doesNotMatch(en.text.replace(/<a [^>]*data-nolang[^>]*>[^<]*<\/a>/g, ''), /href="\/(es|pt|ar|zh|ko|ja|de|nl|fr|hi|bn|id|ur)\//, 'English page only links to other languages from the switcher');
  } finally { await s.close(); }
});

test('translated text, dates and switcher', async () => {
  const s = await boot({});
  try {
    const es = (await s.get('/es/?cc=NL')).text;
    assert.match(es, /Mis equipos/); assert.match(es, /Países Bajos/); assert.match(es, /hoy|Hoy/i);
    assert.match(es, /<a data-nolang hreflang="ja" href="\/ja\/">日本語<\/a>/);
    assert.match(es, /<a data-nolang hreflang="en" href="\/">English<\/a>/);
    assert.match(es, /rel="alternate" hreflang="x-default"/);
    assert.match(es, /hreflang="zh" href="[^"]*\/zh\/"/);
    const en = (await s.get('/?cc=NL')).text;
    assert.match(en, /rel="alternate" hreflang="es" href="[^"]*\/es\/"/);
    const ja = (await s.get('/ja/football/germany/bundesliga/?cc=NL')).text;
    assert.match(ja, /順位表/); assert.match(ja, /ドイツ/);
    const m = (en.match(/href="(\/match\/[^"]+\/)"/) || [])[1];
    const ar = (await s.get('/ar' + m + '?cc=NL')).text;
    assert.match(ar, /الملخص/); assert.match(ar, /الإحصائيات/);
    assert.match(ar, /dir="rtl"/);
  } finally { await s.close(); }
});

test('language paths: bare prefix redirects, unknown pages 404 in language, legal pages carry an English-only note, robots', async () => {
  const s = await boot({});
  try {
    const r = await s.get('/es');
    assert.strictEqual(r.status, 301); assert.strictEqual(r.headers.get('location'), '/es/');
    assert.strictEqual((await s.get('/ja/nothing-here/')).status, 404);
    const terms = (await s.get('/pt/terms/')).text;
    assert.match(terms, /apenas em inglês/);
    const rb = (await s.get('/robots.txt')).text;
    assert.match(rb, /Disallow: \/es\/search\//);
    const fr = await s.get('/es/frag/favorites/?teams=1');
    assert.strictEqual(fr.status, 200);
    const st = await s.get('/es/football/?cc=NL');
    assert.strictEqual(st.status, 301); assert.match(st.headers.get('location'), /^\/es\/(\?|$)/);
  } finally { await s.close(); }
});

test('LANGUAGES=off switches the translated copies off', async () => {
  const s = await boot({ LANGUAGES: 'off' });
  try {
    assert.strictEqual((await s.get('/es/')).status, 404);
    const en = (await s.get('/?cc=NL')).text;
    assert.doesNotMatch(en, /hreflang|data-nolang/);
  } finally { await s.close(); }
});

test('English pages offer the visitor their own language (browser language first, then country)', async () => {
  const s = await boot({});
  try {
    const base = s.base;
    const get = async (p, h) => { const r = await s.raw(p, h); return r; };
    const de = await get('/football/germany/bundesliga/?cc=NL', { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' });
    assert.match(de, /class="langbar" lang="de" dir="ltr"/);
    assert.match(de, /class="lb-yes" data-nolang href="\/de\/football\/germany\/bundesliga\/\?cc=NL">Deutsch</);
    assert.match(de, /Möchtest du diese Seite auf Deutsch lesen\?/);
    assert.doesNotMatch(await get('/?cc=DE', { 'accept-language': 'en-GB,en;q=0.9,de;q=0.5' }), /langbar/, 'English first = no prompt');
    assert.doesNotMatch(await get('/?cc=DE', { 'accept-language': 'fi,sv;q=0.5' }), /langbar/, 'unknown browser language = no prompt');
    assert.match(await get('/?cc=BR', {}), /class="langbar" lang="pt"/, 'no browser language: use the country');
    assert.match(await get('/?cc=PK', { 'accept-language': 'ur-PK,ur;q=0.9' }), /class="langbar" lang="ur" dir="rtl"/);
    assert.doesNotMatch(await get('/?cc=DE', { 'accept-language': 'de', cookie: 'lsn_langno=1' }), /langbar/, 'dismissed once = never again');
    assert.doesNotMatch(await get('/?cc=DE', { 'accept-language': 'de', 'user-agent': 'Googlebot/2.1' }), /langbar/, 'not shown to search bots');
    assert.doesNotMatch(await get('/de/?cc=DE', { 'accept-language': 'de' }), /langbar/, 'not shown on translated pages');
    assert.doesNotMatch(await get('/embed/live/?cc=DE', { 'accept-language': 'de' }), /langbar/, 'not shown in widgets');
  } finally { await s.close(); }
});

test('SEO: sitemap index, per-language sitemaps, og:locale, legal copies noindex', async () => {
  const s = await boot({});
  try {
    const idx = (await s.get('/sitemap.xml')).text;
    assert.match(idx, /<sitemapindex/);
    for (const c of ['en', 'es', 'ar', 'zh', 'ur']) assert.match(idx, new RegExp('/sitemap-' + c + '\\.xml'), c);
    const de = (await s.get('/sitemap-de.xml')).text;
    assert.match(de, /<loc>[^<]*\/de\/<\/loc>/);
    assert.match(de, /\/de\/basketball\//);
    assert.doesNotMatch(de, /\/de\/(terms|privacy|cookies)\//);
    assert.doesNotMatch(de, /\/de\/de\//);
    assert.doesNotMatch(de, /\/de\/team\//, 'team pages only in the English sitemap');
    assert.match((await s.get('/sitemap-en.xml')).text, /\/team\//);
    for (const c of ['en', 'de']) { const sm = (await s.get('/sitemap-' + c + '.xml')).text; for (const u of (sm.match(/<loc>[^<]+<\/loc>/g) || []).filter((v) => /\/standings\//.test(v)).slice(0, 8)) { const path = u.replace(/<\/?loc>/g, '').replace(/^https?:\/\/[^/]+/, ''); assert.strictEqual((await s.get(path + '?cc=GB')).status, 200, path); } }
    assert.match((await s.get('/sitemap-en.xml')).text, /\/terms\//);
    assert.strictEqual((await s.get('/sitemap-xx.xml')).status, 404);
    assert.match((await s.get('/?cc=NL')).text, /og:locale" content="en_GB"/);
    const fr = (await s.get('/fr/?cc=FR')).text;
    assert.match(fr, /og:locale" content="fr_FR"/);
    assert.match(fr, /rel="alternate" hreflang="de"/);
    const t = (await s.get('/fr/terms/?cc=FR')).text;
    assert.match(t, /<meta name="robots" content="noindex,follow">/);
    assert.doesNotMatch(t, /rel="alternate" hreflang=/);
    assert.doesNotMatch((await s.get("/terms/?cc=NL")).text, /rel="alternate" hreflang=/);
  } finally { await s.close(); }
});

test('ads carry an operator key so phones can keep one ad per operator', async () => {
  const s = await boot({});
  try {
    const h = (await s.get('/?cc=NL')).text;
    assert.match(h, /data-op="b\d+"/);
    const js = fs.readFileSync(path.join(__dirname, '../public/assets/app.js'), 'utf8');
    assert.match(js, /function onePerOperator/);
    assert.match(js, /max-width:820px\) and \(pointer:coarse/);
  } finally { await s.close(); }
});

test('settings menu has a language picker that keeps the current page', async () => {
  const s = await boot({});
  try {
    const en = (await s.get('/basketball/?cc=NL')).text;
    assert.match(en, /id="setLang"[^>]*><option value="\/basketball\/" selected>English<\/option><option value="\/es\/basketball\/"/);
    const de = (await s.get('/de/basketball/?cc=DE')).text;
    assert.match(de, /<option value="\/de\/basketball\/" selected>Deutsch<\/option>/);
    assert.doesNotMatch(de, /value="\/de\/de\//);
  } finally { await s.close(); }
});

test('Crypto.Games sidebar uses the official animated banner', async () => {
  const s = await boot({});
  try {
    const h = (await s.get('/?cc=NL')).text;
    assert.match(h, /src="\/assets\/ads\/cryptogames-300x250-anim\.webp"/);
    assert.doesNotMatch((await s.get('/?cc=GB')).text, /cryptogames-\d+x\d+-anim/);
  } finally { await s.close(); }
});

test('live-update fragments are never indexable', async () => {
  const s = await boot({});
  try {
    for (const u of ['/frag/favorites/?teams=1,2&cc=GB', '/es/frag/favorites/?teams=1,2&cc=GB']) {
      const r = await s.get(u); assert.match(r.headers.get('x-robots-tag') || '', /noindex/, u);
    }
    const m = (await s.get('/?cc=GB')).text.match(/href="(\/match\/[^"]+)"/)[1];
    const r2 = await s.get(m + '?frag=1&cc=GB'); assert.match(r2.headers.get('x-robots-tag') || '', /noindex/);
    const r3 = await s.get(m + '?cc=GB'); assert.doesNotMatch(r3.headers.get('x-robots-tag') || '', /noindex/);
  } finally { await s.close(); }
});
