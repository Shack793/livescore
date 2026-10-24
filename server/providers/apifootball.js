'use strict';
// server/providers/apifootball.js — real football feed via API-Football v3 (api-sports.io).
//
// IMPORTANT: this adapter was written from the API-Football v3 documentation as I know it, but it has NOT been
// run against a live key. Before relying on it, run:   npm run provider:check
// which makes one small call per endpoint and reports whether each response mapped to the shapes we need.
// Field names / bet ids can change; the mapping code is deliberately defensive and isolated in this one file.
//
// Coverage: football only (API-Sports sells separate APIs per sport; other sports stay on the demo feed
// until you add adapters for them). Auth header: x-apisports-key. Base: https://v3.football.api-sports.io
const { slugify } = require('../../shared/util');

// Pre-match odds are paginated per day. Each page is one API call, so this cap
// keeps the daily quota bounded (see README on the 7,500 calls/day plan).
const ODDS_MAX_PAGES = 5;
const STATUS = {
  TBD: 'scheduled', NS: 'scheduled',
  '1H': 'live', '2H': 'live', ET: 'live', BT: 'live', P: 'live', LIVE: 'live',
  HT: 'halftime',
  FT: 'finished', AET: 'finished', PEN: 'finished',
  PST: 'postponed', SUSP: 'postponed', INT: 'postponed',
  CANC: 'cancelled', ABD: 'cancelled', AWD: 'finished', WO: 'finished'
};
// Well-known competitions pre-flagged as "top" (shown first / in the Top leagues menu). Edit freely in Admin → Leagues.
const TOP_IDS = new Set([39, 140, 135, 78, 61, 2, 3, 848, 88, 94, 71, 253, 1, 4, 5, 9]);
const UK_NATIONS = { England: 'ENG', Scotland: 'SCO', Wales: 'WAL', 'Northern-Ireland': 'NIR', 'Northern Ireland': 'NIR' };

function countryCode(name, code) {
  if (UK_NATIONS[name]) return UK_NATIONS[name];
  if (name === 'World') return 'WLD';
  if (code && /^[A-Za-z]{2}$/.test(code)) return code.toUpperCase();
  return 'X-' + slugify(name || 'unknown').toUpperCase().slice(0, 12);
}

