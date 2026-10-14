// shared/seed-data.js — demo bookmakers, geo rules, compliance rows and ad slots.
// Used by server/seed.js (first run) and by the standalone preview. EVERYTHING HERE IS PLACEHOLDER:
// replace the bookmakers with your real affiliate partners in the admin panel.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LSN = root.LSN || {}; root.LSN.seed = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var bookmakers = [
    { id: 1, name: 'BetWave', short_code: 'BW', color: '#e8341c', provider_ref: 'mock-betwave', affiliate_url: 'https://example.com/betwave?aff=YOUR_ID&sub={subid}&c={country}', offer: 'Welcome bonus up to GHS 500', terms_url: 'https://example.com/terms', license_text: 'Licensed by the Gaming Commission of Ghana (demo text).', sort_order: 1 },
    { id: 2, name: 'StakeKing', short_code: 'SK', color: '#0a8f5b', provider_ref: 'mock-stakeking', affiliate_url: 'https://example.com/stakeking?aff=YOUR_ID&sub={subid}&c={country}', offer: '100% first deposit match', terms_url: 'https://example.com/terms', license_text: 'Demo licence text — replace with the real licence.', sort_order: 2 },
    { id: 3, name: 'OddsDen', short_code: 'OD', color: '#6b3fd1', provider_ref: 'mock-oddsden', affiliate_url: 'https://example.com/oddsden?aff=YOUR_ID&sub={subid}&c={country}', offer: 'Free bet on your first wager', terms_url: 'https://example.com/terms', license_text: 'Demo licence text — replace with the real licence.', sort_order: 3 },
    { id: 4, name: 'PariLine', short_code: 'PL', color: '#0b6fd6', provider_ref: 'mock-pariline', affiliate_url: 'https://example.com/pariline?aff=YOUR_ID&sub={subid}&c={country}', offer: 'Boosted odds every weekend', terms_url: 'https://example.com/terms', license_text: 'Demo licence text — replace with the real licence.', sort_order: 4 },
    { id: 5, name: 'GoalBet', short_code: 'GB', color: '#e0a100', provider_ref: 'mock-goalbet', affiliate_url: 'https://example.com/goalbet?aff=YOUR_ID&sub={subid}&c={country}', offer: 'Bet £10 get £30 in free bets', terms_url: 'https://example.com/terms', license_text: 'Demo licence text — replace with the real licence.', sort_order: 5 }
  ];

  // scope_type: country | region | all ; mode: allow | block
  var rules = [
    { bookmaker_id: 1, scope_type: 'region', scope_value: 'AFRICA', mode: 'allow' },
    { bookmaker_id: 1, scope_type: 'country', scope_value: 'GH', mode: 'allow', offer: 'GHS 500 welcome bonus + free spins', sort_order: 1 },
    { bookmaker_id: 1, scope_type: 'country', scope_value: 'ZA', mode: 'block' },
    { bookmaker_id: 2, scope_type: 'region', scope_value: 'WEST_AFRICA', mode: 'allow' },
    { bookmaker_id: 2, scope_type: 'region', scope_value: 'UKI', mode: 'allow' },
    { bookmaker_id: 2, scope_type: 'region', scope_value: 'EU27', mode: 'allow' },
    { bookmaker_id: 3, scope_type: 'region', scope_value: 'AFRICA', mode: 'allow', sort_order: 3 },
    { bookmaker_id: 3, scope_type: 'region', scope_value: 'ASIA', mode: 'allow' },
    { bookmaker_id: 3, scope_type: 'region', scope_value: 'LATAM', mode: 'allow' },
    { bookmaker_id: 4, scope_type: 'region', scope_value: 'EUROPE', mode: 'allow' },
    { bookmaker_id: 4, scope_type: 'country', scope_value: 'GB', mode: 'block' },
    { bookmaker_id: 5, scope_type: 'all', scope_value: '*', mode: 'allow' },
    { bookmaker_id: 5, scope_type: 'country', scope_value: 'US', mode: 'block' },
    { bookmaker_id: 5, scope_type: 'country', scope_value: 'GB', mode: 'allow', sort_order: 1, offer: 'Bet £10 get £30 in free bets (18+, T&Cs apply)' }
  ];

  var countryRules = [
    { country_code: 'GH', betting_content: 1, min_age: 18, rg_text: 'Betting is for persons 18 and over. Bet responsibly. Gambling can be addictive.', rg_url: '', license_text: '' },
    { country_code: 'NG', betting_content: 1, min_age: 18, rg_text: 'Betting is for persons 18 and over. Bet responsibly.', rg_url: '', license_text: '' },
    { country_code: 'GB', betting_content: 1, min_age: 18, rg_text: 'BeGambleAware.org — 18+. When the fun stops, stop. Gambling can be addictive.', rg_url: 'https://www.begambleaware.org', license_text: '' },
    { country_code: 'US', betting_content: 0, min_age: 21, rg_text: '', rg_url: '', license_text: '' },
    { country_code: 'IN', betting_content: 0, min_age: 18, rg_text: '', rg_url: '', license_text: '' },
    { country_code: 'AE', betting_content: 0, min_age: 18, rg_text: '', rg_url: '', license_text: '' }
  ];

  // placement: where the slot renders. Sizes are IAB-standard. ad_code is empty until you paste your own tag.
  var adSlots = [
    { slot_key: 'leaderboard', label: 'Top leaderboard', placement: 'header', width: 728, height: 90, betting_related: 0, sort_order: 1 },
    { slot_key: 'sidebar-1', label: 'Right sidebar – top', placement: 'sidebar', width: 300, height: 250, betting_related: 0, sort_order: 2 },
    { slot_key: 'sidebar-2', label: 'Right sidebar – bottom', placement: 'sidebar', width: 300, height: 600, betting_related: 0, sort_order: 3 },
    { slot_key: 'left-skyscraper', label: 'Left skyscraper', placement: 'left', width: 160, height: 600, betting_related: 0, sort_order: 4 },
    { slot_key: 'infeed', label: 'In-feed native (after 3rd league)', placement: 'infeed', width: 0, height: 0, betting_related: 0, sort_order: 5 },
    { slot_key: 'match-strip', label: 'Match page strip', placement: 'match', width: 728, height: 90, betting_related: 1, sort_order: 6 },
    { slot_key: 'mobile-sticky', label: 'Mobile sticky footer', placement: 'mobile', width: 320, height: 50, betting_related: 0, sort_order: 7 }
  ];

  return { bookmakers: bookmakers, rules: rules, countryRules: countryRules, adSlots: adSlots };
});
