'use strict';
// server/providers/sportmonks.js — real football feed via Sportmonks API v3.
//
// Field mapping verified live against the account token (2026-10-15, Starter trial):
//   my/leagues -> 5 leagues (8 EPL, 82 Bundesliga, 301 Ligue 1, 384 Serie A, 564 La Liga)
//   fixtures/between, livescores/inplay, fixtures/{id}, head-to-head, standings/seasons,
//   squads/teams, odds/bookmakers, odds/markets, odds per fixture, core/types.
// Odds add-on is ACTIVE, so per-bookmaker odds are available.
//
// Polling follows the livescore pattern: inplay builds the board, then inplay is
// re-polled every ~15s during match windows (cheap enough: ~240 calls/hr against a
// 2,000 calls/entity/hr quota). Finished matches are served via fixtures/by-ID.
// Scores always come from the authoritative CURRENT score (never reconstructed from
// events), so VAR-overturned goals (type 10) can never leave a phantom goal on screen.
const { slugify } = require('../../shared/util');

// Fixture state_id -> our status. Live halves/ET/penalties are all 'live'.
const STATUS = {
  1: 'scheduled',
  2: 'live', 22: 'live', 6: 'live', 9: 'live', 21: 'live', 25: 'live',
  3: 'halftime',
  4: 'break',
  5: 'finished', 7: 'finished', 8: 'finished',
  10: 'postponed', 11: 'postponed', 15: 'postponed', 16: 'postponed', 18: 'postponed', 19: 'postponed',
  12: 'cancelled', 20: 'cancelled',
  13: 'scheduled', 14: 'scheduled', 17: 'scheduled', 26: 'scheduled'
};
// Event type_id -> our event type (must match shared/pages.js eventIcon: goal,yellow,red,sub,pen,own).
const EVENTS = { 14: 'goal', 15: 'own', 16: 'pen', 18: 'sub', 19: 'yellow', 20: 'red', 21: 'red' };
// Statistic type_id -> [label, isPercent]. Mirrors the apifootball stat list.
const STATS = [
  [45, 'Ball possession', true], [42, 'Total shots'], [86, 'Shots on target'], [41, 'Shots off target'],
  [34, 'Corner kicks'], [56, 'Fouls'], [51, 'Offsides'], [84, 'Yellow cards'], [83, 'Red cards'],
  [57, 'Goalkeeper saves'], [80, 'Passes'], [82, 'Pass accuracy', true]
];
const POS = { 24: 'GK', 25: 'DF', 26: 'MF', 27: 'FW' };
// Country fallback for the 5 known leagues (league payloads only carry country_id).
const COUNTRIES = { 8: ['ENG', 'England'], 82: ['DE', 'Germany'], 301: ['FR', 'France'], 384: ['IT', 'Italy'], 564: ['ES', 'Spain'] };

