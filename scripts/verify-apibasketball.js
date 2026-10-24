'use strict';
// Local verification of the API-Sports football + basketball feeds (read-only).
// Env needed: DATA_PROVIDER=multi, FOOTBALL_PROVIDER=apifootball,
// BASKETBALL_PROVIDER=apibasketball, API_SPORTS_KEY (or API_FOOTBALL_KEY).
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

  // Reference data through the multi router (proves routing, not just an adapter).
  const ref = await p.referenceData();
  const nba = (ref.leagues || []).find((l) => l.ref === 'ab:l12');
  check('reference has NBA', !!nba, (ref.leagues || []).length + ' leagues total');
  const fb = (ref.leagues || []).filter((l) => /^(af|sm):/.test(String(l.ref)));
  check('reference has a real football feed', fb.length > 0, fb.length + ' football leagues');
  const badSplit = (ref.leagues || []).filter((l) => String(l.ref).indexOf('ab:') === 0 && l.sport === 'football');
  check('no football from API-Basketball', badSplit.length === 0, 'clean split');

  // Basketball.
  const bfx = await p.fixtures({ sport: 'basketball', from: now - 86400, to: now + 86400 });
  check('basketball fixtures today', bfx.length > 0, bfx.length + ' games');
  const blv = await p.live({ sport: 'basketball' });
  console.log('INFO basketball live now: ' + blv.length);
  const nbaGames = bfx.filter((m) => m.leagueRef === 'ab:l12');
  if (bfx.length) {
    const d = await p.matchDetail(bfx[0]);
    check('basketball detail h2h', Array.isArray(d.h2h), d.h2h.length + ' h2h rows');
    check('basketball detail honest empties', Array.isArray(d.events) && d.lineups === null, 'events/lineups empty as designed');
    const sample = nbaGames[0] || bfx[0];
    const sq = await p.squad({ ref: sample.homeRef, sport: 'basketball' });
    check('basketball squad', sq.length >= 5, sq.length + ' players (' + sample.homeTeam.name + ')');
  }
  const season = nba ? nba.season : '2026-2027';
  const st = await p.standings({ ref: 'ab:l12', sport: 'basketball', season });
  check('basketball standings', st.length > 0 && st[0].rows.length > 10, st.length ? st[0].rows.length + ' rows' : 'none');
  if (cfg.basketballOdds) {
    const od = await p.odds({ matches: (nbaGames.length ? nbaGames : bfx).slice(0, 4), live: false });
    check('basketball odds (winner market)', od.length > 0 || !nbaGames.length, od.length + ' rows' + (od[0] ? '; e.g. ' + od[0].market + '/' + od[0].selection + ' @ ' + od[0].value : ''));
  }

  // Football through the same router.
  const ffx = await p.fixtures({ sport: 'football', from: now - 3 * 86400, to: now + 86400 });
  check('football fixtures via multi', ffx.length > 0 && ffx.every((m) => /^(af|sm):/.test(String(m.ref))), ffx.length + ' fixtures');
  const flv = await p.live({ sport: 'football' });
  check('football live via multi', Array.isArray(flv), flv.length + ' live now');

  console.log(fail ? 'RESULT: ' + fail + ' FAILURES' : 'RESULT: ALL PASS');
  if (p.status) console.log('Provider status: ' + JSON.stringify(p.status()));
  process.exit(fail ? 1 : 0);
})();
