'use strict';
// server/admin.js — password-protected admin (HTTP Basic) + JSON API. Mutating requests also need the header
// "X-LSN-Admin: 1" (a custom header cannot be sent cross-site without CORS approval, which blocks CSRF).
const path = require('path');
const http = require('./lib/http');
const countries = require('./geo/countries');
const B = require('../shared/bookmakers');

function create({ cfg, db, store, sync, hub, geoip, log, getBk, clearCaches }) {
  const pub = path.join(cfg.root, 'public', 'admin');
  const fails = http.makeLimiter(10, 15 * 60 * 1000);
  const err = (code, msg) => Object.assign(new Error(msg), { code });
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 500);
  const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
  const url = (v, req) => { v = str(v, 1500); if (req && !v) throw err(400, 'URL is required'); if (v && !/^https?:\/\//i.test(v)) throw err(400, 'URLs must start with http:// or https://'); return v; };
  const ccList = (v) => str(v, 2000).split(/[\s,;]+/).map((x) => x.toUpperCase()).filter(Boolean).filter((x) => countries.isValid(x)).join(',');
  const regionCodes = () => new Set(db.all('SELECT code FROM regions').map((r) => r.code));

  function auth(req, res, ip) {
    if (!cfg.adminPass) { http.send(req, res, 503, 'Admin is disabled: set ADMIN_PASS in .env and restart.', { 'Content-Type': 'text/plain' }); return false; }
    const c = http.parseBasic(req);
    const ok = c && http.safeEqual(c.user, cfg.adminUser) && http.safeEqual(c.pass, cfg.adminPass);
    if (ok) return true;
    const l = fails(ip);
    if (!l.ok) { http.send(req, res, 429, 'Too many failed attempts. Try again later.', { 'Content-Type': 'text/plain', 'Retry-After': String(l.retry) }); return false; }
    http.send(req, res, 401, 'Authentication required', { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Basic realm="LiveScoreNow admin", charset="UTF-8"', 'Cache-Control': 'no-store' });
    return false;
  }

  /* ---------- bookmakers ---------- */
  function readBookmaker(row) {
    const rules = db.all('SELECT scope_type,scope_value,mode,affiliate_url,offer,license_text,sort_order FROM bookmaker_geo WHERE bookmaker_id=? ORDER BY scope_type,scope_value', row.id);
    return Object.assign({}, row, { rules });
  }
  function saveBookmaker(id, b) {
    const name = str(b.name, 80); if (!name) throw err(400, 'Name is required');
    const rec = [name, str(b.short_code || name.slice(0, 2).toUpperCase(), 4), str(b.color, 9), url(b.logo_url), str(b.provider_ref, 80), url(b.affiliate_url, true), str(b.offer, 200), url(b.terms_url), str(b.license_text, 500), flag(b.active), int(b.sort_order, 0)];
    const regions = regionCodes();
    const rules = (Array.isArray(b.rules) ? b.rules : []).map((r) => {
      const t = str(r.scope_type, 10), v = t === 'all' ? '*' : str(r.scope_value, 40).toUpperCase();
      if (!['country', 'region', 'all'].includes(t)) throw err(400, 'Bad rule scope');
      if (t === 'country' && !countries.isValid(v)) throw err(400, 'Unknown country code ' + v);
      if (t === 'region' && !regions.has(v)) throw err(400, 'Unknown region ' + v);
      const mode = r.mode === 'block' ? 'block' : 'allow';
      return [t, v, mode, r.affiliate_url ? url(r.affiliate_url) : null, r.offer ? str(r.offer, 200) : null, r.license_text ? str(r.license_text, 500) : null, r.sort_order === '' || r.sort_order == null ? null : int(r.sort_order, null)];
    });
    return db.tx(() => {
      if (id) db.run("UPDATE bookmakers SET name=?,short_code=?,color=?,logo_url=?,provider_ref=?,affiliate_url=?,offer=?,terms_url=?,license_text=?,active=?,sort_order=?,updated_at=datetime('now') WHERE id=?", ...rec, id);
      else id = Number(db.run('INSERT INTO bookmakers (name,short_code,color,logo_url,provider_ref,affiliate_url,offer,terms_url,license_text,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...rec).lastInsertRowid);
      db.run('DELETE FROM bookmaker_geo WHERE bookmaker_id=?', id);
      const seen = new Set();
      rules.forEach((r) => { const k = r[0] + ':' + r[1]; if (seen.has(k)) return; seen.add(k); db.run('INSERT INTO bookmaker_geo (bookmaker_id,scope_type,scope_value,mode,affiliate_url,offer,license_text,sort_order) VALUES (?,?,?,?,?,?,?,?)', id, ...r); });
      return id;
    });
  }

  /* ---------- API ---------- */
  async function api(req, res, u, ip) {
    const parts = u.pathname.replace(/^\/admin\/api\//, '').split('/').filter(Boolean);
    const m = req.method, a = parts[0], b = parts[1];
    const ok = (o) => http.json(req, res, 200, o === undefined ? { ok: true } : o, { 'Cache-Control': 'no-store' });
    const body = m === 'GET' || m === 'DELETE' ? {} : await http.readJson(req, 200000);

    if (a === 'meta' && m === 'GET') {
      return ok({
        countries: countries.list().map((c) => [c.code, c.name]),
        regions: db.all('SELECT * FROM regions ORDER BY name').map((r) => ({ code: r.code, name: r.name, countries: r.countries.split(',').filter(Boolean) })),
        countryRules: db.all('SELECT * FROM country_rules ORDER BY country_code'),
        feedBookmakers: db.all('SELECT * FROM feed_bookmakers ORDER BY name'),
        settings: db.all('SELECT key,value FROM settings').reduce((o, r) => { o[r.key] = r.value; return o; }, {}),
        provider: cfg.provider, mock: store.isMock()
      });
    }
    if (a === 'bookmakers') {
      if (m === 'GET' && !b) return ok(db.all('SELECT * FROM bookmakers ORDER BY sort_order,id').map(readBookmaker));
      if ((m === 'POST' && !b) || (m === 'PUT' && b)) { const id = saveBookmaker(b ? int(b) : 0, body); clearCaches(); return ok(readBookmaker(db.get('SELECT * FROM bookmakers WHERE id=?', id))); }
      if (m === 'DELETE' && b) { db.run('DELETE FROM bookmakers WHERE id=?', int(b)); clearCaches(); return ok(); }
    }
    if (a === 'resolve' && m === 'GET') { // "what would a visitor in X see?"
      const cc = str(u.searchParams.get('cc'), 2).toUpperCase();
      if (!countries.isValid(cc)) throw err(400, 'Unknown country code');
      const r = B.resolve(store.bookmakerConfig(), cc);
      return ok({ country: cc, name: countries.nameOf(cc), compliance: r.compliance, bookmakers: r.items.map((x) => ({ id: x.id, name: x.name, offer: x.offer, affiliate_url: x.affiliate_url })) });
    }
    if (a === 'regions') {
      if (m === 'PUT' && b) {
        const code = str(b, 30).toUpperCase().replace(/[^A-Z0-9_]/g, ''); if (!code) throw err(400, 'Bad code');
        db.run('INSERT INTO regions (code,name,countries) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, countries=excluded.countries', code, str(body.name, 80) || code, ccList(Array.isArray(body.countries) ? body.countries.join(',') : body.countries));
        clearCaches(); return ok();
      }
      if (m === 'DELETE' && b) { db.run('DELETE FROM regions WHERE code=?', str(b, 30)); db.run("DELETE FROM bookmaker_geo WHERE scope_type='region' AND scope_value=?", str(b, 30)); clearCaches(); return ok(); }
    }
    if (a === 'country-rules') {
      const cc = str(b, 2).toUpperCase();
      if (m === 'PUT' && b) {
        if (!countries.isValid(cc)) throw err(400, 'Unknown country code');
        db.run('INSERT INTO country_rules (country_code,betting_content,min_age,rg_text,rg_url,license_text) VALUES (?,?,?,?,?,?) ON CONFLICT(country_code) DO UPDATE SET betting_content=excluded.betting_content, min_age=excluded.min_age, rg_text=excluded.rg_text, rg_url=excluded.rg_url, license_text=excluded.license_text',
          cc, flag(body.betting_content), Math.max(16, Math.min(25, int(body.min_age, 18))), str(body.rg_text, 400), url(body.rg_url), str(body.license_text, 500));
        clearCaches(); return ok();
      }
      if (m === 'DELETE' && b) { db.run('DELETE FROM country_rules WHERE country_code=?', cc); clearCaches(); return ok(); }
    }
    if (a === 'ad-slots') {
      if (m === 'GET') return ok(db.all('SELECT * FROM ad_slots ORDER BY sort_order'));
      if (m === 'PUT' && b) {
        const key = str(b, 40).toLowerCase().replace(/[^a-z0-9-]/g, ''); if (!key) throw err(400, 'Bad slot key');
        const old = db.get('SELECT * FROM ad_slots WHERE slot_key=?', key);
        const rec = [str(body.label, 80) || key, str(body.placement, 20) || (old ? old.placement : 'sidebar'), int(body.width, 0), int(body.height, 0), String(body.ad_code == null ? '' : body.ad_code).slice(0, 20000), String(body.fallback_code == null ? '' : body.fallback_code).slice(0, 20000), flag(body.betting_related), ccList(body.countries_include), ccList(body.countries_exclude), flag(body.active), int(body.sort_order, 0)];
        db.run(`INSERT INTO ad_slots (slot_key,label,placement,width,height,ad_code,fallback_code,betting_related,countries_include,countries_exclude,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(slot_key) DO UPDATE SET label=excluded.label,placement=excluded.placement,width=excluded.width,height=excluded.height,ad_code=excluded.ad_code,fallback_code=excluded.fallback_code,betting_related=excluded.betting_related,countries_include=excluded.countries_include,countries_exclude=excluded.countries_exclude,active=excluded.active,sort_order=excluded.sort_order,updated_at=datetime('now')`, key, ...rec);
        clearCaches(); return ok();
      }
      if (m === 'DELETE' && b) { db.run('DELETE FROM ad_slots WHERE slot_key=?', str(b, 40)); clearCaches(); return ok(); }
    }
    if (a === 'leagues') {
      if (m === 'GET') {
        const q = '%' + str(u.searchParams.get('q'), 60).replace(/[%_]/g, ' ') + '%';
        return ok(db.all(`SELECT l.id,l.name,l.sport,l.top,l.active,l.type,c.name country FROM leagues l JOIN countries c ON c.id=l.country_id WHERE l.name LIKE ? OR c.name LIKE ? ORDER BY l.top DESC, c.name, l.name LIMIT 300`, q, q));
      }
      if (m === 'PUT' && b) { db.run('UPDATE leagues SET top=?, active=? WHERE id=?', flag(body.top), flag(body.active), int(b)); clearCaches(); return ok(); }
    }
    if (a === 'settings' && m === 'PUT') {
      ['odds_format', 'site_tagline', 'footer_note'].forEach((k) => { if (body[k] != null) db.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, k === 'odds_format' ? (['decimal', 'fractional', 'american'].includes(body[k]) ? body[k] : 'decimal') : str(body[k], 200)); });
      clearCaches(); return ok();
    }
    if (a === 'status' && m === 'GET') {
      const n = (t) => db.get('SELECT COUNT(*) n FROM ' + t).n;
      return ok({ sync: sync.status(), jobs: sync.jobs, viewers: hub.size(), geoipRanges: geoip.count, counts: { sports: n('sports'), countries: n('countries'), leagues: n('leagues'), teams: n('teams'), matches: n('matches'), odds: n('odds_current'), clicks: n('clicks') } });
    }
    if (a === 'sync' && m === 'POST' && b) { if (!sync.jobs.includes(b)) throw err(404, 'Unknown job'); sync.runJob(b); return ok(); }
    if (a === 'clicks' && m === 'GET') {
      const days = Math.max(1, Math.min(365, int(u.searchParams.get('days'), 7))), since = Math.floor(Date.now() / 1000) - days * 86400;
      return ok({
        days, total: db.get('SELECT COUNT(*) n FROM clicks WHERE ts>=?', since).n,
        byBookmaker: db.all('SELECT b.name name, COUNT(*) n FROM clicks c JOIN bookmakers b ON b.id=c.bookmaker_id WHERE c.ts>=? GROUP BY b.id ORDER BY n DESC', since),
        byCountry: db.all('SELECT country, COUNT(*) n FROM clicks WHERE ts>=? GROUP BY country ORDER BY n DESC LIMIT 30', since),
        byPlacement: db.all("SELECT placement, COUNT(*) n FROM clicks WHERE ts>=? GROUP BY placement ORDER BY n DESC LIMIT 30", since),
        byDay: db.all("SELECT strftime('%Y-%m-%d', ts, 'unixepoch') d, COUNT(*) n FROM clicks WHERE ts>=? GROUP BY d ORDER BY d", since)
      });
    }
    throw err(404, 'Not found');
  }

  async function handle(req, res, u, ip) {
    if (!auth(req, res, ip)) return;
    const p = u.pathname;
    if (p.startsWith('/admin/api/')) {
      if (req.method !== 'GET' && req.headers['x-lsn-admin'] !== '1') return http.json(req, res, 403, { error: 'Missing X-LSN-Admin header' });
      try { return await api(req, res, u, ip); }
      catch (e) { const code = e.code && Number.isInteger(e.code) ? e.code : 500; if (code === 500) log('admin error: ' + (e.stack || e)); return http.json(req, res, code, { error: code === 500 ? 'Server error' : e.message }); }
    }
    const rel = p === '/admin' || p === '/admin/' ? 'index.html' : p.replace(/^\/admin\//, '');
    if (!http.serveStatic(req, res, pub, rel, { cache: 'no-store' })) http.send(req, res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  }
  return { handle };
}
module.exports = { create };
