// shared/util.js — isomorphic helpers (Node + browser). No DOM, no Node-only APIs.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LSN = root.LSN || {}; root.LSN.util = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function slugify(s) {
    var out = String(s || '')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return out || 'x';
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- deterministic PRNG ---------- */
  function hash32(str) {
    str = String(str);
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rng(seed) {
    var a = hash32(seed);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- time zones (Intl based, works for any IANA zone) ---------- */
  var dtfCache = {};
  function dtf(tz) {
    return dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
  }
  function validTz(tz) { try { dtf(tz); return true; } catch (e) { return false; } }
  function parts(tz, ts) {
    var p = {};
    dtf(tz).formatToParts(new Date(ts * 1000)).forEach(function (x) { if (x.type !== 'literal') p[x.type] = +x.value; });
    return p;
  }
  function tzOffsetMinutes(tz, ts) {
    var p = parts(tz, ts);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts * 1000) / 60000);
  }
  function dateStr(ts, tz) { var p = parts(tz || 'UTC', ts); return p.year + '-' + pad(p.month) + '-' + pad(p.day); }
  function dayStart(ds, tz) {
    var a = ds.split('-').map(Number);
    var guess = Date.UTC(a[0], a[1] - 1, a[2]) / 1000;
    var off = tzOffsetMinutes(tz, guess);
    var ts = guess - off * 60;
    var off2 = tzOffsetMinutes(tz, ts);
    if (off2 !== off) ts = guess - off2 * 60;
    return ts;
  }
  function addDays(ds, n) {
    var a = ds.split('-').map(Number);
    var t = new Date(Date.UTC(a[0], a[1] - 1, a[2] + n));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }
  function dayRange(ds, tz) { return [dayStart(ds, tz), dayStart(addDays(ds, 1), tz)]; }
  function fmtTime(ts, tz) { var p = parts(tz || 'UTC', ts); return pad(p.hour) + ':' + pad(p.minute); }
  function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')); }
  function dayLabel(ds) {
    var a = ds.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
      .format(new Date(Date.UTC(a[0], a[1] - 1, a[2]))).replace(',', '');
  }
  function longDate(ds) {
    var a = ds.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(a[0], a[1] - 1, a[2])));
  }

  /* ---------- flags ---------- */
  function flagUrl(code, w) {
    if (!code) return '';
    var map = { ENG: 'gb-eng', SCO: 'gb-sct', WAL: 'gb-wls', NIR: 'gb-nir' };
    var c = map[code] || String(code).toLowerCase();
    if (!/^[a-z]{2}(-[a-z]{3})?$/.test(c)) return '';
    return 'https://flagcdn.com/w' + (w || 20) + '/' + c + '.png';
  }

  /* ---------- odds formatting ---------- */
  var FRAC_DEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 25, 30, 40, 50, 100];
  function toFraction(dec) {
    var target = dec - 1, best = null;
    for (var i = 0; i < FRAC_DEN.length; i++) {
      var d = FRAC_DEN[i], n = Math.round(target * d);
      if (n < 1) continue;
      var err = Math.abs(n / d - target);
      if (!best || err < best.err - 1e-9) best = { n: n, d: d, err: err };
      if (err < 1e-9) break;
    }
    return best ? best.n + '/' + best.d : '1/100';
  }
  function formatOdd(v, fmt) {
    v = Number(v);
    if (!isFinite(v) || v < 1.01) return '–';
    if (fmt === 'fractional') return toFraction(v);
    if (fmt === 'american') return v >= 2 ? '+' + Math.round((v - 1) * 100) : '-' + Math.round(100 / (v - 1));
    return v.toFixed(2);
  }

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  return {
    esc: esc, slugify: slugify, pad: pad, hash32: hash32, rng: rng, clamp: clamp,
    validTz: validTz, tzOffsetMinutes: tzOffsetMinutes, dateStr: dateStr, dayStart: dayStart,
    addDays: addDays, dayRange: dayRange, fmtTime: fmtTime, isDateStr: isDateStr, dayLabel: dayLabel,
    longDate: longDate, flagUrl: flagUrl, formatOdd: formatOdd, toFraction: toFraction
  };
});
