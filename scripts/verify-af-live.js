'use strict';
const config = require('../server/config');
const providers = require('../server/providers');
(async () => {
  const p = providers.create(config.load(), console.log);
  const lv = await p.live({ sport: 'football' });
  console.log('live:', lv.length);
  const m = lv.find((x) => x.status === 'live') || lv[0];
  if (!m) { console.log('no live match to inspect'); return; }
  console.log('detail on:', m.homeTeam.name, 'v', m.awayTeam.name, m.status);
  const d = await p.matchDetail(m);
  console.log('events:', d.events.length, JSON.stringify(d.events.slice(0, 2)));
  console.log('stats:', d.stats.length, JSON.stringify(d.stats.slice(0, 2)));
  console.log('lineups:', d.lineups ? 'yes' : 'no');
  console.log('status:', JSON.stringify(p.status()));
})();
