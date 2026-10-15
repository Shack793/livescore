'use strict';
// Local verification of the Sportmonks adapter (read-only). Run: node scripts/verify-sportmonks.js
// Reads SPORTMONKS_TOKEN from process env (set DATA_PROVIDER=sportmonks first).
const config = require('../server/config');
const providers = require('../server/providers');

(async () => {
  const cfg = config.load();
  const p = providers.create(cfg, console.log);
  const now = Math.floor(Date.now() / 1000);
  let fail = 0;
  const check = (name, cond, extra) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
    if (!cond) fail++;
  };
  const ref = await p.referenceData();
  check('referenceData 5 leagues', ref.leagues.length === 5, ref.leagues.map((l) => l.ref + '=' + l.name).join(', '));
  check('league seasons', ref.leagues.every((l) => l.season), ref.leagues.map((l) => l.season).join(','));
  const bks = await p.feedBookmakers();
  check('feedBookmakers', bks.length >= 20, bks.length + ' bookmakers');
  const fx = await p.fixtures({ sport: 'football', from: now - 3 * 86400, to: now + 7 * 86400 });
  check('fixtures 10d window', fx.length > 10, fx.length + ' fixtures');
  const lv = await p.live({ sport: 'football' });
  console.log('INFO live right now: ' + lv.length);
  const fin = fx.find((m) => m.status === 'finished');
  if (fin) {
    const d = await p.matchDetail(fin);
    check('matchDetail events', d.events.length > 0, d.events.length + ' events');
    check('matchDetail stats', d.stats.length >= 8, d.stats.length + ' stats');
    check('matchDetail lineups', !!(d.lineups && d.lineups.home), d.lineups ? 'yes' : 'no');
    console.log('INFO h2h rows: ' + d.h2h.length);
  }
  const st = await p.standings({ ref: 'sm:l8', season: '' });
  check('standings EPL', st.length && st[0].rows.length >= 18, st.length ? st[0].rows.length + ' rows, #1=' + st[0].rows[0].teamRef + ' ' + st[0].rows[0].points + 'pts' : 'none');
  const sq = await p.squad({ ref: 'sm:t68' });
  check('squad Dortmund', sq.length >= 20, sq.length + ' players');
  const upc = fx.filter((m) => m.status === 'scheduled').slice(0, 3);
  if (upc.length) {
    const od = await p.odds({ matches: upc, live: false });
    const m1 = od.filter((o) => o.market === '1x2');
    console.log('INFO odds rows: ' + od.length + ' (1x2: ' + m1.length + ')');
    check('odds have 1x2', m1.length > 0, m1.slice(0, 3).map((o) => o.bookmaker + ':' + o.value).join(' '));
  } else console.log('INFO no upcoming fixtures in window to test odds');
  console.log(fail ? 'RESULT: ' + fail + ' FAILURES' : 'RESULT: ALL PASS');
  console.log('Provider status: ' + JSON.stringify(p.status()));
  process.exit(fail ? 1 : 0);
})();
