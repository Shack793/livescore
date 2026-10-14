/* LiveScoreNow client — progressive enhancement only: pages work without it. */
(function () {
  'use strict';
  var CFG = window.LSN_CFG || {};
  var LSN = (window.LSN = window.LSN || {});
  function withCc(u) { return CFG.ccq ? u + (u.indexOf('?') === -1 ? '?' : '&') + 'cc=' + CFG.ccq : u; } // dev-only region preview (?cc=XX)
  var H = (LSN.hooks = Object.assign({
    fetchText: function (u) { return fetch(withCc(u), { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }); },
    fetchJSON: function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); },
    navigate: function (u) { location.assign(u); },
    openNew: function (u) { var w = window.open(u, '_blank', 'noopener'); if (!w) location.assign(u); },
    query: function () { return new URLSearchParams(location.search); },
    shareUrl: function (ids) { return location.origin + '/favorites/?teams=' + ids; },
    setRegion: function (cc) { var q = location.search.replace(/([?&])cc=[^&]*&?/, '$1').replace(/[?&]$/, ''); location.assign('/set-region?cc=' + cc + '&next=' + encodeURIComponent(location.pathname + q)); },
    stream: function (on) { // returns {close}
      if (!window.EventSource || !CFG.live) return null;
      var es = new EventSource(withCc('/api/stream'));
      ['m', 'o', 'd'].forEach(function (t) { es.addEventListener(t, function (e) { try { on(t, JSON.parse(e.data)); } catch (x) { /* ignore */ } }); });
      return es;
    }
  }, LSN.hooks || {}));

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* ---------- storage / cookies (never throw) ---------- */
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  var memCk = {}; // fallback when the page is opened from file:// (cookies are not stored there)
  function getCookie(n) { var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : (memCk[n] || ''); }
  function setCookie(n, v) { memCk[n] = v; document.cookie = n + '=' + encodeURIComponent(v) + '; Path=/; Max-Age=31536000; SameSite=Lax'; }

  /* ---------- time ---------- */
  function curTz() { var t = getCookie('lsn_tz'); try { if (t) { new Intl.DateTimeFormat('en', { timeZone: t }); return t; } } catch (e) { /* bad */ } return CFG.tz || 'UTC'; }
  function fmtTime(ts, tz) { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts * 1000)); } catch (e) { return ''; } }
  function fmtFull(ts, tz) { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts * 1000)).replace(',', '').replace(/\//g, '.'); } catch (e) { return ''; } }
  function localize(root) {
    var tz = curTz();
    $$('time[data-ts]', root).forEach(function (t) { var ts = +t.getAttribute('data-ts'); t.textContent = t.hasAttribute('data-full') ? fmtFull(ts, tz) : fmtTime(ts, tz); });
  }

  /* ---------- odds ---------- */
  function toFraction(dec) {
    var den = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 25, 30, 40, 50, 100], t = dec - 1, best = null;
    for (var i = 0; i < den.length; i++) { var d = den[i], n = Math.round(t * d); if (n < 1) continue; var err = Math.abs(n / d - t); if (!best || err < best.err - 1e-9) best = { n: n, d: d, err: err }; if (err < 1e-9) break; }
    return best ? best.n + '/' + best.d : '1/100';
  }
  function fmtOdd(v, f) {
    v = +v; if (!isFinite(v) || v < 1.01) return '–';
    if (f === 'fractional') return toFraction(v);
    if (f === 'american') return v >= 2 ? '+' + Math.round((v - 1) * 100) : '-' + Math.round(100 / (v - 1));
    return v.toFixed(2);
  }
  function oddsFmt() { return getCookie('lsn_odds') || CFG.odds || 'decimal'; }
  function reformatOdds(root) { var f = oddsFmt(); $$('.odd[data-dec]', root).forEach(function (a) { a.textContent = fmtOdd(a.getAttribute('data-dec'), f); }); }

  /* ---------- favourites & pins ---------- */
  var pins = function () { return lsGet('lsn_pins', []); };
  var teams = function () { return lsGet('lsn_teams', []); };
  function isTeam(id) { return teams().some(function (t) { return t.id === id; }); }
  function paintStars() {
    var p = pins().map(function (x) { return x.id; }), t = teams().map(function (x) { return x.id; });
    $$('[data-pin]').forEach(function (el) { var on = p.indexOf(+el.getAttribute('data-pin')) !== -1; el.classList.toggle('on', on); el.textContent = on ? '★' : '☆'; });
    $$('.mr-fav').forEach(function (el) { var r = el.closest('.mrow'); if (!r) return; var on = t.indexOf(+r.getAttribute('data-h')) !== -1 || t.indexOf(+r.getAttribute('data-a')) !== -1; el.classList.toggle('on', on); el.textContent = on ? '★' : '☆'; });
    $$('.follow[data-team]').forEach(function (b) { var on = t.indexOf(+b.getAttribute('data-team')) !== -1; b.classList.toggle('on', on); b.textContent = (on ? '★ Following' : '☆ Follow') + (b.closest('.mh-follow') ? ' ' + b.getAttribute('data-name') : ''); });
  }
  function orderPinned() {
    var p = pins().map(function (x) { return x.id; });
    $$('.mlist').forEach(function (list) {
      var first = list.firstElementChild;
      p.slice().reverse().forEach(function (id) { var s = $('section.lg[data-lg="' + id + '"]', list); if (s && s !== list.firstElementChild) list.insertBefore(s, list.firstElementChild); });
      void first;
    });
  }
  function paintSidebars() {
    var pl = $('#pinned'), ml = $('#myteams');
    var sport = CFG.sport || 'football';
    if (pl) { var p = pins(); pl.innerHTML = p.length ? p.map(function (x) { return '<li><a href="' + esc(x.href) + '"><span>' + esc(x.name) + '</span></a></li>'; }).join('') : '<li class="muted small">Tap ☆ next to a league to pin it here.</li>'; }
    if (ml) { var t = teams(); ml.innerHTML = t.length ? t.map(function (x) { return '<li><a href="/team/' + esc(x.slug || 'x') + '/' + x.id + '/"><span>' + esc(x.name) + '</span></a></li>'; }).join('') : '<li class="muted small">Follow teams with ☆ — they appear here.</li>'; }
    void sport;
  }
  function togglePin(el) {
    var id = +el.getAttribute('data-pin'), list = pins(), i = list.findIndex(function (x) { return x.id === id; });
    if (i !== -1) list.splice(i, 1);
    else {
      var head = el.closest('.lg-head'), a = head && $('.lg-name', head), name, href;
      if (a) { name = a.textContent.replace(/\s+/g, ' ').trim(); href = a.getAttribute('href'); }
      else { var h1 = $('.ph .h1'); name = h1 ? h1.textContent : 'League'; href = location.pathname.replace(/(standings|results|fixtures)\/$/, ''); }
      list.push({ id: id, name: name, href: href });
    }
    lsSet('lsn_pins', list); paintStars(); orderPinned(); paintSidebars();
  }
  function toggleTeams(items) { // items: [{id,name,slug}]
    var list = teams(), allOn = items.every(function (it) { return list.some(function (t) { return t.id === it.id; }); });
    items.forEach(function (it) {
      var i = list.findIndex(function (t) { return t.id === it.id; });
      if (allOn) { if (i !== -1) list.splice(i, 1); } else if (i === -1) list.push(it);
    });
    lsSet('lsn_teams', list); paintStars(); paintSidebars();
    if (CFG.page === 'favorites') loadFavorites();
  }
  /* ---------- favourites page: team list, transfer link, import ---------- */
  function paintFavTeams() {
    var box = $('#favTeams'); if (!box) return;
    var t = teams();
    box.innerHTML = t.length ? '<b>Teams I follow</b><ul class="chips">' + t.map(function (x) { return '<li><a href="/team/' + esc(x.slug || 'x') + '/' + x.id + '/">' + esc(x.name) + '</a><button type="button" data-unfollow="' + x.id + '" aria-label="Unfollow ' + esc(x.name) + '">×</button></li>'; }).join('') + '</ul>' : '<span class="muted">No teams yet.</span>';
    var fa = $('#favAlerts'); if (fa) fa.checked = alertsOn();
  }
  function checkImport() {
    var q = H.query().get('teams'); var box = $('#favImport'); if (!q || !box) return;
    var ids = q.split(',').map(Number).filter(function (n) { return n > 0; }).slice(0, 60);
    var have = teams().map(function (t) { return t.id; });
    var fresh = ids.filter(function (i) { return have.indexOf(i) === -1; });
    if (!fresh.length) return;
    H.fetchJSON('/api/teams?ids=' + fresh.join(',')).then(function (list) {
      if (!list.length) return;
      box.hidden = false;
      box.innerHTML = '<b>Add ' + list.length + ' team' + (list.length === 1 ? '' : 's') + ' from this link?</b><p class="muted">' + list.map(function (x) { return esc(x.name); }).join(', ') + '</p><button class="btn" id="doImport" type="button">Add to my teams</button>';
      $('#doImport').onclick = function () { var cur = teams(); list.forEach(function (x) { if (!cur.some(function (c) { return c.id === x.id; })) cur.push({ id: x.id, name: x.name, slug: x.slug }); }); lsSet('lsn_teams', cur); box.hidden = true; paintStars(); paintSidebars(); paintFavTeams(); loadFavorites(); toast('Teams added'); };
    }).catch(function () {});
  }

  /* ---------- alerts (no account: runs while the site is open) ---------- */
  var swReg = null, lastState = {};
  function alertsOn() { return lsGet('lsn_alerts', false) === true; }
  function toast(msg, href) {
    var box = $('#toasts'); if (!box) return;
    var d = document.createElement('div'); d.className = 'toast'; d.innerHTML = href ? '<a href="' + esc(href) + '">' + esc(msg) + '</a>' : esc(msg);
    box.appendChild(d); setTimeout(function () { d.classList.add('out'); setTimeout(function () { d.remove(); }, 400); }, 7000);
  }
  function notify(title, body, href) {
    toast(title + ' ' + body, href);
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
      var opts = { body: body, icon: '/assets/icon-192.png', tag: title + body, data: { url: href || '/' } };
      if (swReg && swReg.showNotification) swReg.showNotification(title, opts); else new Notification(title, opts);
    } catch (e) { /* ignore */ }
  }
  function setAlerts(on) {
    lsSet('lsn_alerts', !!on);
    $$('#setAlerts,#favAlerts').forEach(function (c) { c.checked = !!on; });
    if (on && 'Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) { /* ignore */ } }
    if (on) toast('Alerts on for the teams you follow' + ((window.Notification && Notification.permission === 'denied') ? ' (notifications are blocked in your browser; you will see in-page alerts only)' : ''));
  }
  function seedStates() { $$('.mrow').forEach(function (r) { var sh = $('.sh', r), sa = $('.sa', r); lastState[r.getAttribute('data-id')] = { st: r.getAttribute('data-st'), hs: sh && sh.textContent !== '' ? +sh.textContent : null, as: sa && sa.textContent !== '' ? +sa.textContent : null }; }); }
  function checkAlerts(d) {
    var prev = lastState[d.id], key = stKey(d.st);
    lastState[d.id] = { st: key, hs: d.hs, as: d.as };
    if (!prev || !alertsOn() || !d.h) return;
    var mine = teams().map(function (t) { return t.id; });
    if (mine.indexOf(d.h) === -1 && mine.indexOf(d.a) === -1) return;
    var href = '/match/' + 'x-vs-y/' + d.id + '/', score = d.hn + ' ' + d.hs + '–' + d.as + ' ' + d.an;
    if (prev.st === 'sch' && (key === 'live')) notify('⏱ Kick-off', d.hn + ' v ' + d.an, href);
    else if (d.hs != null && prev.hs != null && (d.hs > prev.hs || d.as > prev.as) && (key === 'live' || key === 'ht')) notify('⚽ GOAL!', score + (d.min != null ? " (" + d.min + "')" : ''), href);
    else if (prev.st === 'live' && key === 'ht') notify('⏸ Half-time', score, href);
    else if (prev.st !== 'fin' && key === 'fin' && prev.st !== 'sch') notify('🏁 Full-time', score, href);
  }

  function loadFavorites() {
    var box = $('#favList'); if (!box) return;
    var ids = teams().map(function (t) { return t.id; }).join(',');
    H.fetchText('/frag/favorites/?teams=' + ids).then(function (html) { box.innerHTML = html; afterContent(box); }).catch(function () {});
  }

  /* ---------- live patching ---------- */
  var LAB = { basketball: 'Q', hockey: 'P', 'american-football': 'Q', handball: 'H', rugby: 'H', tennis: 'S', volleyball: 'S', baseball: 'Inn ' };
  function statusText(sport, d) {
    if (d.st === 'halftime') return { k: 'ht', t: (sport === 'football' || sport === 'handball' || sport === 'rugby') ? 'HT' : 'Break' };
    if (d.st === 'live' || d.st === 'break') {
      var t;
      if (sport === 'football') t = d.min != null ? d.min + "'" : 'Live';
      else if (sport === 'tennis' || sport === 'volleyball') t = LAB[sport] + (d.p || 1);
      else t = (LAB[sport] || '') + (d.p || 1) + (d.min != null && sport !== 'baseball' ? ' ' + d.min + "'" : '');
      return { k: 'live', t: t };
    }
    if (d.st === 'finished') return { k: 'fin', t: 'FT' };
    if (d.st === 'postponed') return { k: 'pp', t: 'PP' };
    return null;
  }
  function stKey(st) { return st === 'live' || st === 'break' ? 'live' : st === 'halftime' ? 'ht' : st === 'finished' ? 'fin' : st === 'scheduled' ? 'sch' : 'pp'; }
  function perHtml(pe, sport) {
    if (!pe || !pe.length || sport === 'football') return '';
    return pe.map(function (p) { return '<i><u>' + p.home + '</u><u>' + p.away + '</u></i>'; }).join('');
  }
  function patchRow(row, d) {
    var sport = row.getAttribute('data-sport'), old = row.getAttribute('data-st'), key = stKey(d.st);
    var st = statusText(sport, d), el = $('.mr-st', row);
    if (st && el) { el.className = 'mr-st ' + st.k; el.textContent = st.t; }
    row.className = row.className.replace(/\bs-\w+/, 's-' + key); row.setAttribute('data-st', key);
    if (d.hs != null && d.as != null && d.st !== 'scheduled') {
      var sh = $('.sh', row), sa = $('.sa', row), changed = false;
      if (sh && sh.textContent !== String(d.hs)) { if (sh.textContent !== '') changed = true; sh.textContent = d.hs; }
      if (sa && sa.textContent !== String(d.as)) { if (sa.textContent !== '') changed = true; sa.textContent = d.as; }
      if (changed && key === 'live') { row.classList.remove('goalflash'); void row.offsetWidth; row.classList.add('goalflash'); }
      var per = $('.mr-per', row); if (per) per.innerHTML = perHtml(d.pe, sport);
    }
    if (key === 'fin' && old !== 'fin') { var mo = $('.mr-odds', row); if (mo) { mo.className = 'mr-odds none'; mo.innerHTML = $$('.odd', mo).map(function () { return '<span class="odd na">–</span>'; }).join(''); } row.removeAttribute('data-odds'); }
    // keep the Live filter honest
    if (old !== key) applyFilter();
  }
  function oddsHtml(it) {
    var f = oddsFmt();
    return '<span class="bkchip" style="--c:' + esc(it.bc || '#555') + '" title="' + esc(it.bn) + '">' + esc(it.bs || '') + '</span>' + it.cells.map(function (c) {
      return '<a class="odd' + (c.trend ? ' ' + c.trend : '') + '" data-dec="' + c.value + '" data-sel="' + esc(c.sel) + '" href="/go/' + it.bk + '?p=list&m=' + it.id + '" target="_blank" rel="sponsored nofollow noopener">' + esc(fmtOdd(c.value, f)) + '</a>';
    }).join('');
  }
  function patchOdds(row, it) {
    var box = $('.mr-odds', row); if (!box) return;
    if (it.none) { if (!box.classList.contains('none')) { box.className = 'mr-odds none'; box.innerHTML = $$('.odd', box).map(function () { return '<span class="odd na">–</span>'; }).join(''); row.removeAttribute('data-odds'); } return; }
    var cur = $$('a.odd', box);
    if (!box.classList.contains('none') && String(box.getAttribute('data-bk')) === String(it.bk) && cur.length === it.cells.length) {
      it.cells.forEach(function (c, i) {
        var a = cur[i], prev = +a.getAttribute('data-dec');
        if (prev !== c.value) {
          a.setAttribute('data-dec', c.value); a.textContent = fmtOdd(c.value, oddsFmt());
          a.classList.remove('up', 'down', 'flash-up', 'flash-down'); if (c.trend) a.classList.add(c.trend);
          void a.offsetWidth; a.classList.add(c.value > prev ? 'flash-up' : 'flash-down');
        }
      });
    } else { box.className = 'mr-odds'; box.setAttribute('data-bk', it.bk); box.innerHTML = oddsHtml(it); row.setAttribute('data-odds', '1'); }
  }
  var fragTimer = null, fragBusy = false;
  function refreshMatchPage() {
    if (fragTimer || fragBusy) return;
    fragTimer = setTimeout(function () {
      fragTimer = null; fragBusy = true;
      var active = ($('#mtabs a.on') || {}).getAttribute ? $('#mtabs a.on').getAttribute('data-tab') : 'summary';
      H.fetchText(location.pathname + '?frag=1').then(function (html) {
        var t = document.createElement('div'); t.innerHTML = html;
        var mh = $('#mh'), nmh = $('#mh', t); if (mh && nmh) mh.replaceWith(nmh);
        var strip = $('.strip'), nstrip = $('.strip', t);
        if (strip && nstrip) strip.replaceWith(nstrip); else if (strip && !nstrip) strip.remove(); else if (!strip && nstrip && $('#mh')) $('#mh').after(nstrip);
        var mb = $('#mbody'), nmb = $('#mbody', t); if (mb && nmb) mb.innerHTML = nmb.innerHTML;
        setTab(active, true); localize(document); reformatOdds(document); paintStars();
      }).catch(function () {}).then(function () { fragBusy = false; });
    }, 1500);
  }
  var stream = null;
  function startStream() {
    if (stream || CFG.page === 'static' || CFG.page === 'notfound') return;
    stream = H.stream(function (type, data) {
      if (type === 'm') {
        data.forEach(function (d) {
          checkAlerts(d);
          var row = document.getElementById('m' + d.id);
          if (row) patchRow(row, { st: d.st, min: d.min, p: d.p, hs: d.hs, as: d.as, pe: d.pe });
          if (CFG.page === 'match' && CFG.matchId === d.id) refreshMatchPage();
        });
      } else if (type === 'o') {
        data.forEach(function (it) {
          var row = document.getElementById('m' + it.id); if (row) patchOdds(row, it);
          if (CFG.page === 'match' && CFG.matchId === it.id) refreshMatchPage();
        });
      } else if (type === 'd') { if (CFG.page === 'match' && data.indexOf(CFG.matchId) !== -1) refreshMatchPage(); }
    });
  }

  /* ---------- filters ---------- */
  var filter = 'all';
  function applyFilter() {
    var list = $('#mlist'); if (!list) return;
    var live = 0;
    $$('.mrow', list).forEach(function (r) {
      var st = r.getAttribute('data-st'), show = true;
      if (st === 'live' || st === 'ht') live++;
      if (filter === 'live') show = st === 'live' || st === 'ht';
      else if (filter === 'odds') show = r.hasAttribute('data-odds');
      else if (filter === 'fin') show = st === 'fin';
      else if (filter === 'sch') show = st === 'sch';
      r.style.display = show ? '' : 'none';
    });
    $$('section.lg', list).forEach(function (s) { s.style.display = $$('.mrow', s).some(function (r) { return r.style.display !== 'none'; }) ? '' : 'none'; });
    var b = $('#filters [data-f="live"]');
    if (b) b.innerHTML = 'LIVE' + (live ? ' <em>' + live + '</em>' : '');
    var any = $$('section.lg', list).some(function (s) { return s.style.display !== 'none'; });
    var e = $('#noMatch', list);
    if (!any && filter !== 'all') { if (!e) { e = document.createElement('div'); e.id = 'noMatch'; e.className = 'empty'; e.textContent = 'No matches in this view.'; list.appendChild(e); } } else if (e) e.remove();
  }

  /* ---------- match page tabs ---------- */
  function setTab(id, quiet) {
    var tabs = $$('#mtabs a'); if (!tabs.length) return;
    if (!tabs.some(function (a) { return a.getAttribute('data-tab') === id; })) id = 'summary';
    tabs.forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === id); });
    $$('.mpanel').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-tab') === id); });
    if (!quiet && !LSN.preview && history.replaceState) history.replaceState(null, '', location.pathname + location.search + '#' + id);
  }

  /* ---------- ads (consent-aware) ---------- */
  function runAd(ad) {
    if (ad.getAttribute('data-ran')) return;
    var tpl = $('template.ad-code', ad); if (!tpl) return;
    var needs = ad.getAttribute('data-consent') === '1';
    if (needs && getCookie('lsn_consent') !== 'yes') {
      var fb = $('template.ad-fallback', ad);
      if (fb) { ad.insertAdjacentHTML('beforeend', fb.innerHTML); ad.setAttribute('data-ran', 'fb'); } else { ad.style.display = 'none'; }
      return;
    }
    ad.setAttribute('data-ran', '1');
    var holder = document.createElement('div'); holder.innerHTML = tpl.innerHTML;
    $$('script', holder).forEach(function (old) { var s = document.createElement('script'); Array.prototype.forEach.call(old.attributes, function (a) { s.setAttribute(a.name, a.value); }); s.text = old.text; old.replaceWith(s); });
    ad.appendChild(holder);
  }
  function loadAds(root) {
    var ads = $$('.ad[data-slot]', root).filter(function (a) { return $('template.ad-code', a); });
    if (!ads.length) return;
    if (!('IntersectionObserver' in window)) { ads.forEach(runAd); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); runAd(e.target); } }); }, { rootMargin: '300px' });
    ads.forEach(function (a) { io.observe(a); });
  }

  /* ---------- settings, region, search ---------- */
  var TZS = ['UTC', 'Africa/Accra', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Sao_Paulo', 'America/Mexico_City'];
  function openSettings() {
    var pop = $('#setPop'); if (!pop) return;
    var willOpen = pop.hidden; closePops(); pop.hidden = !willOpen; if (!willOpen) return;
    var so = $('#setOdds'), st = $('#setTheme'), sz = $('#setTz');
    var sa = $('#setAlerts'); if (sa) sa.checked = alertsOn();
    so.value = oddsFmt(); st.value = getCookie('lsn_theme') || 'auto';
    var dev = ''; try { dev = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
    var cur = curTz(), list = TZS.slice(); [dev, cur].forEach(function (z) { if (z && list.indexOf(z) === -1) list.unshift(z); });
    sz.innerHTML = list.map(function (z) { return '<option value="' + esc(z) + '">' + esc(z.replace(/_/g, ' ')) + (z === dev ? ' (device)' : '') + '</option>'; }).join('');
    sz.value = cur;
  }
  function closePops() { $$('.pop').forEach(function (p) { p.hidden = true; }); }
  var ccData = null;
  function openCountry() {
    var pop = $('#ccPop'); if (!pop) return;
    var willOpen = pop.hidden; closePops(); pop.hidden = !willOpen; if (!willOpen) return;
    var inp = $('#ccFilter'); inp.value = ''; inp.focus();
    (ccData ? Promise.resolve(ccData) : H.fetchJSON('/api/countries')).then(function (d) { ccData = d; renderCountries(''); });
  }
  function renderCountries(q) {
    var ul = $('#ccList'); if (!ul || !ccData) return; q = q.toLowerCase();
    var rows = ccData.filter(function (c) { return !q || c[1].toLowerCase().indexOf(q) !== -1 || c[0].toLowerCase() === q; }).slice(0, 80);
    ul.innerHTML = rows.map(function (c) { return '<li class="' + (c[0] === CFG.cc ? 'cur' : '') + '"><a href="#" data-cc="' + c[0] + '"><img class="flag" src="https://flagcdn.com/w20/' + c[0].toLowerCase() + '.png" alt="" width="20" height="14" loading="lazy">' + esc(c[1]) + '</a></li>'; }).join('') || '<li class="muted small" style="padding:8px">No match</li>';
  }
  var suggTimer = null, suggSeq = 0;
  function suggest(q) {
    var box = $('#sugg'); if (!box) return;
    clearTimeout(suggTimer);
    if (q.trim().length < 2) { box.hidden = true; return; }
    suggTimer = setTimeout(function () {
      var seq = ++suggSeq;
      H.fetchJSON('/api/search?q=' + encodeURIComponent(q)).then(function (r) {
        if (seq !== suggSeq) return;
        var h = '';
        if (r.leagues.length) h += '<h6>Competitions</h6>' + r.leagues.map(function (l) { return '<a href="/' + l.sport + '/' + l.country.slug + '/' + l.slug + '/"><b>' + esc(l.name) + '</b><small>' + esc(l.country.name) + '</small></a>'; }).join('');
        if (r.teams.length) h += '<h6>Teams</h6>' + r.teams.map(function (t) { return '<a href="/team/' + t.slug + '/' + t.id + '/"><b>' + esc(t.name) + '</b><small>' + esc(t.sport) + '</small></a>'; }).join('');
        box.innerHTML = h || '<a href="#"><small>No results</small></a>'; box.hidden = false;
      }).catch(function () {});
    }, 180);
  }

  /* ---------- events (delegated; bound once) ---------- */
  var bound = false;
  function bind() {
    if (bound) return; bound = true;
    document.addEventListener('click', function (e) {
      var t = e.target;
      var el;
      if ((el = t.closest('.mrow')) && !t.closest('a,button,.mr-fav,.odd')) { var ra = $('.mr-teams', el); if (ra) { H.openNew(ra.getAttribute('href')); return; } }
      if ((el = t.closest('[data-pin]'))) { e.preventDefault(); togglePin(el); return; }
      if ((el = t.closest('.mr-fav'))) {
        e.preventDefault(); var r = el.closest('.mrow');
        var th = $('.th .tn', r), ta = $('.ta .tn', r);
        toggleTeams([{ id: +r.getAttribute('data-h'), name: th ? th.textContent : 'Team' }, { id: +r.getAttribute('data-a'), name: ta ? ta.textContent : 'Team' }]); return;
      }
      if ((el = t.closest('.follow[data-team]'))) { e.preventDefault(); toggleTeams([{ id: +el.getAttribute('data-team'), name: el.getAttribute('data-name'), slug: el.getAttribute('data-slug') }]); return; }
      if ((el = t.closest('#filters button'))) { filter = el.getAttribute('data-f'); $$('#filters button').forEach(function (b) { b.classList.toggle('on', b === el); }); applyFilter(); return; }
      if ((el = t.closest('#mtabs a'))) { e.preventDefault(); setTab(el.getAttribute('data-tab')); return; }
      if ((el = t.closest('[data-unfollow]'))) { var uid = +el.getAttribute('data-unfollow'); lsSet('lsn_teams', teams().filter(function (x) { return x.id !== uid; })); paintStars(); paintSidebars(); paintFavTeams(); loadFavorites(); return; }
      if (t.closest('#shareBtn')) { var ids = teams().map(function (x) { return x.id; }).join(','); if (!ids) { var sm = $('#shareMsg'); if (sm) sm.textContent = 'Follow a team first.'; return; } var link = H.shareUrl(ids); var done = function () { var sm = $('#shareMsg'); if (sm) sm.textContent = 'Link copied — open it on your other device and tap “Add to my teams”.'; }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy this link:', link); }); else window.prompt('Copy this link:', link); return; }
      if (t.closest('#setBtn')) { openSettings(); return; }
      if (t.closest('#ccBtn')) { openCountry(); return; }
      if (t.closest('#menuBtn')) { var cl = $('.col-left'); if (cl) cl.classList.toggle('open'); return; }
      if (t.closest('#searchBtn')) { var s = $('.search'); if (s) { s.classList.toggle('open'); var i = $('#q'); if (i) i.focus(); } return; }
      if ((el = t.closest('#ccList a[data-cc]'))) { e.preventDefault(); H.setRegion(el.getAttribute('data-cc')); return; }
      if ((el = t.closest('[data-consent]')) && el.tagName === 'BUTTON') { setCookie('lsn_consent', el.getAttribute('data-consent')); var b = $('#consent'); if (b) b.remove(); CFG.consent = el.getAttribute('data-consent'); $$('.ad[data-slot]').forEach(function (a) { a.removeAttribute('data-ran'); }); loadAds(document); return; }
      if (!t.closest('.pop') && !t.closest('.icon-btn')) closePops();
      if (!t.closest('.search')) { var sg = $('#sugg'); if (sg) sg.hidden = true; }
      if (!t.closest('.col-left') && !t.closest('#menuBtn')) { var c2 = $('.col-left'); if (c2) c2.classList.remove('open'); }
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'setOdds') { setCookie('lsn_odds', t.value); CFG.odds = t.value; reformatOdds(document); }
      else if (t.id === 'setTheme') { setCookie('lsn_theme', t.value); document.documentElement.setAttribute('data-theme', t.value); }
      else if (t.id === 'setTz') { setCookie('lsn_tz', t.value); CFG.tz = t.value; localize(document); }
      else if (t.id === 'setAlerts' || t.id === 'favAlerts') setAlerts(t.checked);
      else if (t.id === 'datePick') { var base = t.getAttribute('data-base'), v = t.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) H.navigate(base + (v === t.getAttribute('data-today') ? '' : '?date=' + v)); }
    });
    document.addEventListener('input', function (e) {
      if (e.target.id === 'q') suggest(e.target.value);
      else if (e.target.id === 'ccFilter') renderCountries(e.target.value);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePops(); var sg = $('#sugg'); if (sg) sg.hidden = true; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-pin],.mr-fav')) { e.preventDefault(); e.target.click(); }
    });
  }

  function centerDate() { var on = $('.dn-d.on'), box = $('.dn-days'); if (on && box) box.scrollLeft = on.offsetLeft - (box.clientWidth - on.clientWidth) / 2; }
  function afterContent(root) { centerDate(); localize(root); reformatOdds(root); paintStars(); orderPinned(); applyFilter(); loadAds(root); }

  function init() {
    CFG = window.LSN_CFG || CFG;
    bind();
    // first visit: remember the device time zone; re-render once if it differs from the site's default
    if (!getCookie('lsn_tz')) {
      var dz = ''; try { dz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
      if (dz) { setCookie('lsn_tz', dz); if (dz !== CFG.siteTz && !LSN.preview) { try { if (!sessionStorage.getItem('lsn_tzr')) { sessionStorage.setItem('lsn_tzr', '1'); location.reload(); return; } } catch (e) { /* ignore */ } } }
    }
    if (CFG.page === 'match') setTab(LSN.preview ? 'summary' : (location.hash || '').slice(1) || 'summary', true);
    paintSidebars(); afterContent(document);
    seedStates();
    if (CFG.page === 'favorites') { paintFavTeams(); checkImport(); loadFavorites(); }
    if (!LSN.preview && 'serviceWorker' in navigator && !swReg) navigator.serviceWorker.register('/sw.js').then(function (r) { swReg = r; }).catch(function () {});
    startStream();
  }
  LSN.app = { init: init, afterContent: afterContent, fmtOdd: fmtOdd, getCookie: getCookie, setCookie: setCookie };
  if (!LSN.preview) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
})();
(function () { document.addEventListener('click', function (e) { var d = document.querySelector('.morebox[open]'); if (d && !d.contains(e.target)) d.removeAttribute('open'); }); })();
