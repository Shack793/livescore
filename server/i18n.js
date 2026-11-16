'use strict';
// Translates a finished English page into another language. The English pages stay exactly as they are;
// this runs afterwards on the HTML (text, titles, descriptions, link addresses) when a visitor opens /es/, /pt/ ...
const D = require('./lang-data');
const D2 = require('./lang-data2');

const LANGS = [
  { code: 'es', name: 'Español', locale: 'es', dir: 'ltr', hreflang: 'es' },
  { code: 'pt', name: 'Português', locale: 'pt-BR', dir: 'ltr', hreflang: 'pt' },
  { code: 'ar', name: 'العربية', locale: 'ar-u-nu-latn', dir: 'rtl', hreflang: 'ar' },
  { code: 'zh', name: '中文', locale: 'zh-CN', dir: 'ltr', hreflang: 'zh' },
  { code: 'ko', name: '한국어', locale: 'ko', dir: 'ltr', hreflang: 'ko' },
  { code: 'ja', name: '日本語', locale: 'ja', dir: 'ltr', hreflang: 'ja' },
  { code: 'de', name: 'Deutsch', locale: 'de', dir: 'ltr', hreflang: 'de' },
  { code: 'nl', name: 'Nederlands', locale: 'nl', dir: 'ltr', hreflang: 'nl' },
  { code: 'fr', name: 'Français', locale: 'fr', dir: 'ltr', hreflang: 'fr' },
  { code: 'hi', name: 'हिन्दी', locale: 'hi-u-nu-latn', dir: 'ltr', hreflang: 'hi' },
  { code: 'bn', name: 'বাংলা', locale: 'bn-u-nu-latn', dir: 'ltr', hreflang: 'bn' },
  { code: 'id', name: 'Bahasa Indonesia', locale: 'id', dir: 'ltr', hreflang: 'id' },
  { code: 'ur', name: 'اردو', locale: 'ur-u-nu-latn', dir: 'rtl', hreflang: 'ur' }
];
// where a language's words sit: the first data file (es...ja) or the second (de...ur)
function cell(code, kind, idx) {
  const a = D.ORDER.indexOf(code);
  return a >= 0 ? D[kind][idx][a + 1] : D2[kind][idx][D2.ORDER.indexOf(code) + 1];
}
const CODES = LANGS.map((l) => l.code);
const RX_PREFIX = new RegExp('^/(' + CODES.join('|') + ')(/.*)?$');
const SKIP_PREFIX = /^\/(assets|api|go|admin|set-region|sw\.js|manifest|sitemap|robots|healthz|embed|frag|favicon)/;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const cache = {};
function compile(code) {
  if (cache[code]) return cache[code];
  const i = LANGS.findIndex((l) => l.code === code) + 1;
  const exact = new Map(), pats = [];
  D.EXACT.forEach((r, k) => exact.set(r[0], cell(code, 'EXACT', k)));
  D.CLIENT.forEach((r, k) => { if (!exact.has(r[0])) exact.set(r[0], cell(code, 'CLIENT', k)); });
  D.PATTERNS.forEach((r, k) => {
    const parts = r[0].split(/(\{\d\})/);
    let src = '^', lit = 0;
    parts.forEach((p) => { const m = p.match(/^\{(\d)\}$/); if (m) src += '(.+?)'; else { src += p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); lit += p.length; } });
    pats.push({ re: new RegExp(src + '$', 's'), tpl: cell(code, 'PATTERNS', k), lit });
  });
  pats.sort((a, b) => b.lit - a.lit);
  let countries = null;
  try {
    const dn = new Intl.DisplayNames([LANGS[i - 1].locale.replace('-u-nu-latn', '')], { type: 'region' });
    countries = new Map();
    require('./geo/countries').list().forEach((c) => { let n; try { n = dn.of(c.code); } catch (e) { n = null; } if (n && n !== c.code) { countries.set(c.name, n); countries.set(c.name.toUpperCase(), n); } });
  } catch (e) { countries = new Map(); }
  const dtl = new Intl.DateTimeFormat(LANGS[i - 1].locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dts = new Intl.DateTimeFormat(LANGS[i - 1].locale, { weekday: 'short', timeZone: 'UTC' });
  return (cache[code] = { exact, pats, countries, dtl, dts, lang: LANGS[i - 1] });
}

