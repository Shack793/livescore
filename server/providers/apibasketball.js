'use strict';
// server/providers/apibasketball.js — basketball feed via API-Sports Basketball v1.
//
// Field mapping verified live against the account key (2026-10-15, Free plan):
//   /games (by date + live), /leagues (428), /standings, /players, /games?h2h=.
// No team-statistics, lineup or odds coverage was returned for the probed games,
// so matchDetail returns events/stats/lineups empty (honest "not available" states)
// and odds() stays off until coverage appears (see BASKETBALL_ODDS below).
//
// QUOTA: the Free plan allows 100 requests/day for this API. The sync loop calls
// fixtures()/live() often, so this adapter throttles itself: fixtures refetch at
// most every BASKETBALL_FIXTURES_SEC (default 6h, ~10 calls) and live at most
// every BASKETBALL_LIVE_SEC (default 1h, 1 call). That is TEST cadence — upgrade
// the basketball product to a paid plan and lower both values for real live scores.
const { slugify } = require('../../shared/util');

const STATUS = {
  NS: 'scheduled', TBD: 'scheduled',
  Q1: 'live', Q2: 'live', Q3: 'live', Q4: 'live', OT: 'live', ET: 'live', LIVE: 'live',
  HT: 'halftime', BT: 'break',
  FT: 'finished', AOT: 'finished',
  POST: 'postponed', PST: 'postponed', SUSP: 'postponed', INT: 'postponed',
  CANC: 'cancelled', ABD: 'cancelled'
};
// Flagged as "top" (Top leagues menu + scheduled standings). Edit freely in Admin → Leagues.
const TOP_IDS = new Set([12]); // NBA
const POS = { 'Point Guard': 'PG', 'Shooting Guard': 'SG', 'Small Forward': 'SF', 'Power Forward': 'PF', Center: 'C', Guard: 'G', Forward: 'F' };

function statusOf(short) {
  if (STATUS[short]) return STATUS[short];
  if (/^Q\d/i.test(short || '') || /^(OT|ET|LIVE)$/i.test(short || '')) return 'live';
  return 'scheduled';
}

