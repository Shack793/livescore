'use strict';
// server/app.js — the HTTP application: public pages, JSON/SSE endpoints, affiliate redirects and admin.
const fs = require('fs');
const path = require('path');
const http = require('./lib/http');
const countries = require('./geo/countries');
const { resolveCountry } = require('./geo/resolve');
const B = require('../shared/bookmakers');
const pages = require('../shared/pages');
const V = require('../shared/views');
const U = require('../shared/util');
const admin = require('./admin');

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|monitor|headless/i;

function create({ cfg, db, store, sync, hub, geoip, log, hubFactory }) {
  const pub = path.join(cfg.root, 'public');
  const assetV = (() => { try { return ['app.js', 'style.css'].map((f) => Math.floor(fs.statSync(path.join(pub, 'assets', f)).mtimeMs / 1000).toString(36)).join(''); } catch (e) { return '1'; } })();
  const pageCfg = { siteName: cfg.siteName, siteUrl: cfg.siteUrl, siteTz: cfg.siteTz, assetV, contactEmail: cfg.contactEmail, forumUrl: cfg.forumUrl, forumName: cfg.forumName, forumMatchUrl: cfg.forumMatchUrl };
  const bkCache = http.makeCache(400);
  const goLimit = http.makeLimiter(90, 60000);
  const apiLimit = http.makeLimiter(cfg.apiRatePerMin, 60000);
  const countryList = countries.list();
  const consent = new Set(countries.CONSENT_COUNTRIES);
  const adminApi = admin.create({ cfg, db, store, sync, hub, geoip, log, getBk, clearCaches });

  function getBk(cc) {
    let r = bkCache.get(cc);
    if (!r) { r = B.resolve(store.bookmakerConfig(), cc); bkCache.set(cc, r, 30000); }
    return r;
  }
  function clearCaches() { store.invalidate(); bkCache.clear(); }

  function geo(req, url) { return resolveCountry(req, url, cfg, geoip); }
  const nameOf = (cc) => (cc === 'ZZ' ? 'your region' : countries.nameOf(cc));
  const NOCACHE = { 'Cache-Control': 'private, no-cache' };

  function applyTemplate(tpl, vars) {
    return String(tpl).replace(/\{(subid|country|match|placement)\}/g, (_, k) => encodeURIComponent(vars[k] == null ? '' : vars[k]));
  }

  function handleGo(req, res, url, id) {
    const g = geo(req, url), ip = http.clientIp(req, cfg.trustProxy);
    const item = getBk(g.code).items.find((b) => b.id === id);
    let dest = '';
    if (item) {
      const placement = String(url.searchParams.get('p') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
      const matchId = Number(url.searchParams.get('m')) > 0 ? Number(url.searchParams.get('m')) : 0;
      dest = applyTemplate(item.affiliate_url, { subid: 'lsn-' + (placement || 'x') + '-' + (matchId || 0), country: g.code, match: matchId || '', placement });
      if (!/^https?:\/\//i.test(dest)) dest = '';
      if (dest && goLimit(ip).ok && !BOT.test(req.headers['user-agent'] || '')) {
        try { db.run('INSERT INTO clicks (ts,bookmaker_id,country,match_id,placement) VALUES (?,?,?,?,?)', Math.floor(Date.now() / 1000), id, g.code, matchId || null, placement); } catch (e) { log('click log: ' + e.message); }
      }
    }
    // The destination is resolved per visitor country on the server; the URL never appears in page HTML.
    http.redirect(res, dest || '/', 302, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  }

  function sitemap() {
    const { leagues } = store.allForSitemap(), base = cfg.siteUrl, urls = ['/'];
    store.sports().forEach((s) => { if (s.id !== 'football') urls.push('/' + s.id + '/'); });
    leagues.forEach((l) => { urls.push('/' + l.sport + '/' + l.cslug + '/' + l.slug + '/'); urls.push('/' + l.sport + '/' + l.cslug + '/' + l.slug + '/standings/'); });
    ['about', 'contact', 'advertise', 'terms', 'privacy', 'cookies', 'responsible-gambling'].forEach((p) => urls.push('/' + p + '/'));
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map((u) => '<url><loc>' + U.esc(base + u) + '</loc></url>').join('') + '</urlset>';
  }

  // which league's standings does this URL need? (league standings tab, or a match page)
  function leagueIdFor(parts) {
    try {
      if (parts[0] === 'match' && /^\d+$/.test(parts[2] || '')) { const m = store.match(Number(parts[2])); return m && m.league.type === 'league' ? m.league.id : 0; }
      if (parts.length >= 3 && parts.length <= 4 && (parts[3] === undefined || parts[3] === 'standings')) { const l = store.league(parts[0], parts[1], parts[2]); return l && l.type === 'league' ? l.id : 0; }
    } catch (e) { /* ignore */ }
    return 0;
  }

  async function renderPage(req, res, url) {
    const g = geo(req, url), ck = http.parseCookies(req);
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (parts[0] === 'match' && /^\d+$/.test(parts[2] || '')) await Promise.race([sync.ensureDetail(Number(parts[2])), new Promise((r) => setTimeout(r, 2500))]);
      const lgId = leagueIdFor(parts);
      if (lgId) await Promise.race([sync.ensureStandings(lgId), new Promise((r) => setTimeout(r, 2500))]);
      if (parts[0] === 'team' && /^\d+$/.test(parts[2] || '') && parts[3] === 'squad') await Promise.race([sync.ensureSquad(Number(parts[2])), new Promise((r) => setTimeout(r, 2500))]);
    } catch (e) { /* page still renders with whatever is cached */ }
    const query = {};
    url.searchParams.forEach((v, k) => { if (!(k in query)) query[k] = v; });
    const out = pages.handle(store, { path: url.pathname, query, cookies: ck, cc: g.code, ccSource: g.source, countryName: nameOf(g.code), now: Math.floor(Date.now() / 1000), cfg: pageCfg, needConsent: consent.has(g.code), streamOn: cfg.syncEnabled });
    if (out.redirect) return http.redirect(res, out.redirect + (url.search && !out.redirect.includes('?') ? url.search : ''), out.status || 301);
    if (out.fragment != null) return http.send(req, res, 200, out.fragment, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, NOCACHE));
    const hdr = Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, NOCACHE);
    if (out.page && out.page.embed) { // widgets may be framed only by the origins you list (default: the forum)
      const allow = cfg.embedOrigins.concat(cfg.forumUrl ? [new URL(cfg.forumUrl).origin] : []);
      hdr['X-Frame-Options'] = null;
      hdr['Content-Security-Policy'] = "frame-ancestors 'self' " + allow.join(' ');
    }
    http.send(req, res, out.status, out.html, hdr);
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      const ip = http.clientIp(req, cfg.trustProxy);
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') return http.send(req, res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });

      if (p === '/healthz') return http.json(req, res, 200, { ok: true, provider: cfg.provider, live: hub.size() });
      if (p.startsWith('/assets/')) {
        if (http.serveStatic(req, res, path.join(pub, 'assets'), p.slice(8), { cache: 'public, max-age=86400' })) return;
        return http.send(req, res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      }
      if (p === '/favicon.ico') return http.redirect(res, '/assets/favicon.ico', 301);
      if (p === '/manifest.webmanifest') return http.send(req, res, 200, JSON.stringify({ name: cfg.siteName, short_name: cfg.siteName, start_url: '/', display: 'standalone', background_color: '#0b1f33', theme_color: '#0b1f33', icons: [{ src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/assets/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }, { src: '/assets/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] }), { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' });
      if (p === '/sw.js') { try { return http.send(req, res, 200, fs.readFileSync(path.join(pub, 'sw.js')), { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }); } catch (e) { return http.send(req, res, 404, 'Not found', { 'Content-Type': 'text/plain' }); } }
      if (p === '/robots.txt') return http.send(req, res, 200, 'User-agent: *\nDisallow: /go/\nDisallow: /admin\nDisallow: /api/\nDisallow: /search/\nSitemap: ' + cfg.siteUrl + '/sitemap.xml\n', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      if (p === '/sitemap.xml') return http.send(req, res, 200, sitemap(), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });

      if (p === '/admin' || p.startsWith('/admin/')) return adminApi.handle(req, res, url, ip);

      const mGo = p.match(/^\/go\/(\d+)\/?$/);
      if (mGo) return handleGo(req, res, url, Number(mGo[1]));

      if (p === '/set-region') {
        const cc = require('./geo/resolve').clean(url.searchParams.get('cc'));
        let next = url.searchParams.get('next') || '/';
        if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) next = '/';
        const hdr = { 'Cache-Control': 'no-store' };
        if (cc) hdr['Set-Cookie'] = http.cookie('lsn_cc', cc, { maxAge: 31536000 });
        return http.redirect(res, next, 302, hdr);
      }

      if (p.startsWith('/api/')) {
        if (!apiLimit(ip).ok && p !== '/api/stream') return http.json(req, res, 429, { error: 'rate limited' });
        if (p === '/api/stream') {
          const g = geo(req, url);
          return hub.add(req, res, { cc: g.code, ip });
        }
        if (p === '/api/countries') return http.json(req, res, 200, countryList.map((c) => [c.code, c.name]), { 'Cache-Control': 'public, max-age=86400' });
        if (p === '/api/geo') { const g = geo(req, url); const bk = getBk(g.code); return http.json(req, res, 200, { cc: g.code, name: nameOf(g.code), source: g.source, betting: bk.compliance.betting_allowed, bookmakers: bk.items.map((b) => b.name) }, NOCACHE); }
        if (p === '/api/teams') { // names for followed team ids (used to restore a "My teams" link on a new device)
          const ids = String(url.searchParams.get('ids') || '').split(',').map(Number).filter((n) => n > 0).slice(0, 60);
          return http.json(req, res, 200, Array.from(store.teamsByIds(ids).values()).map((t) => ({ id: t.id, name: t.name, slug: t.slug })), { 'Cache-Control': 'public, max-age=300' });
        }
        if (p === '/api/search') return http.json(req, res, 200, store.search(url.searchParams.get('q'), 6), { 'Cache-Control': 'public, max-age=30' });
        return http.json(req, res, 404, { error: 'not found' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return http.send(req, res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
      return await renderPage(req, res, url);
    } catch (e) {
      log('request error: ' + (e && e.stack || e));
      if (!res.headersSent) http.send(req, res, 500, '<h1>Something went wrong</h1><p><a href="/">Back to LiveScoreNow</a></p>', { 'Content-Type': 'text/html; charset=utf-8' });
      else try { res.end(); } catch (x) { /* ignore */ }
    }
  }
  return { handler, getBk, clearCaches, assetV };
}
module.exports = { create };
