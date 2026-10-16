'use strict';
// Local verification of the API-Basketball adapter + multi router (read-only).
// Env needed: DATA_PROVIDER=multi, FOOTBALL_PROVIDER=sportmonks,
// BASKETBALL_PROVIDER=apibasketball, API_SPORTS_KEY=..., SPORTMONKS_TOKEN=...
const config = require('../server/config');
const providers = require('../server/providers');

(async () => {
  const cfg = config.load();
  console.log('Provider: ' + cfg.provider + ' sports-filter: ' + (cfg.sports.join(',') || '(all)'));
  const p = providers.create(cfg, console.log);
  console.log('Serving sports: ' + (p.sports || []).join(','));
  let fail = 0;
  const check = (name, cond, extra) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
    if (!cond) fail++;
  };
  const now = Math.floor(Date.now() / 1000);

  // Basketball via the router (proves routing, not just the adapter).
  const bref = await p.referenceData();
  const nba = bref.leagues.find((l) => l.ref === 'ab:l12');
  check('multi reference has NBA', !!nba, bref.leagues.length + ' basketball+football leagues total');
  const fb = (bref.leagues || []).filter((l) => String(l.ref).indexOf('sm:') === 0);
  check('football still 5x Sportmonks', fb.length === 5, fb.map((l) => l.name).join(','));
  const dupes = fb.filter((l) => String(l.ref).indexOf('ab:') === 0);
  check('no football from API-Sports', dupes.length === 0, 'clean split');

  const bfx = await p.fixtures({ sport: 'basketball', from: now - 86400, to: now + 86400 });
  check('basketball fixtures today', bfx.length > 0, bfx.length + ' games');
  const blv = await p.live({ sport: 'basketball' });
  console.log('INFO basketball live now: ' + blv.length);
  if (bfx.length) {
    const d = await p.matchDetail(bfx[0]);
    check('basketball detail h2h', Array.isArray(d.h2h), d.h2h.length + ' h2h rows');
    check('basketball detail honest empties', Array.isArray(d.events) && d.lineups === null, 'events/lineups empty as designed');
  }
  const st = await p.standings({ ref: 'ab:l12', sport: 'basketball', season: '2024-2025' });
  check('basketball standings', st.length > 0 && st[0].rows.length > 10, st.length ? st[0].rows.length + ' rows' : 'none');
  const sq = await p.squad({ ref: 'ab:t138', sport: 'basketball' });
  check('basketball squad', sq.length >= 10, sq.length + ' players');
  const ffx = await p.fixtures({ sport: 'football', from: now - 3 * 86400, to: now + 86400 });
  check('football via multi still Sportmonks', ffx.length > 0 && ffx.every((m) => String(m.ref).indexOf('sm:') === 0), ffx.length + ' fixtures');
  console.log(fail ? 'RESULT: ' + fail + ' FAILURES' : 'RESULT: ALL PASS');
  if (p.status) console.log('Provider status: ' + JSON.stringify(p.status()));
  process.exit(fail ? 1 : 0);
})();
