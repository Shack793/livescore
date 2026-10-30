/* Standalone preview runtime: renders the SAME pages as the server, in the browser, from the demo world. */
(function () {
  'use strict';
  var LSN = window.LSN, DATA = window.LSN_PREVIEW_DATA;
  LSN.preview = true;
  var U = LSN.util, V = LSN.views, P = LSN.pages, O = LSN.odds, B = LSN.bookmakers;
  var dn; try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { dn = null; }
  function nameOf(c) { try { var n = dn && dn.of(c); return n && n !== c ? n : (c === 'XK' ? 'Kosovo' : c); } catch (e) { return c; } }
  var store = LSN.storeMemory.create({ countryName: nameOf, regions: DATA.regions });
  var deviceTz = 'UTC'; try { deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* ignore */ }
  var root = document.getElementById('root');
  var cfg = { siteName: 'LiveScoreNow', siteUrl: location.origin && location.origin !== 'null' ? location.origin : 'https://livescorenow.example', siteTz: deviceTz, assetV: 'p', contactEmail: 'hello@livescorenow.example', forumUrl: 'https://www.pitchsideforum.com', forumName: 'Pitchside Forum', showCountryPicker: false };

  // Country is detected automatically (like the real site does on the server). The preview is a static page, so it asks a
  // free IP-country service from the browser; ?cc=NG on the page address overrides it for testing. No visible country picker.
  var cc = 'GH', detected = false;
  function fromLang() { var m = String(navigator.language || '').match(/-([A-Z]{2})$/); return m && DATA.iso.indexOf(m[1]) !== -1 ? m[1] : 'GH'; }
  function detectCc(done) {
    var q = new URLSearchParams(location.search).get('cc');
    if (q && DATA.iso.indexOf(q.toUpperCase()) !== -1) { cc = q.toUpperCase(); return done(); }
    var finished = false; function fin(c) { if (finished) return; finished = true; cc = c && DATA.iso.indexOf(c) !== -1 ? c : fromLang(); done(); }
    var t = setTimeout(function () { fin(''); }, 2500);
    try { fetch('https://api.country.is/').then(function (r) { return r.json(); }).then(function (j) { clearTimeout(t); fin(String(j.country || '').toUpperCase()); }).catch(function () { clearTimeout(t); fin(''); }); } catch (e) { clearTimeout(t); fin(''); }
  }

  function cookies() {
    var o = {}; ['lsn_tz', 'lsn_odds', 'lsn_theme', 'lsn_consent'].forEach(function (k) { var v = LSN.app.getCookie(k); if (v) o[k] = v; });
    return o;
  }
  function run(pathAndQuery) {
    var u = new URL(pathAndQuery, 'http://x'), q = {};
    u.searchParams.forEach(function (v, k) { if (!(k in q)) q[k] = v; });
    return P.handle(store, { path: u.pathname, query: q, cookies: cookies(), cc: cc, ccSource: '', countryName: nameOf(cc), now: Math.floor(Date.now() / 1000), cfg: cfg, needConsent: DATA.consent.indexOf(cc) !== -1, streamOn: true });
  }
  function routeOf() { var h = location.hash || ''; return h.indexOf('#/') === 0 ? h.slice(1) : '/'; }

  function render() {
    var out = run(routeOf());
    if (out.redirect) { location.hash = '#' + out.redirect; return; }
    if (out.fragment != null) return;
    document.documentElement.setAttribute('data-theme', out.ctx.theme);
    document.documentElement.className = 'js';
    document.title = out.page.title ? out.page.title + ' | LiveScoreNow' : 'LiveScoreNow';
    window.LSN_CFG = V.pageConfig(out.ctx, out.page);
    root.innerHTML = V.shell(out.ctx, out.page);
    window.scrollTo(0, 0);
    LSN.app.init();
  }

  // ---- hooks used by app.js ----
  Object.assign(LSN.hooks, {
    fetchText: function (u) { var o = run(u); return Promise.resolve(o.fragment != null ? o.fragment : o.html || ''); },
    fetchJSON: function (u) {
      if (u.indexOf('/api/countries') === 0) return Promise.resolve(DATA.iso.map(function (c) { return [c, nameOf(c)]; }).sort(function (a, b) { return a[1].localeCompare(b[1]); }));
      if (u.indexOf('/api/search') === 0) { var q = decodeURIComponent((u.split('q=')[1] || '').split('&')[0]); var r = store.search(q, 6); return Promise.resolve({ teams: r.teams.map(function (t) { return { id: t.id, name: t.name, slug: t.slug, sport: t.sport }; }), leagues: r.leagues.map(function (l) { return { id: l.id, name: l.name, slug: l.slug, sport: l.sport, country: { name: l.country.name, slug: l.country.slug } }; }) }); }
      if (u.indexOf('/api/teams') === 0) { var ids = (u.split('ids=')[1] || '').split(',').map(Number); return Promise.resolve(ids.map(function (i) { return store.team(i); }).filter(Boolean).map(function (t) { return { id: t.id, name: t.name, slug: t.slug }; })); }
      return Promise.reject(new Error('n/a'));
    },
    navigate: function (u) { location.hash = '#' + u; },
    openNew: function (u) { var w = window.open(location.href.split('#')[0] + '#' + u, '_blank'); if (!w) location.hash = '#' + u; },
    query: function () { var h = location.hash || ''; var i = h.indexOf('?'); return new URLSearchParams(i === -1 ? '' : h.slice(i)); },
    shareUrl: function (ids) { return location.href.split('#')[0] + '#/favorites/?teams=' + ids; },
    setRegion: function () {},
    stream: function (on) {
      var n = 0;
      var t = setInterval(function () {
        n++;
        var ch = store.refresh();
        if (ch.length) on('m', store.matchesByIds(ch).map(function (x) { return { id: x.id, st: x.status, min: x.minute, p: x.period, hs: x.hs, as: x.as, h: x.home.id, a: x.away.id, hn: x.home.name, an: x.away.name, hh: x.hths, ha: x.htas, pe: x.periods }; }));
        var oc = store.refreshOdds();
        if (oc.length) {
          var bk = B.resolve(store.bookmakerConfig(), cc), items = [];
          if (bk.compliance.betting_allowed) store.matchesByIds(oc).forEach(function (m) {
            var p = O.primary(store.oddsRows([m.id]).get(m.id) || [], bk.items, m.sport);
            items.push(p ? { id: m.id, bk: p.bookmaker_id, bn: p.bookmaker_name, bs: (bk.items.filter(function (b) { return b.id === p.bookmaker_id; })[0] || {}).short_code, bc: (bk.items.filter(function (b) { return b.id === p.bookmaker_id; })[0] || {}).color, cells: p.cells } : { id: m.id, none: 1 });
          });
          if (items.length) on('o', items);
        }
        if (window.LSN_CFG && window.LSN_CFG.page === 'match' && n % 2 === 0) on('d', [window.LSN_CFG.matchId]);
      }, 5000);
      return { close: function () { clearInterval(t); } };
    }
  });

  // ---- navigation: links become #/path ----
  var clicks = 0, H = LSN.hooks;
  function modal(html) {
    var m = document.getElementById('pvModal'); if (m) m.remove();
    m = document.createElement('div'); m.id = 'pvModal'; m.innerHTML = '<div class="pvbox">' + html + '<p><button class="btn" id="pvClose">Close</button></p></div>';
    document.body.appendChild(m);
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#pvClose') || e.target.id === 'pvModal') { var m = document.getElementById('pvModal'); if (m) m.remove(); return; }
    var a = e.target.closest('a[href]'); if (!a) return;
    var href = a.getAttribute('href');
    var go = href.match(/^\/go\/(\d+)/);
    if (go) {
      e.preventDefault(); clicks++;
      var it = B.resolve(store.bookmakerConfig(), cc).items.filter(function (x) { return x.id === +go[1]; })[0];
      var u = new URL(href, 'http://x'), pl = u.searchParams.get('p') || '', mid = u.searchParams.get('m') || '';
      var dest = it ? it.affiliate_url.replace(/\{(subid|country|match|placement)\}/g, function (_, k) { return encodeURIComponent({ subid: 'lsn-' + (pl || 'x') + '-' + (mid || 0), country: cc, match: mid, placement: pl }[k]); }) : '';
      modal('<h3>Affiliate click (preview)</h3>' + (it ? '<p>On the live site this click is logged (' + clicks + ' this session) and the visitor from <b>' + nameOf(cc) + '</b> is redirected to <b>' + U.esc(it.name) + '</b>:</p><p><code>' + U.esc(dest) + '</code></p>' : '<p>This bookmaker is not available in ' + U.esc(nameOf(cc)) + '.</p>'));
      return;
    }
    if (href.charAt(0) === '/' && href.indexOf('//') !== 0) { e.preventDefault(); if (a.getAttribute('target') === '_blank') H.openNew(href); else location.hash = '#' + href; }
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target; if (f.getAttribute('action') === '/search/') { e.preventDefault(); location.hash = '#/search/?q=' + encodeURIComponent(f.querySelector('input[name=q]').value); }
  });
  window.addEventListener('hashchange', render);
  detectCc(function () { render(); });
})();