const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ndash;/g, '–').replace(/&nbsp;/g, ' ');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SPORTS = ['football', 'basketball', 'tennis', 'volleyball', 'handball', 'american football', 'baseball', 'ice hockey', 'rugby', 'cricket'];
const HEAD = { es: '{1} de {0}', pt: '{1} de {0}', ar: '{1} في {0}', zh: '{0}{1}', ko: '{0} {1}', ja: '{0} {1}', de: '{1} in {0}', nl: '{1} in {0}', fr: '{1} – {0}', hi: '{0} {1}', bn: '{0} {1}', id: '{1} {0}', ur: '{0} {1}' };
const LOWER_SPORT = ['es', 'pt', 'fr', 'nl', 'id'];
function simple(c, t) { // exact words, country names and dates only
  if (c.exact.has(t)) return c.exact.get(t);
  if (SPORTS.indexOf(t) >= 0) { const w = c.exact.get(t.replace(/\b\w/g, (x) => x.toUpperCase())); if (w) return /^[a-zà-ÿ]/i.test(w) && LOWER_SPORT.indexOf(c.lang.code) >= 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w; }
  if (c.countries.has(t)) return c.countries.get(t);
  return null;
}
function tr(c, text, depth) {
  const t = text.trim();
  if (!t) return null;
  let r = simple(c, t);
  if (r != null) return r;
  let m = t.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{2}\/\d{2})$/); // date bar: "Fri 13/11"
  if (m) { const di = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(m[1]); return c.dts.format(new Date(Date.UTC(2023, 0, 1 + di))) + ' ' + m[2]; }
  m = t.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{1,2}) (\w+) (\d{4})$/); // "Saturday, 14 November 2026"
  if (m && MONTHS.indexOf(m[3]) >= 0) return c.dtl.format(new Date(Date.UTC(+m[4], MONTHS.indexOf(m[3]), +m[2])));
  m = t.match(/^(.+?) (football|basketball|tennis|volleyball|handball|american football|baseball|ice hockey|rugby|cricket)$/); // "Africa football"
  if (m) { const cn = simple(c, m[1]), sp = simple(c, m[2]); if (cn && sp) return HEAD[c.lang.code].replace('{0}', cn).replace('{1}', sp); }
  m = t.match(/^(.+?) · (\d{4}(?:\/\d{2,4})?)$/); // "Germany · 2026/27"
  if (m) { const cn = simple(c, m[1]); if (cn) return cn + ' · ' + m[2]; }
  m = t.match(/^([A-Z][A-Z .'&-]+): (.+)$/); // match header "BRAZIL: Serie A"
  if (m) { const cn = simple(c, m[1]); if (cn) return cn.toUpperCase() + ': ' + m[2]; }
  m = t.match(/^([A-Z][A-Z .'&-]+):$/); // "BRAZIL:" group heading
  if (m) { const cn = simple(c, m[1]); if (cn) return cn.toUpperCase() + ':'; }
  if (depth) return null;
  for (let k = 0; k < c.pats.length; k++) {
    const pm = t.match(c.pats[k].re);
    if (pm) return c.pats[k].tpl.replace(/\{(\d)\}/g, (_, n) => { const g = pm[+n + 1]; const x = tr(c, g, 1); return x != null ? x : g; });
  }
  return null;
}

function localize(html, code, opt) {
  const c = compile(code), L = c.lang, site = (opt && opt.siteUrl) || '', pathNow = (opt && opt.path) || '/';
  const T = (txt) => { const raw = unesc(txt), lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0], r = tr(c, raw); return r == null ? txt : esc(lead + (L.dir === 'rtl' ? r.replace(/›/g, '‹') : r) + trail); };
  const chunks = html.split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>)/i);
  const out = chunks.map((ch, idx) => {
    if (idx % 2) return ch;
    // text between tags
    ch = ch.replace(/>([^<>]+)</g, (m0, txt) => '>' + (/\S/.test(txt) ? T(txt) : txt) + '<');
    // <title>
    ch = ch.replace(/<title>([^<]*)<\/title>/, (m0, t) => { const k = t.lastIndexOf(' | '); const a = k > 0 ? t.slice(0, k) : t, b = k > 0 ? t.slice(k) : ''; return '<title>' + T(a) + b + '</title>'; });
    // meta description / og
    ch = ch.replace(/<meta (name="description"|property="og:description"|property="og:title") content="([^"]*)">/g, (m0, k, v) => {
      const i2 = v.lastIndexOf(' | '); const a = i2 > 0 ? v.slice(0, i2) : v, b = i2 > 0 ? v.slice(i2) : '';
      return '<meta ' + k + ' content="' + T(a) + b + '">';
    });
    // attributes users can read
    ch = ch.replace(/\b(aria-label|placeholder|title|alt)="([^"]+)"/g, (m0, k, v) => k + '="' + T(v) + '"');
    // internal links keep the visitor in their language
    ch = ch.replace(/<(a|form)\b[^>]*>/g, (tag) => {
      if (/\bdata-nolang\b/.test(tag)) return tag;
      return tag.replace(/\b(href|action)="(\/[^"\/][^"]*|\/)"/, (m0, k, v) => SKIP_PREFIX.test(v) ? m0 : k + '="/' + code + v + '"');
    });
    // language of the page, canonical address
    ch = ch.replace(/<html lang="en"/, '<html lang="' + L.hreflang + '" dir="' + L.dir + '"');
    if (site) {
      const pre = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      ch = ch.replace(new RegExp('(<link rel="canonical" href="|<meta property="og:url" content=")' + pre + '(/[^"]*|)"', 'g'), (m0, a, b) => a + site + '/' + code + (b || '/') + '"');
    }
    return ch;
  }).join('');
  let res = out;
  const OGL = { es: 'es_ES', pt: 'pt_BR', ar: 'ar_AR', zh: 'zh_CN', ko: 'ko_KR', ja: 'ja_JP', de: 'de_DE', nl: 'nl_NL', fr: 'fr_FR', hi: 'hi_IN', bn: 'bn_BD', id: 'id_ID', ur: 'ur_PK' };
  res = res.replace('<meta property="og:locale" content="en_GB">', '<meta property="og:locale" content="' + OGL[code] + '">');
  res = res.replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org",/g, '<script type="application/ld+json">{"@context":"https://schema.org","inLanguage":"' + L.hreflang + '",');
  if (site) res = res.split(site + '/search/?q=').join(site + '/' + code + '/search/?q=');
  if (/^\/(terms|privacy|cookies)\/?$/.test(pathNow)) res = res.replace('<link rel="canonical"', '<meta name="robots" content="noindex,follow"><link rel="canonical"');
  if (/^\/(terms|privacy|cookies)\/?$/.test(pathNow)) res = res.replace('<div class="prose card">', '<div class="prose card"><p class="muted small">' + esc(c.exact.get('This page is currently available in English only.')) + '</p>');
  const client = {}; D.CLIENT.forEach((r, k) => { client[r[0]] = cell(code, 'CLIENT', k); }); D.EXACT.forEach((r, k) => { if (D.CLIENT_EXTRA.indexOf(r[0]) >= 0) client[r[0]] = cell(code, 'EXACT', k); });
  res = res.replace(/(<script src="\/assets\/app\.js)/, '<script>window.LSN_LP="/' + code + '";window.LSN_I18N=' + JSON.stringify(client).replace(/</g, '\\u003c') + ';</script>$1');
  return res;
}

// ---- "Read this site in ...?" prompt on the English pages ----
const ASK = {
  es: ['¿Quieres ver este sitio en español?', 'Ahora no'], pt: ['Quer ver este site em português?', 'Agora não'], ar: ['هل تريد قراءة الموقع بالعربية؟', 'لاحقاً'],
  zh: ['要用中文浏览本站吗？', '暂不'], ko: ['이 사이트를 한국어로 보시겠어요?', '나중에'], ja: ['このサイトを日本語で表示しますか？', '今はしない'],
  de: ['Möchtest du diese Seite auf Deutsch lesen?', 'Nicht jetzt'], nl: ['Wil je deze site in het Nederlands lezen?', 'Niet nu'], fr: ['Voulez-vous lire ce site en français ?', 'Pas maintenant'],
  hi: ['क्या आप इस साइट को हिन्दी में पढ़ना चाहेंगे?', 'अभी नहीं'], bn: ['আপনি কি এই সাইট বাংলায় পড়তে চান?', 'এখন নয়'], id: ['Ingin membaca situs ini dalam bahasa Indonesia?', 'Nanti saja'], ur: ['کیا آپ یہ سائٹ اردو میں پڑھنا چاہیں گے؟', 'ابھی نہیں']
};
// countries where one of our languages is the everyday language (used only when the browser gives no language)
const BY_COUNTRY = {};
[['es', 'ES MX AR CO CL PE VE EC UY PY BO CR PA GT HN SV NI DO CU'], ['pt', 'BR PT AO MZ'], ['ar', 'SA AE EG MA DZ IQ JO KW QA OM LB TN LY SY YE SD BH'], ['zh', 'CN'], ['ko', 'KR'], ['ja', 'JP'],
  ['de', 'DE AT'], ['nl', 'NL'], ['fr', 'FR CI SN CM CD ML BF NE TG BJ GN MG'], ['hi', ''], ['bn', 'BD'], ['id', 'ID'], ['ur', 'PK']].forEach((r) => r[1].split(' ').filter(Boolean).forEach((c) => { BY_COUNTRY[c] = r[0]; }));

// Which language to offer: the browser's first language if it is one of ours, otherwise (if the browser names none we know) the country.
function suggest(acceptLanguage, cc) {
  const list = String(acceptLanguage || '').split(',').map((s) => { const m = s.trim().match(/^([a-zA-Z]{2,3})(?:-[\w-]+)?(?:;q=([\d.]+))?$/); return m ? { l: m[1].toLowerCase(), q: m[2] === undefined ? 1 : parseFloat(m[2]) } : null; }).filter(Boolean).sort((a, b) => b.q - a.q);
  for (let i = 0; i < list.length; i++) { if (list[i].l === 'en') return ''; if (CODES.indexOf(list[i].l) >= 0) return list[i].l; }
  if (list.length) return '';
  return BY_COUNTRY[String(cc || '').toUpperCase()] || '';
}
function bar(code, target) {
  const L = LANGS.find((l) => l.code === code), a = ASK[code];
  return '<div class="langbar" lang="' + L.hreflang + '" dir="' + L.dir + '"><span>' + esc(a[0]) + '</span><a class="lb-yes" data-nolang href="/' + code + esc(target) + '">' + esc(L.name) + '</a><button class="lb-no" type="button">' + esc(a[1]) + '</button></div>';
}

module.exports = { LANGS, CODES, RX_PREFIX, localize, suggest, bar };