module.exports = function createApiFootball(cfg, log) {
  const base = cfg.apiFootballBase.replace(/\/+$/, '');
  const key = cfg.apiFootballKey;
  const st = { calls: 0, remaining: null, limit: null, lastError: null, lastOk: null };
  const logger = log || { info() {}, warn() {}, error() {} };

  // Serialize calls and leave a gap so a burst (standings backfill, crawlers
  // opening many league pages) can never exceed the per-minute subscription
  // limit: 250 ms => at most 240 calls/min.
  const MIN_GAP = 250;
  let queue = Promise.resolve();
  let lastAt = 0;

  function call(path, params) {
    const exec = async () => {
      const wait = Math.max(0, lastAt + MIN_GAP - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      if (!key) throw new Error('API_FOOTBALL_KEY is not set');
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
      if (!res.ok) { st.lastError = 'HTTP ' + res.status + ' ' + path; throw new Error('API-Football HTTP ' + res.status + ' for ' + path); }
      const body = await res.json();
      const errs = body && body.errors;
      const hasErr = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
      if (hasErr) { const msg = JSON.stringify(errs); st.lastError = msg; throw new Error('API-Football error for ' + path + ': ' + msg); }
      st.lastOk = Date.now(); st.lastError = null;
      return body;
    };
    const p = queue.then(exec, exec);
    queue = p.then(() => {}, () => {});
    return p;
  }
  const lowBudget = () => st.remaining != null && st.remaining < 150;

  function mapMatch(f) {
    const fx = f.fixture || {}, lg = f.league || {}, tm = f.teams || {}, g = f.goals || {}, sc = f.score || {};
    const short = fx.status && fx.status.short;
    const status = STATUS[short] || 'scheduled';
    const live = status === 'live' || status === 'halftime';
    const ht = sc.halftime || {};
    const cc = countryCode(lg.country, null);
    return {
      ref: 'af:' + fx.id, sport: 'football', leagueRef: 'af:l' + lg.id, season: String(lg.season || ''), round: lg.round || '',
      homeRef: 'af:t' + (tm.home && tm.home.id), awayRef: 'af:t' + (tm.away && tm.away.id), kickoff: fx.timestamp,
      status, minute: live ? (fx.status.elapsed || null) : null, period: null,
      homeScore: status === 'scheduled' || status === 'postponed' || status === 'cancelled' ? null : (g.home == null ? 0 : g.home),
      awayScore: status === 'scheduled' || status === 'postponed' || status === 'cancelled' ? null : (g.away == null ? 0 : g.away),
      htHome: ht.home == null ? null : ht.home, htAway: ht.away == null ? null : ht.away, periods: null,
      league: { ref: 'af:l' + lg.id, name: lg.name, countryCode: cc, countryName: lg.country || 'World', type: 'league', season: String(lg.season || ''), sport: 'football', logo: lg.logo },
      homeTeam: { ref: 'af:t' + (tm.home && tm.home.id), name: tm.home && tm.home.name, logo: tm.home && tm.home.logo },
      awayTeam: { ref: 'af:t' + (tm.away && tm.away.id), name: tm.away && tm.away.name, logo: tm.away && tm.away.logo }
    };
  }

  function ymd(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }

  return {
    name: 'apifootball',
    isMock: false,
    sports: ['football'],
    status() { return { calls: st.calls, remaining: st.remaining, limit: st.limit, lastOk: st.lastOk ? new Date(st.lastOk).toISOString() : null, lastError: st.lastError, keySet: !!key }; },
    lowBudget,
    _call: call, // used by scripts/provider-check.js

    async referenceData() {
      const [c, l] = await Promise.all([call('/countries'), call('/leagues', { current: 'true' })]);
      const countries = (c.response || []).map((x) => ({ code: countryCode(x.name, x.code), name: x.name, kind: x.name === 'World' ? 'region' : 'country' }));
      const leagues = [], seen = {};
      (l.response || []).forEach((x) => {
        const lg = x.league || {}, co = x.country || {};
        if (seen[lg.id]) return; seen[lg.id] = 1;
        const cur = (x.seasons || []).find((s) => s.current) || (x.seasons || [])[0] || {};
        leagues.push({
          ref: 'af:l' + lg.id, sport: 'football', countryCode: countryCode(co.name, co.code), countryName: co.name,
          name: lg.name, type: /cup/i.test(lg.type || '') ? 'cup' : 'league', season: String(cur.year || ''), top: TOP_IDS.has(lg.id) ? 1 : 0, logo: lg.logo
        });
        if (!countries.some((k) => k.code === countryCode(co.name, co.code))) countries.push({ code: countryCode(co.name, co.code), name: co.name || 'World', kind: co.name === 'World' ? 'region' : 'country' });
      });
      return { countries, leagues, teams: [] }; // teams are discovered from fixtures (and /teams for chosen leagues)
    },

    async feedBookmakers() {
      const r = await call('/odds/bookmakers');
      return (r.response || []).map((b) => ({ ref: 'af:b' + b.id, name: b.name }));
    },

    async fixtures({ from, to }) {
      const out = [];
      for (let t = from; t < to; t += 86400) {
        const r = await call('/fixtures', { date: ymd(t), timezone: 'UTC' });
        (r.response || []).forEach((f) => { const m = mapMatch(f); if (m.kickoff >= from && m.kickoff < to) out.push(m); });
      }
      return out;
    },

    async live() {
      const r = await call('/fixtures', { live: 'all' });
      return (r.response || []).map(mapMatch);
    },

    async matchDetail(match) {
      const id = String(match.ref).replace(/^af:/, '');
      const [ev, stt, lu, hh] = await Promise.all([
        call('/fixtures/events', { fixture: id }).catch(() => ({ response: [] })),
        call('/fixtures/statistics', { fixture: id }).catch(() => ({ response: [] })),
        call('/fixtures/lineups', { fixture: id }).catch(() => ({ response: [] })),
        match.homeRef && match.awayRef
          ? call('/fixtures/headtohead', { h2h: String(match.homeRef).replace('af:t', '') + '-' + String(match.awayRef).replace('af:t', ''), last: 5 }).catch(() => ({ response: [] }))
          : Promise.resolve({ response: [] })
      ]);
      const homeTeamId = String(match.homeRef).replace('af:t', '');
      const events = (ev.response || []).map((e) => {
        const side = String(e.team && e.team.id) === homeTeamId ? 'home' : 'away';
        const t = (e.type || '').toLowerCase(), d = e.detail || '';
        let type = null;
        if (t === 'goal') type = /missed/i.test(d) ? null : 'goal';
        else if (t === 'card') type = /red/i.test(d) ? 'red' : 'yellow';
        else if (t === 'subst') type = 'sub';
        if (!type) return null;
        const minute = (e.time && e.time.elapsed || 0) + (e.time && e.time.extra || 0);
        // For substitutions API-Football puts the player COMING ON in `assist` and the player going off in `player`.
        if (type === 'sub') return { min: minute, type, side, player: e.assist && e.assist.name || '', out: e.player && e.player.name || '' };
        return { min: minute, type, side, player: e.player && e.player.name || '', assist: e.assist && e.assist.name || null, detail: /own/i.test(d) ? 'Own goal' : /pen/i.test(d) ? 'Penalty' : 'Goal' };
      }).filter(Boolean);

      const sIdx = {}; (stt.response || []).forEach((s) => { const side = String(s.team && s.team.id) === homeTeamId ? 'home' : 'away'; (s.statistics || []).forEach((x) => { (sIdx[x.type] = sIdx[x.type] || {})[side] = x.value; }); });
      const num = (v) => { if (v == null) return 0; const n = parseFloat(String(v).replace('%', '')); return isFinite(n) ? n : 0; };
      const defs = [['Ball Possession', 'Ball possession', true], ['Total Shots', 'Total shots'], ['Shots on Goal', 'Shots on target'], ['Shots off Goal', 'Shots off target'],
        ['Corner Kicks', 'Corner kicks'], ['Fouls', 'Fouls'], ['Offsides', 'Offsides'], ['Yellow Cards', 'Yellow cards'], ['Red Cards', 'Red cards'],
        ['Goalkeeper Saves', 'Goalkeeper saves'], ['Total passes', 'Passes'], ['Passes %', 'Pass accuracy', true]];
      const stats = defs.filter((d) => sIdx[d[0]]).map((d) => ({ key: slugify(d[0]), label: d[1], home: num(sIdx[d[0]].home), away: num(sIdx[d[0]].away), pct: !!d[2] }));

      let lineups = null;
      if ((lu.response || []).length >= 2) {
        const mk = (x) => ({
          formation: x.formation || '', coach: x.coach && x.coach.name || '',
          starters: (x.startXI || []).map((p) => ({ name: p.player.name, number: p.player.number, pos: p.player.pos })),
          subs: (x.substitutes || []).map((p) => ({ name: p.player.name, number: p.player.number, pos: p.player.pos }))
        });
        const h = lu.response.find((x) => String(x.team && x.team.id) === homeTeamId) || lu.response[0];
        const a = lu.response.find((x) => x !== h) || lu.response[1];
        lineups = { home: mk(h), away: mk(a) };
      }
      const h2h = (hh.response || []).map((f) => ({ date: f.fixture.timestamp, home: f.teams.home.name, away: f.teams.away.name, homeScore: f.goals.home, awayScore: f.goals.away, competition: f.league.name }));
      return { events, stats, lineups, h2h };
    },

    async standings(league) {
      const id = String(league.ref).replace('af:l', '');
      const r = await call('/standings', { league: id, season: league.season });
      const first = (r.response || [])[0];
      const groups = first && first.league && first.league.standings || [];
      return groups.map((rows) => ({
        group: rows[0] && rows[0].group && groups.length > 1 ? rows[0].group : '',
        rows: rows.map((x, i) => ({
          teamRef: 'af:t' + x.team.id, rank: x.rank, played: x.all.played, won: x.all.win, drawn: x.all.draw, lost: x.all.lose,
          gf: x.all.goals['for'], ga: x.all.goals.against, points: x.points, form: (x.form || '').slice(-5),
          note: i < 4 && /champions|promotion/i.test(x.description || '') ? 'q1' : /europa|conference|play/i.test(x.description || '') ? 'q2' : /relegation/i.test(x.description || '') ? 'rel' : ''
        }))
      }));
    },

    async squad(team) {
      const r = await call('/players/squads', { team: String(team.ref).replace('af:t', '') });
      const sq = (r.response || [])[0];
      const posMap = { Goalkeeper: 'GK', Defender: 'DF', Midfielder: 'MF', Attacker: 'FW' };
      return ((sq && sq.players) || []).map((p) => ({ name: p.name, number: p.number, pos: posMap[p.position] || p.position || '', age: p.age }));
    },

    // Pre-match odds come per bookmaker. In-play odds: see the note in README ("Live odds with API-Football").
    async odds({ matches, live }) {
      const wanted = new Set((matches || []).map((m) => m.ref));
      const rows = [];
      const push = (matchRef, bk, bets) => {
        (bets || []).forEach((bet) => {
          const name = (bet.name || '').toLowerCase();
          (bet.values || []).forEach((v) => {
            const odd = parseFloat(v.odd); if (!isFinite(odd)) return;
            let market = null, sel = null;
            if (name === 'match winner') { market = '1x2'; sel = { Home: '1', Draw: 'X', Away: '2' }[v.value]; }
            else if (name === 'goals over/under' && /2\.5$/.test(String(v.value))) { market = 'ou25'; sel = /^over/i.test(v.value) ? 'O' : 'U'; }
            else if (name === 'both teams score') { market = 'btts'; sel = /^yes/i.test(v.value) ? 'Y' : 'N'; }
            if (market && sel) rows.push({ matchRef, bookmaker: bk, market, selection: sel, value: odd });
          });
        });
      };
      if (live) {
        if (lowBudget()) return [];
        const r = await call('/odds/live');
        (r.response || []).forEach((o) => {
          const ref = 'af:' + (o.fixture && o.fixture.id);
          if (!wanted.has(ref)) return;
          if (Array.isArray(o.bookmakers) && o.bookmakers.length) o.bookmakers.forEach((b) => push(ref, 'af:b' + b.id, b.bets));
          else push(ref, 'af:live', (o.odds || []).map((b) => ({ name: b.name, values: b.values })));
        });
        return rows;
      }
      const days = {}; (matches || []).forEach((m) => { days[ymd(m.kickoff)] = 1; });
      for (const day of Object.keys(days)) {
        if (lowBudget()) break;
        let page = 1, total = 1;
        while (page <= total && page <= ODDS_MAX_PAGES) {
          const r = await call('/odds', { date: day, page: String(page) });
          total = (r.paging && r.paging.total) || 1;
          (r.response || []).forEach((o) => {
            const ref = 'af:' + (o.fixture && o.fixture.id);
            if (wanted.has(ref)) (o.bookmakers || []).forEach((b) => push(ref, 'af:b' + b.id, b.bets));
          });
          page++;
        }
      }
      return rows;
    }
  };
};
