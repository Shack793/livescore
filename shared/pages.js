// shared/pages.js — routes -> pages. Isomorphic: runs on the server (SSR) and in the standalone preview.
// Everything reads from a `store` (server/store-sqlite.js or shared/store-memory.js).
(function (root, factory) {
  var dep = typeof require === 'function' && typeof module === 'object'
    ? { U: require('./util'), O: require('./odds'), B: require('./bookmakers'), V: require('./views') }
    : { U: root.LSN.util, O: root.LSN.odds, B: root.LSN.bookmakers, V: root.LSN.views };
  var api = factory(dep);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LSN = root.LSN || {}; root.LSN.pages = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var U = dep.U, O = dep.O, B = dep.B, V = dep.V, E = U.esc;

  var SPORT_NAMES = {};
  var DAY = 86400;
  var ODDS_FMT = { decimal: 1, fractional: 1, american: 1 };

  /* ---------- context ---------- */
  function makeCtx(store, inp) {
    var cfg = inp.cfg, ck = inp.cookies || {};
    var tz = ck.lsn_tz && U.validTz(ck.lsn_tz) ? ck.lsn_tz : cfg.siteTz;
    var bk = B.resolve(store.bookmakerConfig(), inp.cc);
    var sports = store.sports();
    sports.forEach(function (s) { SPORT_NAMES[s.id] = s.name; });
    var ctx = {
      siteName: cfg.siteName, siteUrl: cfg.siteUrl, siteTz: cfg.siteTz, assetV: cfg.assetV || '1', contactEmail: cfg.contactEmail || '', forumUrl: cfg.forumUrl || '', forumName: cfg.forumName || 'Pitchside Forum', forumMatchUrl: cfg.forumMatchUrl || '', showCountryPicker: !!cfg.showCountryPicker,
      tagline: store.setting('site_tagline', 'Live scores, fixtures & odds'),
      path: inp.path, ccSource: inp.ccSource || '', now: inp.now, tz: tz, cc: inp.cc || 'ZZ', countryName: inp.countryName || 'your region',
      oddsFmt: ODDS_FMT[ck.lsn_odds] ? ck.lsn_odds : (store.setting('odds_format', 'decimal')),
      theme: ck.lsn_theme === 'dark' || ck.lsn_theme === 'light' ? ck.lsn_theme : 'auto',
      bk: bk, bettingOn: bk.compliance.betting_allowed && bk.items.length > 0,
      needConsent: !!inp.needConsent, consent: ck.lsn_consent === 'yes' || ck.lsn_consent === 'no' ? ck.lsn_consent : '',
      isMock: !!store.isMock(), adSlots: store.adSlots(), sports: sports, sport: 'football', streamOn: inp.streamOn !== false,
      liveCounts: store.liveCounts(), q: ''
    };
    return ctx;
  }

  function sportName(id) { return SPORT_NAMES[id] || id; }
  function sportById(ctx, id) { for (var i = 0; i < ctx.sports.length; i++) if (ctx.sports[i].id === id) return ctx.sports[i]; return null; }

  function withSide(ctx, store, sport, openCountry) {
    ctx.sport = sport;
    ctx.topLeagues = store.topLeagues(sport);
    ctx.menu = store.menu(sport);
    ctx.openCountry = openCountry || '';
  }

  function oddsFor(ctx, store, matches) {
    return ctx.bettingOn ? store.oddsRows(matches.map(function (m) { return m.id; })) : new Map();
  }

  /* ---------- shared widgets ---------- */
  function tabs(items, active) {
    return '<nav class="subtabs">' + items.map(function (t) { return '<a class="' + (t.id === active ? 'on' : '') + '" href="' + t.href + '">' + E(t.label) + '</a>'; }).join('') + '</nav>';
  }

  function dateNav(ctx, basePath, date) {
    var today = U.dateStr(ctx.now, ctx.tz), out = '<div class="datenav">';
    function href(ds) { return basePath + (ds === today ? '' : '?date=' + ds); }
    out += '<a class="dn-arrow" href="' + href(U.addDays(date, -1)) + '" aria-label="Previous day">‹</a><div class="dn-days">';
    for (var i = -3; i <= 3; i++) {
      var ds = U.addDays(date, i);
      out += '<a class="dn-d' + (ds === date ? ' on' : '') + (ds === today ? ' today' : '') + '" href="' + href(ds) + '" data-date="' + ds + '">' + (ds === today ? '<b>Today</b>' : '') + '<span>' + E(U.dayLabel(ds)) + '</span></a>';
    }
    out += '</div><a class="dn-arrow" href="' + href(U.addDays(date, 1)) + '" aria-label="Next day">›</a>' +
      '<label class="dn-cal" title="Pick a date">📅<input type="date" id="datePick" value="' + date + '" aria-label="Pick a date" data-base="' + basePath + '" data-today="' + today + '"></label></div>';
    return out;
  }

  function filters(ctx, matches) {
    var live = matches.filter(function (m) { return V.LIVE[m.status]; }).length;
    return '<div class="filters" id="filters">' +
      '<button class="on" data-f="all">All</button><button data-f="live">LIVE' + (live ? ' <em>' + live + '</em>' : '') + '</button>' +
      (ctx.bettingOn ? '<button data-f="odds">Odds</button>' : '') +
      '<button data-f="fin">Finished</button><button data-f="sch">Scheduled</button></div>';
  }

  function dayList(ctx, matches, oddsMap, empty) {
    if (!matches.length) return '<div class="empty">' + E(empty) + '</div>';
    var groups = [], idx = {};
    matches.forEach(function (m) {
      var ds = U.dateStr(m.kickoff, ctx.tz), g = idx[ds];
      if (!g) { g = idx[ds] = { ds: ds, list: [] }; groups.push(g); }
      g.list.push(m);
    });
    return groups.map(function (g) {
      return '<section class="lg"><div class="lg-head day"><b>' + E(U.longDate(g.ds)) + '</b></div>' +
        g.list.map(function (m) { return V.matchRow(m, ctx, ctx.bettingOn ? O.primary(oddsMap.get(m.id) || [], ctx.bk.items, m.sport) : null); }).join('') + '</section>';
    }).join('');
  }

  function crumbs(list) {
    return '<nav class="crumbs">' + list.map(function (c, i) { return c.href ? '<a href="' + c.href + '">' + E(c.label) + '</a>' : '<span>' + E(c.label) + '</span>'; }).join('<i>›</i>') + '</nav>';
  }

  function standingsTable(ctx, st, teams, hi, compact) {
    if (!st || !st.groups || !st.groups.length) return '<div class="empty">Standings are not available for this competition.</div>';
    return st.groups.map(function (g) {
      return (g.group ? '<h3 class="gh">' + E(g.group) + '</h3>' : '') +
        '<div class="tblwrap"><table class="std"><thead><tr><th class="c-rank">#</th><th class="c-team">Team</th><th title="Played">MP</th><th title="Won">W</th><th title="Drawn">D</th><th title="Lost">L</th><th class="c-g" title="Goals / points for-against">G</th><th title="Points">Pts</th>' + (compact ? '' : '<th class="c-form">Form</th>') + '</tr></thead><tbody>' +
        g.rows.map(function (r) {
          var t = teams.get(r.teamId); if (!t) return '';
          var form = String(r.form || '').split('').map(function (f) { return '<i class="f f-' + f + '">' + f + '</i>'; }).join('');
          return '<tr class="' + (hi && hi.indexOf(r.teamId) !== -1 ? 'hi ' : '') + 'n-' + E(r.note || '') + '"><td class="c-rank"><span>' + r.rank + '</span></td><td class="c-team"><a href="' + V.teamUrl(t) + '">' + V.crest(t) + '<span>' + E(t.name) + '</span></a></td><td>' + r.played + '</td><td>' + r.won + '</td><td>' + r.drawn + '</td><td>' + r.lost + '</td><td class="c-g">' + r.gf + ':' + r.ga + '</td><td class="pts">' + r.points + '</td>' + (compact ? '' : '<td class="c-form">' + form + '</td>') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }).join('') + '<p class="legend"><i class="k n-q1"></i> Qualification <i class="k n-q2"></i> Qualification (2) <i class="k n-rel"></i> Relegation</p>';
  }

  function standingsTeams(store, st) {
    var ids = [];
    if (st) st.groups.forEach(function (g) { g.rows.forEach(function (r) { ids.push(r.teamId); }); });
    return store.teamsByIds(ids);
  }

  /* ---------- pages ---------- */
  function pageSport(ctx, store, sport, query) {
    var s = sportById(ctx, sport);
    if (!s) return null;
    withSide(ctx, store, sport);
    var today = U.dateStr(ctx.now, ctx.tz);
    var date = U.isDateStr(query.date) ? query.date : today;
    var r = U.dayRange(date, ctx.tz);
    var matches = store.matches({ sport: sport, from: r[0], to: r[1] });
    var odds = oddsFor(ctx, store, matches);
    var base = V.sportUrl(sport);
    var html = '<h1 class="h1">' + E(s.name) + ' scores &amp; live results</h1>' + dateNav(ctx, base, date) + filters(ctx, matches) +
      '<div class="mlist" id="mlist">' + V.matchList(ctx, matches, odds, { infeed: true, empty: 'No ' + s.name.toLowerCase() + ' matches on this day.' }) + '</div>';
    return {
      kind: 'sport', title: s.name + ' Live Scores, Results & Odds', canonical: date === today ? base : base + '?date=' + date,
      description: 'Live ' + s.name.toLowerCase() + ' scores, fixtures, results, standings and odds comparison. Updated in real time.',
      html: html, noindex: date !== today,
      jsonld: sport === 'football' && date === today ? { '@context': 'https://schema.org', '@type': 'WebSite', name: ctx.siteName, url: ctx.siteUrl, potentialAction: { '@type': 'SearchAction', target: ctx.siteUrl + '/search/?q={q}', 'query-input': 'required name=q' } } : null
    };
  }

  function pageCountry(ctx, store, sport, slug) {
    var c = store.country(sport, slug);
    if (!c || !sportById(ctx, sport)) return null;
    withSide(ctx, store, sport, slug);
    var html = crumbs([{ label: sportName(sport), href: V.sportUrl(sport) }, { label: c.name }]) +
      '<div class="ph">' + V.flag(c.code, 'big') + '<div><h1 class="h1">' + E(c.name) + ' ' + E(sportName(sport).toLowerCase()) + '</h1><p class="muted">' + c.leagues.length + ' competition' + (c.leagues.length === 1 ? '' : 's') + '</p></div></div>' +
      '<ul class="cards">' + c.leagues.map(function (l) { return '<li><a href="' + V.leagueUrl(sport, c, l) + '"><b>' + E(l.name) + '</b><small>' + E(l.season || '') + '</small></a></li>'; }).join('') + '</ul>';
    return { kind: 'country', title: c.name + ' ' + sportName(sport) + ' – Leagues & Results', description: 'All ' + c.name + ' ' + sportName(sport).toLowerCase() + ' competitions: live scores, results, fixtures and standings.', html: html };
  }

  function pageLeague(ctx, store, sport, cslug, lslug, tab) {
    var lg = store.league(sport, cslug, lslug);
    if (!lg || !sportById(ctx, sport)) return null;
    withSide(ctx, store, sport, cslug);
    var isLeague = lg.type === 'league';
    tab = tab || (isLeague ? 'standings' : 'fixtures');
    if (['standings', 'results', 'fixtures'].indexOf(tab) === -1 || (tab === 'standings' && !isLeague)) return null;
    var items = (isLeague ? [{ id: 'standings', label: 'Standings', href: V.leagueUrl(sport, lg.country, lg, 'standings') }] : []).concat([
      { id: 'fixtures', label: 'Fixtures', href: V.leagueUrl(sport, lg.country, lg, 'fixtures') }, { id: 'results', label: 'Results', href: V.leagueUrl(sport, lg.country, lg, 'results') }]);
    var body, matches = [];
    if (tab === 'standings') {
      var st = store.standings(lg.id);
      body = '<div class="card">' + standingsTable(ctx, st, standingsTeams(store, st), []) + '</div>';
    } else if (tab === 'results') {
      matches = store.matches({ leagueId: lg.id, finished: true, desc: true, limit: 80 });
      body = '<div class="mlist" id="mlist">' + dayList(ctx, matches, oddsFor(ctx, store, matches), 'No recent results.') + '</div>';
    } else {
      matches = store.matches({ leagueId: lg.id, from: ctx.now - 6 * 3600, limit: 80 }).filter(function (m) { return m.status !== 'finished'; });
      body = '<div class="mlist" id="mlist">' + dayList(ctx, matches, oddsFor(ctx, store, matches), 'No upcoming fixtures.') + '</div>';
    }
    var html = crumbs([{ label: sportName(sport), href: V.sportUrl(sport) }, { label: lg.country.name, href: '/' + sport + '/' + lg.country.slug + '/' }, { label: lg.name }]) +
      '<div class="ph">' + V.flag(lg.country.code, 'big') + '<div><h1 class="h1">' + E(lg.name) + '</h1><p class="muted">' + E(lg.country.name) + (lg.season ? ' · ' + E(lg.season) : '') + '</p></div>' +
      '<span class="pin big" role="button" tabindex="0" data-pin="' + lg.id + '" aria-label="Pin league">☆</span></div>' + tabs(items, tab) + body;
    return { kind: 'league', title: lg.name + ' ' + lg.country.name + ' – ' + (tab === 'standings' ? 'Standings' : tab === 'results' ? 'Results' : 'Fixtures'), description: lg.name + ' (' + lg.country.name + ') ' + tab + ', live scores and odds.', html: html, noindex: false };
  }

  function pageTeam(ctx, store, slug, id, tab) {
    var t = store.team(id);
    if (!t) return null;
    if (t.slug !== slug) return { redirect: V.teamUrl(t) };
    withSide(ctx, store, t.sport);
    tab = tab || 'summary';
    var items = [['summary', 'Summary', ''], ['results', 'Results', 'results'], ['fixtures', 'Fixtures', 'fixtures'], ['standings', 'Standings', 'standings'], ['squad', 'Squad', 'squad']]
      .filter(function (x) { return x[0] !== 'squad' || t.sport === 'football' || t.sport === 'basketball' || true; })
      .map(function (x) { return { id: x[0], label: x[1], href: V.teamUrl(t) + (x[2] ? x[2] + '/' : '') }; });
    if (!items.some(function (i) { return i.id === tab; })) return null;
    var next = store.matches({ teamId: id, from: ctx.now - 3 * 3600, limit: 40 }).filter(function (m) { return m.status !== 'finished'; });
    var past = store.matches({ teamId: id, finished: true, desc: true, limit: 40 });
    var body = '';
    if (tab === 'summary') {
      var show = next.slice(0, 3).concat(past.slice(0, 5)), om = oddsFor(ctx, store, show);
      body = '<h3 class="gh">Next matches</h3><div class="mlist">' + dayList(ctx, next.slice(0, 3), om, 'No upcoming matches.') + '</div><h3 class="gh">Latest results</h3><div class="mlist">' + dayList(ctx, past.slice(0, 5), om, 'No recent results.') + '</div>';
    } else if (tab === 'results') body = '<div class="mlist" id="mlist">' + dayList(ctx, past, new Map(), 'No recent results.') + '</div>';
    else if (tab === 'fixtures') body = '<div class="mlist" id="mlist">' + dayList(ctx, next, oddsFor(ctx, store, next), 'No upcoming matches.') + '</div>';
    else if (tab === 'standings') {
      var lgs = store.teamLeagues(id).filter(function (l) { return !!store.standings(l.id); });
      body = lgs.length ? lgs.map(function (l) { var st = store.standings(l.id); return '<h3 class="gh"><a href="' + V.leagueUrl(t.sport, l.country, l, 'standings') + '">' + E(l.country.name) + ': ' + E(l.name) + '</a></h3><div class="card">' + standingsTable(ctx, st, standingsTeams(store, st), [id], true) + '</div>'; }).join('') : '<div class="empty">No standings available.</div>';
    } else {
      var sq = store.squad(id);
      body = sq && sq.length ? '<div class="card"><table class="squad"><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Age</th></tr></thead><tbody>' + sq.map(function (p) { return '<tr><td>' + E(p.number == null ? '' : p.number) + '</td><td>' + E(p.name) + '</td><td>' + E(p.pos || '') + '</td><td>' + E(p.age == null ? '' : p.age) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">Squad information is not available.</div>';
    }
    var html = crumbs([{ label: sportName(t.sport), href: V.sportUrl(t.sport) }].concat(t.country ? [{ label: t.country.name }] : []).concat([{ label: t.name }])) +
      '<div class="ph">' + V.crest(t, 'xl') + '<div><h1 class="h1">' + E(t.name) + '</h1><p class="muted">' + E(sportName(t.sport)) + (t.country ? ' · ' + E(t.country.name) : '') + '</p></div>' +
      '<button class="btn follow" data-team="' + t.id + '" data-name="' + E(t.name) + '" data-slug="' + E(t.slug) + '">☆ Follow</button></div>' + tabs(items, tab) + body;
    return { kind: 'team', title: t.name + ' – Fixtures, Results & Live Scores', description: t.name + ' live scores, fixtures, results, standings and squad.', html: html, teamId: t.id };
  }

  /* ---- match page ---- */
  function eventIcon(t) { return { goal: '⚽', yellow: '<i class="card-y"></i>', red: '<i class="card-r"></i>', sub: '🔁', pen: '⚽', own: '⚽' }[t] || '•'; }

  function eventsHtml(m, d) {
    var ev = (d.events || []).slice().sort(function (a, b) { return a.min - b.min; });
    if (!ev.length) return '<div class="empty">' + (m.status === 'scheduled' ? 'The match has not started yet.' : 'No key events recorded.') + '</div>';
    return '<div class="events">' + ev.map(function (e) {
      var txt = '<b>' + E(e.player || '') + '</b>' + (e.type === 'goal' && e.assist ? ' <small>(' + E(e.assist) + ')</small>' : '') + (e.type === 'sub' && e.out ? ' <small>↓ ' + E(e.out) + '</small>' : '');
      return '<div class="ev ' + (e.side === 'home' ? 'h' : 'a') + '"><span class="ev-m">' + e.min + '\'</span><span class="ev-i">' + eventIcon(e.type) + '</span><span class="ev-t">' + txt + '</span></div>';
    }).join('') + '</div>';
  }
  function statsHtml(d) {
    if (!d.stats || !d.stats.length) return '<div class="empty">Statistics are not available yet.</div>';
    return '<div class="stats">' + d.stats.map(function (s) {
      var h = Number(s.home) || 0, a = Number(s.away) || 0, tot = h + a || 1, hp = Math.round(h / tot * 100);
      var fmt = function (v) { return s.pct ? v + '%' : v; };
      return '<div class="stat"><div class="stat-v"><b' + (h > a ? ' class="lead"' : '') + '>' + fmt(s.home) + '</b><span>' + E(s.label) + '</span><b' + (a > h ? ' class="lead"' : '') + '>' + fmt(s.away) + '</b></div><div class="bar"><i style="width:' + hp + '%"></i><u style="width:' + (100 - hp) + '%"></u></div></div>';
    }).join('') + '</div>';
  }
  function lineupsHtml(d, m) {
    var l = d.lineups;
    if (!l || !l.home) return '<div class="empty">Line-ups have not been announced yet.</div>';
    function side(x, t) {
      return '<div class="lu"><h4>' + E(t.name) + (x.formation ? ' <small>' + E(x.formation) + '</small>' : '') + '</h4>' +
        '<ol class="starters">' + x.starters.map(function (p) { return '<li><span class="no">' + E(p.number == null ? '' : p.number) + '</span><span class="nm">' + E(p.name) + '</span><span class="ps">' + E(p.pos || '') + '</span></li>'; }).join('') + '</ol>' +
        (x.subs && x.subs.length ? '<h5>Substitutes</h5><ol class="subs">' + x.subs.map(function (p) { return '<li><span class="no">' + E(p.number == null ? '' : p.number) + '</span><span class="nm">' + E(p.name) + '</span><span class="ps">' + E(p.pos || '') + '</span></li>'; }).join('') + '</ol>' : '') +
        (x.coach ? '<p class="coach">Coach: <b>' + E(x.coach) + '</b></p>' : '') + '</div>';
    }
    return '<div class="lus">' + side(l.home, m.home) + side(l.away, m.away) + '</div>';
  }
  function h2hHtml(d, m) {
    var rows = d.h2h || [];
    if (!rows.length) return '<div class="empty">No previous meetings found.</div>';
    var hw = 0, dr = 0, aw = 0;
    rows.forEach(function (r) {
      if (r.homeScore === r.awayScore) dr++;
      else { var w = r.homeScore > r.awayScore ? r.home : r.away; if (w === m.home.name) hw++; else aw++; }
    });
    return '<div class="h2hsum"><span><b>' + hw + '</b>' + E(m.home.name) + ' wins</span><span><b>' + dr + '</b>Draws</span><span><b>' + aw + '</b>' + E(m.away.name) + ' wins</span></div>' +
      '<div class="h2h">' + rows.map(function (r) {
        return '<div class="h2r"><time>' + E(U.dateStr(r.date, 'UTC').split('-').reverse().join('.')) + '</time><span class="cmp">' + E(r.competition || '') + '</span><span class="hm' + (r.home === m.home.name ? ' me' : '') + '">' + E(r.home) + '</span><b>' + r.homeScore + ' - ' + r.awayScore + '</b><span class="aw' + (r.away === m.away.name ? ' me' : '') + '">' + E(r.away) + '</span></div>';
      }).join('') + '</div>';
  }
  function oddsPanel(ctx, comp, m) {
    if (!comp.length) return '<div class="empty">No odds available for this match in your region.</div>';
    return comp.map(function (c) {
      return '<div class="card oddsbox"><h4>' + E(c.title) + '</h4><div class="tblwrap"><table class="oddstbl"><thead><tr><th>Bookmaker</th>' + c.selections.map(function (s) { return '<th>' + E(s[1]) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
        c.lines.map(function (l) {
          return '<tr><td class="bkn">' + V.bkChip(l.bookmaker) + '<span>' + E(l.bookmaker.name) + '</span></td>' + l.values.map(function (v, i) {
            if (!v) return '<td><span class="odd na">–</span></td>';
            var trend = v.prev == null || v.prev === v.value ? '' : (v.value > v.prev ? 'up' : 'down');
            var cell = V.oddCell({ value: v.value, trend: trend, sel: c.selections[i][0] }, l.bookmaker.id, m.id, ctx, 'match-odds');
            return '<td' + (v.value === c.best[i] ? ' class="best"' : '') + '>' + cell + '</td>';
          }).join('') + '<td>' + V.cta(l.bookmaker, m.id, 'match-odds', 'Bet') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).join('') + '<p class="muted small">' + ctx.bk.compliance.min_age + '+ · Odds are indicative and may change. ' + E(ctx.bk.compliance.rg_text) + '</p>';
  }

  function matchBody(ctx, store, m, d, comp, st, teams) {
    var panels = [], first = true;
    function add(id, label, html) { panels.push({ id: id, label: label, html: html }); }
    add('summary', 'Summary', eventsHtml(m, d));
    if (ctx.bettingOn) add('odds', 'Odds', oddsPanel(ctx, comp, m));
    add('stats', 'Stats', statsHtml(d));
    add('lineups', 'Line-ups', lineupsHtml(d, m));
    add('h2h', 'H2H', h2hHtml(d, m));
    if (st) add('standings', 'Standings', standingsTable(ctx, st, teams, [m.home.id, m.away.id], true));
    return '<nav class="subtabs mtabs" id="mtabs">' + panels.map(function (p, i) { return '<a href="#' + p.id + '" data-tab="' + p.id + '" class="' + (i === 0 ? 'on' : '') + '">' + E(p.label) + '</a>'; }).join('') + '</nav>' +
      panels.map(function (p, i) { return '<section class="mpanel' + (i === 0 ? ' on' : '') + '" id="tab-' + p.id + '" data-tab="' + p.id + '"><h2 class="sr">' + E(p.label) + '</h2>' + p.html + '</section>'; }).join('');
  }

  function matchHeader(ctx, m, d) {
    var st = V.statusOf(m, ctx.tz), live = st.live;
    var sc = V.hasScore(m) ? '<b class="sh">' + m.hs + '</b><i>–</i><b class="sa">' + m.as + '</b>' : '<span class="vs">vs</span>';
    var goals = (d.events || []).filter(function (e) { return e.type === 'goal'; });
    var gl = function (side) { return goals.filter(function (e) { return e.side === side; }).map(function (e) { return '<div>' + E(e.player || '') + ' <small>' + e.min + '\'</small></div>'; }).join(''); };
    var ht = m.hths != null && m.sport === 'football' && m.status !== 'scheduled' ? '<div class="ht">HT ' + m.hths + ' - ' + m.htas + '</div>' : '';
    var per = m.periods && m.periods.length && m.sport !== 'football' && m.status !== 'scheduled' ? '<div class="perline">' + m.periods.map(function (p) { return '<i>' + p.home + '-' + p.away + '</i>'; }).join('') + '</div>' : '';
    return '<div class="mh s-' + V.stKey(m) + '" id="mh" data-id="' + m.id + '" data-st="' + V.stKey(m) + '" data-ko="' + m.kickoff + '">' +
      '<div class="mh-meta"><a href="' + V.leagueUrl(m.sport, m.country, m.league) + '">' + V.flag(m.country.code) + ' ' + E(m.country.name.toUpperCase()) + ': ' + E(m.league.name) + '</a>' + (m.round ? ' · ' + E(m.round) : '') + ' · <time data-ts="' + m.kickoff + '" data-full="1">' + E(U.dateStr(m.kickoff, ctx.tz).split('-').reverse().join('.') + ' ' + U.fmtTime(m.kickoff, ctx.tz)) + '</time></div>' +
      '<div class="mh-main"><a class="mh-t" href="' + V.teamUrl(m.home) + '">' + V.crest(m.home, 'xl') + '<span>' + E(m.home.name) + '</span></a>' +
      '<div class="mh-sc"><div class="score">' + sc + '</div><div class="mh-st ' + st.cls + '">' + E(st.time ? 'Scheduled' : st.text) + '</div>' + ht + per + '</div>' +
      '<a class="mh-t" href="' + V.teamUrl(m.away) + '">' + V.crest(m.away, 'xl') + '<span>' + E(m.away.name) + '</span></a></div>' +
      (goals.length ? '<div class="mh-goals"><div class="gh">' + gl('home') + '</div><div class="gm">⚽</div><div class="ga">' + gl('away') + '</div></div>' : '') +
      '<div class="mh-follow"><button class="btn ghost follow" data-team="' + m.home.id + '" data-name="' + E(m.home.name) + '" data-slug="' + E(m.home.slug) + '">☆ ' + E(m.home.name) + '</button><button class="btn ghost follow" data-team="' + m.away.id + '" data-name="' + E(m.away.name) + '" data-slug="' + E(m.away.slug) + '">☆ ' + E(m.away.name) + '</button></div></div>';
  }

  function matchOddsStrip(ctx, m, rows) {
    if (!ctx.bettingOn) return '';
    var p = O.primary(rows, ctx.bk.items, m.sport);
    if (!p || m.status === 'finished') return '';
    var labels = (O.MAIN_MARKET[m.sport] || O.MAIN_MARKET.football).labels;
    var bk = ctx.bk.items.filter(function (b) { return b.id === p.bookmaker_id; })[0];
    return '<div class="strip">' + V.bkChip(bk) + '<div class="strip-t"><b>' + E(p.bookmaker_name) + '</b><span>' + E(bk.offer || '') + '</span></div><div class="strip-o">' +
      p.cells.map(function (c, i) { return '<div><small>' + E(labels[i]) + '</small>' + V.oddCell(c, p.bookmaker_id, m.id, ctx, 'match-strip') + '</div>'; }).join('') + '</div>' + V.cta(bk, m.id, 'match-strip', 'Bet now') + '</div>';
  }

  function pageMatch(ctx, store, slug, id, query) {
    var m = store.match(id);
    if (!m) return null;
    var canon = m.home.slug + '-vs-' + m.away.slug;
    if (slug !== canon) return { redirect: V.matchUrl(m) };
    withSide(ctx, store, m.sport, m.country.slug);
    var d = store.detail(id);
    var rows = ctx.bettingOn ? (store.oddsRows([id]).get(id) || []) : [];
    var comp = ctx.bettingOn ? O.comparison(rows, ctx.bk.items) : [];
    var st = m.league.type === 'league' ? store.standings(m.league.id) : null;
    var teams = st ? standingsTeams(store, st) : new Map();
    var body = matchBody(ctx, store, m, d, comp, st, teams);
    if (query.frag) return { fragment: matchHeader(ctx, m, d) + matchOddsStrip(ctx, m, rows) + '<div id="mbody">' + body + '</div>' };
    var html = crumbs([{ label: sportName(m.sport), href: V.sportUrl(m.sport) }, { label: m.country.name, href: '/' + m.sport + '/' + m.country.slug + '/' }, { label: m.league.name, href: V.leagueUrl(m.sport, m.country, m.league) }, { label: m.home.name + ' – ' + m.away.name }]) +
      '<div id="mwrap">' + matchHeader(ctx, m, d) + (ctx.forumUrl ? '<a class="discuss" href="' + E(V.forumMatchLink(ctx, m)) + '">💬 Discuss this match on ' + E(ctx.forumName) + ' ›</a>' : '') + matchOddsStrip(ctx, m, rows) + V.adSlot(ctx, 'match-strip', m.id) + '<div id="mbody">' + body + '</div></div>';
    var score = V.hasScore(m) ? ' ' + m.hs + '-' + m.as : '';
    return {
      kind: 'match', matchId: m.id, title: m.home.name + ' vs ' + m.away.name + score + ' – Live Score, Lineups & Odds',
      description: m.home.name + ' vs ' + m.away.name + ' (' + m.league.name + '): live score, events, statistics, line-ups, head-to-head' + (ctx.bettingOn ? ' and odds comparison' : '') + '.',
      html: html,
      jsonld: { '@context': 'https://schema.org', '@type': 'SportsEvent', name: m.home.name + ' vs ' + m.away.name, startDate: new Date(m.kickoff * 1000).toISOString(), sport: sportName(m.sport),
        homeTeam: { '@type': 'SportsTeam', name: m.home.name }, awayTeam: { '@type': 'SportsTeam', name: m.away.name }, eventStatus: m.status === 'postponed' ? 'https://schema.org/EventPostponed' : 'https://schema.org/EventScheduled' }
    };
  }

  function pageSearch(ctx, store, q) {
    ctx.q = q;
    withSide(ctx, store, 'football');
    var r = store.search(q, 30), html = '<h1 class="h1">Search</h1>';
    if (String(q).trim().length < 2) html += '<div class="empty">Type at least 2 characters to search teams and competitions.</div>';
    else if (!r.teams.length && !r.leagues.length) html += '<div class="empty">No results for “' + E(q) + '”.</div>';
    else {
      if (r.leagues.length) html += '<h3 class="gh">Competitions</h3><ul class="cards">' + r.leagues.map(function (l) { return '<li><a href="' + V.leagueUrl(l.sport, l.country, l) + '">' + V.flag(l.country.code) + ' <b>' + E(l.name) + '</b><small>' + E(l.country.name) + ' · ' + E(sportName(l.sport)) + '</small></a></li>'; }).join('') + '</ul>';
      if (r.teams.length) html += '<h3 class="gh">Teams</h3><ul class="cards">' + r.teams.map(function (t) { return '<li><a href="' + V.teamUrl(t) + '">' + V.crest(t) + ' <b>' + E(t.name) + '</b><small>' + E(sportName(t.sport)) + '</small></a></li>'; }).join('') + '</ul>';
    }
    return { kind: 'search', title: 'Search', html: html, noindex: true };
  }

  function pageFavorites(ctx, store) {
    withSide(ctx, store, 'football');
    return { kind: 'favorites', title: 'My Teams', noindex: true, html:
      '<h1 class="h1">My teams</h1><p class="muted">Follow teams and competitions without an account. Your list is saved in this browser only.</p>' +
      '<div id="favImport" class="card" hidden></div>' +
      '<div class="card" id="favTeams"></div>' +
      '<div class="card favtools"><label class="chk"><input type="checkbox" id="favAlerts"> <b>Alerts for my teams</b> <span class="muted">— goals, kick-off and full-time pop up while the site is open (allow notifications when asked)</span></label>' +
      '<p><button class="btn ghost" id="shareBtn" type="button">🔗 Copy link to open my teams on another device</button> <span class="muted small" id="shareMsg"></span></p></div>' +
      '<div id="favList" class="mlist"><div class="empty">You are not following any teams yet. Tap ☆ next to a match or open a team page and press Follow.</div></div>' };
  }
  // fragment for /frag/favorites?teams=1,2,3
  function fragFavorites(ctx, store, idsCsv) {
    var ids = String(idsCsv || '').split(',').map(Number).filter(function (n) { return n > 0; }).slice(0, 40);
    if (!ids.length) return '<div class="empty">You are not following any teams yet. Tap ☆ next to a match or open a team page and press Follow.</div>';
    var seen = {}, list = [];
    ids.forEach(function (id) {
      store.matches({ teamId: id, from: ctx.now - 2 * DAY, to: ctx.now + 7 * DAY, limit: 12 }).forEach(function (m) { if (!seen[m.id]) { seen[m.id] = 1; list.push(m); } });
    });
    list.sort(function (a, b) { return a.kickoff - b.kickoff; });
    return dayList(ctx, list, oddsFor(ctx, store, list), 'No recent or upcoming matches for your teams.');
  }

  // /embed/live/  or  /embed/<sport>/ : compact widget for other sites (e.g. the forum). Query: limit, live=1, odds=1, theme=dark|light, cc
  function pageEmbed(ctx, store, sport, q) {
    var s = sport === 'live' ? sportById(ctx, q.sport || 'football') : sportById(ctx, sport);
    if (!s) return null;
    ctx.sport = s.id;
    if (q.odds !== '1') ctx.bettingOn = false;               // betting content is opt-in for embeds
    ctx.adSlots = [];                                        // never any ads inside the widget
    if (q.theme === 'dark' || q.theme === 'light') ctx.theme = q.theme;
    var r = U.dayRange(U.dateStr(ctx.now, ctx.tz), ctx.tz);
    var list = store.matches({ sport: s.id, from: r[0], to: r[1] });
    var liveOnly = sport === 'live' || q.live === '1';
    var live = list.filter(function (m) { return V.LIVE[m.status]; });
    var chosen = liveOnly && live.length ? live : liveOnly && !live.length ? list.filter(function (m) { return m.status === 'scheduled'; }) : list;
    var limit = Math.max(1, Math.min(60, parseInt(q.limit, 10) || 15));
    var shown = chosen.sort(function (a, b) { return (V.LIVE[b.status] ? 1 : 0) - (V.LIVE[a.status] ? 1 : 0) || b.top - a.top || a.kickoff - b.kickoff; }).slice(0, limit);
    var html = '<div class="mlist" id="mlist">' + V.matchList(ctx, shown, oddsFor(ctx, store, shown), { empty: 'No matches right now.' }) + '</div>';
    return { kind: 'embed', embed: true, heading: s.name + (liveOnly && live.length ? ' · live now' : ' · today'), title: s.name + ' live scores widget', html: html };
  }

  /* ---- static pages ---- */
  function staticPage(ctx, store, slug) {
    var n = ctx.siteName, mail = ctx.contactEmail || 'hello@' + (ctx.siteUrl.replace(/^https?:\/\//, '').replace(/[:/].*$/, '') || 'example.com');
    var P = {
      about: ['About ' + n, '<p>' + E(n) + ' brings you live scores, fixtures, results, standings and odds comparison for football and other major sports, updated in real time.</p><p>We are funded by advertising and by affiliate commissions from bookmakers shown in your region. Affiliate relationships never change the scores or statistics we publish.</p>'],
      contact: ['Contact', '<p>For support, corrections or partnership enquiries email <a href="mailto:' + E(mail) + '">' + E(mail) + '</a>.</p>'],
      advertise: ['Advertise with us', '<p>Reach engaged sports fans with banner placements and bookmaker partnerships targeted by country. Contact <a href="mailto:' + E(mail) + '">' + E(mail) + '</a> for rates and available placements.</p>'],
      terms: ['Terms of use', '<p>' + E(n) + ' provides sports information for general use only. Scores, statistics and odds may be delayed or contain errors and must not be relied upon for betting decisions. We are not a bookmaker and do not accept bets.</p><p>You must be of legal age in your jurisdiction to use any betting service reached through this site. External sites are governed by their own terms.</p><p class="muted small">Template text — have it reviewed by a qualified lawyer for the countries you operate in.</p>'],
      privacy: ['Privacy policy', '<p>We use your approximate location (derived from your IP address, which we do not store) to show the bookmakers and offers available in your country. We store your preferences (odds format, theme, time zone, favourite teams) in your browser.</p><p>When you click an affiliate link we record the bookmaker, your country and the page placement — never your IP address — to measure performance. Advertising partners may set cookies with your consent where required.</p><p class="muted small">Template text — adapt it to your actual ad and analytics partners and have it reviewed by a qualified lawyer.</p>'],
      cookies: ['Cookies', '<p>We use essential cookies to remember your settings and region. In regions that require it, advertising cookies are only used after you accept them. You can change your choice by clearing this site’s cookies.</p><p class="muted small">Template text — replace with the details of your consent management platform.</p>'],
      'responsible-gambling': ['Responsible gambling', '<p>' + E(ctx.bk.compliance.rg_text) + '</p><ul><li>Only bet what you can afford to lose.</li><li>Set deposit and time limits.</li><li>Never chase losses.</li><li>If gambling stops being fun, seek help from a local support organisation.</li></ul>' + (ctx.bk.compliance.rg_url ? '<p><a href="' + E(ctx.bk.compliance.rg_url) + '" target="_blank" rel="noopener">Find support</a></p>' : '')]
    };
    if (!P[slug]) return null;
    withSide(ctx, store, 'football');
    return { kind: 'static', title: P[slug][0], description: P[slug][0] + ' – ' + n, html: '<h1 class="h1">' + E(P[slug][0]) + '</h1><div class="prose card">' + P[slug][1] + '</div>' };
  }

  /* ---------- router ---------- */
  function notFound(ctx, store) {
    withSide(ctx, store, 'football');
    return { status: 404, page: { kind: 'notfound', title: 'Page not found', noindex: true, html: '<h1 class="h1">Page not found</h1><div class="empty">We couldn’t find that page. <a href="/">Go to today’s matches</a>.</div>' } };
  }

  // inp: { path, query, cookies, cc, countryName, now, cfg, needConsent }
  function handle(store, inp) {
    var ctx = makeCtx(store, inp), p = inp.path.replace(/\/{2,}/g, '/'), q = inp.query || {};
    var parts = p.split('/').filter(Boolean), page = null, status = 200, r;
    var sports = ctx.sports.map(function (s) { return s.id; });

    if (!parts.length) page = pageSport(ctx, store, 'football', q);
    else if (parts[0] === 'embed' && parts.length === 2) page = pageEmbed(ctx, store, parts[1], q);
    else if (parts[0] === 'search' && parts.length === 1) page = pageSearch(ctx, store, String(q.q || '').slice(0, 60));
    else if (parts[0] === 'favorites' && parts.length === 1) page = pageFavorites(ctx, store);
    else if (parts[0] === 'frag' && parts[1] === 'favorites') return { ctx: ctx, status: 200, fragment: fragFavorites(ctx, store, q.teams) };
    else if (parts[0] === 'team' && parts.length >= 3 && /^\d+$/.test(parts[2])) page = pageTeam(ctx, store, parts[1], Number(parts[2]), parts[3]);
    else if (parts[0] === 'match' && parts.length === 3 && /^\d+$/.test(parts[2])) page = pageMatch(ctx, store, parts[1], Number(parts[2]), q);
    else if (parts.length === 1 && staticPage(ctx, store, parts[0])) page = staticPage(ctx, store, parts[0]);
    else if (sports.indexOf(parts[0]) !== -1) {
      if (parts.length === 1) page = parts[0] === 'football' ? { redirect: '/' } : pageSport(ctx, store, parts[0], q);
      else if (parts.length === 2) page = pageCountry(ctx, store, parts[0], parts[1]);
      else if (parts.length === 3) page = pageLeague(ctx, store, parts[0], parts[1], parts[2], '');
      else if (parts.length === 4) page = pageLeague(ctx, store, parts[0], parts[1], parts[2], parts[3]);
    }
    if (page && page.redirect) return { ctx: ctx, redirect: page.redirect, status: 301 };
    if (page && page.fragment != null) return { ctx: ctx, status: 200, fragment: page.fragment };
    if (!page) { r = notFound(ctx, store); page = r.page; status = r.status; }
    return { ctx: ctx, status: status, page: page, html: V.document(ctx, page) };
  }

  return { handle: handle, makeCtx: makeCtx, standingsTable: standingsTable };
});
