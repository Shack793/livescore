'use strict';
// server/providers/mock.js — demo provider backed by the deterministic world in shared/mock-world.js.
// Lets you run and demo the whole site (all 9 sports, live scores, odds) with no API key.
const { createWorld } = require('../../shared/mock-world');

module.exports = function createMock(cfg) {
  const world = createWorld({ realtime: !!cfg.mockRealtime });
  const now = () => world.simNow(Math.floor(Date.now() / 1000));
  const sportIds = ['football', 'basketball', 'tennis', 'hockey', 'volleyball', 'american-football', 'baseball', 'handball', 'rugby'];

  return {
    name: 'mock',
    isMock: true,
    sports: sportIds,
    world,
    async referenceData() { return world.referenceData(); },
    async feedBookmakers() { return world.feedBookmakers(); },
    async fixtures({ sport, from, to }) { return world.fixtures({ sport, from, to, now: now() }); },
    async live({ sport }) { return world.live({ sport, now: now() }); },
    async matchDetail(match) { return world.detail(match.ref, now()); },
    async standings(league) { return world.standings(league.ref, now()); },
    async squad(team) { return world.squad(team.ref); },
    async odds({ matches }) { return world.odds({ matches, now: now() }); },
    status() { return { mode: world.realtime ? 'real clock' : 'demo clock (loops 14:00-21:00 every 7h)', simTime: new Date(now() * 1000).toISOString() }; }
  };
};
