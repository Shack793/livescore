// shared/mock-world.js — deterministic demo world (leagues, teams, fixtures, live simulation,
// events, stats, lineups, standings, squads, bookmaker odds). Pure functions: runs in Node
// (demo provider) AND in the browser (standalone Netlify preview).
//
// Everything is derived from (match ref, simulated clock), so the same input always gives the
// same output and nothing needs to be stored. In the default "cycle" clock mode the simulated
// clock loops through a 14:00-21:00 window every 7 hours, so there are always live matches to
// look at. Pass { realtime: true } to use the real clock instead.
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LSN = root.LSN || {}; root.LSN.mockWorld = api; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var U = isNode ? require('./util') : root.LSN.util;
  var D = isNode ? require('./mock-data') : root.LSN.mockData;

  function poisson(lambda, r) {
    var L = Math.exp(-lambda), k = 0, p = 1;
    do { k++; p *= r(); } while (p > L && k < 40);
    return k - 1;
  }
  function pmf(l, k) { var f = 1; for (var i = 2; i <= k; i++) f *= i; return Math.exp(-l) * Math.pow(l, k) / f; }
  function shuffle(arr, r) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function pick(arr, r) { return arr[Math.floor(r() * arr.length)]; }
  function weighted(items, weights, r) {
    var tot = 0, i; for (i = 0; i < weights.length; i++) tot += weights[i];
    var x = r() * tot;
    for (i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
    return items[items.length - 1];
  }
  function dayNum(ds) { return Math.floor(Date.parse(ds + 'T00:00:00Z') / 86400000); }
  function dayTs(ds) { return Date.parse(ds + 'T00:00:00Z') / 1000; }
  function slotSeconds(s) { var a = s.split(':'); return (+a[0]) * 3600 + (+a[1]) * 60; }

  function createWorld(opts) {
    opts = opts || {};
    var realtime = !!opts.realtime;

    /* ------------------------------------------------------------------ definitions */
    var countries = {};
    function addCountry(code, name) {
      if (!countries[code]) countries[code] = { code: code, name: name, slug: U.slugify(name), kind: (code === 'EUR' || code === 'AFR' || code === 'ATP' || code === 'WTA') ? 'region' : 'country', flag: code };
    }
    var leagues = [], leagueByRef = {}, teams = {}, teamList = [];

    function addTeam(sport, name, code, rating) {
      var ref = sport + ':' + U.slugify(name);
      if (!teams[ref]) {
        teams[ref] = { ref: ref, sport: sport, name: name, slug: U.slugify(name), countryCode: code, rating: rating };
        teamList.push(teams[ref]);
      }
      return teams[ref];
    }
    function addLeague(sport, def, type, teamRefs) {
      var lg = {
        ref: sport + ':' + U.slugify(def.country) + ':' + U.slugify(def.name), sport: sport, countryCode: def.code, countryName: def.country,
        name: def.name, slug: U.slugify(def.name), type: type, top: def.top ? 1 : 0, season: def.season, def: def, teamRefs: teamRefs
      };
      addCountry(def.code, def.country);
      leagues.push(lg); leagueByRef[lg.ref] = lg;
      return lg;
    }
    function ratingFor(ref, i, n) { return U.clamp(0.88 - 0.5 * (n > 1 ? i / (n - 1) : 0) + (U.rng('rate:' + ref)() - 0.5) * 0.08, 0.2, 0.95); }

    D.FOOTBALL.forEach(function (def) {
      var refs = def.teams.map(function (nm, i) { return addTeam('football', nm, def.code, ratingFor('football:' + nm, i, def.teams.length)).ref; });
      addLeague('football', def, 'league', refs);
    });
    D.EXTRA_CLUBS.forEach(function (c, i) { addTeam('football', c[0], c[1], U.clamp(0.78 - i * 0.02, 0.5, 0.85)); addCountry(c[1], c[1]); });
    D.CUPS.forEach(function (def) {
      var refs = def.teams.map(function (nm) { return 'football:' + U.slugify(nm); });
      addLeague('football', def, 'cup', refs);
    });
    Object.keys(D.TEAM_SPORTS).forEach(function (sport) {
      var cfg = D.TEAM_SPORTS[sport];
      cfg.leagues.forEach(function (def) {
        var refs = def.teams.map(function (nm, i) { return addTeam(sport, nm, def.code, ratingFor(sport + ':' + nm, i, def.teams.length)).ref; });
        var lg = addLeague(sport, def, 'league', refs); lg.cfg = cfg;
      });
    });
    (function () {
      var def = D.VOLLEYBALL;
      var refs = def.teams.map(function (nm, i) { return addTeam('volleyball', nm, def.code, ratingFor('volleyball:' + nm, i, def.teams.length)).ref; });
      addLeague('volleyball', def, 'league', refs);
    })();
    D.TENNIS.forEach(function (def) {
      var refs = def.players.map(function (nm, i) { return addTeam('tennis', nm, 'INT', ratingFor('tennis:' + nm, i, def.players.length)).ref; });
      addLeague('tennis', def, 'cup', refs);
    });

    function rating(ref) { return teams[ref] ? teams[ref].rating : 0.5; }

    /* ------------------------------------------------------------------ clock */
    function simNow(realTs) {
      if (realtime) return realTs;
      var day = Math.floor(realTs / 86400) * 86400;
      return day + 14 * 3600 + ((realTs - day) % (7 * 3600));
    }

    /* ------------------------------------------------------------------ squads */
    var squadCache = {};
    function poolFor(teamRef) {
      var t = teams[teamRef]; var key = D.COUNTRY_POOL[t && t.countryCode] || 'en';
      return D.NAME_POOLS[key];
    }
    function squad(teamRef) {
      if (squadCache[teamRef]) return squadCache[teamRef];
      var t = teams[teamRef], r = U.rng('squad:' + teamRef), pool = poolFor(teamRef), out = [];
      var plan = t && t.sport === 'football'
        ? [['GK', 3], ['DF', 8], ['MF', 8], ['FW', 5]]
        : t && t.sport === 'tennis' ? [] : [['P', 14]];
      var used = {};
      var nums = shuffle(Array.apply(null, Array(40)).map(function (_, i) { return i + 1; }), r);
      var ni = 0;
      plan.forEach(function (p) {
        for (var i = 0; i < p[1]; i++) {
          var nm, tries = 0;
          do { nm = pick(pool.f, r) + ' ' + pick(pool.l, r); tries++; } while (used[nm] && tries < 20);
          used[nm] = 1;
          out.push({ name: nm, pos: p[0], number: nums[ni++ % nums.length], age: 18 + Math.floor(r() * 19) });
        }
      });
      squadCache[teamRef] = out;
      return out;
    }
    function coachName(teamRef) { var r = U.rng('coach:' + teamRef), pool = poolFor(teamRef); return pick(pool.f, r) + ' ' + pick(pool.l, r); }

    /* ------------------------------------------------------------------ schedule */
    var dayCache = {};
    function rrPairs(list, rnd, flip) {
      var n = list.length, rest = list.slice(1), s = rnd % rest.length;
      var seq = [list[0]].concat(rest.slice(s), rest.slice(0, s)), pairs = [];
      for (var i = 0; i < n / 2; i++) {
        var h = seq[i], a = seq[n - 1 - i];
        if ((i + rnd + (flip ? 1 : 0)) % 2 === 1) { var t = h; h = a; a = t; }
        pairs.push([h, a]);
      }
      return pairs;
    }
    var TENNIS_ROUNDS = [['Round of 16', 8], ['Quarter-finals', 4], ['Semi-finals', 2], ['Final', 1]];
    var TENNIS_SLOTS = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00', '20:30'];

    function dayMatches(lg, ds) {
      var key = lg.ref + '|' + ds;
      if (dayCache[key]) return dayCache[key];
      var def = lg.def, dn = dayNum(ds), base = dayTs(ds), list = [], pairs = [], round = '';
      var r = U.rng('day:' + key);
      if (lg.sport === 'tennis') {
        var ri = dn % 4, cnt = TENNIS_ROUNDS[ri][1];
        round = TENNIS_ROUNDS[ri][0];
        var sh = shuffle(lg.teamRefs, r);
        for (var i = 0; i < cnt; i++) pairs.push([sh[i * 2], sh[i * 2 + 1], TENNIS_SLOTS[i]]);
      } else if (def.fraction) {
        var shf = shuffle(lg.teamRefs, r), c = Math.floor(shf.length * def.fraction / 2) * 2;
        for (var j = 0; j < c; j += 2) pairs.push([shf[j], shf[j + 1]]);
        round = 'Regular season';
      } else {
        if (((dn + def.offset) % def.period) !== 0) { dayCache[key] = []; return dayCache[key]; }
        var k = Math.floor((dn + def.offset) / def.period), n = lg.teamRefs.length;
        if (lg.type === 'cup') {
          var shc = shuffle(lg.teamRefs, r);
          for (var q = 0; q + 1 < shc.length && pairs.length < 6; q += 2) pairs.push([shc[q], shc[q + 1]]);
          round = (lg.name.indexOf('CAF') === 0 ? 'Group stage - Matchday ' : 'League phase - Matchday ') + ((k % 8) + 1);
        } else {
          var rn = k % (n - 1), flip = Math.floor(k / (n - 1)) % 2 === 1;
          pairs = rrPairs(lg.teamRefs, rn, flip);
          round = (lg.sport === 'football' ? 'Round ' : 'Matchday ') + ((k % (2 * (n - 1))) + 1);
        }
      }
      pairs.forEach(function (p, idx) {
        var slot = p[2] || pick(def.slots, r);
        var m = {
          ref: lg.ref + ':' + ds + ':' + idx, sport: lg.sport, leagueRef: lg.ref, season: lg.season, round: round,
          homeRef: p[0], awayRef: p[1], kickoff: base + slotSeconds(slot), idx: idx, postponed: false
        };
        m.postponed = U.rng('pp:' + m.ref)() < 0.015;
        list.push(m);
      });
      dayCache[key] = list;
      return list;
    }

    function descByRef(ref) {
      var parts = String(ref).split(':');
      if (parts.length < 5) return null;
      var idx = +parts.pop(), ds = parts.pop(), lg = leagueByRef[parts.join(':')];
      if (!lg || !U.isDateStr(ds)) return null;
      return dayMatches(lg, ds)[idx] || null;
    }

    /* ------------------------------------------------------------------ football simulation */
    var scriptCache = {}, scriptCount = 0;
    var FORMATIONS = { '4-3-3': [4, 3, 3], '4-4-2': [4, 4, 2], '4-2-3-1': [4, 5, 1], '3-5-2': [3, 5, 2] };

    function fbScript(m) {
      if (scriptCache[m.ref]) return scriptCache[m.ref];
      if (scriptCount > 4000) { scriptCache = {}; scriptCount = 0; }
      var r = U.rng('fb:' + m.ref), H = squad(m.homeRef), A = squad(m.awayRef);
      var d = rating(m.homeRef) - rating(m.awayRef);
      var lh = U.clamp(1.28 + 1.7 * d + 0.22, 0.25, 3.8), la = U.clamp(1.02 - 1.5 * d, 0.2, 3.3);
      var gh = poisson(lh, r), ga = poisson(la, r);

      // line-ups first, so events only involve players who are on the pitch
      function lineup(sq, teamRef) {
        var fm = pick(Object.keys(FORMATIONS), r), q = FORMATIONS[fm], sh = shuffle(sq, r);
        function of(pos) { return sh.filter(function (p) { return p.pos === pos; }); }
        var gk = of('GK'), df = of('DF'), mf = of('MF'), fw = of('FW');
        var starters = [gk[0]].concat(df.slice(0, q[0]), mf.slice(0, q[1]), fw.slice(0, q[2]));
        var set = {}; starters.forEach(function (p) { set[p.name] = 1; });
        var subs = sh.filter(function (p) { return !set[p.name]; }).slice(0, 7);
        return { formation: fm, coach: coachName(teamRef), starters: starters, subs: subs };
      }
      var lu = { home: lineup(H, m.homeRef), away: lineup(A, m.awayRef) };

      var ev = [];
      function scorerOf(side) {
        var st = lu[side].starters.filter(function (p) { return p.pos !== 'GK'; });
        return weighted(st, st.map(function (p) { return p.pos === 'FW' ? 6 : p.pos === 'MF' ? 3 : 1; }), r);
      }
      [['home', gh], ['away', ga]].forEach(function (s) {
        for (var i = 0; i < s[1]; i++) {
          var sc = scorerOf(s[0]), as = null;
          if (r() < 0.62) { var cands = lu[s[0]].starters.filter(function (p) { return p.pos !== 'GK' && p.name !== sc.name; }); as = pick(cands, r).name; }
          var kind = r() < 0.09 ? 'Penalty' : 'Goal';
          if (kind === 'Penalty') as = null;
          ev.push({ min: 1 + Math.floor(r() * 90), type: 'goal', side: s[0], player: sc.name, assist: as, detail: kind });
        }
      });
      ['home', 'away'].forEach(function (side) {
        var outfield = lu[side].starters.filter(function (p) { return p.pos !== 'GK'; }), yc = poisson(1.7, r), booked = {};
        for (var i = 0; i < yc; i++) {
          var p = pick(outfield, r);
          if (booked[p.name]) continue;
          booked[p.name] = 1;
          ev.push({ min: 5 + Math.floor(r() * 85), type: 'yellow', side: side, player: p.name });
        }
        if (r() < 0.06) ev.push({ min: 20 + Math.floor(r() * 70), type: 'red', side: side, player: pick(outfield, r).name });
        var outs = shuffle(outfield, r), ins = lu[side].subs.filter(function (p) { return p.pos !== 'GK'; }), mins = [];
        for (var s = 0; s < 3; s++) mins.push(55 + Math.floor(r() * 31));
        mins.sort(function (a, b) { return a - b; });
        for (var t = 0; t < 3 && t < ins.length; t++) ev.push({ min: mins[t], type: 'sub', side: side, player: ins[t].name, out: outs[t].name });
      });
      var order = { goal: 0, red: 1, yellow: 2, sub: 3 };
      ev.sort(function (a, b) { return a.min - b.min || order[a.type] - order[b.type]; });

      var poss = U.clamp(Math.round(50 + 38 * d + (r() - 0.5) * 10), 28, 72);
      var shotsH = Math.max(3, Math.round(10 + 11 * d + gh * 1.6 + r() * 5)), shotsA = Math.max(2, Math.round(9 - 10 * d + ga * 1.6 + r() * 5));
      var sotH = Math.min(shotsH, Math.max(gh, Math.round(shotsH * (0.3 + 0.12 * r())))), sotA = Math.min(shotsA, Math.max(ga, Math.round(shotsA * (0.3 + 0.12 * r()))));
      var fin = {
        possession: [poss, 100 - poss], shots: [shotsH, shotsA], sot: [sotH, sotA],
        corners: [Math.round(shotsH * (0.3 + 0.2 * r())), Math.round(shotsA * (0.3 + 0.2 * r()))],
        fouls: [8 + Math.floor(r() * 9), 8 + Math.floor(r() * 9)], offsides: [Math.floor(r() * 5), Math.floor(r() * 5)],
        passes: [Math.round(260 + poss * 4.2 + r() * 70), Math.round(260 + (100 - poss) * 4.2 + r() * 70)],
        passAcc: [Math.round(70 + poss * 0.22 + r() * 6), Math.round(70 + (100 - poss) * 0.22 + r() * 6)]
      };
      var script = { lh: lh, la: la, events: ev, final: fin, lineups: lu };
      scriptCache[m.ref] = script; scriptCount++;
      return script;
    }

    function fbClock(kickoff, now) {
      var e = (now - kickoff) / 60;
      if (e < 0) return { status: 'scheduled', minute: null, cut: -1 };
      if (e < 45) return { status: 'live', minute: Math.floor(e) + 1, cut: Math.floor(e) + 1 };
      if (e < 60) return { status: 'halftime', minute: 45, cut: 45 };
      if (e < 105) return { status: 'live', minute: Math.min(90, 46 + Math.floor(e - 60)), cut: Math.min(90, 46 + Math.floor(e - 60)) };
      return { status: 'finished', minute: null, cut: 999 };
    }

    function fbMatch(m, now) {
      var base = { ref: m.ref, sport: 'football', leagueRef: m.leagueRef, season: m.season, round: m.round, homeRef: m.homeRef, awayRef: m.awayRef, kickoff: m.kickoff, period: null, periods: null };
      if (m.postponed) {
        return Object.assign(base, { status: 'postponed', minute: null, homeScore: null, awayScore: null, htHome: null, htAway: null });
      }
      var c = fbClock(m.kickoff, now);
      if (c.status === 'scheduled') return Object.assign(base, { status: 'scheduled', minute: null, homeScore: null, awayScore: null, htHome: null, htAway: null });
      var sc = fbScript(m), hs = 0, as = 0, hh = 0, ha = 0;
      sc.events.forEach(function (e) {
        if (e.type !== 'goal' || e.min > c.cut) return;
        if (e.side === 'home') { hs++; if (e.min <= 45) hh++; } else { as++; if (e.min <= 45) ha++; }
      });
      var showHt = c.cut >= 45;
      return Object.assign(base, { status: c.status, minute: c.minute, homeScore: hs, awayScore: as, htHome: showHt ? hh : null, htAway: showHt ? ha : null });
    }

    function fbDetail(m, now) {
      var c = fbClock(m.kickoff, now), sc = fbScript(m);
      if (c.status === 'scheduled' || m.postponed) {
        var early = m.kickoff - now < 3600 && !m.postponed;
        return { events: [], stats: [], lineups: early ? sc.lineups : null };
      }
      var events = sc.events.filter(function (e) { return e.min <= c.cut; });
      var f = c.status === 'finished' ? 1 : Math.min(1, c.cut / 90), fin = sc.final;
      function sc2(a) { return [Math.round(a[0] * f), Math.round(a[1] * f)]; }
      var yH = 0, yA = 0, rH = 0, rA = 0, gH = 0, gA = 0;
      events.forEach(function (e) {
        if (e.type === 'yellow') { if (e.side === 'home') yH++; else yA++; }
        if (e.type === 'red') { if (e.side === 'home') rH++; else rA++; }
        if (e.type === 'goal') { if (e.side === 'home') gH++; else gA++; }
      });
      var shots = sc2(fin.shots), sot = [Math.max(gH, Math.min(shots[0], Math.round(fin.sot[0] * f))), Math.max(gA, Math.min(shots[1], Math.round(fin.sot[1] * f)))];
      var stats = [
        { key: 'possession', label: 'Ball possession', home: fin.possession[0], away: fin.possession[1], pct: true },
        { key: 'shots', label: 'Total shots', home: shots[0], away: shots[1] },
        { key: 'sot', label: 'Shots on target', home: sot[0], away: sot[1] },
        { key: 'soff', label: 'Shots off target', home: Math.max(0, shots[0] - sot[0]), away: Math.max(0, shots[1] - sot[1]) },
        { key: 'corners', label: 'Corner kicks', home: sc2(fin.corners)[0], away: sc2(fin.corners)[1] },
        { key: 'fouls', label: 'Fouls', home: sc2(fin.fouls)[0], away: sc2(fin.fouls)[1] },
        { key: 'offsides', label: 'Offsides', home: sc2(fin.offsides)[0], away: sc2(fin.offsides)[1] },
        { key: 'yellow', label: 'Yellow cards', home: yH, away: yA },
        { key: 'red', label: 'Red cards', home: rH, away: rA },
        { key: 'saves', label: 'Goalkeeper saves', home: Math.max(0, sot[1] - gA), away: Math.max(0, sot[0] - gH) },
        { key: 'passes', label: 'Passes', home: sc2(fin.passes)[0], away: sc2(fin.passes)[1] },
        { key: 'passAcc', label: 'Pass accuracy', home: fin.passAcc[0], away: fin.passAcc[1], pct: true }
      ];
      return { events: events, stats: stats, lineups: sc.lineups };
    }

    /* ------------------------------------------------------------------ period sports (basketball, hockey, ...) */
    var periodCache = {};
    function schedule(cfg) {
      var out = [], t = 0;
      for (var p = 0; p < cfg.periods; p++) {
        out.push({ start: t, end: t + cfg.periodMin });
        var gap = (cfg.periods % 2 === 0 && p + 1 === cfg.periods / 2) ? cfg.halfMin : cfg.breakMin;
        t += cfg.periodMin + (p < cfg.periods - 1 ? gap : 0);
      }
      return { periods: out, total: out[out.length - 1].end };
    }
    function periodScript(m, cfg) {
      if (periodCache[m.ref]) return periodCache[m.ref];
      var r = U.rng('ps:' + m.ref), sch = schedule(cfg), d = rating(m.homeRef) - rating(m.awayRef);
      var avg = cfg.value.reduce(function (a, b) { return a + b; }, 0) / cfg.value.length, ev = [];
      [['home', 1 + 0.4 * d + 0.04], ['away', 1 - 0.4 * d]].forEach(function (s) {
        sch.periods.forEach(function (p, pi) {
          var n = poisson(U.clamp(cfg.perPeriod * s[1], 0.05, 80) / avg, r);
          for (var i = 0; i < n; i++) ev.push({ t: p.start + r() * cfg.periodMin, side: s[0], pts: pick(cfg.value, r), p: pi });
        });
      });
      ev.sort(function (a, b) { return a.t - b.t; });
      var sc = { ev: ev, sch: sch };
      periodCache[m.ref] = sc;
      return sc;
    }
    function periodMatch(m, now, cfg) {
      var base = { ref: m.ref, sport: m.sport, leagueRef: m.leagueRef, season: m.season, round: m.round, homeRef: m.homeRef, awayRef: m.awayRef, kickoff: m.kickoff, htHome: null, htAway: null };
      if (m.postponed) return Object.assign(base, { status: 'postponed', minute: null, period: null, periods: null, homeScore: null, awayScore: null });
      var e = (now - m.kickoff) / 60;
      if (e < 0) return Object.assign(base, { status: 'scheduled', minute: null, period: null, periods: null, homeScore: null, awayScore: null });
      var sc = periodScript(m, cfg), status = 'finished', period = null, minute = null, cut = Infinity;
      if (e < sc.sch.total) {
        cut = e; status = 'halftime';
        for (var i = 0; i < sc.sch.periods.length; i++) {
          var p = sc.sch.periods[i];
          if (e >= p.start && e < p.end) { status = 'live'; period = i + 1; minute = Math.floor(e - p.start) + 1; break; }
        }
        if (status === 'halftime') { for (var k = 0; k < sc.sch.periods.length; k++) if (e >= sc.sch.periods[k].end) period = k + 1; }
      }
      var hs = 0, as = 0, per = [];
      var started = status === 'finished' ? sc.sch.periods.length : (period || 1);
      for (var pi = 0; pi < started; pi++) per.push({ home: 0, away: 0 });
      sc.ev.forEach(function (x) {
        if (x.t > cut) return;
        if (x.side === 'home') { hs += x.pts; per[x.p].home += x.pts; } else { as += x.pts; per[x.p].away += x.pts; }
      });
      return Object.assign(base, { status: status, minute: minute, period: period, periods: per, homeScore: hs, awayScore: as });
    }

    /* ------------------------------------------------------------------ set sports (tennis, volleyball) */
    var setCache = {};
    function setScript(m) {
      if (setCache[m.ref]) return setCache[m.ref];
      var r = U.rng('set:' + m.ref), tennis = m.sport === 'tennis';
      var d = rating(m.homeRef) - rating(m.awayRef);
      var p = U.clamp(0.5 + (tennis ? 0.42 : 0.5) * d, 0.12, 0.88);
      var units = [], sets = [], hw = 0, aw = 0, setNo = 0;
      while (hw < 2 && aw < 2 || (!tennis && hw < 3 && aw < 3)) {
        if (tennis && (hw === 2 || aw === 2)) break;
        var h = 0, a = 0, target = tennis ? 6 : (setNo === 4 ? 15 : 25);
        while (true) {
          var homeWins = r() < p;
          units.push({ set: setNo, side: homeWins ? 'home' : 'away' });
          if (homeWins) h++; else a++;
          if (tennis) {
            if ((h >= 6 || a >= 6) && Math.abs(h - a) >= 2) break;
            if (h === 7 || a === 7) break;
          } else if ((h >= target || a >= target) && Math.abs(h - a) >= 2) break;
          if (units.length > 400) break;
        }
        sets.push({ home: h, away: a });
        if (h > a) hw++; else aw++;
        setNo++;
        if (tennis && (hw === 2 || aw === 2)) break;
        if (!tennis && (hw === 3 || aw === 3)) break;
      }
      var sc = { units: units, unitMin: tennis ? 4.3 : 0.95, total: units.length };
      setCache[m.ref] = sc;
      return sc;
    }
    function setMatch(m, now) {
      var base = { ref: m.ref, sport: m.sport, leagueRef: m.leagueRef, season: m.season, round: m.round, homeRef: m.homeRef, awayRef: m.awayRef, kickoff: m.kickoff, htHome: null, htAway: null, minute: null };
      if (m.postponed) return Object.assign(base, { status: 'postponed', period: null, periods: null, homeScore: null, awayScore: null });
      var e = (now - m.kickoff) / 60;
      if (e < 0) return Object.assign(base, { status: 'scheduled', period: null, periods: null, homeScore: null, awayScore: null });
      var sc = setScript(m), played = Math.min(sc.total, Math.floor(e / sc.unitMin) + 1), finished = e / sc.unitMin >= sc.total;
      if (finished) played = sc.total;
      var tennis = m.sport === 'tennis', per = [], hs = 0, as = 0, cur = -1;
      for (var i = 0; i < played; i++) {
        var u = sc.units[i];
        if (u.set !== cur) { per.push({ home: 0, away: 0 }); cur = u.set; }
        if (u.side === 'home') per[per.length - 1].home++; else per[per.length - 1].away++;
      }
      per.forEach(function (s, idx) {
        var done = idx < per.length - 1 || finished;
        if (!done) return;
        if (s.home > s.away) hs++; else as++;
      });
      return Object.assign(base, { status: finished ? 'finished' : 'live', period: finished ? null : per.length, periods: per, homeScore: hs, awayScore: as, minute: tennis ? null : null });
    }

    /* ------------------------------------------------------------------ generic match state */
    function stateOf(m, now) {
      if (m.sport === 'football') return fbMatch(m, now);
      if (m.sport === 'tennis' || m.sport === 'volleyball') return setMatch(m, now);
      return periodMatch(m, now, leagueByRef[m.leagueRef].cfg);
    }

    function fixtures(o) {
      o = o || {};
      var from = o.from, to = o.to, now = o.now, out = [];
      var d0 = U.dateStr(from, 'UTC'), d1 = U.dateStr(to - 1, 'UTC'), ds = d0;
      var guard = 0;
      while (ds <= d1 && guard++ < 60) {
        leagues.forEach(function (lg) {
          if (o.sport && lg.sport !== o.sport) return;
          dayMatches(lg, ds).forEach(function (m) {
            if (m.kickoff >= from && m.kickoff < to) out.push(stateOf(m, now));
          });
        });
        ds = U.addDays(ds, 1);
      }
      return out;
    }

    function liveNow(o) {
      var now = o.now, out = [];
      var d0 = U.dateStr(now - 4 * 3600, 'UTC'), d1 = U.dateStr(now, 'UTC');
      [d0, d1].filter(function (x, i, a) { return a.indexOf(x) === i; }).forEach(function (ds) {
        leagues.forEach(function (lg) {
          if (o.sport && lg.sport !== o.sport) return;
          dayMatches(lg, ds).forEach(function (m) {
            var s = stateOf(m, now);
            if (s.status === 'live' || s.status === 'halftime') out.push(s);
          });
        });
      });
      return out;
    }

    /* ------------------------------------------------------------------ details, h2h */
    function h2h(m) {
      var r = U.rng('h2h:' + [m.homeRef, m.awayRef].sort().join('|')), out = [];
      var lg = leagueByRef[m.leagueRef], day = Math.floor(m.kickoff / 86400);
      for (var i = 0; i < 5; i++) {
        var swap = r() < 0.5, hr = swap ? m.awayRef : m.homeRef, ar = swap ? m.homeRef : m.awayRef;
        day -= 70 + Math.floor(r() * 260);
        var d = rating(hr) - rating(ar), hs, as;
        if (m.sport === 'football') { hs = poisson(U.clamp(1.4 + 1.5 * d, 0.3, 3.5), r); as = poisson(U.clamp(1.1 - 1.3 * d, 0.2, 3), r); }
        else if (m.sport === 'tennis') { var hw = r() < U.clamp(0.5 + 0.4 * d, 0.1, 0.9); hs = hw ? 2 : (r() < 0.4 ? 1 : 0); as = hw ? (r() < 0.4 ? 1 : 0) : 2; }
        else if (m.sport === 'volleyball') { var hv = r() < U.clamp(0.5 + 0.4 * d, 0.1, 0.9); hs = hv ? 3 : Math.floor(r() * 3); as = hv ? Math.floor(r() * 3) : 3; }
        else { var cfg = lg.cfg, per = cfg.perPeriod * cfg.periods; hs = Math.max(0, Math.round(per * (1 + 0.3 * d) + (r() - 0.5) * per * 0.4)); as = Math.max(0, Math.round(per * (1 - 0.3 * d) + (r() - 0.5) * per * 0.4)); if (hs === as) hs += 1; }
        out.push({ date: day * 86400, home: teams[hr].name, away: teams[ar].name, homeScore: hs, awayScore: as, competition: lg.name });
      }
      return out;
    }

    function detail(ref, now) {
      var m = descByRef(ref);
      if (!m) return null;
      var d = m.sport === 'football' ? fbDetail(m, now) : { events: [], stats: [], lineups: null };
      d.h2h = h2h(m);
      return d;
    }

    /* ------------------------------------------------------------------ standings */
    function standings(leagueRef, now) {
      var lg = leagueByRef[leagueRef];
      if (!lg || lg.type !== 'league') return [];
      var n = lg.teamRefs.length, def = lg.def, dn = Math.floor(now / 86400);
      var played;
      if (def.fraction) played = (dn % 60) + 8; else played = (Math.floor((dn + def.offset) / def.period) % (2 * (n - 1))) + 0;
      played = Math.max(played, 1);
      var rows = lg.teamRefs.map(function (ref) {
        var r = U.rng('std:' + ref + ':' + lg.season), t = { teamRef: ref, played: played, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, seq: [] };
        var hasDraw = lg.sport === 'football' || lg.sport === 'handball' || lg.sport === 'rugby';
        var pw = U.clamp(0.12 + 0.62 * rating(ref), 0.08, 0.82), pd = hasDraw ? (lg.sport === 'football' ? 0.24 : 0.06) : 0;
        for (var g = 0; g < played; g++) {
          var x = r(), a = r(), b = r(), c = r(), res = x < pw ? 'W' : (x < pw + pd ? 'D' : 'L');
          var mult = lg.sport === 'football' ? 1 : (lg.cfg ? Math.max(1, lg.cfg.perPeriod * lg.cfg.periods / 2.4) : 1);
          var gf, ga;
          if (res === 'W') { gf = 1 + Math.floor(a * 3 * mult); ga = Math.floor(b * Math.max(1, gf) * (lg.sport === 'football' ? 0.9 : 0.95)); if (ga >= gf) ga = gf - 1; }
          else if (res === 'D') { gf = Math.floor(a * 2.6 * mult); ga = gf; }
          else { ga = 1 + Math.floor(a * 3 * mult); gf = Math.floor(b * Math.max(1, ga) * (lg.sport === 'football' ? 0.9 : 0.95)); if (gf >= ga) gf = ga - 1; }
          if (gf < 0) gf = 0; if (ga < 0) ga = 0;
          t.gf += gf; t.ga += ga; t.seq.push(res);
          if (res === 'W') t.won++; else if (res === 'D') t.drawn++; else t.lost++;
          void c;
        }
        t.points = lg.sport === 'football' ? t.won * 3 + t.drawn : (lg.sport === 'hockey' ? t.won * 2 : (lg.sport === 'handball' || lg.sport === 'rugby' ? t.won * 2 + t.drawn : t.won * 2));
        t.form = t.seq.slice(-5).join('');
        delete t.seq;
        if (lg.sport === 'basketball' || lg.sport === 'baseball' || lg.sport === 'american-football') { t.drawn = null; t.points = null; }
        return t;
      });
      rows.sort(function (a, b) {
        var pa = a.points == null ? a.won : a.points, pb = b.points == null ? b.won : b.points;
        return (pb - pa) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf) || (teams[a.teamRef].name < teams[b.teamRef].name ? -1 : 1);
      });
      rows.forEach(function (row, i) {
        row.rank = i + 1;
        row.note = lg.sport === 'football' && n >= 16 ? (i < 4 ? 'q1' : i < 6 ? 'q2' : i >= n - 3 ? 'rel' : '') : (i < 6 && lg.sport !== 'football' ? 'q1' : '');
      });
      return [{ group: '', rows: rows }];
    }

    /* ------------------------------------------------------------------ odds */
    function winProbs(m, st, tennisLike) {
      // returns [pHome, pDraw, pAway]
      var d = rating(m.homeRef) - rating(m.awayRef);
      if (m.sport === 'football') {
        var lg = fbScript(m), c = fbClock(m.kickoff, st.now), rem = c.status === 'scheduled' ? 1 : (c.status === 'finished' ? 0.0001 : Math.max(0.02, 1 - c.cut / 90));
        var lh = lg.lh * rem, la = lg.la * rem, g0 = st.homeScore || 0, g1 = st.awayScore || 0, pH = 0, pD = 0, pA = 0, o25 = 0, bt = 0;
        for (var i = 0; i <= 8; i++) for (var j = 0; j <= 8; j++) {
          var p = pmf(lh, i) * pmf(la, j), fh = g0 + i, fa = g1 + j;
          if (fh > fa) pH += p; else if (fh === fa) pD += p; else pA += p;
          if (fh + fa > 2.5) o25 += p;
          if (fh >= 1 && fa >= 1) bt += p;
        }
        var tot = pH + pD + pA; return { p: [pH / tot, pD / tot, pA / tot], o25: o25 / tot, btts: bt / tot };
      }
      var x = 6 * d + 0.12, live = st.status === 'live' || st.status === 'halftime';
      if (live) {
        var diff = (st.homeScore || 0) - (st.awayScore || 0), scale = tennisLike ? 0.9 : (m.sport === 'hockey' || m.sport === 'baseball' ? 1.2 : 0.12);
        var lgx = leagueByRef[m.leagueRef], progress = 0.4;
        if (lgx.cfg) { var sch = schedule(lgx.cfg); progress = U.clamp(((st.now - m.kickoff) / 60) / sch.total, 0, 1); }
        x += diff * scale * (1 + 3 * progress);
      }
      var ph = 1 / (1 + Math.exp(-x));
      if (m.sport === 'handball') { var pd = 0.07; return { p: [ph * (1 - pd), pd, (1 - ph) * (1 - pd)] }; }
      return { p: [ph, 0, 1 - ph] };
    }

    var COVER = {};
    function covers(bkRef, m) {
      var k = bkRef + '|' + m.leagueRef, v = COVER[k];
      if (v == null) { v = 0.55 + U.rng('cover:' + k)() * 0.45; COVER[k] = v; }
      return U.rng('cov:' + bkRef + m.ref)() < v || leagueByRef[m.leagueRef].top === 1 && U.rng('covt:' + bkRef + m.ref)() < 0.92;
    }

    function oddsFor(m, st, now) {
      // st = provider match state at `now`
      if (st.status === 'finished' || st.status === 'postponed') return [];
      st.now = now;
      var pr = winProbs(m, st, m.sport === 'tennis' || m.sport === 'volleyball'), rows = [];
      var two = m.sport !== 'football' && m.sport !== 'handball';
      var bucket = Math.floor(now / 20);
      D.FEED_BOOKMAKERS.forEach(function (b) {
        if (!covers(b.ref, m)) return;
        function price(p, bk, sel) {
          function at(bu) {
            var eps = (U.rng('odds:' + m.ref + b.ref + sel + bu)() - 0.5) * 0.05;
            return Math.round(U.clamp(1 / (Math.max(p, 0.004) * (1 + b.margin)) * (1 + eps), 1.01, 250) * 100) / 100;
          }
          return { value: at(bk), prev: at(bk - 1) };
        }
        function push(market, sel, p) { var pv = price(p, bucket, market + sel); rows.push({ matchRef: m.ref, bookmaker: b.ref, market: market, selection: sel, value: pv.value, prev: pv.prev }); }
        if (two) { push('ml', '1', pr.p[0]); push('ml', '2', pr.p[2]); }
        else { push('1x2', '1', pr.p[0]); push('1x2', 'X', pr.p[1]); push('1x2', '2', pr.p[2]); }
        if (m.sport === 'football') {
          push('ou25', 'O', pr.o25); push('ou25', 'U', 1 - pr.o25);
          push('btts', 'Y', pr.btts); push('btts', 'N', 1 - pr.btts);
        }
      });
      return rows;
    }

    function odds(o) {
      var now = o.now, out = [];
      (o.matches || []).forEach(function (st) {
        var m = descByRef(st.ref);
        if (!m) return;
        oddsFor(m, st, now).forEach(function (row) { out.push(row); });
      });
      return out;
    }

    /* ------------------------------------------------------------------ reference data */
    function referenceData() {
      return {
        sports: D.SPORTS.slice(),
        countries: Object.keys(countries).map(function (k) { return countries[k]; }),
        leagues: leagues.map(function (l) { return { ref: l.ref, sport: l.sport, countryCode: l.countryCode, name: l.name, slug: l.slug, type: l.type, top: l.top, season: l.season }; }),
        teams: teamList.map(function (t) { return { ref: t.ref, sport: t.sport, countryCode: t.countryCode, name: t.name, slug: t.slug }; })
      };
    }

    return {
      simNow: simNow, referenceData: referenceData, fixtures: fixtures, live: liveNow, detail: detail,
      standings: standings, squad: squad, odds: odds, feedBookmakers: function () { return D.FEED_BOOKMAKERS.map(function (b) { return { ref: b.ref, name: b.name }; }); },
      leagues: leagues, teams: teams, leagueByRef: leagueByRef, countries: countries, descByRef: descByRef, coachName: coachName, realtime: realtime
    };
  }

  return { createWorld: createWorld };
});
