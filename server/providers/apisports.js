'use strict';
const { slugify } = require('../../shared/util');

const SPORTS = {
  baseball: { name: 'apibaseball', baseKey: 'baseballBase', base: 'https://v1.baseball.api-sports.io', prefix: 'bs:', top: [1] },
  hockey: { name: 'apihockey', baseKey: 'hockeyBase', base: 'https://v1.hockey.api-sports.io', prefix: 'hk:', top: [57, 256, 146] },
  handball: { name: 'apihandball', baseKey: 'handballBase', base: 'https://v1.handball.api-sports.io', prefix: 'hb:', top: [131, 39, 34, 103, 78] },
  rugby: { name: 'apirugby', baseKey: 'rugbyBase', base: 'https://v1.rugby.api-sports.io', prefix: 'rg:', top: [13, 51, 71, 44] },
  volleyball: { name: 'apivolleyball', baseKey: 'volleyballBase', base: 'https://v1.volleyball.api-sports.io', prefix: 'vb:', top: [97, 113, 248, 63, 66, 25] },
  'american-football': { name: 'apiamericanfootball', baseKey: 'americanFootballBase', base: 'https://v1.american-football.api-sports.io', prefix: 'nf:', top: [1, 2] }
};

const LIVE = new Set(['live', 'halftime', 'break']);

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function statusOf(short) {
  const s = String(short || '').toUpperCase();
  if (!s) return 'scheduled';
  if (['NS', 'TBD', 'SCHEDULED', 'NOT STARTED'].includes(s)) return 'scheduled';
  if (['FT', 'AOT', 'AP', 'ENDED', 'FINISHED', 'AFTER EXTRA TIME', 'AFTER PENALTIES', 'AWD', 'WO'].includes(s)) return 'finished';
  if (['HT', 'HALFTIME', 'HALF-TIME'].includes(s)) return 'halftime';
  if (['BT', 'BREAK'].includes(s)) return 'break';
  if (/^(CANC|CANCELLED|ABD|ABANDONED)/.test(s)) return 'cancelled';
  if (/^(POST|PST|SUSP|INT|POSTPONED)/.test(s)) return 'postponed';
  if (s === 'LIVE' || /^(Q[1-4]|P[1-3]|H[12]|S[1-5]|IN\d+|E\d+|OT|ET|PEN|SO)$/.test(s)) return 'live';
  return 'scheduled';
}

function periodOf(short) {
  const s = String(short || '').toUpperCase();
  const m = /^(?:Q|P|H|S)([1-9])$/.exec(s) || /^IN(\d+)$/.exec(s);
  if (m) return Number(m[1]);
  if (s === 'OT' || s === 'ET') return 5;
  return null;
}

function countryOf(c) {
  const code = c && c.code;
  if (code && /^[A-Za-z]{2}$/.test(code)) return [code.toUpperCase(), c.name || code.toUpperCase()];
  const name = (c && c.name) || 'World';
  if (name === 'World') return ['INT', 'World'];
  return ['X-' + slugify(name).toUpperCase().slice(0, 12), name];
}

function sideTotal(side) {
  if (side == null) return null;
  if (typeof side === 'number' || typeof side === 'string') return num(side);
  if (typeof side === 'object') {
    for (const k of ['total', 'points', 'score']) if (side[k] != null) return num(side[k]);
  }
  return null;
}

