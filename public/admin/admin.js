(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var META = null, tab = 'dashboard';
  function toast(msg, bad) { var t = $('#toast'); t.textContent = msg; t.className = bad ? 'err' : ''; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3200); }
  function api(method, path, body) {
    return fetch('/admin/api/' + path, { method: method, headers: { 'Content-Type': 'application/json', 'X-LSN-Admin': '1' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function act(p, okMsg) { return p.then(function (r) { toast(okMsg || 'Saved'); return r; }).catch(function (e) { toast(e.message, true); throw e; }); }
  var TABS = [['dashboard', 'Dashboard'], ['bookmakers', 'Bookmakers & regions'], ['regions', 'Region groups'], ['compliance', 'Country compliance'], ['adsgeo', 'Ads by country'], ['ads', 'Ad slots'], ['leagues', 'Leagues'], ['settings', 'Settings']];
  function nav() { $('#nav').innerHTML = TABS.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join(''); }
  document.addEventListener('click', function (e) { var b = e.target.closest('#nav button'); if (b) { tab = b.getAttribute('data-t'); show(); } });
  function show() { nav(); var v = $('#view'); v.innerHTML = '<p>Loading…</p>'; (VIEWS[tab] || VIEWS.dashboard)(v).catch(function (e) { v.innerHTML = '<div class="card">Error: ' + esc(e.message) + '</div>'; }); }

  var VIEWS = {};
  /* ---------- dashboard ---------- */
  VIEWS.dashboard = function (v) {
    return Promise.all([api('GET', 'status'), api('GET', 'clicks?days=7')]).then(function (r) {
      var s = r[0], c = r[1], max = Math.max.apply(null, c.byBookmaker.map(function (x) { return x.n; }).concat([1]));
      var jobs = Object.keys(s.sync.jobs || {}).map(function (k) { var j = s.sync.jobs[k]; return '<tr><td>' + esc(k) + '</td><td>' + j.runs + '</td><td><span class="pill ' + (j.errors ? 'bad' : 'ok') + '">' + j.errors + ' errors</span></td><td>' + (j.lastOk ? new Date(j.lastOk * 1000).toLocaleTimeString() : '–') + '</td><td>' + (j.lastMs || '') + ' ms</td><td class="muted">' + esc(j.lastError || '') + '</td><td><button class="b sec" data-job="' + k + '">Run now</button></td></tr>'; }).join('');
      v.innerHTML = '<h2>Dashboard</h2><div class="row"><div class="card"><b>Data provider</b><br>' + esc(s.sync.provider) + ' <span class="muted">' + esc(JSON.stringify(s.sync.providerStatus || {})) + '</span></div><div class="card"><b>Live viewers connected</b><br><span style="font-size:28px">' + s.viewers + '</span></div><div class="card"><b>IP→country ranges</b><br>' + s.geoipRanges + (s.geoipRanges ? '' : ' <span class="pill bad">not loaded — run npm run geoip:update</span>') + '</div></div>' +
        '<div class="card"><h3 style="margin-top:0">Database</h3>' + Object.keys(s.counts).map(function (k) { return '<span class="pill">' + k + ': ' + s.counts[k] + '</span> '; }).join('') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Sync jobs</h3><table><tr><th>Job</th><th>Runs</th><th>Errors</th><th>Last OK</th><th>Time</th><th>Last error</th><th></th></tr>' + jobs + '</table></div>' +
        '<div class="card"><h3 style="margin-top:0">Affiliate clicks (last 7 days): ' + c.total + '</h3><div class="row"><div><b>By bookmaker</b><div class="bars">' + c.byBookmaker.map(function (x) { return '<div><span style="width:110px">' + esc(x.name) + '</span><i style="width:' + Math.round(x.n / max * 160) + 'px"></i>' + x.n + '</div>'; }).join('') + '</div></div><div><b>By country</b><div>' + c.byCountry.map(function (x) { return '<span class="pill">' + esc(x.country) + ' ' + x.n + '</span> '; }).join('') + '</div></div><div><b>By placement</b><div>' + c.byPlacement.map(function (x) { return '<span class="pill">' + esc(x.placement || '–') + ' ' + x.n + '</span> '; }).join('') + '</div></div></div></div>';
      v.onclick = function (e) { var b = e.target.closest('[data-job]'); if (b) act(api('POST', 'sync/' + b.getAttribute('data-job')), 'Started'); };
    });
  };

  /* ---------- bookmakers ---------- */
  function ruleRow(r, regions) {
    r = r || { scope_type: 'country', scope_value: '', mode: 'allow' };
    return '<tr class="rule"><td><select class="r-type"><option value="country"' + (r.scope_type === 'country' ? ' selected' : '') + '>Country</option><option value="region"' + (r.scope_type === 'region' ? ' selected' : '') + '>Region</option><option value="all"' + (r.scope_type === 'all' ? ' selected' : '') + '>Everywhere</option></select></td>' +
      '<td><input class="r-val" value="' + esc(r.scope_type === 'all' ? '' : r.scope_value) + '" placeholder="GH  or  WEST_AFRICA" list="regionlist"></td>' +
      '<td><select class="r-mode"><option value="allow"' + (r.mode === 'allow' ? ' selected' : '') + '>Show</option><option value="block"' + (r.mode === 'block' ? ' selected' : '') + '>Hide</option></select></td>' +
      '<td><input class="r-url" value="' + esc(r.affiliate_url || '') + '" placeholder="(same as default)"></td><td><input class="r-offer" value="' + esc(r.offer || '') + '" placeholder="(same as default)"></td><td><input class="r-sort" style="width:60px" value="' + esc(r.sort_order == null ? '' : r.sort_order) + '"></td><td><button class="b del r-del" type="button">×</button></td></tr>';
  }
  function editor(b, feed) {
    b = b || { id: 0, name: '', short_code: '', color: '#18c37e', provider_ref: '', affiliate_url: 'https://', offer: '', terms_url: '', license_text: '', active: 1, sort_order: 10, rules: [{ scope_type: 'region', scope_value: 'AFRICA', mode: 'allow' }] };
    var f = function (k, label, ph) { return '<label>' + label + '<input data-k="' + k + '" value="' + esc(b[k]) + '" placeholder="' + esc(ph || '') + '"></label>'; };
    return '<div class="card" data-id="' + b.id + '"><h3 style="margin-top:0">' + (b.id ? esc(b.name) : 'New bookmaker') + '</h3><div class="row">' + f('name', 'Name') + f('short_code', 'Short code (chip)', 'BW') + f('color', 'Brand colour', '#e8341c') + f('sort_order', 'Priority (low = first)') + '</div>' +
      '<label>Default affiliate link <span class="muted">— placeholders: {subid} {country} {match} {placement}</span><input data-k="affiliate_url" value="' + esc(b.affiliate_url) + '"></label>' +
      '<div class="row">' + f('offer', 'Default offer text') + f('terms_url', 'Terms URL') + f('license_text', 'Licence text (shown in footer per country)') + '<label>Odds feed bookmaker<select data-k="provider_ref"><option value="">— none (no odds shown) —</option>' + feed.map(function (x) { return '<option value="' + esc(x.ref) + '"' + (x.ref === b.provider_ref ? ' selected' : '') + '>' + esc(x.name) + ' (' + esc(x.ref) + ')</option>'; }).join('') + '</select></label></div>' +
      '<label><input type="checkbox" data-k="active" ' + (Number(b.active) ? 'checked' : '') + ' style="width:auto"> Active</label>' +
      '<h3>Where is it shown?</h3><p class="muted">Most specific rule wins: country › region › everywhere. “Hide” beats “Show” at the same level. A bookmaker with no matching rule is <b>not shown</b>.</p>' +
      '<table><tr><th>Scope</th><th>Country / region code</th><th>Action</th><th>Override affiliate link</th><th>Override offer</th><th>Priority</th><th></th></tr>' + (b.rules || []).map(function (r) { return ruleRow(r); }).join('') + '</table>' +
      '<p class="gap"><button class="b sec add-rule" type="button">+ Add rule</button><button class="b save" type="button">Save bookmaker</button>' + (b.id ? '<button class="b del del-bk" type="button">Delete</button>' : '') + '</p></div>';
  }
  function collect(card) {
    var o = { rules: [] };
    card.querySelectorAll('[data-k]').forEach(function (el) { o[el.getAttribute('data-k')] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value; });
    card.querySelectorAll('tr.rule').forEach(function (tr) { var t = tr.querySelector('.r-type').value; o.rules.push({ scope_type: t, scope_value: t === 'all' ? '*' : tr.querySelector('.r-val').value, mode: tr.querySelector('.r-mode').value, affiliate_url: tr.querySelector('.r-url').value, offer: tr.querySelector('.r-offer').value, sort_order: tr.querySelector('.r-sort').value }); });
    return o;
  }
  VIEWS.bookmakers = function (v) {
    return Promise.all([api('GET', 'bookmakers'), api('GET', 'meta')]).then(function (r) {
      META = r[1]; var list = r[0];
      v.innerHTML = '<h2>Bookmakers &amp; regions</h2><datalist id="regionlist">' + META.regions.map(function (x) { return '<option value="' + esc(x.code) + '">' + esc(x.name) + '</option>'; }).join('') + '</datalist>' +
        '<div class="card"><b>Test a region</b> <span class="muted">— see exactly what a visitor from a country gets</span><div class="gap" style="display:flex;margin-top:8px"><input id="tcc" placeholder="Country code e.g. GH" style="max-width:200px"><button class="b" id="tbtn">Check</button></div><div id="tout" style="margin-top:8px"></div></div>' +
        list.map(function (b) { return editor(b, META.feedBookmakers); }).join('') + '<div id="newbk"></div><p><button class="b" id="addbk">+ Add bookmaker</button></p>';
      v.onclick = function (e) {
        var t = e.target, card = t.closest('.card[data-id]');
        if (t.id === 'addbk') { $('#newbk').innerHTML = editor(null, META.feedBookmakers); return; }
        if (t.id === 'tbtn') { var cc = $('#tcc').value.trim().toUpperCase(); act(api('GET', 'resolve?cc=' + encodeURIComponent(cc)), 'OK').then(function (d) { $('#tout').innerHTML = (d.compliance.betting_allowed ? '' : '<span class="pill bad">Betting content is switched OFF for ' + esc(d.name) + '</span>') + (d.bookmakers.length ? '<ol>' + d.bookmakers.map(function (b) { return '<li><b>' + esc(b.name) + '</b> — ' + esc(b.offer) + '<br><span class="muted">' + esc(b.affiliate_url) + '</span></li>'; }).join('') + '</ol>' : '<p>No bookmakers would be shown in ' + esc(d.name) + '.</p>') + '<div class="muted">Age ' + d.compliance.min_age + '+ · ' + esc(d.compliance.rg_text) + '</div>'; }); return; }
        if (!card) return;
        if (t.classList.contains('add-rule')) { var tb = card.querySelector('table'); tb.insertAdjacentHTML('beforeend', ruleRow(null)); }
        else if (t.classList.contains('r-del')) t.closest('tr').remove();
        else if (t.classList.contains('save')) { var id = Number(card.getAttribute('data-id')); act(api(id ? 'PUT' : 'POST', id ? 'bookmakers/' + id : 'bookmakers', collect(card))).then(function () { show(); }); }
        else if (t.classList.contains('del-bk')) { if (confirm('Delete this bookmaker and its rules?')) act(api('DELETE', 'bookmakers/' + card.getAttribute('data-id')), 'Deleted').then(function () { show(); }); }
      };
    });
  };

  /* ---------- region groups ---------- */
  VIEWS.regions = function (v) {
    return api('GET', 'meta').then(function (m) {
      v.innerHTML = '<h2>Region groups</h2><p class="muted">Groups let one rule cover many countries (e.g. WEST_AFRICA). Use the group code in a bookmaker rule.</p>' + m.regions.map(function (r) { return '<div class="card" data-code="' + esc(r.code) + '"><div class="row"><label>Code<input value="' + esc(r.code) + '" disabled></label><label>Name<input data-k="name" value="' + esc(r.name) + '"></label></div><label>Countries (ISO codes, comma separated)<textarea data-k="countries">' + esc(r.countries.join(', ')) + '</textarea></label><p class="gap"><button class="b save">Save</button><button class="b del del-r">Delete</button></p></div>'; }).join('') +
        '<div class="card"><h3 style="margin-top:0">New group</h3><div class="row"><label>Code<input id="nrc" placeholder="MY_REGION"></label><label>Name<input id="nrn"></label></div><label>Countries<textarea id="nrl" placeholder="GH, NG, KE"></textarea></label><p><button class="b" id="nrs">Create</button></p></div>';
      v.onclick = function (e) {
        var t = e.target, card = t.closest('[data-code]');
        if (t.id === 'nrs') { act(api('PUT', 'regions/' + encodeURIComponent($('#nrc').value), { name: $('#nrn').value, countries: $('#nrl').value })).then(show); return; }
        if (!card) return; var code = card.getAttribute('data-code');
        if (t.classList.contains('save')) act(api('PUT', 'regions/' + code, { name: card.querySelector('[data-k=name]').value, countries: card.querySelector('[data-k=countries]').value }));
        if (t.classList.contains('del-r') && confirm('Delete group ' + code + ' and any rules that use it?')) act(api('DELETE', 'regions/' + code), 'Deleted').then(show);
      };
    });
  };

  /* ---------- compliance ---------- */
  VIEWS.compliance = function (v) {
    return api('GET', 'meta').then(function (m) {
      var row = function (r) { r = r || { country_code: '', betting_content: 1, min_age: 18, rg_text: '', rg_url: '', license_text: '' }; return '<div class="card" data-cc="' + esc(r.country_code) + '"><div class="row"><label>Country code<input data-k="cc" value="' + esc(r.country_code) + '" ' + (r.country_code ? 'disabled' : 'placeholder="GH"') + '></label><label>Minimum age<input data-k="min_age" value="' + r.min_age + '"></label><label>Betting content<select data-k="betting_content"><option value="1"' + (Number(r.betting_content) ? ' selected' : '') + '>Allowed</option><option value="0"' + (Number(r.betting_content) ? '' : ' selected') + '>Hide ALL betting content (odds, bookmakers, betting ads)</option></select></label></div><label>Responsible-gambling text<input data-k="rg_text" value="' + esc(r.rg_text) + '"></label><div class="row"><label>Help URL<input data-k="rg_url" value="' + esc(r.rg_url) + '"></label><label>Regulator / licence text for footer<input data-k="license_text" value="' + esc(r.license_text) + '"></label></div><p class="gap"><button class="b save">Save</button>' + (r.country_code ? '<button class="b del del-c">Delete</button>' : '') + '</p></div>'; };
      v.innerHTML = '<h2>Country compliance</h2><p class="muted">Per-country legal switches. <b>You are responsible for checking local law</b> — set “Hide ALL betting content” for every country where affiliate advertising of betting is not permitted.</p>' + m.countryRules.map(row).join('') + '<h3>Add country</h3>' + row(null);
      v.onclick = function (e) {
        var t = e.target, card = t.closest('[data-cc]'); if (!card) return;
        var g = function (k) { return card.querySelector('[data-k=' + k + ']').value; };
        if (t.classList.contains('save')) { var cc = (card.getAttribute('data-cc') || g('cc')).toUpperCase(); act(api('PUT', 'country-rules/' + cc, { betting_content: g('betting_content'), min_age: g('min_age'), rg_text: g('rg_text'), rg_url: g('rg_url'), license_text: g('license_text') })).then(show); }
        if (t.classList.contains('del-c') && confirm('Delete rule?')) act(api('DELETE', 'country-rules/' + card.getAttribute('data-cc')), 'Deleted').then(show);
      };
    });
  };

  /* ---------- ad slots ---------- */
  VIEWS.ads = function (v) {
    return api('GET', 'ad-slots').then(function (slots) {
      var row = function (s) { s = s || { slot_key: '', label: '', placement: 'sidebar', width: 300, height: 250, ad_code: '', fallback_code: '', betting_related: 0, countries_include: '', countries_exclude: '', active: 1, sort_order: 50 }; return '<div class="card" data-key="' + esc(s.slot_key) + '"><div class="row"><label>Key<input data-k="key" value="' + esc(s.slot_key) + '" ' + (s.slot_key ? 'disabled' : 'placeholder="my-slot"') + '></label><label>Label<input data-k="label" value="' + esc(s.label) + '"></label><label>Placement<input data-k="placement" value="' + esc(s.placement) + '"></label><label>Width<input data-k="width" value="' + s.width + '"></label><label>Height<input data-k="height" value="' + s.height + '"></label></div>' +
        '<label>Ad code (paste your AdSense / ad-network / banner HTML) <span class="muted">— leave empty to show a built-in geo-targeted bookmaker banner</span><textarea data-k="ad_code">' + esc(s.ad_code) + '</textarea></label><label>Fallback code (shown if visitor declines ad cookies)<textarea data-k="fallback_code">' + esc(s.fallback_code) + '</textarea></label>' +
        '<div class="row"><label>Only show in countries (codes)<input data-k="countries_include" value="' + esc(s.countries_include) + '" placeholder="GH,NG"></label><label>Never show in countries<input data-k="countries_exclude" value="' + esc(s.countries_exclude) + '"></label><label>Priority<input data-k="sort_order" value="' + s.sort_order + '"></label></div>' +
        '<label><input type="checkbox" data-k="betting_related" ' + (Number(s.betting_related) ? 'checked' : '') + ' style="width:auto"> Betting-related (automatically hidden where betting content is off)</label> <label><input type="checkbox" data-k="active" ' + (Number(s.active) ? 'checked' : '') + ' style="width:auto"> Active</label><p class="gap"><button class="b save">Save</button>' + (s.slot_key ? '<button class="b del del-s">Delete</button>' : '') + '</p></div>'; };
      v.innerHTML = '<h2>Ad slots</h2>' + slots.map(row).join('') + '<h3>New slot</h3>' + row(null);
      v.onclick = function (e) {
        var t = e.target, card = t.closest('[data-key]'); if (!card) return;
        var g = function (k) { var el = card.querySelector('[data-k=' + k + ']'); return el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value; };
        var key = card.getAttribute('data-key') || g('key');
        if (t.classList.contains('save')) act(api('PUT', 'ad-slots/' + encodeURIComponent(key), { label: g('label'), placement: g('placement'), width: g('width'), height: g('height'), ad_code: g('ad_code'), fallback_code: g('fallback_code'), countries_include: g('countries_include'), countries_exclude: g('countries_exclude'), sort_order: g('sort_order'), betting_related: g('betting_related'), active: g('active') })).then(show);
        if (t.classList.contains('del-s') && confirm('Delete slot?')) act(api('DELETE', 'ad-slots/' + encodeURIComponent(key)), 'Deleted').then(show);
      };
    });
  };

  /* ---------- ads by country / region ---------- */
  VIEWS.adsgeo = function (v) {
    return Promise.all([api('GET', 'ad-creatives'), api('GET', 'ad-slots'), api('GET', 'meta')]).then(function (r) {
      var list = r[0], slots = r[1], meta = r[2];
      var regionOpts = meta.regions.map(function (x) { return '<option value="' + esc(x.code) + '">' + esc(x.name) + ' (' + esc(x.code) + ')</option>'; }).join('');
      var slotOpts = function (sel) { return slots.map(function (s) { return '<option value="' + esc(s.slot_key) + '"' + (s.slot_key === sel ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join(''); };
      var scopeLabel = function (c) { return c.scope_type === 'all' ? 'Everywhere else' : c.scope_type === 'region' ? 'Region ' + c.scope_value : 'Country ' + c.scope_value; };
      var row = function (c) {
        c = c || { id: '', slot_key: slots[0] ? slots[0].slot_key : '', name: '', scope_type: 'country', scope_value: '', mode: 'show', ad_code: '', fallback_code: '', image_url: '', link_url: '', alt_text: '', betting_related: 0, priority: 0, active: 1 };
        var sel = function (a, b) { return a === b ? ' selected' : ''; };
        return '<div class="card" data-id="' + esc(c.id) + '"><div class="row">' +
          '<label>Name (for you)<input data-k="name" value="' + esc(c.name) + '" placeholder="e.g. Ghana summer banner"></label>' +
          '<label>Slot<select data-k="slot_key">' + slotOpts(c.slot_key) + '</select></label>' +
          '<label>Who sees it<select data-k="scope_type"><option value="country"' + sel(c.scope_type, 'country') + '>One country</option><option value="region"' + sel(c.scope_type, 'region') + '>A region group</option><option value="all"' + sel(c.scope_type, 'all') + '>Everywhere else (default)</option></select></label>' +
          '<label>Country code or region<input data-k="scope_value" list="regionlist2" value="' + esc(c.scope_type === 'all' ? '' : c.scope_value) + '" placeholder="GH  or  WEST_AFRICA"></label></div>' +
          '<div class="row"><label>What to do<select data-k="mode"><option value="show"' + sel(c.mode, 'show') + '>Show this ad</option><option value="hide"' + sel(c.mode, 'hide') + '>Show no ad there</option></select></label>' +
          '<label>Priority (higher wins a tie)<input data-k="priority" value="' + esc(c.priority) + '"></label></div>' +
          '<label>Ad code (AdSense / ad-network tag / banner HTML)<textarea data-k="ad_code">' + esc(c.ad_code) + '</textarea></label>' +
          '<div class="row"><label>…or banner image address<input data-k="image_url" value="' + esc(c.image_url) + '" placeholder="https://…/banner.png"></label><label>Banner click-through link<input data-k="link_url" value="' + esc(c.link_url) + '" placeholder="https://advertiser.com/…"></label></div>' +
          '<label><input type="checkbox" data-k="betting_related" ' + (Number(c.betting_related) ? 'checked' : '') + ' style="width:auto"> Betting / casino ad (never shown where betting content is off)</label> <label><input type="checkbox" data-k="active" ' + (Number(c.active) ? 'checked' : '') + ' style="width:auto"> Active</label>' +
          '<p class="gap"><button class="b save">Save</button>' + (c.id ? '<button class="b del-c">Delete</button> <span class="muted">' + esc(scopeLabel(c)) + '</span>' : '') + '</p></div>';
      };
      v.innerHTML = '<h2>Ads by country</h2><p class="muted">Each slot can have a different ad for each country or region. A visitor gets the most specific match: their <b>country</b> first, then their <b>region group</b>, then <b>Everywhere else</b>. If nothing matches, the slot falls back to its own default ad code (Ad slots tab), or a bookmaker banner for their country.</p>' +
        '<datalist id="regionlist2">' + regionOpts + '</datalist>' + list.map(row).join('') + '<h3>New ad</h3>' + row(null);
      v.onclick = function (e) {
        var t = e.target, card = t.closest('[data-id]'); if (!card) return;
        var g = function (k) { var el = card.querySelector('[data-k=' + k + ']'); return el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value; };
        var id = card.getAttribute('data-id');
        if (t.classList.contains('save')) act(api('PUT', 'ad-creatives/' + (id || 'new'), { name: g('name'), slot_key: g('slot_key'), scope_type: g('scope_type'), scope_value: g('scope_value'), mode: g('mode'), priority: g('priority'), ad_code: g('ad_code'), image_url: g('image_url'), link_url: g('link_url'), betting_related: g('betting_related'), active: g('active') })).then(show);
        if (t.classList.contains('del-c') && confirm('Delete this ad?')) act(api('DELETE', 'ad-creatives/' + id), 'Deleted').then(show);
      };
    });
  };

  /* ---------- leagues ---------- */
  VIEWS.leagues = function (v) {
    function load(q) {
      api('GET', 'leagues?q=' + encodeURIComponent(q || '')).then(function (rows) {
        $('#lgb').innerHTML = rows.map(function (l) { return '<tr data-id="' + l.id + '"><td>' + esc(l.country) + '</td><td>' + esc(l.name) + '</td><td>' + esc(l.sport) + '</td><td><input type="checkbox" class="l-top" ' + (l.top ? 'checked' : '') + '></td><td><input type="checkbox" class="l-act" ' + (l.active ? 'checked' : '') + '></td></tr>'; }).join('');
      });
    }
    v.innerHTML = '<h2>Leagues</h2><p class="muted">Competitions are imported automatically from the data feed. “Top” puts a league in the Top leagues menu and sorts it first; untick “Active” to hide a competition everywhere.</p><div class="card"><input id="lq" placeholder="Search league or country…"><table><tr><th>Country</th><th>League</th><th>Sport</th><th>Top</th><th>Active</th></tr><tbody id="lgb"></tbody></table></div>';
    load('');
    $('#lq').oninput = function () { clearTimeout(load.t); var q = this.value; load.t = setTimeout(function () { load(q); }, 250); };
    v.onchange = function (e) { var tr = e.target.closest('tr[data-id]'); if (!tr) return; act(api('PUT', 'leagues/' + tr.getAttribute('data-id'), { top: tr.querySelector('.l-top').checked ? 1 : 0, active: tr.querySelector('.l-act').checked ? 1 : 0 })); };
    return Promise.resolve();
  };

  /* ---------- settings ---------- */
  VIEWS.settings = function (v) {
    return api('GET', 'meta').then(function (m) {
      var s = m.settings;
      v.innerHTML = '<h2>Settings</h2><div class="card"><label>Default odds format<select id="s-odds"><option value="decimal">Decimal</option><option value="fractional">Fractional</option><option value="american">American</option></select></label><label>Tagline<input id="s-tag" value="' + esc(s.site_tagline || '') + '"></label><p><button class="b" id="s-save">Save</button></p></div><div class="card"><b>Data provider:</b> ' + esc(m.provider) + ' — change <code>DATA_PROVIDER</code> and keys in <code>.env</code>, then restart.</div>';
      $('#s-odds').value = s.odds_format || 'decimal';
      $('#s-save').onclick = function () { act(api('PUT', 'settings', { odds_format: $('#s-odds').value, site_tagline: $('#s-tag').value })); };
    });
  };

  api('GET', 'meta').then(function (m) { META = m; if (m.mock) $('#mode').textContent = 'DEMO DATA'; show(); }).catch(function (e) { $('#view').innerHTML = '<div class="card">Could not load: ' + esc(e.message) + '</div>'; });
})();
