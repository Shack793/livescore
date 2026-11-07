'use strict';
// server/analytics.js — private, cookie-free visit statistics for the admin Reports tab.
// Raw IP addresses are NEVER stored. A visitor is counted as a short one-way hash of (secret + month + IP + browser),
// so we can count unique visitors per day/week/month without being able to recover who they are.
const crypto = require('crypto');
const countries = require('./geo/countries');

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|monitor|headless|curl|wget|python|java\/|httpclient/i;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

function create(db, cfg) {
  let secret = (db.get("SELECT value v FROM settings WHERE key='analytics_secret'") || {}).v;
  if (!secret) { secret = crypto.randomBytes(24).toString('hex'); db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('analytics_secret',?)", secret); }
  let n = 0;

  function pageGroup(pathname) {
    const parts = String(pathname || '/').split('/').filter(Boolean);
    if (!parts.length) return '/';
    if (parts[0] === 'match' || parts[0] === 'team') return '/' + parts[0] + '/';
    return ('/' + parts.slice(0, 3).join('/') + '/').slice(0, 120);
  }
  function refHost(req) {
    try {
      const h = new URL(String(req.headers.referer || '')).hostname.replace(/^www\./, '').toLowerCase();
      const own = new URL(cfg.siteUrl).hostname.replace(/^www\./, '').toLowerCase();
      return !h || h === own ? '' : h.slice(0, 80);
    } catch (e) { return ''; }
  }

  function record(req, pathname, cc, ip) {
    try {
      const ua = String(req.headers['user-agent'] || '');
      if (!ua || BOT.test(ua)) return;
      const now = Date.now(), day = dayOf(now), cty = (cc || 'ZZ').toUpperCase().slice(0, 2);
      const vid = crypto.createHash('sha256').update(secret + day.slice(0, 7) + String(ip || '') + ua).digest('hex').slice(0, 16);
      db.tx(() => {
        db.run('INSERT OR IGNORE INTO visitors_seen (vid,day,country) VALUES (?,?,?)', vid, day, cty);
        db.run('INSERT INTO traffic_daily (day,country,views) VALUES (?,?,1) ON CONFLICT(day,country) DO UPDATE SET views=views+1', day, cty);
        db.run('INSERT INTO pages_daily (day,page,views) VALUES (?,?,1) ON CONFLICT(day,page) DO UPDATE SET views=views+1', day, pageGroup(pathname));
        const rh = refHost(req);
        if (rh) db.run('INSERT INTO refs_daily (day,host,views) VALUES (?,?,1) ON CONFLICT(day,host) DO UPDATE SET views=views+1', day, rh);
      });
      if (++n % 2000 === 0) prune();
    } catch (e) { /* statistics must never break a page */ }
  }

  // keep 14 months
  function prune() {
    try {
      const cut = dayOf(Date.now() - 430 * 86400000);
      ['traffic_daily', 'visitors_seen', 'pages_daily', 'refs_daily'].forEach((t) => db.run('DELETE FROM ' + t + ' WHERE day<?', cut));
    } catch (e) { /* ignore */ }
  }

  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  function range(from, to, days) {
    const today = dayOf(Date.now());
    to = okDate(to) ? to : today;
    if (!okDate(from)) from = dayOf(Date.parse(to + 'T00:00:00Z') - (Math.max(1, Math.min(400, days || 30)) - 1) * 86400000);
    if (from > to) { const t = from; from = to; to = t; }
    if (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z') > 400 * 86400000) from = dayOf(Date.parse(to + 'T00:00:00Z') - 400 * 86400000);
    return { from, to };
  }

  function report(q) {
    const r = range(q.from, q.to, q.days), f = r.from, t = r.to;
    const A = [f, t], W = 'day>=? AND day<=?';
    const sumViews = (where) => db.get('SELECT COALESCE(SUM(views),0) n FROM traffic_daily WHERE ' + where, ...A).n;
    const cts = Math.floor(Date.parse(f + 'T00:00:00Z') / 1000), cte = Math.floor(Date.parse(t + 'T00:00:00Z') / 1000) + 86400;
    const nm = (c) => (c === 'ZZ' || !c ? 'Unknown' : countries.nameOf(c));
    const byDay = db.all('SELECT day d, SUM(views) views FROM traffic_daily WHERE ' + W + ' GROUP BY day ORDER BY day', ...A);
    const uDay = new Map(db.all('SELECT day d, COUNT(*) n FROM visitors_seen WHERE ' + W + ' GROUP BY day', ...A).map((x) => [x.d, x.n]));
    const grp = (expr) => {
      const v = new Map(db.all('SELECT ' + expr + ' g, SUM(views) views FROM traffic_daily WHERE ' + W + ' GROUP BY g', ...A).map((x) => [x.g, x.views]));
      const u = new Map(db.all('SELECT ' + expr + ' g, COUNT(DISTINCT vid) n FROM visitors_seen WHERE ' + W + ' GROUP BY g', ...A).map((x) => [x.g, x.n]));
      return Array.from(v.keys()).sort().map((g) => ({ label: g, views: v.get(g), visitors: u.get(g) || 0 }));
    };
    const vc = new Map(db.all('SELECT country c, COUNT(DISTINCT vid) n FROM visitors_seen WHERE ' + W + ' GROUP BY country', ...A).map((x) => [x.c, x.n]));
    const cc = new Map(db.all('SELECT country c, COUNT(*) n FROM clicks WHERE ts>=? AND ts<? GROUP BY country', cts, cte).map((x) => [x.c, x.n]));
    const byCountry = db.all('SELECT country c, SUM(views) views FROM traffic_daily WHERE ' + W + ' GROUP BY country ORDER BY views DESC', ...A)
      .map((x) => ({ code: x.c, country: nm(x.c), views: x.views, visitors: vc.get(x.c) || 0, clicks: cc.get(x.c) || 0 }));
    return {
      from: f, to: t,
      totals: { views: sumViews(W), visitors: db.get('SELECT COUNT(DISTINCT vid) n FROM visitors_seen WHERE ' + W, ...A).n, visitorDays: db.get('SELECT COUNT(*) n FROM visitors_seen WHERE ' + W, ...A).n, clicks: db.get('SELECT COUNT(*) n FROM clicks WHERE ts>=? AND ts<?', cts, cte).n },
      byDay: byDay.map((x) => ({ label: x.d, views: x.views, visitors: uDay.get(x.d) || 0 })),
      byWeek: grp("date(day,'weekday 0','-6 days')"),
      byMonth: grp('substr(day,1,7)'),
      byCountry,
      pages: db.all('SELECT page, SUM(views) views FROM pages_daily WHERE ' + W + ' GROUP BY page ORDER BY views DESC LIMIT 30', ...A),
      referrers: db.all('SELECT host, SUM(views) views FROM refs_daily WHERE ' + W + ' GROUP BY host ORDER BY views DESC LIMIT 20', ...A),
      clicksByBookmaker: db.all('SELECT b.name name, COUNT(*) n FROM clicks c JOIN bookmakers b ON b.id=c.bookmaker_id WHERE c.ts>=? AND c.ts<? GROUP BY b.id ORDER BY n DESC', cts, cte)
    };
  }

  // quick numbers for the dashboard: today, last 7 days, last 30 days
  function summary() {
    const today = dayOf(Date.now()), pick = (d) => report({ days: d, to: today }).totals;
    return { today: pick(1), week: pick(7), month: pick(30) };
  }

  function csv(q) {
    const r = report(q), by = String(q.by || 'day');
    const esc = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    let head, rows;
    if (by === 'country') { head = ['Country', 'Code', 'Page views', 'Unique visitors', 'Affiliate clicks']; rows = r.byCountry.map((x) => [x.country, x.code, x.views, x.visitors, x.clicks]); }
    else if (by === 'pages') { head = ['Page', 'Page views']; rows = r.pages.map((x) => [x.page, x.views]); }
    else if (by === 'referrers') { head = ['Referrer', 'Page views']; rows = r.referrers.map((x) => [x.host, x.views]); }
    else { const k = by === 'week' ? 'byWeek' : by === 'month' ? 'byMonth' : 'byDay'; head = [k === 'byWeek' ? 'Week starting' : k === 'byMonth' ? 'Month' : 'Day', 'Page views', 'Unique visitors']; rows = r[k].map((x) => [x.label, x.views, x.visitors]); }
    return '﻿' + [head].concat(rows).map((l) => l.map(esc).join(',')).join('\r\n') + '\r\n';
  }
  return { record, report, summary, csv, prune };
}
module.exports = { create };