function periodsOf(g, sport) {
  if (sport === 'baseball') {
    const h = (g.scores && g.scores.home && g.scores.home.innings) || {};
    const a = (g.scores && g.scores.away && g.scores.away.innings) || {};
    const keys = Object.keys(h).filter((k) => k !== 'extra').sort((x, y) => Number(x) - Number(y));
    const out = keys.map((k) => ({ home: num(h[k]), away: num(a[k]) })).filter((p) => p.home != null || p.away != null)
      .map((p) => ({ home: p.home == null ? 0 : p.home, away: p.away == null ? 0 : p.away }));
    if (h.extra != null || a.extra != null) out.push({ home: num(h.extra) == null ? 0 : num(h.extra), away: num(a.extra) == null ? 0 : num(a.extra) });
    return out.length ? out : null;
  }
  if (sport === 'american-football') {
    const h = (g.scores && g.scores.home) || {};
    const a = (g.scores && g.scores.away) || {};
    const out = ['quarter_1', 'quarter_2', 'quarter_3', 'quarter_4', 'overtime']
      .map((k) => ({ home: num(h[k]), away: num(a[k]) }))
      .filter((p) => p.home != null || p.away != null)
      .map((p) => ({ home: p.home == null ? 0 : p.home, away: p.away == null ? 0 : p.away }));
    return out.length ? out : null;
  }
  const p = g.periods;
  if (Array.isArray(p)) return p.length ? p.map((x) => ({ home: x.home == null ? 0 : x.home, away: x.away == null ? 0 : x.away })) : null;
  if (p && typeof p === 'object') {
    const keys = ['first', 'second', 'third', 'fourth', 'fifth', 'overtime', 'second_overtime', 'penalties'];
    const out = [];
    keys.forEach((k) => {
      const v = p[k];
      if (v == null) return;
      if (typeof v === 'string') {
        const [home, away] = v.split('-').map(num);
        if (home != null || away != null) out.push({ home: home == null ? 0 : home, away: away == null ? 0 : away });
      } else if (typeof v === 'object') {
        const home = num(v.home), away = num(v.away);
        if (home != null || away != null) out.push({ home: home == null ? 0 : home, away: away == null ? 0 : away });
      }
    });
    return out.length ? out : null;
  }
  return null;
}

function kickoffOf(g, sport) {
  if (sport === 'american-football') return num(g.game && g.game.date && g.game.date.timestamp);
  return num(g.timestamp);
}

