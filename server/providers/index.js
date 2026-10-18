'use strict';
// server/providers/index.js — data provider registry.
//
// Single-sport mode (unchanged): DATA_PROVIDER=mock|apifootball|sportmonks|apibasketball.
//
// Multi-sport mode: DATA_PROVIDER=multi. Each sport is served by exactly ONE
// adapter, so feeds can never disagree with each other ("no confusion" rule):
//   football   -> FOOTBALL_PROVIDER   (default sportmonks; Sportmonks wins every
//               football duplicate — the API-Sports football product is never used)
//   basketball -> BASKETBALL_PROVIDER (default off; set apibasketball to enable)
// Refs are prefixed per feed (sm:, af:, ab:) so entities from different feeds
// can never collide in the database.
const createMock = require('./mock');
const createApiFootball = require('./apifootball');
const createSportmonks = require('./sportmonks');
const createApiBasketball = require('./apibasketball');
const createFailover = require('./failover');

const BUILDERS = { mock: createMock, apifootball: createApiFootball, sportmonks: createSportmonks, apibasketball: createApiBasketball, failover: createFailover };

function createOne(name, cfg, log) {
  const b = BUILDERS[name];
  if (!b) throw new Error('Unknown provider "' + name + '". Use "mock", "apifootball", "sportmonks", "apibasketball" or "failover".');
  return b(cfg, log);
}

function createMulti(cfg, log) {
  const subs = [];
  const football = createOne(cfg.footballProvider || 'sportmonks', cfg, log);
  subs.push(football);
  if (cfg.basketballProvider) subs.push(createOne(cfg.basketballProvider, cfg, log));
  const bySport = {};
  subs.forEach((p) => (p.sports || []).forEach((s) => { bySport[s] = p; }));
  // Ref prefixes per feed (sportmonks sm:, apifootball af:, apibasketball ab:).
  // Routing prefers the explicit sport field; prefixes are only a fallback.
  const PREFIX = { sportmonks: ['sm:'], apifootball: ['af:'], apibasketball: ['ab:'], mock: [] };
  const prefixOf = (p) => Object.keys(PREFIX).filter((k) => p.name.indexOf(k) === 0).flatMap((k) => PREFIX[k]);
  const byPrefix = {};
  subs.forEach((p) => prefixOf(p).forEach((x) => { byPrefix[x] = p; }));
  const sportOf = (o) => {
    if (o && o.sport && bySport[o.sport]) return bySport[o.sport];
    const ref = o && (o.ref || o.leagueRef || o.matchRef);
    if (ref) { const pre = Object.keys(byPrefix).find((x) => String(ref).indexOf(x) === 0); if (pre) return byPrefix[pre]; }
    return subs[0];
  };
  const uniq = (arr, k) => { const seen = {}; return (arr || []).filter((x) => (seen[x[k]] ? false : (seen[x[k]] = true))); };
  return {
    name: 'multi(' + subs.map((p) => p.name).join('+') + ')',
    isMock: false,
    sports: Object.keys(bySport),
    status() { const o = { mode: 'multi' }; subs.forEach((p) => { o[p.name] = p.status ? p.status() : null; }); return o; },
    lowBudget() { return subs.some((p) => p.lowBudget && p.lowBudget()); },
    async referenceData() {
      const all = await Promise.all(subs.map((p) => p.referenceData()));
      return {
        countries: uniq(all.flatMap((r) => r.countries || []), 'code'),
        leagues: uniq(all.flatMap((r) => r.leagues || []), 'ref'),
        teams: uniq(all.flatMap((r) => r.teams || []), 'ref')
      };
    },
    async feedBookmakers() {
      const all = await Promise.all(subs.map((p) => (p.feedBookmakers ? p.feedBookmakers().catch(() => []) : [])));
      return uniq(all.flat(), 'ref');
    },
    async fixtures({ sport, from, to }) { return bySport[sport] ? bySport[sport].fixtures({ sport, from, to }) : []; },
    async live({ sport }) { return bySport[sport] ? bySport[sport].live({ sport }) : []; },
    async matchDetail(match) { return sportOf(match).matchDetail(match); },
    async standings(league) { return sportOf(league).standings(league); },
    async squad(team) { return sportOf(team).squad(team); },
    async odds({ matches, live }) {
      const groups = {};
      (matches || []).forEach((m) => { const p = sportOf(m); (groups[p.name] = groups[p.name] || { p, list: [] }).list.push(m); });
      const out = [];
      for (const k of Object.keys(groups)) {
        const r = await groups[k].p.odds({ matches: groups[k].list, live }).catch(() => []);
        (r || []).forEach((o) => out.push(o));
      }
      return out;
    }
  };
}

function create(cfg, log) {
  if ((cfg.provider || '') === 'multi') return createMulti(cfg, log);
  return createOne(cfg.provider, cfg, log);
}

module.exports = { create };
