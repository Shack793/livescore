'use strict';
// server/providers/apibasketball.js — basketball feed via API-Sports Basketball v1.
//
// Verified live against the account key (2026-10-24, Pro plan, 7,500 calls/day):
//   /games (by date + by id + h2h), /leagues, /standings, /players, /odds?game=.
// Basketball v1 has NO /games/events, /games/statistics or /odds/bookmakers
// endpoint, so matchDetail returns honest empty events/stats/lineups and
// feedBookmakers() discovers bookmakers from a real odds response instead.
//
// QUOTA: the Pro plan allows 7,500 requests/day for this API. Polling cadence is
// controlled by BASKETBALL_FIXTURES_SEC / BASKETBALL_LIVE_SEC, and per-game odds
// are cached, so the sync loop stays well inside the daily budget.
const { slugify } = require('../../shared/util');

const STATUS = {
  NS: 'scheduled', TBD: 'scheduled',
  Q1: 'live', Q2: 'live', Q3: 'live', Q4: 'live', OT: 'live', ET: 'live', LIVE: 'live',
  HT: 'halftime', BT: 'break',
  FT: 'finished', AOT: 'finished',
  POST: 'postponed', PST: 'postponed', SUSP: 'postponed', INT: 'postponed',
  CANC: 'cancelled', ABD: 'cancelled'
};
// Flagged as "top" (Top leagues menu + scheduled standings + odds). Edit freely in Admin → Leagues.
const TOP_IDS = new Set([12]); // NBA
const POS = { 'Point Guard': 'PG', 'Shooting Guard': 'SG', 'Small Forward': 'SF', 'Power Forward': 'PF', Center: 'C', Guard: 'G', Forward: 'F' };

function statusOf(short) {
  if (STATUS[short]) return STATUS[short];
  if (/^Q\d/i.test(short || '') || /^(OT|ET|LIVE)$/i.test(short || '')) return 'live';
  return 'scheduled';
}

function periodOf(short) {
  const q = /^Q([1-4])/i.exec(short || '');
  if (q) return Number(q[1]);
  if (/^(OT|ET)$/i.test(short || '')) return 5;
  return null;
}

