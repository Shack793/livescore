// shared/bookmakers.js — decides which bookmakers a visitor may see, by country.
//
// Rules live in `cfg.rules` (one row per bookmaker x scope):
//   scope_type  'country' | 'region' | 'all'
//   scope_value ISO-2 code (country), region code (region), or '*' (all)
//   mode        'allow' | 'block'
//   optional overrides: affiliate_url, offer, license_text, sort_order
//
// Resolution (per bookmaker):
//   1. Collect rules that match the visitor's country.
//   2. The MOST SPECIFIC scope wins:  country  >  region  >  all.
//   3. Within one specificity level, 'block' beats 'allow'.
//   4. No matching rule at all  =>  NOT shown (default deny).
// A country whose compliance row has betting_content = 0 shows no betting
// content at all (no bookmakers, no odds, no betting ads).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LSN = root.LSN || {}; root.LSN.bookmakers = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_RG = 'Gambling can be addictive. Please play responsibly and only bet what you can afford to lose.';

  function resolve(cfg, cc) {
    cc = String(cc || '').toUpperCase();
    var countryRules = cfg.countryRules || [];
    var cr = null;
    for (var i = 0; i < countryRules.length; i++) if (countryRules[i].country_code === cc) { cr = countryRules[i]; break; }

    var compliance = {
      country: cc || 'ZZ',
      betting_allowed: !(cr && Number(cr.betting_content) === 0),
      min_age: cr && cr.min_age ? Number(cr.min_age) : 18,
      rg_text: (cr && cr.rg_text) || DEFAULT_RG,
      rg_url: (cr && cr.rg_url) || '',
      license_text: (cr && cr.license_text) || ''
    };
    if (!compliance.betting_allowed) return { compliance: compliance, items: [] };

    var regionCodes = [];
    (cfg.regions || []).forEach(function (r) {
      if (cc && (r.countries || []).indexOf(cc) !== -1) regionCodes.push(r.code);
    });

    function specificity(r) {
      if (r.scope_type === 'country') return cc && r.scope_value === cc ? 3 : 0;
      if (r.scope_type === 'region') return regionCodes.indexOf(r.scope_value) !== -1 ? 2 : 0;
      if (r.scope_type === 'all') return 1;
      return 0;
    }

    var items = [];
    (cfg.bookmakers || []).forEach(function (b) {
      if (!Number(b.active)) return;
      var best = 0, winners = [];
      (cfg.rules || []).forEach(function (r) {
        if (r.bookmaker_id !== b.id) return;
        var s = specificity(r);
        if (!s) return;
        if (s > best) { best = s; winners = [r]; } else if (s === best) winners.push(r);
      });
      if (!winners.length) return;
      var blocked = winners.some(function (w) { return w.mode === 'block'; });
      if (blocked) return;
      winners.sort(function (a, c) { return (a.sort_order == null ? 1e9 : a.sort_order) - (c.sort_order == null ? 1e9 : c.sort_order); });
      var w = winners[0];
      items.push({
        id: b.id, name: b.name, short_code: b.short_code, color: b.color || '', logo_url: b.logo_url || '',
        provider_ref: b.provider_ref || '', terms_url: b.terms_url || '',
        affiliate_url: w.affiliate_url || b.affiliate_url,
        offer: w.offer || b.offer || '',
        license_text: w.license_text || b.license_text || '',
        sort: w.sort_order != null ? Number(w.sort_order) : Number(b.sort_order || 0)
      });
    });
    items.sort(function (a, b) { return a.sort - b.sort || a.id - b.id; });
    return { compliance: compliance, items: items };
  }

  // Never ship affiliate URLs to the browser: links go through /go/:id which
  // re-resolves the destination for the visitor's country on the server.
  function publicItems(items) {
    return items.map(function (b) {
      return { id: b.id, name: b.name, short_code: b.short_code, color: b.color, logo_url: b.logo_url, offer: b.offer, license_text: b.license_text, terms_url: b.terms_url };
    });
  }

  return { resolve: resolve, publicItems: publicItems, DEFAULT_RG: DEFAULT_RG };
});