module.exports = function createSportmonks(cfg, log) {
  const base = (cfg.sportmonksBase || 'https://api.sportmonks.com/v3').replace(/\/+$/, '');
  const key = cfg.sportmonksToken;
  const leagueIds = (cfg.sportmonksLeagues || []).map(Number).filter((n) => n > 0);
  const st = { calls: 0, remaining: null, lastError: null, lastOk: null };
  const logger = log || (() => {});
  const seasons = new Map(); // leagueId -> { seasonId, seasonName }

  async function call(path, params) {
    if (!key) throw new Error('SPORTMONKS_TOKEN is not set');
    const qs = new URLSearchParams(Object.assign({ api_token: key }, params || {})).toString();
    const url = base + path + '?' + qs;
    st.calls++;
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
    } catch (e) { st.lastError = 'network: ' + e.message; throw e; }
    for (const h of ['x-ratelimit-remaining', 'ratelimit-remaining']) {
      const v = res.headers.get(h);
      if (v != null) { st.remaining = Number(v); break; }
    }
    if (!res.ok) {
      let msg = 'HTTP ' + res.status + ' ' + path;
      try { const b = await res.json(); if (b && b.message) msg += ': ' + b.message; } catch (e) { /* ignore */ }
      st.lastError = msg;
      throw new Error('Sportmonks ' + msg);
    }
    st.lastOk = Date.now(); st.lastError = null;
    return res.json();
  }
  const lowBudget = () => st.remaining != null && st.remaining < 200;
  const leagueFilter = () => (leagueIds.length ? { filters: 'fixtureLeagues:' + leagueIds.join(',') } : {});
  const ymd = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

  function sideOf(fx, participantId, homeId) {
    return String(participantId) === String(homeId) ? 'home' : 'away';
  }

  function mapMatch(fx) {
    const parts = fx.participants || [];
    const home = parts.find((p) => p.meta && p.meta.location === 'home') || {};
    const away = parts.find((p) => p.meta && p.meta.location === 'away') || {};
    const status = STATUS[fx.state_id] || 'scheduled';
    const liveish = status === 'live' || status === 'halftime' || status === 'break';
    const scoreOf = (desc, loc) => {
      const s = (fx.scores || []).find((x) => x.description === desc && x.score && x.score.participant === loc);
      return s && s.score.goals != null ? s.score.goals : null;
    };
    const notStarted = status === 'scheduled' || status === 'postponed' || status === 'cancelled';
    const kickoff = fx.starting_at_timestamp || (fx.starting_at ? Math.floor(Date.parse(fx.starting_at + ' UTC') / 1000) : null);
    const cc = COUNTRIES[fx.league_id] || ['INT', 'World'];
    const lg = fx.league || {};
    const seasonName = (seasons.get(fx.league_id) || {}).seasonName || '';
    return {
      ref: 'sm:' + fx.id, sport: 'football', leagueRef: 'sm:l' + fx.league_id, season: seasonName, round: '',
      homeRef: 'sm:t' + home.id, awayRef: 'sm:t' + away.id, kickoff,
      status, minute: liveish && fx.minute != null ? fx.minute : null, period: null,
      homeScore: notStarted ? null : (scoreOf('CURRENT', 'home') == null ? 0 : scoreOf('CURRENT', 'home')),
      awayScore: notStarted ? null : (scoreOf('CURRENT', 'away') == null ? 0 : scoreOf('CURRENT', 'away')),
      htHome: scoreOf('1ST_HALF', 'home'), htAway: scoreOf('1ST_HALF', 'away'), periods: null,
      league: { ref: 'sm:l' + fx.league_id, name: lg.name || ('League ' + fx.league_id), countryCode: cc[0], countryName: cc[1], type: 'league', season: seasonName, sport: 'football', logo: lg.image_path || '' },
      homeTeam: { ref: 'sm:t' + home.id, name: home.name, logo: home.image_path || '' },
      awayTeam: { ref: 'sm:t' + away.id, name: away.name, logo: away.image_path || '' }
    };
  }

  function mapEvents(fx, homeId) {
    return (fx.events || []).map((e) => {
      const type = EVENTS[e.type_id];
      if (!type) return null; // includes VAR (10), missed pens, shootouts: never shown, never scored from
      const min = (e.minute || 0) + (e.extra_minute || 0);
      const side = sideOf(fx, e.participant_id, homeId);
      if (type === 'sub') return { min, type, side, player: e.related_player_name || '', out: e.player_name || '' };
      if (type === 'yellow' || type === 'red') return { min, type, side, player: e.player_name || '' };
      return {
        min, type: 'goal', side, player: e.player_name || '', assist: e.related_player_name || null,
        detail: type === 'own' ? 'Own goal' : type === 'pen' ? 'Penalty' : 'Goal'
      };
    }).filter(Boolean);
  }

  function mapStats(fx, homeId) {
    const idx = {};
    (fx.statistics || []).forEach((s) => {
      const side = sideOf(fx, s.participant_id, homeId);
      const v = s.data && s.data.value != null ? Number(s.data.value) : 0;
      (idx[s.type_id] = idx[s.type_id] || {})[side] = isFinite(v) ? v : 0;
    });
    return STATS.filter((d) => idx[d[0]]).map((d) => ({
      key: slugify(d[1]), label: d[1], home: idx[d[0]].home || 0, away: idx[d[0]].away || 0, pct: !!d[2]
    }));
  }

  function mapLineups(fx, homeId) {
    const rows = fx.lineups || [];
    if (!rows.length) return null;
    const mk = (teamId) => {
      const mine = rows.filter((r) => String(r.team_id) === String(teamId));
      if (!mine.length) return null;
      const one = (r) => {
        const pl = r.player || {};
        return { name: pl.name || pl.display_name || r.player_name || '', number: r.jersey_number, pos: POS[r.position_id] || '' };
      };
      return { formation: '', coach: '', starters: mine.filter((r) => r.type_id === 11).map(one), subs: mine.filter((r) => r.type_id === 12).map(one) };
    };
    const parts = fx.participants || [];
    const h = parts.find((p) => p.meta && p.meta.location === 'home');
    const a = parts.find((p) => p.meta && p.meta.location === 'away');
    const home = mk(h ? h.id : homeId), away = mk(a ? a.id : null);
    return home && away ? { home, away } : null;
  }

  async function seasonOf(leagueId) {
    if (seasons.has(leagueId)) return seasons.get(leagueId);
    const r = await call('/football/leagues/' + leagueId, { include: 'currentSeason' });
    const cs = r.data && r.data.currentseason;
    const s = { seasonId: cs && cs.id, seasonName: (cs && cs.name) || '' };
    seasons.set(leagueId, s);
    return s;
  }

  function mapOdds(rows, wanted) {
    const out = [];
    (rows || []).forEach((o) => {
      const ref = 'sm:' + o.fixture_id;
      if (wanted && !wanted.has(ref)) return;
      const v = parseFloat(o.dp3 != null ? o.dp3 : o.value);
      if (!isFinite(v) || v <= 1) return;
      const label = String(o.label || o.name || '');
      let market = null, sel = null;
      if (o.market_id === 1) { market = '1x2'; sel = { Home: '1', Draw: 'X', Away: '2' }[label]; }
      else if (o.market_id === 14) { market = 'btts'; sel = /^yes/i.test(label) ? 'Y' : /^no/i.test(label) ? 'N' : null; }
      else if (o.market_id === 4 && Number(o.total) === 2.5) { market = 'ou25'; sel = /^over/i.test(label) ? 'O' : /^under/i.test(label) ? 'U' : null; }
      if (market && sel) out.push({ matchRef: ref, bookmaker: 'sm:b' + o.bookmaker_id, market, selection: sel, value: v });
    });
    return out;
  }

  return {
    name: 'sportmonks',
    isMock: false,
    sports: ['football'],
    status() { return { mode: 'sportmonks', calls: st.calls, remaining: st.remaining, lastOk: st.lastOk ? new Date(st.lastOk).toISOString() : null, lastError: st.lastError, keySet: !!key, leagues: leagueIds }; },
    lowBudget,
    _call: call, // used by scripts/provider-check.js

    async referenceData() {
      const mine = await call('/my/leagues');
      const ids = (mine.data || []).map((l) => l.id);
      const leagues = await Promise.all(ids.map(async (id) => {
        const r = await call('/football/leagues/' + id, { include: 'currentSeason' });
        const lg = r.data || {};
        const cs = lg.currentseason || {};
        if (cs.id) seasons.set(id, { seasonId: cs.id, seasonName: cs.name || '' });
        const cc = COUNTRIES[id] || ['INT', 'World'];
        return {
          ref: 'sm:l' + id, sport: 'football', countryCode: cc[0], countryName: cc[1], name: lg.name || ('League ' + id),
          type: /cup/i.test(lg.type + ' ' + lg.name) ? 'cup' : 'league', season: cs.name || '', top: 1, logo: lg.image_path || ''
        };
      }));
      const countries = [];
      leagues.forEach((l) => { if (!countries.some((c) => c.code === l.countryCode)) countries.push({ code: l.countryCode, name: l.countryName, kind: 'country' }); });
      return { countries, leagues, teams: [] }; // teams are discovered from fixtures
    },

    async feedBookmakers() {
      const r = await call('/odds/bookmakers');
      return ((r.data || [])).map((b) => ({ ref: 'sm:b' + b.id, name: b.name }));
    },

    async fixtures({ from, to }) {
      const r = await call('/football/fixtures/between/' + ymd(from) + '/' + ymd(to),
        Object.assign({ include: 'league;participants;scores' }, leagueFilter()));
      return (r.data || []).map(mapMatch).filter((m) => m.kickoff && m.kickoff >= from && m.kickoff < to);
    },

    async live() {
      const r = await call('/football/livescores/inplay',
        Object.assign({ include: 'league;participants;scores' }, leagueFilter()));
      return (r.data || []).map(mapMatch);
    },

    async matchDetail(match) {
      const id = String(match.ref).replace(/^sm:/, '');
      const homeId = match.homeRef ? String(match.homeRef).replace(/^sm:t/, '') : null;
      const awayId = match.awayRef ? String(match.awayRef).replace(/^sm:t/, '') : null;
      const [fx, hh] = await Promise.all([
        call('/football/fixtures/' + id, { include: 'league;participants;scores;periods;events;statistics;lineups' }),
        (homeId && awayId)
          ? call('/football/fixtures/head-to-head/' + homeId + '/' + awayId, { include: 'league;participants;scores' }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] })
      ]);
      const d = fx.data || {};
      const parts = d.participants || [];
      const h = homeId || ((parts.find((p) => p.meta && p.meta.location === 'home') || {}).id);
      const h2h = (hh.data || []).slice(0, 5).map((f) => {
        const fp = f.participants || [];
        const hn = (fp.find((p) => p.meta && p.meta.location === 'home') || {}).name || '';
        const an = (fp.find((p) => p.meta && p.meta.location === 'away') || {}).name || '';
        const sc = (loc) => { const s = (f.scores || []).find((x) => x.description === 'CURRENT' && x.score && x.score.participant === loc); return s ? s.score.goals : null; };
        return {
          date: f.starting_at_timestamp || null, home: hn, away: an,
          homeScore: sc('home'), awayScore: sc('away'), competition: (f.league || {}).name || ''
        };
      });
      return { events: mapEvents(d, h), stats: mapStats(d, h), lineups: mapLineups(d, h), h2h };
    },

    async standings(league) {
      const leagueId = Number(String(league.ref).replace(/^sm:l/, ''));
      const s = await seasonOf(leagueId);
      if (!s.seasonId) return [];
      const r = await call('/football/standings/seasons/' + s.seasonId, { include: 'details' });
      const val = (details, tid) => { const x = (details || []).find((y) => y.type_id === tid); return x ? Number(x.value) || 0 : 0; };
      return [{
        group: '',
        rows: (r.data || []).map((x) => ({
          teamRef: 'sm:t' + x.participant_id, rank: x.position, played: val(x.details, 129), won: val(x.details, 130),
          drawn: val(x.details, 131), lost: val(x.details, 132), gf: val(x.details, 133), ga: val(x.details, 134),
          points: x.points || 0, form: '', note: ''
        }))
      }];
    },

    async squad(team) {
      const id = String(team.ref).replace(/^sm:t/, '');
      const r = await call('/football/squads/teams/' + id, { include: 'player' });
      return (r.data || []).map((s) => {
        const p = s.player || {};
        let age = null;
        const dob = p.date_of_birth || p.birthdate;
        if (dob) { const y = Number(String(dob).slice(0, 4)); if (y > 1960) age = new Date().getFullYear() - y; }
        return { name: p.name || p.display_name || p.common_name || '', number: s.jersey_number, pos: POS[s.position_id] || '', age };
      }).filter((p) => p.name);
    },

    // Pre-match and live odds share one path: per-fixture odds filtered to the
    // markets the UI renders (1 = 1X2, 4 = match goals, 14 = BTTS). One small
    // call per match keeps quota use predictable on a 2,000/hr plan.
    async odds({ matches, live }) {
      if (lowBudget()) return [];
      const wanted = new Set((matches || []).map((m) => m.ref));
      const rows = [];
      for (const m of matches || []) {
        if (!wanted.has(m.ref)) continue;
        try {
          const id = String(m.ref).replace(/^sm:/, '');
          const r = await call('/football/fixtures/' + id, { include: 'odds', filters: 'markets:1,4,14' });
          mapOdds((r.data || {}).odds, wanted).forEach((o) => rows.push(o));
        } catch (e) { logger('odds ' + m.ref + ': ' + e.message); }
        if (lowBudget()) break;
      }
      return rows;
    }
  };
};
