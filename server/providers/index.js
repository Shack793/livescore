'use strict';
// server/providers/index.js — data provider registry.
//
// A provider is the ONLY thing that knows where scores, fixtures and odds come from. Everything else
// (database, sync loop, pages, live push, geo-targeting) is provider-agnostic. To add a feed, write a
// module that returns an object with the methods below and register it in create().
//
// All methods are async. `ref` values are the provider's own stable string ids.
//
//   name, isMock, sports                       identification; sports = ids this provider can serve
//   referenceData()  -> { sports?, countries:[{code,name,kind?}], leagues:[{ref,sport,countryCode,name,slug?,type,top,season}],
//                         teams:[{ref,sport,countryCode,name,slug?,logo?}] }
//   feedBookmakers() -> [{ref,name}]           bookmakers present in the odds feed (admin maps them to affiliates)
//   fixtures({sport,from,to})  -> [Match]      all matches with kickoff in [from,to) (epoch seconds)
//   live({sport})    -> [Match]                matches currently in play
//   matchDetail(match) -> { events, stats, lineups, h2h } | null
//   standings(league)  -> [{group, rows:[{teamRef, rank, played, won, drawn, lost, gf, ga, points, form, note}]}]
//   squad(team)        -> [{name, number, pos, age}]
//   odds({matches, live}) -> [{matchRef, bookmaker, market, selection, value}]
//   status()           -> optional object shown in the admin (quota, last error, ...)
//
// Match = { ref, sport, leagueRef, season, round, homeRef, awayRef, kickoff, status, minute, period,
//           homeScore, awayScore, htHome, htAway, periods:[{home,away}]|null,
//           // optional: lets the sync create entities it hasn't seen yet (real feeds discover teams/leagues via fixtures)
//           league?:{ref,name,countryCode,countryName,type,season,sport}, homeTeam?:{ref,name,logo}, awayTeam?:{ref,name,logo} }
//   status: 'scheduled' | 'live' | 'halftime' | 'break' | 'finished' | 'postponed' | 'cancelled'
//
// markets used by the UI:  '1x2' (1,X,2)   'ml' (1,2)   'ou25' (O,U)   'btts' (Y,N)

const createMock = require('./mock');
const createApiFootball = require('./apifootball');

function create(cfg, log) {
  switch (cfg.provider) {
    case 'mock': return createMock(cfg);
    case 'apifootball': return createApiFootball(cfg, log);
    default: throw new Error('Unknown DATA_PROVIDER "' + cfg.provider + '". Use "mock" or "apifootball".');
  }
}

module.exports = { create };
