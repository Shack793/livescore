'use strict';
// npm run provider:check — verifies your data provider settings WITHOUT touching the database.
// Run it after putting your API key in .env. It prints what the feed returns so you can confirm the mapping.
const config = require('../server/config');
const providers = require('../server/providers');

(async () => {
  const cfg = config.load();
  console.log('Provider: ' + cfg.provider);
  const p = providers.create(cfg, console.log);
  const t0 = Date.now(), now = Math.floor(Date.now() / 1000);
  const step = async (name, fn) => { const s = Date.now(); try { const r = await fn(); console.log('OK   ' + name + ' (' + (Date.now() - s) + ' ms)'); return r; } catch (e) { console.log('FAIL ' + name + ': ' + e.message); return null; } };

  const ref = await step('referenceData (countries, leagues, teams)', () => p.referenceData());
  if (ref) console.log('     countries=' + (ref.countries || []).length + ' leagues=' + (ref.leagues || []).length + ' teams=' + (ref.teams || []).length);
  const bks = await step('feedBookmakers', () => p.feedBookmakers());
  if (bks) console.log('     ' + bks.length + ' bookmakers in the odds feed: ' + bks.slice(0, 12).map((b) => b.name + ' [' + b.ref + ']').join(', ') + (bks.length > 12 ? ' …' : ''));
  const fx = await step('fixtures (next 24h, football)', () => p.fixtures({ sport: 'football', from: now, to: now + 86400 }));
  if (fx) console.log('     ' + fx.length + ' fixtures' + (fx[0] ? '; sample: ' + (fx[0].homeTeam ? fx[0].homeTeam.name : fx[0].homeRef) + ' v ' + (fx[0].awayTeam ? fx[0].awayTeam.name : fx[0].awayRef) : ''));
  const lv = await step('live (football)', () => p.live({ sport: 'football' }));
  if (lv) console.log('     ' + lv.length + ' live matches right now');
  if (fx && fx.length) {
    const od = await step('odds (first 5 fixtures)', () => p.odds({ matches: fx.slice(0, 5), live: false }));
    if (od) {
      const by = {}; od.forEach((o) => { by[o.bookmaker] = (by[o.bookmaker] || 0) + 1; });
      console.log('     ' + od.length + ' odds rows from ' + Object.keys(by).length + ' bookmakers: ' + Object.keys(by).join(', '));
      const unmapped = Object.keys(by).length;
      if (!unmapped) console.log('     WARNING: no odds returned. Check that your plan includes odds and the fixtures have odds yet.');
    }
    await step('matchDetail (first fixture)', async () => { const d = await p.matchDetail(fx[0]); console.log('     events=' + ((d && d.events) || []).length + ' stats=' + ((d && d.stats) || []).length + ' lineups=' + (d && d.lineups ? 'yes' : 'no') + ' h2h=' + ((d && d.h2h) || []).length); });
  }
  if (p.status) console.log('Provider status: ' + JSON.stringify(p.status()));
  console.log('Done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's. Then map each odds-feed bookmaker to your affiliate bookmaker in Admin → Bookmakers → "Odds feed bookmaker".');
})();
