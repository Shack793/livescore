'use strict';
// server/geo/geoip.js — self-hosted IP -> country lookup, no account or API needed.
//
// Data: the free "IP to Country Lite" CSV from DB-IP (https://db-ip.com/db/download/ip-to-country-lite,
// CC BY 4.0 — the site footer carries the required attribution). Run `npm run geoip:update` to download
// the latest month and load it into SQLite. Lookups are binary searches over in-memory arrays.
//
// CSV format (one range per line):  start_ip,end_ip,COUNTRY_CODE
const net = require('net');

function v4ToInt(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) { const v = Number(x); if (!/^\d+$/.test(x) || v > 255) return null; n = n * 256 + v; }
  return n;
}
function v6ToBig(ip) {
  if (ip.includes('%')) ip = ip.split('%')[0];
  // embedded IPv4 (::ffff:1.2.3.4 or 64:ff9b::1.2.3.4)
  const m = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) { const v = v4ToInt(m[2]); if (v == null) return null; ip = m[1] + ((v >>> 16).toString(16)) + ':' + ((v & 0xffff).toString(16)); }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 0) return null;
  const groups = halves.length === 2 ? head.concat(Array(fill).fill('0'), tail) : head;
  let n = 0n;
  for (const g of groups) { if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null; n = (n << 16n) + BigInt(parseInt(g, 16)); }
  return n;
}

class GeoIP {
  constructor() { this.v4 = { s: [], e: [], c: [] }; this.v6 = { s: [], e: [], c: [] }; this.count = 0; }

  load(rows) { // rows: [{family, start, end, cc}] with start/end as strings
    this.v4 = { s: [], e: [], c: [] }; this.v6 = { s: [], e: [], c: [] };
    const v4 = [], v6 = [];
    for (const r of rows) {
      if (r.family === 4) v4.push([Number(r.start), Number(r.end), r.cc]);
      else v6.push([BigInt(r.start), BigInt(r.end), r.cc]);
    }
    v4.sort((a, b) => a[0] - b[0]);
    v6.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    v4.forEach((x) => { this.v4.s.push(x[0]); this.v4.e.push(x[1]); this.v4.c.push(x[2]); });
    v6.forEach((x) => { this.v6.s.push(x[0]); this.v6.e.push(x[1]); this.v6.c.push(x[2]); });
    this.count = v4.length + v6.length;
    return this.count;
  }

  loadFromDb(db) { return this.load(db.all('SELECT family, start, end, cc FROM geoip')); }

  lookup(ip) {
    if (!ip || typeof ip !== 'string') return null;
    // Dual-stack servers report IPv4 visitors as ::ffff:a.b.c.d — treat those as plain IPv4.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) ip = mapped[1];
    const fam = net.isIP(ip.includes('%') ? ip.split('%')[0] : ip);
    if (!fam) return null;
    const t = fam === 4 ? this.v4 : this.v6;
    if (!t.s.length) return null;
    const key = fam === 4 ? v4ToInt(ip) : v6ToBig(ip);
    if (key == null) return null;
    let lo = 0, hi = t.s.length - 1, hit = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (t.s[mid] <= key) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
    if (hit < 0 || key > t.e[hit]) return null;
    const cc = t.c[hit];
    return cc && cc !== 'ZZ' ? cc : null;
  }
}

// Parse DB-IP CSV text into rows ready for the geoip table.
function parseCsv(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
    if (parts.length < 3) continue;
    const a = parts[0], b = parts[1], cc = parts[2].toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) continue;
    const fa = net.isIP(a), fb = net.isIP(b);
    if (!fa || fa !== fb) continue;
    if (fa === 4) { const s = v4ToInt(a), e = v4ToInt(b); if (s == null || e == null) continue; rows.push({ family: 4, start: String(s), end: String(e), cc }); }
    else { const s = v6ToBig(a), e = v6ToBig(b); if (s == null || e == null) continue; rows.push({ family: 6, start: s.toString(), end: e.toString(), cc }); }
  }
  return rows;
}

function saveToDb(db, rows) {
  db.tx(() => {
    db.run('DELETE FROM geoip');
    const ins = db.raw.prepare('INSERT INTO geoip (family, start, end, cc) VALUES (?,?,?,?)');
    for (const r of rows) ins.run(r.family, r.start, r.end, r.cc);
  });
}

module.exports = { GeoIP, parseCsv, saveToDb, v4ToInt, v6ToBig };