module.exports = function createApiBasketball(cfg, log) {
  const base = 'https://v1.basketball.api-sports.io';
  const key = cfg.apiSportsKey;
  const leagueIds = (cfg.basketballLeagues || []).map(Number).filter((n) => n > 0);
  const fixSec = Math.max(300, cfg.basketballFixturesSec || 21600);
  const liveSec = Math.max(60, cfg.basketballLiveSec || 3600);
  const oddsOn = !!cfg.basketballOdds;
  const st = { calls: 0, remaining: null, limit: null, lastError: null, lastOk: null };
  const logger = log || (() => {});
  let lastFixtures = 0, lastLive = 0, lastCallAt = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function call(path, params) {
    if (!key) throw new Error('API_SPORTS_KEY is not set');
    // Free plan: 10 requests/minute. Pace all calls so bursts can never 429.
    const gap = Date.now() - lastCallAt;
    if (gap < 6500) await sleep(6500 - gap);
    lastCallAt = Date.now();
    const qs = new URLSearchParams(params || {}).toString();
    const url = base + path + (qs ? '?' + qs : '');
    st.calls++;
    let res;
    try {
      res = await fetch(url, { headers: { 'x-apisports-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    } catch (e) { st.lastError = 'network: ' + e.message; throw e; }
    const rem = res.headers.get('x-ratelimit-requests-remaining'), lim = res.headers.get('x-ratelimit-requests-limit');
    if (rem != null) st.remaining = Number(rem);
    if (lim != null) st.limit = Number(lim);
    if (!res.ok) { st.lastError = 'HTTP ' + res.status + ' ' + path; throw new Error('API-Basketball HTTP ' + res.status + ' for ' + path); }
    const body = await res.json();
    const errs = body && body.errors;
    const hasErr = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
    if (hasErr) { const msg = JSON.stringify(errs); st.lastError = msg; throw new Error('API-Basketball error for ' + path + ': ' + msg); }
    if (st.remaining === 0) { st.lastError = 'daily quota exhausted'; throw new Error('API-Basketball daily quota exhausted'); }
    st.lastOk = Date.now(); st.lastError = null;
    return body;
  }
  const lowBudget = () => st.remaining != null && st.remaining < 20;
  const wanted = (id) => !leagueIds.length || leagueIds.includes(Number(id));
  const ymd = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

  function countryOf(c) {
    const code = c && c.code;
    if (code && /^[A-Za-z]{2}$/.test(code)) return [code.toUpperCase(), (c && c.name) || code.toUpperCase()];
    return ['INT', ((c && c.name) || 'World')];
  }

  function mapGame(g) {
    const lg = g.league || {}, tm = g.teams || {}, sc = g.scores || {};
    const status = statusOf(g.status && g.status.short);
    const hs = sc.home || {}, as = sc.away || {};
    const notStarted = status === 'scheduled' || status === 'postponed' || status === 'cancelled';
    const periods = ['quarter_1', 'quarter_2', 'quarter_3', 'quarter_4'].map((q) => ({ home: hs[q], away: as[q] }))
      .filter((p) => p.home != null && p.away != null);
    if (hs.over_time != null && as.over_time != null) periods.push({ home: hs.over_time, away: as.over_time });
    const cc = countryOf(g.country);
    return {
      ref: 'ab:' + g.id, sport: 'basketball', leagueRef: 'ab:l' + lg.id, season: String(lg.season || ''),
      round: g.stage || g.week || '', homeRef: 'ab:t' + (tm.home && tm.home.id), awayRef: 'ab:t' + (tm.away && tm.away.id),
      kickoff: g.timestamp, status, minute: null, period: null,
      homeScore: notStarted ? null : (hs.total == null ? 0 : hs.total),
      awayScore: notStarted ? null : (as.total == null ? 0 : as.total),
      htHome: null, htAway: null, periods: periods.length ? periods : null,
      league: { ref: 'ab:l' + lg.id, name: lg.name, countryCode: cc[0], countryName: cc[1], type: /cup/i.test(lg.type || '') ? 'cup' : 'league', season: String(lg.season || ''), sport: 'basketball', logo: lg.logo || '' },
      homeTeam: { ref: 'ab:t' + (tm.home && tm.home.id), name: tm.home && tm.home.name, logo: tm.home && tm.home.logo },
      awayTeam: { ref: 'ab:t' + (tm.away && tm.away.id), name: tm.away && tm.away.name, logo: tm.away && tm.away.logo }
    };
  }

  return {
    name: 'apibasketball',
    isMock: false,
    sports: ['basketball'],
    status() { return { mode: 'apibasketball', calls: st.calls, remaining: st.remaining, limit: st.limit, lastOk: st.lastOk ? new Date(st.lastOk).toISOString() : null, lastError: st.lastError, keySet: !!key }; },
    lowBudget,

    async referenceData() {
      const r = await call('/leagues');
      const now = Date.now();
      const leagues = [], countries = [];
      (r.response || []).forEach((x) => {
        if (!wanted(x.id)) return;
        const seasons = (x.seasons || []).filter((s) => s && s.season);
        if (!seasons.length) return;
        // Prefer the season covering today, else the most recently started one.
        let cur = seasons.find((s) => Date.parse(s.start) <= now && now <= Date.parse(s.end) + 90 * 86400000);
        if (!cur) cur = seasons.slice().sort((a, b) => (a.start < b.start ? 1 : -1))[0];
        const cc = countryOf(x.country);
        if (!countries.some((c) => c.code === cc[0])) countries.push({ code: cc[0], name: cc[1], kind: cc[0] === 'INT' ? 'region' : 'country' });
        leagues.push({
          ref: 'ab:l' + x.id, sport: 'basketball', countryCode: cc[0], countryName: cc[1], name: x.name,
          type: /cup/i.test(x.type || '') ? 'cup' : 'league', season: String(cur.season), top: TOP_IDS.has(x.id) ? 1 : 0, logo: x.logo || ''
        });
      });
      return { countries, leagues, teams: [] }; // teams are discovered from games
    },

    async feedBookmakers() {
      try {
        const r = await call('/odds/bookmakers');
        return (r.response || []).map((b) => ({ ref: 'ab:b' + b.id, name: b.name }));
      } catch (e) { logger('feedBookmakers: ' + e.message); return []; }
    },

    async fixtures({ from, to }) {
      if (Date.now() - lastFixtures < fixSec * 1000) return [];
      if (lowBudget()) return [];
      const out = [];
      for (let t = from; t < to; t += 86400) {
        if (lowBudget()) break;
        // Free plans only cover ~yesterday→tomorrow: skip out-of-range days
        // instead of failing the whole job (paid plans get the full window).
        let r;
        try {
          r = await call('/games', { date: ymd(t), timezone: 'UTC' });
        } catch (e) {
          if (/date|plan|season/i.test(e.message)) { logger('fixtures ' + ymd(t) + ' skipped: ' + e.message); continue; }
          throw e;
        }
        (r.response || []).forEach((g) => {
          if (!wanted(g.league && g.league.id)) return;
          const m = mapGame(g);
          if (m.kickoff >= from && m.kickoff < to) out.push(m);
        });
      }
      lastFixtures = Date.now();
      return out;
    },

    // No reliable live-only endpoint in Basketball v1: pull today's games once
    // per throttle window and keep the in-play ones. Deterministic and quota-cheap.
    async live() {
      if (Date.now() - lastLive < liveSec * 1000) return [];
      if (lowBudget()) return [];
      const today = ymd(Math.floor(Date.now() / 1000));
      const r = await call('/games', { date: today, timezone: 'UTC' });
      lastLive = Date.now();
      const liveSet = new Set(['live', 'halftime', 'break']);
      return (r.response || []).filter((g) => wanted(g.league && g.league.id)).map(mapGame)
        .filter((m) => liveSet.has(m.status));
    },

    async matchDetail(match) {
      const ids = [match.homeRef, match.awayRef].map((r) => String(r || '').replace(/^ab:t/, ''));
      let hh = { response: [] };
      if (ids[0] && ids[1] && ids[0] !== ids[1]) {
        hh = await call('/games', { h2h: ids[0] + '-' + ids[1] }).catch(() => ({ response: [] }));
      }
      const h2h = (hh.response || []).slice(-5).map((f) => {
        const tm = f.teams || {}, sc = f.scores || {};
        return {
          date: f.timestamp || null, home: tm.home && tm.home.name || '', away: tm.away && tm.away.name || '',
          homeScore: sc.home && sc.home.total, awayScore: sc.away && sc.away.total,
          competition: (f.league && f.league.name) || ''
        };
      });
      // No event, team-stat or lineup coverage in Basketball v1 (verified 2026-10-15).
      return { events: [], stats: [], lineups: null, h2h };
    },

    async standings(league) {
      const id = String(league.ref).replace(/^ab:l/, '');
      const r = await call('/standings', { league: id, season: league.season });
      const rows = Array.isArray(r.response) ? (Array.isArray(r.response[0]) ? r.response[0] : r.response) : [];
      const byGroup = {};
      rows.forEach((x) => {
        const g = (x.group && x.group.name) || '';
        (byGroup[g] = byGroup[g] || []).push({
          teamRef: 'ab:t' + (x.team && x.team.id), rank: x.position,
          played: x.games && x.games.played || 0, won: x.games && x.games.win && x.games.win.total || 0, drawn: 0,
          lost: x.games && x.games.lose && x.games.lose.total || 0,
          gf: x.points && x.points.for || 0, ga: x.points && x.points.against || 0, points: 0,
          form: (x.form || '').slice(-5),
          note: /playoff|promotion|champion/i.test(x.description || '') ? 'q1' : /relegation/i.test(x.description || '') ? 'rel' : ''
        });
      });
      return Object.keys(byGroup).map((g) => ({ group: g, rows: byGroup[g] }));
    },

    async squad(team) {
      const id = String(team.ref).replace(/^ab:t/, '');
      // /players requires a season; try the most likely current seasons first.
      // Squad results are cached 24h per team, so this costs at most 3 calls/day/team.
      const now = new Date(), y = now.getUTCFullYear();
      const guess = now.getUTCMonth() >= 7 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
      // Free plans only cover older seasons: fall back to recent ones (stale squad beats none).
      const cands = Array.from(new Set([guess, '2024-2025', '2023-2024', '2022-2023'])).slice(0, 4);
      for (const season of cands) {
        try {
          const r = await call('/players', { team: id, season });
          if (r.response && r.response.length) {
            return r.response.map((p) => ({ name: p.name || '', number: p.number != null ? Number(p.number) || p.number : null, pos: POS[p.position] || p.position || '', age: p.age || null })).filter((p) => p.name);
          }
        } catch (e) { if (!/season/i.test(e.message)) throw e; }
        if (lowBudget()) break;
      }
      return [];
    },

    // No odds coverage returned for basketball (verified 2026-10-15). Stay silent
    // to protect the 100/day free quota; set BASKETBALL_ODDS=true once covered.
    async odds() {
      if (!oddsOn) return [];
      if (lowBudget()) return [];
      return [];
    }
  };
};
