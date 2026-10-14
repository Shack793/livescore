// shared/store-memory.js — the same read API as server/store-sqlite.js, backed by the demo world in memory.
// Used only by the standalone preview (index.html for Netlify). Not used by the real server.
(function (root, factory) {
  var dep = typeof require === 'function' && typeof module === 'object'
    ? { U: require('./util'), O: require('./odds'), W: require('./mock-world'), S: require('./seed-data') }
    : { U: root.LSN.util, O: root.LSN.odds, W: root.LSN.mockWorld, S: root.LSN.seed };
  var api = factory(dep);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LSN = root.LSN || {}; root.LSN.storeMemory = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var U = dep.U, DAY = 86400;
  var LIVE = { live: 1, halftime: 1, 'break': 1 };

  // opts: { countryName(code) -> string, regions: [{code,name,countries[]}], realtime }
  function create(opts) {
    opts = opts || {};
    var world = dep.W.createWorld({ realtime: !!opts.realtime });
    var ref = world.referenceData();
    var simNow = function () { return world.simNow(Math.floor(Date.now() / 1000)); };

    var countries = {}, countryList = [], leagues = [], leagueById = {}, leagueByRef = {}, teams = [], teamById = {}, teamByRef = {};
    ref.countries.forEach(function (c) {
      var name = c.name && c.name !== c.code ? c.name : (opts.countryName ? opts.countryName(c.code) : c.code);
      var o = { code: c.code, name: name, slug: c.name && c.name !== c.code ? c.slug : U.slugify(name), kind: c.kind || 'country' };
      countries[c.code] = o; countryList.push(o);
    });
    if (!countries.INT) { countries.INT = { code: 'INT', name: 'World', slug: 'world', kind: 'region' }; }
    ref.leagues.forEach(function (l, i) {
      var c = countries[l.countryCode];
      var o = { id: i + 1, ref: l.ref, name: l.name, slug: l.slug, type: l.type, season: l.season, top: l.top ? 1 : 0, active: 1, sport: l.sport, country: c };
      leagues.push(o); leagueById[o.id] = o; leagueByRef[l.ref] = o;
    });
    ref.teams.forEach(function (t, i) {
      var o = { id: i + 1, ref: t.ref, sport: t.sport, name: t.name, slug: t.slug, logo: '', country: t.countryCode && countries[t.countryCode] ? countries[t.countryCode] : null };
      teams.push(o); teamById[o.id] = o; teamByRef[t.ref] = o;
    });

    // ---- live window of matches (recomputed by refresh()) ----
    var sports = ref.sports, matchById = {}, matchByRef = {}, matchList = [], nextId = 1, oddsByMatch = new Map(), lastNow = 0;
    function shapeOf(st) {
      var lg = leagueByRef[st.leagueRef];
      var m = matchByRef[st.ref];
      if (!m) { m = { id: nextId++, ref: st.ref }; matchByRef[st.ref] = m; matchById[m.id] = m; }
      m.sport = st.sport; m.kickoff = st.kickoff; m.status = st.status; m.minute = st.minute == null ? null : st.minute; m.period = st.period == null ? null : st.period;
      m.hs = st.homeScore == null ? null : st.homeScore; m.as = st.awayScore == null ? null : st.awayScore; m.hths = st.htHome == null ? null : st.htHome; m.htas = st.htAway == null ? null : st.htAway;
      m.periods = st.periods || null; m.round = st.round || ''; m.season = st.season || '';
      m.league = { id: lg.id, name: lg.name, slug: lg.slug, type: lg.type, top: lg.top, active: 1, sport: lg.sport };
      m.country = lg.country; m.home = teamByRef[st.homeRef]; m.away = teamByRef[st.awayRef];
      m._st = st;
      return m;
    }
    function refresh() {
      var now = simNow(); lastNow = now;
      var changed = [], list = [];
      sports.forEach(function (s) {
        world.fixtures({ sport: s.id, from: now - 3 * DAY, to: now + 7 * DAY, now: now }).forEach(function (st) {
          var before = matchByRef[st.ref], sig = before ? [before.status, before.minute, before.period, before.hs, before.as].join('|') : '';
          var m = shapeOf(st);
          if (before && sig !== [m.status, m.minute, m.period, m.hs, m.as].join('|')) changed.push(m.id);
          list.push(m);
        });
      });
      list.sort(function (a, b) { return a.kickoff - b.kickoff || a.id - b.id; });
      matchList = list;
      return changed;
    }
    function refreshOdds() {
      var now = lastNow || simNow(), changedIds = [];
      var pool = matchList.filter(function (m) { return LIVE[m.status] || (m.status === 'scheduled' && m.kickoff < now + 2 * DAY); });
      var rows = world.odds({ matches: pool.map(function (m) { return m._st; }), now: now });
      var next = new Map();
      rows.forEach(function (r) {
        var m = matchByRef[r.matchRef]; if (!m) return;
        var a = next.get(m.id); if (!a) next.set(m.id, a = []);
        a.push({ match_id: m.id, bookmaker_ref: r.bookmaker, market: r.market, selection: r.selection, value: r.value, prev: r.prev });
      });
      next.forEach(function (arr, id) {
        var old = oddsByMatch.get(id);
        if (!old || old.some(function (o, i) { return !arr[i] || arr[i].value !== o.value; })) changedIds.push(id);
      });
      oddsByMatch = next;
      return changedIds;
    }
    refresh(); refreshOdds();

    var store = {
      kind: 'memory', refresh: refresh, refreshOdds: refreshOdds, world: world, simNow: simNow,
      invalidate: function () {},
      sports: function () { return sports; },
      setting: function (k, d) { return k === 'odds_format' ? 'decimal' : k === 'site_tagline' ? 'Live scores, fixtures & odds' : d; },
      isMock: function () { return true; },
      bookmakerConfig: function () { return { bookmakers: dep.S.bookmakers.map(function (b) { return Object.assign({ active: 1 }, b); }), rules: dep.S.rules.map(function (r) { return Object.assign({ affiliate_url: null, offer: null, license_text: null, sort_order: null }, r); }), regions: opts.regions || [], countryRules: dep.S.countryRules }; },
      adSlots: function () { return dep.S.adSlots.map(function (a) { return Object.assign({ ad_code: '', fallback_code: '', countries_include: '', countries_exclude: '', active: 1 }, a); }); },
      matches: function (o) {
        var out = matchList.filter(function (m) {
          if (o.sport && m.sport !== o.sport) return false;
          if (o.from != null && m.kickoff < o.from) return false;
          if (o.to != null && m.kickoff >= o.to) return false;
          if (o.leagueId && m.league.id !== o.leagueId) return false;
          if (o.teamId && m.home.id !== o.teamId && m.away.id !== o.teamId) return false;
          if (o.live && !LIVE[m.status]) return false;
          if (o.finished && m.status !== 'finished') return false;
          if (o.scheduled && m.status !== 'scheduled') return false;
          return true;
        });
        if (o.desc) out = out.slice().reverse();
        return o.limit ? out.slice(0, o.limit) : out;
      },
      match: function (id) { return matchById[id] || null; },
      matchesByIds: function (ids) { return ids.map(function (i) { return matchById[i]; }).filter(Boolean); },
      detail: function (id) {
        var m = matchById[id]; if (!m) return { events: [], stats: [], lineups: null, h2h: [] };
        var d = world.detail(m.ref, simNow()) || {};
        return { events: d.events || [], stats: d.stats || [], lineups: d.lineups || null, h2h: d.h2h || [], fetched_at: 0 };
      },
      standings: function (leagueId) {
        var lg = leagueById[leagueId]; if (!lg || lg.type !== 'league') return null;
        var g = world.standings(lg.ref, simNow()); if (!g || !g.length) return null;
        return { fetched_at: 0, groups: g.map(function (grp) { return { group: grp.group || '', rows: grp.rows.map(function (r) { return Object.assign({}, r, { teamId: (teamByRef[r.teamRef] || {}).id }); }).filter(function (r) { return r.teamId; }) }; }) };
      },
      squad: function (teamId) { var t = teamById[teamId]; return t ? world.squad(t.ref) : null; },
      menu: function (sport) {
        var by = {}, order = [];
        leagues.filter(function (l) { return l.sport === sport; }).forEach(function (l) {
          var g = by[l.country.code]; if (!g) { g = by[l.country.code] = { country: l.country, leagues: [] }; order.push(g); }
          g.leagues.push({ id: l.id, name: l.name, slug: l.slug, type: l.type, top: l.top });
        });
        order.sort(function (a, b) { return (b.country.kind === 'region' ? 1 : 0) - (a.country.kind === 'region' ? 1 : 0) || a.country.name.localeCompare(b.country.name); });
        order.forEach(function (g) { g.leagues.sort(function (a, b) { return b.top - a.top || a.name.localeCompare(b.name); }); });
        return order;
      },
      topLeagues: function (sport) { return leagues.filter(function (l) { return l.sport === sport && l.top; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (l) { return { id: l.id, name: l.name, slug: l.slug, country: l.country }; }); },
      league: function (sport, cslug, lslug) { var l = leagues.filter(function (x) { return x.sport === sport && x.country.slug === cslug && x.slug === lslug; })[0]; return l || null; },
      country: function (sport, slug) {
        var c = null; Object.keys(countries).forEach(function (k) { if (countries[k].slug === slug) c = countries[k]; });
        if (!c) return null;
        var ls = leagues.filter(function (l) { return l.sport === sport && l.country === c; }).sort(function (a, b) { return b.top - a.top || a.name.localeCompare(b.name); });
        return ls.length ? { code: c.code, name: c.name, slug: c.slug, kind: c.kind, leagues: ls } : null;
      },
      team: function (id) { return teamById[id] || null; },
      teamsByIds: function (ids) { var m = new Map(); ids.forEach(function (i) { if (teamById[i]) m.set(i, teamById[i]); }); return m; },
      teamLeagues: function (id) { var seen = {}, out = []; matchList.forEach(function (m) { if ((m.home.id === id || m.away.id === id) && !seen[m.league.id]) { seen[m.league.id] = 1; out.push(leagueById[m.league.id]); } }); return out; },
      oddsRows: function (ids) { var out = new Map(); ids.forEach(function (i) { if (oddsByMatch.has(i)) out.set(i, oddsByMatch.get(i)); }); return out; },
      liveCounts: function () { var o = {}; matchList.forEach(function (m) { if (LIVE[m.status]) o[m.sport] = (o[m.sport] || 0) + 1; }); return o; },
      search: function (q, limit) {
        q = String(q || '').trim().toLowerCase(); limit = limit || 8;
        if (q.length < 2) return { teams: [], leagues: [] };
        var t = teams.filter(function (x) { return x.name.toLowerCase().indexOf(q) !== -1; }).sort(function (a, b) { return (a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) || a.name.length - b.name.length; }).slice(0, limit);
        var l = leagues.filter(function (x) { return x.name.toLowerCase().indexOf(q) !== -1 || x.country.name.toLowerCase().indexOf(q) !== -1; }).slice(0, limit);
        return { teams: t, leagues: l };
      }
    };
    return store;
  }
  return { create: create };
});
