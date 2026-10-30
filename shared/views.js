// shared/views.js — HTML building blocks (isomorphic: Node for SSR, browser for the standalone preview).
(function (root, factory) {
  var api = factory(typeof require === 'function' && typeof module === 'object' ? { U: require('./util'), O: require('./odds'), B: require('./bookmakers') } : { U: root.LSN.util, O: root.LSN.odds, B: root.LSN.bookmakers });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LSN = root.LSN || {}; root.LSN.views = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var U = dep.U, O = dep.O, E = U.esc;

  var LIVE = { live: 1, halftime: 1, 'break': 1 };
  var PERIOD = { basketball: 'Q', hockey: 'P', 'american-football': 'Q', handball: 'H', rugby: 'H', tennis: 'S', volleyball: 'S', baseball: 'Inn ' };

  /* ---------- urls ---------- */
  function teamUrl(t) { return '/team/' + t.slug + '/' + t.id + '/'; }
  function matchUrl(m) { return '/match/' + m.home.slug + '-vs-' + m.away.slug + '/' + m.id + '/'; }
  function leagueUrl(sport, country, league, tab) { return '/' + sport + '/' + country.slug + '/' + league.slug + '/' + (tab ? tab + '/' : ''); }
  function sportUrl(id) { return id === 'football' ? '/' : '/' + id + '/'; }

  /* ---------- status text ---------- */
  function statusOf(m, tz) {
    var s = m.status;
    if (LIVE[s]) {
      if (s === 'halftime') return { cls: 'ht', live: true, text: m.sport === 'football' || m.sport === 'handball' || m.sport === 'rugby' ? 'HT' : 'Break' };
      var lab = PERIOD[m.sport], t;
      if (m.sport === 'football') t = (m.minute != null ? m.minute + "'" : 'Live');
      else if (m.sport === 'tennis' || m.sport === 'volleyball') t = lab + (m.period || 1);
      else t = lab + (m.period || 1) + (m.minute != null && m.sport !== 'baseball' ? ' ' + m.minute + "'" : '');
      return { cls: 'live', live: true, text: t };
    }
    if (s === 'finished') return { cls: 'fin', live: false, text: 'FT' };
    if (s === 'postponed') return { cls: 'pp', live: false, text: 'PP' };
    if (s === 'cancelled') return { cls: 'pp', live: false, text: 'Canc' };
    return { cls: 'sch', live: false, text: U.fmtTime(m.kickoff, tz), time: true };
  }
  function stKey(m) { return LIVE[m.status] ? (m.status === 'live' ? 'live' : 'ht') : m.status === 'finished' ? 'fin' : m.status === 'scheduled' ? 'sch' : 'pp'; }
  function hasScore(m) { return m.hs != null && m.as != null && m.status !== 'scheduled' && m.status !== 'postponed' && m.status !== 'cancelled'; }

  /* ---------- forum (sister site) links ---------- */
  function forumMatchLink(ctx, m) {
    if (!ctx.forumUrl) return '';
    var q = m.home.name + ' vs ' + m.away.name;
    var tpl = ctx.forumMatchUrl || (ctx.forumUrl + '/search?q={query}');
    return tpl.replace(/\{(query|home|away|league)\}/g, function (_, k) { return encodeURIComponent({ query: q, home: m.home.name, away: m.away.name, league: m.league.name }[k]); });
  }

  /* ---------- small pieces ---------- */
  function flag(code, cls) {
    var u = U.flagUrl(code, 20);
    if (!u) return '<span class="flag fl-globe ' + (cls || '') + '" aria-hidden="true">🌐</span>';
    return '<img class="flag ' + (cls || '') + '" src="' + E(u) + '" alt="" width="20" height="14" loading="lazy" onerror="this.style.visibility=\'hidden\'">';
  }
  function crest(t, cls) {
    if (t.logo) return '<img class="crest ' + (cls || '') + '" src="' + E(t.logo) + '" alt="" loading="lazy">';
    var ini = String(t.name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?';
    return '<span class="crest ini ' + (cls || '') + '" style="--h:' + (U.hash32(t.name) % 360) + '" aria-hidden="true">' + E(ini) + '</span>';
  }
  function bkChip(b) { return '<span class="bkchip" style="--c:' + E(b.color || '#555') + '" title="' + E(b.name) + '">' + E(b.short_code || b.name.slice(0, 2)) + '</span>'; }
  function goUrl(bkId, matchId, placement) { return '/go/' + bkId + '?p=' + encodeURIComponent(placement || '') + (matchId ? '&m=' + matchId : ''); }
  function cta(b, matchId, placement, label) {
    return '<a class="cta" href="' + goUrl(b.id, matchId, placement) + '" target="_blank" rel="sponsored nofollow noopener">' + E(label || 'Bet now') + '</a>';
  }

  function oddCell(c, bkId, matchId, ctx, placement) {
    var v = c.value;
    return '<a class="odd' + (c.trend ? ' ' + c.trend : '') + '" data-dec="' + v + '" data-sel="' + E(c.sel) + '" href="' + goUrl(bkId, matchId, placement || 'list') + '" target="_blank" rel="sponsored nofollow noopener" title="Odds from ' + '">' + E(U.formatOdd(v, ctx.oddsFmt)) + '</a>';
  }

  /* ---------- match row ---------- */
  function perHtml(m) {
    if (!(m.periods && m.periods.length && m.sport !== 'football' && m.status !== 'scheduled')) return '';
    return m.periods.map(function (p) { return '<i><u>' + p.home + '</u><u>' + p.away + '</u></i>'; }).join('');
  }
  function scoreCell(m) {
    if (!hasScore(m)) return '<span class="mr-score"><span class="sc"><b class="sh"></b><b class="sa"></b></span><span class="mr-per"></span></span>';
    return '<span class="mr-score"><span class="sc"><b class="sh">' + m.hs + '</b><b class="sa">' + m.as + '</b></span><span class="mr-per">' + perHtml(m) + '</span></span>';
  }

  function matchRow(m, ctx, prim) {
    var st = statusOf(m, ctx.tz), cfg = O.MAIN_MARKET[m.sport] || O.MAIN_MARKET.football, odds = '';
    if (ctx.bettingOn) {
      if (prim && m.status !== 'finished') {
        odds = '<span class="mr-odds" data-bk="' + prim.bookmaker_id + '">' + bkChip({ short_code: shortOf(ctx, prim.bookmaker_id), name: prim.bookmaker_name, color: colorOf(ctx, prim.bookmaker_id) }) +
          prim.cells.map(function (c) { return oddCell(c, prim.bookmaker_id, m.id, ctx); }).join('') + '</span>';
      } else {
        odds = '<span class="mr-odds none">' + cfg.sels.map(function () { return '<span class="odd na">–</span>'; }).join('') + '</span>';
      }
    }
    return '<div class="mrow s-' + stKey(m) + '" id="m' + m.id + '" data-id="' + m.id + '" data-st="' + stKey(m) + '" data-h="' + m.home.id + '" data-a="' + m.away.id + '" data-lg="' + m.league.id + '" data-sport="' + m.sport + '" data-ko="' + m.kickoff + '"' + (odds && prim && m.status !== 'finished' ? ' data-odds="1"' : '') + '>' +
      '<span class="mr-fav" role="button" tabindex="0" aria-label="Follow teams" data-follow="' + m.id + '">☆</span>' +
      '<span class="mr-st ' + st.cls + '">' + (st.time ? '<time data-ts="' + m.kickoff + '">' + E(st.text) + '</time>' : E(st.text)) + '</span>' +
      '<a class="mr-teams" href="' + matchUrl(m) + '" target="_blank" rel="noopener">' +
        '<span class="tm th">' + crest(m.home) + '<span class="tn">' + E(m.home.name) + '</span></span>' +
        '<span class="tm ta">' + crest(m.away) + '<span class="tn">' + E(m.away.name) + '</span></span>' +
      '</a>' + scoreCell(m) + odds + '</div>';
  }
  function bkOf(ctx, id) { for (var i = 0; i < ctx.bk.items.length; i++) if (ctx.bk.items[i].id === id) return ctx.bk.items[i]; return null; }
  function shortOf(ctx, id) { var b = bkOf(ctx, id); return b ? b.short_code : ''; }
  function colorOf(ctx, id) { var b = bkOf(ctx, id); return b ? b.color : ''; }

  function leagueHead(ctx, sport, lg, country) {
    return '<div class="lg-head" data-lg="' + lg.id + '">' +
      '<span class="pin" role="button" tabindex="0" aria-label="Pin league" data-pin="' + lg.id + '">☆</span>' +
      flag(country.code) + '<a class="lg-name" href="' + leagueUrl(sport, country, lg) + '"><b>' + E(country.name.toUpperCase()) + ':</b> ' + E(lg.name) + '</a>' +
      '<span class="lg-links"><a href="' + leagueUrl(sport, country, lg, 'standings') + '">Standings</a></span></div>';
  }

  // matches: shaped matches; oddsMap: Map id -> odds rows
  function matchList(ctx, matches, oddsMap, opts) {
    opts = opts || {};
    if (!matches.length) return '<div class="empty">' + E(opts.empty || 'No matches found for this selection.') + '</div>';
    var groups = [], idx = {};
    matches.forEach(function (m) {
      var g = idx[m.league.id];
      if (!g) { g = idx[m.league.id] = { league: m.league, country: m.country, sport: m.sport, list: [] }; groups.push(g); }
      g.list.push(m);
    });
    groups.sort(function (a, b) {
      return (b.league.top - a.league.top) || (a.country.kind === 'region' ? -1 : 0) - (b.country.kind === 'region' ? -1 : 0) || a.country.name.localeCompare(b.country.name) || a.league.name.localeCompare(b.league.name);
    });
    var html = '', n = 0;
    groups.forEach(function (g, i) {
      html += '<section class="lg" data-lg="' + g.league.id + '">' + leagueHead(ctx, g.sport, g.league, g.country) +
        g.list.map(function (m) { return matchRow(m, ctx, ctx.bettingOn ? O.primary(oddsMap.get(m.id) || [], ctx.bk.items, m.sport) : null); }).join('') + '</section>';
      n++;
      if (opts.infeed && n === 3 && i < groups.length - 1) html += adSlot(ctx, 'infeed');
    });
    return html;
  }

  /* ---------- ads & house banners ---------- */
  function slotAllowed(ctx, s) {
    if (!s || !Number(s.active)) return false;
    if (Number(s.betting_related) && !ctx.bk.compliance.betting_allowed) return false;
    var inc = String(s.countries_include || '').split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
    var exc = String(s.countries_exclude || '').split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
    if (exc.indexOf(ctx.cc) !== -1) return false;
    if (inc.length && inc.indexOf(ctx.cc) === -1) return false;
    return true;
  }
  function slotOf(ctx, key) { for (var i = 0; i < ctx.adSlots.length; i++) if (ctx.adSlots[i].slot_key === key) return ctx.adSlots[i]; return null; }

  // Built-in banner for slots that have no third-party ad code: a geo-targeted bookmaker offer. Each bookmaker is
  // used at most once per page (so a region with one bookmaker does not see the same banner three times).
  function houseBanner(ctx, s, matchId) {
    if (!ctx.bettingOn) return '';
    var all = ctx.bk.items, used = ctx._house || 0;
    if (used >= all.length) return '';
    var horizontal = !s.height || s.height <= 120 || s.placement === 'infeed';
    if (horizontal) {
      var b = all[used]; ctx._house = used + 1;
      return '<div class="house h" data-ad-house="1">' + bkChip(b) + '<div class="hb-t"><b>' + E(b.name) + '</b><span>' + E(b.offer || 'Bet on today’s matches') + '</span></div>' + cta(b, matchId, 'banner-' + s.slot_key, 'Bet now') + '<small>Ad · ' + ctx.bk.compliance.min_age + '+ · T&amp;Cs apply</small></div>';
    }
    var items = all.slice(used, used + (s.height >= 250 ? 3 : 2)); ctx._house = used + items.length;
    return '<div class="house v' + (s.width && s.width <= 200 ? ' narrow' : '') + '" data-ad-house="1"><div class="hb-h">More offers in ' + E(ctx.countryName) + '</div>' +
      items.map(function (b) { return '<div class="hb-i">' + bkChip(b) + '<div class="hb-t"><b>' + E(b.name) + '</b><span>' + E(b.offer || '') + '</span></div>' + cta(b, matchId, 'banner-' + s.slot_key, 'Bet now') + '</div>'; }).join('') +
      '<small>Ad · ' + ctx.bk.compliance.min_age + '+ · T&amp;Cs apply</small></div>';
  }

  function adSlot(ctx, key, matchId) {
    var s = slotOf(ctx, key);
    if (!s || !slotAllowed(ctx, s)) return '';
    var size = '', inner = '';
    if (s.ad_code) size = s.width && s.height ? 'min-height:' + s.height + 'px;max-width:' + s.width + 'px' : '';
    if (s.ad_code) inner = '<template class="ad-code">' + s.ad_code + '</template>' + (s.fallback_code ? '<template class="ad-fallback">' + s.fallback_code + '</template>' : '');
    else if (s.fallback_code) inner = s.fallback_code;
    else {
      inner = houseBanner(ctx, s, matchId);
      if (!inner && ctx.isMock) inner = '<div class="ad-ph">Ad slot · ' + E(s.label) + (s.width ? ' · ' + s.width + '×' + s.height : '') + '</div>';
      if (!inner) return '';
    }
    return '<div class="ad ad-' + E(s.placement) + '" data-slot="' + E(s.slot_key) + '" data-consent="' + (ctx.needConsent ? '1' : '') + '" style="' + size + '"><span class="ad-lab">Advertisement</span>' + inner + '</div>';
  }

  /* ---------- chrome ---------- */
  var MAIN_SPORTS = ['football', 'basketball', 'tennis', 'volleyball', 'handball', 'american-football', 'baseball'];
  function sportTabs(ctx) {
    function tab(s, cls) {
      var n = ctx.liveCounts[s.id] || 0;
      return '<a class="stab' + cls + (ctx.sport === s.id ? ' on' : '') + '" href="' + sportUrl(s.id) + '"><i>' + s.icon + '</i><span>' + E(s.name) + '</span>' + (n ? '<em class="lc">' + n + '</em>' : '') + '</a>';
    }
    var main = ctx.sports.filter(function (s) { return MAIN_SPORTS.indexOf(s.id) >= 0 || ctx.sports.length <= 7; });
    var more = ctx.sports.filter(function (s) { return main.indexOf(s) < 0; });
    var moreOn = more.some(function (s) { return s.id === ctx.sport; });
    var moreLive = more.reduce(function (t, s) { return t + (ctx.liveCounts[s.id] || 0); }, 0);
    return '<nav class="stabs" aria-label="Sports"><div class="wrap stabs-in">' +
      (ctx.forumUrl ? '<a class="forum-btn" href="' + E(ctx.forumUrl) + '"><i>💬</i><span>' + E(ctx.forumName) + '</span><b>›</b></a>' : '') +
      main.map(function (s) { return tab(s, ''); }).join('') +
      more.map(function (s) { return tab(s, ' xtra'); }).join('') +
      (more.length ? '<details class="morebox' + (moreOn ? ' on' : '') + '"><summary class="stab"><span>More</span>' + (moreLive ? '<em class="lc">' + moreLive + '</em>' : '') + '<i class="car">▾</i></summary><div class="morepanel">' +
        more.map(function (s) { var n = ctx.liveCounts[s.id] || 0; return '<a href="' + sportUrl(s.id) + '"' + (ctx.sport === s.id ? ' class="on"' : '') + '><i>' + s.icon + '</i><span>' + E(s.name) + '</span>' + (n ? '<em class="lc">' + n + '</em>' : '') + '</a>'; }).join('') + '</div></details>' : '') +
      '</div></nav>';
  }

  var MARK = '<svg class="logo-mark" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#143a5f"/><stop offset="1" stop-color="#0b1f33"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#lg1)"/><circle cx="32" cy="33" r="19" fill="none" stroke="#18c37e" stroke-width="5"/><path d="M17 34h8l4-9 6 17 4-8h8" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="14" r="6" fill="#e5252a" stroke="#0b1f33" stroke-width="2.5"/></svg>';

  function header(ctx) {
    return '<header class="top"><div class="wrap top-in">' +
      '<button class="icon-btn menu-btn" id="menuBtn" aria-label="Menu">☰</button>' +
      '<a class="logo" href="/" aria-label="' + E(ctx.siteName) + '">' + MARK + '<span class="lg-w"><span class="lg-a">LIVE</span><span class="lg-b">SCORE</span><span class="lg-c">NOW</span></span></a>' +
      '<form class="search" action="/search/" method="get" role="search"><input id="q" name="q" type="search" placeholder="Search teams, leagues…" autocomplete="off" aria-label="Search" value="' + E(ctx.q || '') + '"><button aria-label="Search">🔍</button><div class="sugg" id="sugg" hidden></div></form>' +
      '<div class="top-actions">' +
        '<button class="icon-btn search-btn" id="searchBtn" aria-label="Search">🔍</button>' +
        '<a class="icon-btn" href="/favorites/" title="My teams">★<span class="lbl">My teams</span></a>' +
        (ctx.showCountryPicker ? '<button class="icon-btn cc-btn" id="ccBtn" title="Your region: ' + E(ctx.countryName) + '. Bookmakers shown depend on this.">' + flag(ctx.cc) + '<span>' + E(ctx.cc === 'ZZ' ? 'Region' : ctx.cc) + '</span></button>' : '') +
        '<button class="icon-btn" id="setBtn" aria-label="Settings">⚙</button>' +
      '</div></div>' +
      '<div class="pop" id="setPop" hidden><h4>Settings</h4>' +
        '<label>Odds format<select id="setOdds"><option value="decimal">Decimal (1.85)</option><option value="fractional">Fractional (17/20)</option><option value="american">American (-118)</option></select></label>' +
        '<label>Theme<select id="setTheme"><option value="auto">Match device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>' +
        '<label>Time zone<select id="setTz"></select></label><label class="chk"><input type="checkbox" id="setAlerts"> Alerts for my teams (goals, kick-off, full-time)</label></div>' +
      (ctx.showCountryPicker ? '<div class="pop" id="ccPop" hidden><h4>Choose your country</h4><p class="muted">Bookmakers and offers are shown according to the country you pick or we detect.</p><input id="ccFilter" type="search" placeholder="Search country…" aria-label="Search country"><ul id="ccList"></ul></div>' : '') +
      '</header>';
  }

  var CONT = {
    Europe: 'ENG SCO WAL NIR AL AD AM AT AZ BY BE BA BG HR CY CZ DK EE FO FI FR GE DE GI GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB',
    Africa: 'DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW',
    Asia: 'AF BH BD BT BN KH CN HK IN ID IR IQ IL JP JO KZ KW KG LA LB MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TM AE UZ VN YE',
    'North & Central America': 'US CA MX AG BS BB BZ CR CU DM DO SV GD GT HT HN JM NI PA KN LC VC TT PR',
    'South America': 'AR BO BR CL CO EC GY PY PE SR UY VE',
    Oceania: 'AU NZ FJ PG WS SB TO VU'
  };
  var CONT_OF = {};
  Object.keys(CONT).forEach(function (k) { CONT[k].split(' ').forEach(function (c) { CONT_OF[c] = k; }); });
  var CONT_ORDER = ['Europe', 'Africa', 'Asia', 'North & Central America', 'South America', 'Oceania', 'Other'];
  var INTL_NAME = { EUR: 'Europe', AFR: 'Africa', ATP: 'ATP', WTA: 'WTA', INT: 'World' };

  function countryRow(ctx, g) {
    return '<details' + (ctx.openCountry === g.country.slug ? ' open' : '') + '><summary>' + flag(g.country.code) + '<a href="/' + ctx.sport + '/' + g.country.slug + '/">' + E(g.country.name) + '</a><small>' + g.leagues.length + '</small></summary><ul>' +
      g.leagues.map(function (l) { return '<li><a href="' + leagueUrl(ctx.sport, g.country, l) + '">' + E(l.name) + '</a></li>'; }).join('') + '</ul></details>';
  }

  // Left-hand tree: international competitions first, then countries grouped by continent.
  function menuTree(ctx, menu) {
    if (!menu.length) return '';
    var intl = menu.filter(function (g) { return g.country.kind === 'region'; });
    var groups = {};
    menu.forEach(function (g) {
      if (g.country.kind === 'region') return;
      var c = CONT_OF[g.country.code] || 'Other';
      (groups[c] = groups[c] || []).push(g);
    });
    var hasOpen = function (list) { return list.some(function (g) { return ctx.openCountry === g.country.slug; }); };
    var out = '';
    if (intl.length) out += '<div class="box"><h3>International</h3><div class="tree">' + intl.map(function (g) { return countryRow(ctx, g); }).join('') + '</div></div>';
    var conts = CONT_ORDER.filter(function (c) { return groups[c] && groups[c].length; });
    if (conts.length) {
      out += '<div class="box"><h3>Countries</h3>' + conts.map(function (c) {
        var list = groups[c].slice().sort(function (a, b) { return a.country.name.localeCompare(b.country.name); });
        var open = hasOpen(list) || (c === 'Europe' && !conts.some(function (k) { return hasOpen(groups[k]); }));
        return '<details class="cont"' + (open ? ' open' : '') + '><summary><b>' + E(c) + '</b><small>' + list.length + '</small></summary><div class="tree">' + list.map(function (g) { return countryRow(ctx, g); }).join('') + '</div></details>';
      }).join('') + '</div>';
    }
    return out;
  }

  function leftSide(ctx) {
    var top = ctx.topLeagues || [], menu = ctx.menu || [];
    return '<aside class="side left" id="leftSide">' +
      (ctx.forumUrl ? '<div class="box forumbox"><a href="' + E(ctx.forumUrl) + '"><b>💬 ' + E(ctx.forumName) + '</b><span>Discuss matches, tips and teams with the community ›</span></a></div>' : '') +
      '<div class="box"><h3>Pinned leagues</h3><ul class="links" id="pinned"><li class="muted small">Tap ☆ next to a league to pin it here.</li></ul></div>' +
      '<div class="box"><h3>My teams</h3><ul class="links" id="myteams"><li class="muted small">Follow teams with ☆ — they appear here.</li></ul><a class="boxlink" href="/favorites/">Open my teams ›</a></div>' +
      (top.length ? '<div class="box"><h3>Top leagues</h3><ul class="links">' + top.map(function (l) { return '<li><a href="' + leagueUrl(ctx.sport, l.country, l) + '">' + flag(l.country.code) + '<span>' + E(l.name) + '</span><small>' + E(l.country.name) + '</small></a></li>'; }).join('') + '</ul></div>' : '') +
      menuTree(ctx, menu) + '</aside>';
  }

  function offersBox(ctx, title) {
    if (!ctx.bettingOn) return '';
    return '<div class="box offers"><h3>' + E(title || 'Top bookmakers in ' + ctx.countryName) + '</h3>' + ctx.bk.items.slice(0, 5).map(function (b, i) {
      return '<div class="of-i">' + bkChip(b) + '<div class="of-t"><b>' + E(b.name) + '</b><span>' + E(b.offer || '') + '</span></div>' + cta(b, null, 'sidebar-offers', 'Visit') + '</div>';
    }).join('') + '<small class="muted">' + ctx.bk.compliance.min_age + '+ · Ad · T&amp;Cs apply. ' + E(ctx.bk.compliance.rg_text) + '</small></div>';
  }

  function rightSide(ctx) {
    return '<aside class="side right">' + adSlot(ctx, 'sidebar-1') + offersBox(ctx) + adSlot(ctx, 'sidebar-2') + '</aside>';
  }

  function footer(ctx) {
    var c = ctx.bk.compliance;
    return '<footer class="foot"><div class="wrap">' +
      (ctx.bettingOn ? '<div class="rg"><span class="age">' + c.min_age + '+</span><p>' + E(c.rg_text) + (c.rg_url ? ' <a href="' + E(c.rg_url) + '" target="_blank" rel="noopener">Get help</a>' : '') + (c.license_text ? ' ' + E(c.license_text) : '') + '</p></div>' : '') +
      '<div class="cols"><div><h5>Sports</h5>' + ctx.sports.map(function (s) { return '<a href="' + sportUrl(s.id) + '">' + E(s.name) + '</a>'; }).join('') + '</div>' +
      '<div><h5>' + E(ctx.siteName) + '</h5><a href="/about/">About</a><a href="/contact/">Contact</a><a href="/advertise/">Advertise</a><a href="/favorites/">My teams</a>' + (ctx.forumUrl ? '<a href="' + E(ctx.forumUrl) + '">' + E(ctx.forumName) + '</a>' : '') + '</div>' +
      '<div><h5>Legal</h5><a href="/terms/">Terms of use</a><a href="/privacy/">Privacy policy</a><a href="/cookies/">Cookies</a><a href="/responsible-gambling/">Responsible gambling</a></div></div>' +
      '<p class="disc">' + E(ctx.siteName) + ' provides scores and statistics for information only. Some links on this site are affiliate links: we may earn a commission if you sign up with a bookmaker, at no cost to you. Odds are indicative and may change; always check the bookmaker’s site. Betting is for adults only and may be restricted where you live.</p>' +
      '<p class="disc">Bookmakers shown are chosen for your region (' + E(ctx.countryName) + '). <a href="https://db-ip.com" target="_blank" rel="noopener">IP Geolocation by DB-IP</a> · © ' + new Date(ctx.now * 1000).getUTCFullYear() + ' ' + E(ctx.siteName) + '</p>' +
      '</div></footer>';
  }

  function consentBanner(ctx) {
    if (!ctx.needConsent || ctx.consent) return '';
    return '<div class="consent" id="consent" role="dialog" aria-label="Cookie consent"><p>We use cookies for ads and to remember your settings. Advertising cookies are only used with your consent. <a href="/cookies/">Learn more</a></p><div><button class="btn ghost" data-consent="no">Reject</button><button class="btn" data-consent="yes">Accept</button></div></div>';
  }

  function shell(ctx, page) {
    return (ctx.isMock ? '<div class="demo">Demo mode: scores, fixtures and odds are simulated. Connect a real data provider in <code>.env</code> to go live.</div>' : '') +
      header(ctx) + sportTabs(ctx) +
      '<div class="wrap ad-top">' + adSlot(ctx, 'leaderboard') + '</div>' +
      '<div class="wrap layout' + (ctx.bettingOn ? '' : ' no-odds') + '">' +
        '<div class="col-left">' + leftSide(ctx) + adSlot(ctx, 'left-skyscraper') + '</div>' +
        '<main class="main" id="main">' + page.html + '</main>' +
        '<div class="col-right">' + rightSide(ctx) + '</div>' +
      '</div>' + footer(ctx) + adSlot(ctx, 'mobile-sticky') + consentBanner(ctx) + '<div id="toasts" aria-live="polite"></div>';
  }

  function pageConfig(ctx, page) {
    return { cc: ctx.cc, odds: ctx.oddsFmt, tz: ctx.tz, siteTz: ctx.siteTz, needConsent: !!ctx.needConsent, consent: ctx.consent || '', ccq: ctx.ccSource === 'query' ? ctx.cc : '', sport: ctx.sport, page: page.kind || '', matchId: page.matchId || 0, live: !!ctx.streamOn, mock: !!ctx.isMock };
  }

  function embedDoc(ctx, page) {
    return '<!doctype html><html lang="en" data-theme="' + E(ctx.theme) + '" class="no-js embed"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + E(page.title || ctx.siteName) + '</title><meta name="robots" content="noindex,follow"><base href="' + E(ctx.siteUrl) + '/" target="_blank">' +
      '<script>document.documentElement.className="js embed";</script><link rel="stylesheet" href="/assets/style.css?v=' + E(ctx.assetV) + '"></head><body class="embedbody">' +
      '<div class="emb-head"><a href="' + E(ctx.siteUrl) + '/" class="emb-logo">' + MARK + '<b>LiveScoreNow</b></a><span>' + E(page.heading || 'Live scores') + '</span></div>' +
      '<main class="main" id="main">' + page.html + '</main>' +
      '<div class="emb-foot"><a href="' + E(ctx.siteUrl) + '/">Powered by ' + E(ctx.siteName) + '</a></div>' +
      '<script>window.LSN_CFG=' + JSON.stringify(pageConfig(ctx, page)).replace(/</g, '\\u003c') + ';</script><script src="/assets/app.js?v=' + E(ctx.assetV) + '" defer></script></body></html>';
  }

  function document_(ctx, page) {
    if (page.embed) return embedDoc(ctx, page);
    var title = page.title ? page.title + ' | ' + ctx.siteName : ctx.siteName + ' – ' + ctx.tagline;
    var canon = ctx.siteUrl + (page.canonical || ctx.path);
    return '<!doctype html><html lang="en" data-theme="' + E(ctx.theme) + '" class="no-js"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + E(title) + '</title><meta name="description" content="' + E(page.description || ctx.tagline) + '">' +
      (page.noindex ? '<meta name="robots" content="noindex,follow">' : '') +
      '<link rel="canonical" href="' + E(canon) + '"><meta name="theme-color" content="#0b1f33">' +
      '<meta property="og:title" content="' + E(title) + '"><meta property="og:description" content="' + E(page.description || ctx.tagline) + '"><meta property="og:type" content="website"><meta property="og:site_name" content="' + E(ctx.siteName) + '">' +
      '<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png"><link rel="alternate icon" href="/assets/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png"><meta property="og:image" content="' + E(ctx.siteUrl) + '/assets/og-image.png"><meta name="twitter:card" content="summary_large_image">' +
      '<script>document.documentElement.className="js";</script>' +
      '<link rel="stylesheet" href="/assets/style.css?v=' + E(ctx.assetV) + '">' +
      (page.jsonld ? '<script type="application/ld+json">' + JSON.stringify(page.jsonld).replace(/</g, '\\u003c') + '</script>' : '') +
      '</head><body>' + shell(ctx, page) +
      '<script>window.LSN_CFG=' + JSON.stringify(pageConfig(ctx, page)).replace(/</g, '\\u003c') + ';</script>' +
      '<script src="/assets/app.js?v=' + E(ctx.assetV) + '" defer></script></body></html>';
  }

  return {
    LIVE: LIVE, teamUrl: teamUrl, matchUrl: matchUrl, leagueUrl: leagueUrl, sportUrl: sportUrl, statusOf: statusOf, stKey: stKey, hasScore: hasScore,
    flag: flag, crest: crest, bkChip: bkChip, cta: cta, goUrl: goUrl, oddCell: oddCell, matchRow: matchRow, perHtml: perHtml, matchList: matchList, adSlot: adSlot,
    offersBox: offersBox, forumMatchLink: forumMatchLink, shell: shell, document: document_, pageConfig: pageConfig, slotAllowed: slotAllowed, houseBanner: houseBanner
  };
});
