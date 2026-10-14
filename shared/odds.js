// shared/odds.js — odds helpers shared by server, browser and preview.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LSN = root.LSN || {}; root.LSN.odds = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Which market appears in the match list for each sport.
  var MAIN_MARKET = {
    football:           { market: '1x2', sels: ['1', 'X', '2'], labels: ['1', 'X', '2'] },
    handball:           { market: '1x2', sels: ['1', 'X', '2'], labels: ['1', 'X', '2'] },
    basketball:         { market: 'ml',  sels: ['1', '2'],      labels: ['1', '2'] },
    tennis:             { market: 'ml',  sels: ['1', '2'],      labels: ['1', '2'] },
    hockey:             { market: 'ml',  sels: ['1', '2'],      labels: ['1', '2'] },
    'american-football':{ market: 'ml',  sels: ['1', '2'],      labels: ['1', '2'] },
    baseball:           { market: 'ml',  sels: ['1', '2'],      labels: ['1', '2'] },
    volleyball:         { market: 'ml',  sels: ['1', '2'],      labels: ['1', '2'] },
    rugby:              { market: 'ml',  sels: ['1', '2'],      labels: ['1', '2'] }
  };

  var MARKET_TITLES = { '1x2': 'Match result', 'ml': 'Winner', 'ou25': 'Over/Under 2.5 goals', 'btts': 'Both teams to score' };
  var MARKET_SELS = {
    '1x2': [['1', 'Home'], ['X', 'Draw'], ['2', 'Away']],
    'ml':  [['1', 'Home'], ['2', 'Away']],
    'ou25': [['O', 'Over 2.5'], ['U', 'Under 2.5']],
    'btts': [['Y', 'Yes'], ['N', 'No']]
  };

  // rows: [{bookmaker_ref, market, selection, value, prev}] -> nested index
  function index(rows) {
    var idx = {};
    (rows || []).forEach(function (r) {
      var b = idx[r.bookmaker_ref] || (idx[r.bookmaker_ref] = {});
      var m = b[r.market] || (b[r.market] = {});
      m[r.selection] = { value: Number(r.value), prev: r.prev == null ? null : Number(r.prev) };
    });
    return idx;
  }

  // First visible bookmaker (by priority) that has the sport's main market.
  function primary(rows, bkItems, sport) {
    var cfg = MAIN_MARKET[sport] || MAIN_MARKET.football;
    var idx = index(rows);
    for (var i = 0; i < bkItems.length; i++) {
      var b = bkItems[i];
      if (!b.provider_ref) continue;
      var m = idx[b.provider_ref] && idx[b.provider_ref][cfg.market];
      if (!m) continue;
      var ok = cfg.sels.every(function (s) { return m[s] && isFinite(m[s].value); });
      if (!ok) continue;
      return {
        bookmaker_id: b.id, bookmaker_name: b.name, market: cfg.market,
        cells: cfg.sels.map(function (s) {
          var c = m[s];
          var trend = c.prev == null || c.prev === c.value ? '' : (c.value > c.prev ? 'up' : 'down');
          return { sel: s, value: c.value, trend: trend };
        })
      };
    }
    return null;
  }

  // Full comparison for the match page: market -> selection -> [{bookmaker, value}] + best.
  function comparison(rows, bkItems) {
    var idx = index(rows);
    var out = [];
    Object.keys(MARKET_SELS).forEach(function (market) {
      var lines = [];
      bkItems.forEach(function (b) {
        var m = b.provider_ref && idx[b.provider_ref] && idx[b.provider_ref][market];
        if (!m) return;
        var vals = MARKET_SELS[market].map(function (s) { return m[s[0]] ? m[s[0]] : null; });
        if (vals.every(function (v) { return !v; })) return;
        lines.push({ bookmaker: b, values: vals });
      });
      if (!lines.length) return;
      var best = MARKET_SELS[market].map(function (s, i) {
        var mx = 0;
        lines.forEach(function (l) { if (l.values[i] && l.values[i].value > mx) mx = l.values[i].value; });
        return mx;
      });
      out.push({ market: market, title: MARKET_TITLES[market], selections: MARKET_SELS[market], lines: lines, best: best });
    });
    return out;
  }

  return { MAIN_MARKET: MAIN_MARKET, MARKET_TITLES: MARKET_TITLES, MARKET_SELS: MARKET_SELS, index: index, primary: primary, comparison: comparison };
});
