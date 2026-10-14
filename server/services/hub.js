'use strict';
// server/services/hub.js — Server-Sent Events hub. Browsers keep ONE connection open to /api/stream.
//   event "m": score/status changes (same for everyone)
//   event "o": odds changes, computed PER COUNTRY so a visitor never receives odds from a bookmaker they may not see.
const odds = require('../../shared/odds');

function create({ store, getBk, maxPerIp, log }) {
  const clients = new Set();
  const perIp = new Map();
  let mq = new Set(), oq = new Set(), dq = new Set(), timer = null;
  let flushMs = 400;

  function write(c, ev, data) {
    try { c.res.write('event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { drop(c); }
  }
  function drop(c) {
    if (!clients.delete(c)) return;
    const n = (perIp.get(c.ip) || 1) - 1;
    if (n <= 0) perIp.delete(c.ip); else perIp.set(c.ip, n);
    try { c.res.end(); } catch (e) { /* ignore */ }
  }

  function add(req, res, { cc, ip }) {
    if ((perIp.get(ip) || 0) >= maxPerIp) { res.writeHead(429, { 'Retry-After': '30' }); res.end('Too many streams'); return null; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 4000\n\n');
    const c = { res, cc, ip };
    clients.add(c);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    write(c, 'hello', { t: Math.floor(Date.now() / 1000) });
    req.on('close', () => drop(c));
    res.on('error', () => drop(c));
    return c;
  }

  function flush() {
    timer = null;
    const m = Array.from(mq), o = Array.from(oq), d = Array.from(dq);
    mq = new Set(); oq = new Set(); dq = new Set();
    if (!clients.size) return;
    try {
      if (m.length) {
        const payload = store.matchesByIds(m).map((x) => ({ id: x.id, st: x.status, min: x.minute, p: x.period, hs: x.hs, as: x.as, h: x.home.id, a: x.away.id, hn: x.home.name, an: x.away.name, hh: x.hths, ha: x.htas, pe: x.periods }));
        clients.forEach((c) => write(c, 'm', payload));
      }
      if (d.length) clients.forEach((c) => write(c, 'd', d));
      if (o.length) {
        const ms = store.matchesByIds(o), rows = store.oddsRows(o), byCc = new Map();
        clients.forEach((c) => { let a = byCc.get(c.cc); if (!a) byCc.set(c.cc, a = []); a.push(c); });
        byCc.forEach((list, cc) => {
          const bk = getBk(cc);
          const items = ms.map((x) => {
            if (!bk.compliance.betting_allowed) return null;
            const p = odds.primary(rows.get(x.id) || [], bk.items, x.sport);
            return p ? { id: x.id, bk: p.bookmaker_id, bn: p.bookmaker_name, bs: (bk.items.find((b) => b.id === p.bookmaker_id) || {}).short_code, bc: (bk.items.find((b) => b.id === p.bookmaker_id) || {}).color, cells: p.cells } : { id: x.id, none: 1 };
          }).filter(Boolean);
          if (items.length) list.forEach((c) => write(c, 'o', items));
        });
      }
    } catch (e) { log && log('hub flush: ' + e.message); }
  }
  function schedule() { if (!timer) { timer = setTimeout(flush, flushMs); timer.unref && timer.unref(); } }

  const hb = setInterval(() => clients.forEach((c) => { try { c.res.write(': hb\n\n'); } catch (e) { drop(c); } }), 25000);
  hb.unref && hb.unref();

  return {
    add,
    matchesChanged(ids, detailOnly) { ids.forEach((i) => (detailOnly ? dq : mq).add(i)); schedule(); },
    oddsChanged(ids) { ids.forEach((i) => oq.add(i)); schedule(); },
    size() { return clients.size; },
    setFlushMs(n) { flushMs = n; },
    closeAll() { clearInterval(hb); Array.from(clients).forEach(drop); }
  };
}
module.exports = { create };