module.exports = function createApiSports(sport, cfg, log) {
  const def = SPORTS[sport];
  if (!def) throw new Error('Unsupported API-Sports sport: ' + sport);
  const base = String(cfg[def.baseKey] || def.base).replace(/\/+$/, '');
  const key = cfg.apiSportsKey || cfg.apiFootballKey;
  const prefix = def.prefix;
  const top = new Set(def.top);
  const minGap = Math.max(250, cfg.apiSportsMinGapMs || 1000);
  const fixSec = Math.max(300, cfg.apiSportsFixturesSec || 900);
  const liveSec = Math.max(30, cfg.apiSportsLiveSec || 60);
  const oddsOn = cfg.apiSportsOdds !== false;
  const oddsTtl = Math.max(60, cfg.apiSportsOddsSec || 600) * 1000;
  const oddsMax = Math.max(1, cfg.apiSportsOddsMax || 6);
  const logger = log || (() => {});
  const st = { calls: 0, remaining: null, limit: null, lastError: null, lastOk: null };
  const oddsCache = new Map();
  let queue = Promise.resolve(), lastAt = 0, lastFixtures = 0, lastLive = 0, cooldownUntil = 0, lastLogged = '';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cooling = () => cooldownUntil > Date.now();
  const lowBudget = () => st.remaining != null && st.remaining < 200;

  function note(msg) {
    if (msg !== lastLogged) { lastLogged = msg; logger(msg); }
  }

  function call(path, params) {
    const exec = async () => {
      if (cooling()) throw new Error('API-Sports ' + sport + ' cooling down');
      if (!key) throw new Error('API_SPORTS_KEY is not set');
      const gap = Date.now() - lastAt;
      if (gap < minGap) await sleep(minGap - gap);
      lastAt = Date.now();
      const qs = new URLSearchParams(params || {}).toString();
      const url = base + path + (qs ? '?' + qs : '');
      st.calls++;
      let res;
      try {
        res = await fetch(url, { headers: { 'x-apisports-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      } catch (e) {
        st.lastError = 'network: ' + e.message;
        cooldownUntil = Date.now() + 30000;
        note('API-Sports ' + sport + ' network: ' + e.message);
        throw e;
      }
      const rem = res.headers.get('x-ratelimit-requests-remaining'), lim = res.headers.get('x-ratelimit-requests-limit');
      if (rem != null) st.remaining = Number(rem);
      if (lim != null) st.limit = Number(lim);
      if (!res.ok) {
        const msg = 'API-Sports ' + sport + ' HTTP ' + res.status + ' for ' + path;
        st.lastError = msg;
        const wait = res.status === 429 ? 60000 : res.status >= 500 ? 30000 : res.status === 401 || res.status === 403 ? 1800000 : 0;
        if (wait) cooldownUntil = Date.now() + wait;
        note(msg);
        throw new Error(msg);
      }
      const body = await res.json();
      const errs = body && body.errors;
      const hasErr = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
      if (hasErr) {
        const msg = JSON.stringify(errs);
        st.lastError = msg;
        let wait = 0;
        if (/quota|request|limit|rate/i.test(msg)) wait = 300000;
        else if (/subscription|plan|key|token|access/i.test(msg)) wait = 1800000;
        else if (/season|date|league|team|player|not found|no result|invalid|live field|do not exist/i.test(msg)) wait = 0;
        else wait = 60000;
        if (wait) cooldownUntil = Date.now() + wait;
        note('API-Sports ' + sport + ' error for ' + path + ': ' + msg);
        throw new Error('API-Sports ' + sport + ' error for ' + path + ': ' + msg);
      }
      if (st.remaining === 0) {
        st.lastError = 'daily quota exhausted';
        cooldownUntil = Date.now() + 300000;
        note('API-Sports ' + sport + ' daily quota exhausted');
        throw new Error('API-Sports ' + sport + ' daily quota exhausted');
      }
      st.lastOk = Date.now(); st.lastError = null; lastLogged = '';
      return body;
    };
    const p = queue.then(exec, exec);
    queue = p.then(() => {}, () => {});
    return p;
  }

  function mapGame(g) {
    const isAF = sport === 'american-football';
    const game = isAF ? (g.game || {}) : g;
    const lg = g.league || {};
    const tm = g.teams || {};
    const sc = g.scores || {};
    const short = (game.status && game.status.short) || (g.status && g.status.short);
    const status = statusOf(short);
    const kickoff = kickoffOf(g, sport);
    const leagueId = lg.id;
    const homeId = tm.home && tm.home.id;
    const awayId = tm.away && tm.away.id;
    if (!game.id || !leagueId || !homeId || !awayId || !kickoff) return null;
    const co = isAF ? (lg.country || {}) : (g.country || {});
    const cc = countryOf(co);
    const notStarted = status === 'scheduled' || status === 'postponed' || status === 'cancelled';
    const hs = sideTotal(sc.home), as = sideTotal(sc.away);
    return {
      ref: prefix + game.id, sport, leagueRef: prefix + 'l' + leagueId, season: String(lg.season || ''),
      round: game.stage || game.week || g.week || '', homeRef: prefix + 't' + homeId, awayRef: prefix + 't' + awayId,
      kickoff, status, minute: null, period: periodOf(short),
      homeScore: notStarted ? null : (hs == null ? 0 : hs), awayScore: notStarted ? null : (as == null ? 0 : as),
      htHome: null, htAway: null, periods: periodsOf(g, sport),
      league: { ref: prefix + 'l' + leagueId, name: lg.name, countryCode: cc[0], countryName: cc[1], type: /cup/i.test(lg.type || '') ? 'cup' : 'league', season: String(lg.season || ''), sport, logo: lg.logo || '' },
      homeTeam: { ref: prefix + 't' + homeId, name: tm.home.name, logo: tm.home.logo },
      awayTeam: { ref: prefix + 't' + awayId, name: tm.away.name, logo: tm.away.logo }
    };
  }

  function oddsRowsOf(gameId, body) {
    const market = sport === 'handball' ? '1x2' : 'ml';
    const out = [];
    ((body && body.response) || []).forEach((o) => {
      (o.bookmakers || []).forEach((b) => {
        (b.bets || []).forEach((bet) => {
          const name = String(bet.name || '');
          const is3way = /3way|1x2|match winner|winner|result/i.test(name);
          const is2way = /home\/away|winner|moneyline|match winner|2way|to win/i.test(name);
          if (market === '1x2' ? !is3way : !is2way) return;
          (bet.values || []).forEach((v) => {
            const odd = parseFloat(v.odd);
            if (!isFinite(odd) || odd <= 1) return;
            const val = String(v.value || '').toLowerCase();
            const sel = /^(home|1)$/.test(val) ? '1' : market === '1x2' && /^(draw|x)$/.test(val) ? 'X' : /^(away|2)$/.test(val) ? '2' : null;
            if (!sel) return;
            out.push({ matchRef: prefix + gameId, bookmaker: prefix + 'b' + b.id, market, selection: sel, value: odd });
          });
        });
      });
    });
    return out;
  }

  return {
    name: def.name,
    isMock: false,
    sports: [sport],
    prefix,
    status() {
      return { mode: def.name, sport, calls: st.calls, remaining: st.remaining, limit: st.limit, lastOk: st.lastOk ? new Date(st.lastOk).toISOString() : null, lastError: st.lastError, keySet: !!key, cooldownUntil: cooldownUntil > Date.now() ? new Date(cooldownUntil).toISOString() : null };
    },
    lowBudget,

    async referenceData() {
      if (cooling()) return { countries: [], leagues: [], teams: [] };
      const r = await call('/leagues');
      const now = Date.now(), leagues = [], countries = [], seen = new Set();
      (r.response || []).forEach((x) => {
        const lg = x.league || x;
        if (!lg || !lg.id) return;
        const ref = prefix + 'l' + lg.id;
        if (seen.has(ref)) return;
        seen.add(ref);
        const seasons = (x.seasons || []).map((s) => Object.assign({}, s, { season: s.season != null ? s.season : s.year }));
        let cur = seasons.find((s) => s.current);
        if (!cur) cur = seasons.find((s) => s.start && s.end && Date.parse(s.start) <= now && now <= Date.parse(s.end) + 90 * 86400000);
        if (!cur) cur = seasons.slice().sort((a, b) => String(b.season).localeCompare(String(a.season)))[0] || {};
        const co = x.country || lg.country || {};
        const cc = countryOf(co);
        if (!countries.some((c) => c.code === cc[0])) countries.push({ code: cc[0], name: cc[1], kind: cc[0] === 'INT' ? 'region' : 'country' });
        leagues.push({
          ref, sport, countryCode: cc[0], countryName: cc[1], name: lg.name,
          type: /cup/i.test(lg.type || '') ? 'cup' : 'league', season: String(cur.season || ''),
          top: top.has(Number(lg.id)) ? 1 : 0, logo: lg.logo || ''
        });
      });
      return { countries, leagues, teams: [] };
    },

    async feedBookmakers() {
      if (cooling()) return [];
      const r = await call('/odds/bookmakers');
      return (r.response || []).map((b) => ({ ref: prefix + 'b' + b.id, name: b.name }));
    },

    async fixtures({ from, to }) {
      if (cooling() || Date.now() - lastFixtures < fixSec * 1000 || lowBudget()) return [];
      const out = [];
      for (let t = from; t < to; t += 86400) {
        if (cooling() || lowBudget()) break;
        let r;
        try {
          r = await call('/games', { date: new Date(t * 1000).toISOString().slice(0, 10), timezone: 'UTC' });
        } catch (e) {
          if (cooling()) break;
          if (/date|season|plan|quota|rate|limit/i.test(e.message)) { logger('fixtures ' + sport + ' ' + new Date(t * 1000).toISOString().slice(0, 10) + ' skipped: ' + e.message); continue; }
          throw e;
        }
        (r.response || []).forEach((g) => {
          const m = mapGame(g);
          if (m && m.kickoff >= from && m.kickoff < to) out.push(m);
        });
      }
      lastFixtures = Date.now();
      return out;
    },

    async live() {
      if (cooling() || Date.now() - lastLive < liveSec * 1000 || lowBudget()) return [];
      const today = new Date().toISOString().slice(0, 10);
      const r = await call('/games', { date: today, timezone: 'UTC' });
      lastLive = Date.now();
      return (r.response || []).map(mapGame).filter((m) => m && LIVE.has(m.status));
    },

    async matchDetail(match) {
      if (cooling()) return { events: [], stats: [], lineups: null, h2h: [] };
      const ids = [match.homeRef, match.awayRef].map((r) => String(r || '').replace(prefix + 't', ''));
      let hh = { response: [] };
      if (ids[0] && ids[1] && ids[0] !== ids[1]) hh = await call('/games', { h2h: ids[0] + '-' + ids[1] }).catch(() => ({ response: [] }));
      const h2h = (hh.response || []).slice().sort((a, b) => (kickoffOf(b, sport) || 0) - (kickoffOf(a, sport) || 0)).slice(0, 5).map((g) => {
        const m = mapGame(g);
        return m ? { date: m.kickoff, home: m.homeTeam.name, away: m.awayTeam.name, homeScore: m.homeScore, awayScore: m.awayScore, competition: m.league.name } : null;
      }).filter(Boolean);
      return { events: [], stats: [], lineups: null, h2h };
    },

    async standings(league) {
      if (cooling()) return [];
      const id = String(league.ref).replace(prefix + 'l', '');
      const r = await call('/standings', { league: id, season: league.season });
      const resp = r.response || [];
      if (!resp.length) return [];
      if (sport === 'american-football') {
        const by = {};
        resp.forEach((x) => {
          if (!x.team || !x.team.id) return;
          const group = x.conference || x.division || '';
          (by[group] = by[group] || []).push({
            teamRef: prefix + 't' + x.team.id, rank: x.position, played: (x.won || 0) + (x.lost || 0) + (x.ties || 0),
            won: x.won || 0, drawn: x.ties || 0, lost: x.lost || 0, gf: (x.points && x.points.for) || 0,
            ga: (x.points && x.points.against) || 0, points: x.won || 0, form: '', note: x.division || x.conference || ''
          });
        });
        return Object.keys(by).map((group) => ({ group, rows: by[group] }));
      }
      const groups = Array.isArray(resp[0]) ? resp : [resp];
      return groups.map((rows) => {
        const valid = (rows || []).filter((x) => x && x.team && Number(x.team.id) > 0);
        return {
          group: (valid[0] && valid[0].group && valid[0].group.name) || '',
          rows: valid.map((x) => {
            const g = x.games || {};
            const won = num(g.win && g.win.total != null ? g.win.total : g.win) || 0;
            const drawn = num(g.draw && g.draw.total != null ? g.draw.total : g.draw) || 0;
            const lost = num(g.lose && g.lose.total != null ? g.lose.total : g.lose) || 0;
            return {
              teamRef: prefix + 't' + x.team.id, rank: x.position,
              played: num(g.played) != null ? num(g.played) : won + drawn + lost,
              won, drawn, lost,
              gf: (x.goals && x.goals.for) != null ? x.goals.for : ((x.points && x.points.for) || 0),
              ga: (x.goals && x.goals.against) != null ? x.goals.against : ((x.points && x.points.against) || 0),
              points: typeof x.points === 'number' ? x.points : won,
              form: typeof x.form === 'string' ? x.form.slice(-5) : '',
              note: x.description || ''
            };
          })
        };
      }).filter((g) => g.rows.length);
    },

    async squad(team) {
      if (cooling()) return [];
      const id = String(team.ref).replace(prefix + 't', '');
      const now = new Date(), y = now.getUTCFullYear();
      const guess = now.getUTCMonth() >= 7 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
      const cands = Array.from(new Set([String(y), guess, String(y - 1)]));
      for (const season of cands) {
        try {
          const r = await call('/players', { team: id, season });
          if (r.response && r.response.length) {
            return r.response.map((x) => {
              const p = x.player || x;
              return { name: p.name || '', number: p.number != null ? p.number : null, pos: p.position || '', age: p.age || null };
            }).filter((p) => p.name);
          }
        } catch (e) { if (!/season|player|team/i.test(e.message)) throw e; }
      }
      return [];
    },

    async odds({ matches, live }) {
      if (!oddsOn || cooling() || lowBudget()) return [];
      const wanted = (matches || []).filter((m) => String(m.ref).startsWith(prefix)).slice(0, oddsMax);
      const out = [];
      for (const m of wanted) {
        const id = String(m.ref).slice(prefix.length);
        const cache = oddsCache.get(id);
        const ttl = live ? Math.min(120000, oddsTtl) : oddsTtl;
        if (cache && Date.now() - cache.at < ttl) { out.push(...cache.rows); continue; }
        try {
          const r = await call('/odds', { game: id });
          const rows = oddsRowsOf(id, r);
          oddsCache.set(id, { at: Date.now(), rows });
          out.push(...rows);
        } catch (e) {
          logger('odds ' + sport + ' ' + id + ': ' + e.message);
          if (cooling()) break;
        }
      }
      return out;
    }
  };
};