module.exports = function createApiBasketball(cfg, log) {
  const base = cfg.basketballBase || 'https://v1.basketball.api-sports.io';
  const key = cfg.apiSportsKey || cfg.apiFootballKey;
  const leagueIds = (cfg.basketballLeagues || []).map(Number).filter((n) => n > 0);
  const minGap = Math.max(250, cfg.basketballMinGapMs || 1000);
  const fixSec = Math.max(300, cfg.basketballFixturesSec || 900);
  const liveSec = Math.max(30, cfg.basketballLiveSec || 60);
  const oddsOn = !!cfg.basketballOdds;
  const oddsTtl = Math.max(60, cfg.basketballOddsSec || 600) * 1000;
  const oddsMax = Math.max(1, cfg.basketballOddsMax || 12);
  const st = { calls: 0, remaining: null, limit: null, lastError: null, lastOk: null };
  const logger = log || (() => {});
  const oddsCache = new Map(); // game id -> { at, rows }
  const feedBk = new Map();    // bookmaker id -> name
  let lastFixtures = 0, lastLive = 0, lastCallAt = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function call(path, params) {
    if (!key) throw new Error('API_SPORTS_KEY is not set');
    const gap = Date.now() - lastCallAt;
    if (gap < minGap) await sleep(minGap - gap);
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
  const lowBudget = () => st.remaining != null && st.remaining < 50;
  const wanted = (id) => !leagueIds.length || leagueIds.includes(Number(id));
  const ymd = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

  function countryOf(c) {
    const code = c && c.code;
    if (code && /^[A-Za-z]{2}$/.test(code)) return [code.toUpperCase(), (c && c.name) || code.toUpperCase()];
    return ['INT', ((c && c.name) || 'World')];
  }

  function mapGame(g) {
    const lg = g.league || {}, tm = g.teams || {}, sc = g.scores || {};
    const short = g.status && g.status.short;
    const status = statusOf(short);
    const hs = sc.home || {}, as = sc.away || {};
    const notStarted = status === 'scheduled' || status === 'postponed' || status === 'cancelled';
    const periods = ['quarter_1', 'quarter_2', 'quarter_3', 'quarter_4'].map((q) => ({ home: hs[q], away: as[q] }))
      .filter((p) => p.home != null && p.away != null);
    if (hs.over_time != null && as.over_time != null) periods.push({ home: hs.over_time, away: as.over_time });
    const cc = countryOf(g.country);
    return {
      ref: 'ab:' + g.id, sport: 'basketball', leagueRef: 'ab:l' + lg.id, season: String(lg.season || ''),
      round: g.stage || g.week || '', homeRef: 'ab:t' + (tm.home && tm.home.id), awayRef: 'ab:t' + (tm.away && tm.away.id),
      kickoff: g.timestamp, status, minute: null, period: periodOf(short),
      homeScore: notStarted ? null : (hs.total == null ? 0 : hs.total),
      awayScore: notStarted ? null : (as.total == null ? 0 : as.total),
      htHome: null, htAway: null, periods: periods.length ? periods : null,
      league: { ref: 'ab:l' + lg.id, name: lg.name, countryCode: cc[0], countryName: cc[1], type: /cup/i.test(lg.type || '') ? 'cup' : 'league', season: String(lg.season || ''), sport: 'basketball', logo: lg.logo || '' },
      homeTeam: { ref: 'ab:t' + (tm.home && tm.home.id), name: tm.home && tm.home.name, logo: tm.home && tm.home.logo },
      awayTeam: { ref: 'ab:t' + (tm.away && tm.away.id), name: tm.away && tm.away.name, logo: tm.away && tm.away.logo }
    };
  }

  function collectBookmakers(body) {
    ((body && body.response) || []).forEach((o) => {
      (o.bookmakers || []).forEach((b) => { if (b && b.id && b.name) feedBk.set(b.id, b.name); });
    });
  }

  function oddsRowsOf(gameId, body) {
    const out = [];
    collectBookmakers(body);
    ((body && body.response) || []).forEach((o) => {
      (o.bookmakers || []).forEach((b) => {
        (b.bets || []).forEach((bet) => {
          const name = String(bet.name || '');
          // Main winner market only (the site's odds UI supports 'ml' for basketball).
          if (!/^(home\/away|winner|moneyline|match winner|to win)$/i.test(name)) return;
          (bet.values || []).forEach((v) => {
            const odd = parseFloat(v.odd);
            if (!isFinite(odd) || odd <= 1) return;
            const selection = /^home$/i.test(v.value) ? '1' : /^away$/i.test(v.value) ? '2' : null;
            if (!selection) return;
            out.push({ matchRef: 'ab:' + gameId, bookmaker: 'ab:b' + b.id, market: 'ml', selection, value: odd });
          });
        });
      });
    });
    return out;
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
      if (feedBk.size) return Array.from(feedBk, ([id, name]) => ({ ref: 'ab:b' + id, name }));
      // Basketball v1 has no /odds/bookmakers endpoint; discover from a real odds response.
      try {
        const r = await call('/odds/bookmakers');
        (r.response || []).forEach((b) => { if (b && b.id && b.name) feedBk.set(b.id, b.name); });
      } catch (e) { /* endpoint absent on this API */ }
      if (!feedBk.size) {
        try {
          const today = ymd(Math.floor(Date.now() / 1000));
          const g = await call('/games', { date: today, timezone: 'UTC' });
          const first = (g.response || []).find((x) => wanted(x.league && x.league.id));
          if (first) collectBookmakers(await call('/odds', { game: first.id }));
        } catch (e) { logger('feedBookmakers: ' + e.message); }
      }
      return Array.from(feedBk, ([id, name]) => ({ ref: 'ab:b' + id, name }));
    },

    async fixtures({ from, to }) {
      if (Date.now() - lastFixtures < fixSec * 1000) return [];
      if (lowBudget()) return [];
      const out = [];
      for (let t = from; t < to; t += 86400) {
        if (lowBudget()) break;
        let r;
        try {
          r = await call('/games', { date: ymd(t), timezone: 'UTC' });
        } catch (e) {
          // Paid plans cover the full window; on a limited plan skip out-of-range
          // days instead of failing the whole job.
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

    // Basketball v1 has no live=all filter: pull today's games once per throttle
    // window and keep the in-play ones. Deterministic and quota-cheap.
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
      const h2h = (hh.response || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 5).map((f) => {
        const tm = f.teams || {}, sc = f.scores || {};
        return {
          date: f.timestamp || null, home: tm.home && tm.home.name || '', away: tm.away && tm.away.name || '',
          homeScore: sc.home && sc.home.total, awayScore: sc.away && sc.away.total,
          competition: (f.league && f.league.name) || ''
        };
      });
      // Basketball v1 exposes no events/statistics/lineups endpoints (verified 2026-10-24).
      return { events: [], stats: [], lineups: null, h2h };
    },

    async standings(league) {
      const id = String(league.ref).replace(/^ab:l/, '');
      const r = await call('/standings', { league: id, season: league.season });
      const rows = Array.isArray(r.response) ? (Array.isArray(r.response[0]) ? r.response[0] : r.response) : [];
      const byGroup = {};
      rows.forEach((x) => {
        const g = (x.group && x.group.name) || '';
        const won = x.games && x.games.win && x.games.win.total || 0;
        (byGroup[g] = byGroup[g] || []).push({
          teamRef: 'ab:t' + (x.team && x.team.id), rank: x.position,
          played: x.games && x.games.played || 0, won, drawn: 0,
          lost: x.games && x.games.lose && x.games.lose.total || 0,
          gf: x.points && x.points.for || 0, ga: x.points && x.points.against || 0, points: won,
          form: (x.form || '').slice(-5),
          note: /playoff|promotion|champion/i.test(x.description || '') ? 'q1' : /relegation/i.test(x.description || '') ? 'rel' : ''
        });
      });
      return Object.keys(byGroup).map((g) => ({ group: g, rows: byGroup[g] }));
    },

    async squad(team) {
      const id = String(team.ref).replace(/^ab:t/, '');
      // /players requires a season; try the most likely current seasons first.
      // Squad results are cached 24h per team, so this costs at most 4 calls/day/team.
      const now = new Date(), y = now.getUTCFullYear();
      const guess = now.getUTCMonth() >= 7 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
      // Some competitions use calendar-year seasons ("2026"), others span two
      // years ("2026-2027"), so try both shapes before giving up.
      const cands = Array.from(new Set([guess, String(y), (y - 1) + '-' + y, String(y - 1), '2024-2025'])).slice(0, 5);
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

    // Per-game odds (Basketball v1 only supports ?game=), cached and capped.
    // Only the winner ('ml') market is published: the site's basketball board
    // shows 1/2, and mapping a total would need a different UI market.
    async odds({ matches }) {
      if (!oddsOn) return [];
      if (lowBudget()) return [];
      const wantedRefs = new Set();
      const out = [];
      let fetched = 0;
      for (const m of matches || []) {
        const ref = String(m && m.ref || '');
        if (ref.indexOf('ab:') !== 0 || wantedRefs.has(ref)) continue;
        wantedRefs.add(ref);
        if (m.sport && m.sport !== 'basketball') continue;
        const leagueId = Number(String(m.leagueRef || '').replace(/^ab:l/, ''));
        // Keep odds to top competitions (NBA) so 7,500/day is never at risk.
        if (!TOP_IDS.has(leagueId)) continue;
        const id = ref.slice(3);
        const cached = oddsCache.get(id);
        if (cached && Date.now() - cached.at < oddsTtl) { (cached.rows || []).forEach((x) => out.push(x)); continue; }
        if (fetched >= oddsMax) continue;
        fetched++;
        try {
          const r = await call('/odds', { game: id });
          const rows = oddsRowsOf(id, r);
          oddsCache.set(id, { at: Date.now(), rows });
          rows.forEach((x) => out.push(x));
        } catch (e) {
          if (/quota|limit/i.test(e.message)) break;
          logger('odds ' + ref + ': ' + e.message);
        }
      }
      if (oddsCache.size > 500) {
        const keep = Date.now() - oddsTtl;
        for (const [id, v] of oddsCache) if (v.at < keep) oddsCache.delete(id);
      }
      return out;
    }
  };
};
