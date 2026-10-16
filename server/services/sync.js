'use strict';
// server/services/sync.js — pulls reference data, fixtures, live scores, odds, standings and match details from the
// configured provider into SQLite, detects what changed, and tells the live hub so it can push to browsers.
const { slugify } = require('../../shared/util');
const countries = require('../geo/countries');

const LIVE = ['live', 'halftime', 'break'];
const DAY = 86400;

function create({ db, provider, cfg, hub, log }) {
  log = log || (() => {});
  const ids = { country: new Map(), league: new Map(), team: new Map(), match: new Map() };
  const states = new Map(); // match ref -> latest provider match object (needed by odds())
  const status = { provider: provider.name, jobs: {}, lastError: '', counts: {} };
  const running = new Set();
  const timers = [];
  let stopped = false, lastStaleFix = 0;
  const nowSec = () => Math.floor(Date.now() / 1000);

  function warm() {
    db.all('SELECT code,id FROM countries').forEach((r) => ids.country.set(r.code, r.id));
    db.all('SELECT ref,id FROM leagues').forEach((r) => ids.league.set(r.ref, r.id));
    db.all('SELECT ref,id FROM teams').forEach((r) => ids.team.set(r.ref, r.id));
  }

  /* ---------- entity upserts ---------- */
  function upCountry(c) {
    const code = String(c.code || 'INT').toUpperCase();
    let id = ids.country.get(code);
    if (id) return id;
    let name = c.name && c.name !== code ? c.name : (countries.nameOf(code) !== code ? countries.nameOf(code) : (c.name || code));
    if (code === 'INT') name = 'World';
    let slug = c.slug && c.slug !== code.toLowerCase() ? c.slug : slugify(name);
    if (db.get('SELECT 1 x FROM countries WHERE slug=?', slug)) slug = slug + '-' + code.toLowerCase();
    db.run('INSERT INTO countries (code,name,slug,kind) VALUES (?,?,?,?)', code, name, slug, c.kind || (code === 'INT' ? 'region' : 'country'));
    id = db.get('SELECT id FROM countries WHERE code=?', code).id;
    ids.country.set(code, id);
    return id;
  }
  function uniqueSlug(table, col, base, where, params) {
    let slug = base, n = 2;
    while (db.get(`SELECT 1 x FROM ${table} WHERE ${where} AND ${col}=?`, ...params, slug)) slug = base + '-' + n++;
    return slug;
  }
  function upLeague(l) {
    let id = ids.league.get(l.ref);
    const cid = upCountry({ code: l.countryCode, name: l.countryName });
    if (id) return id;
    const slug = uniqueSlug('leagues', 'slug', l.slug || slugify(l.name), 'sport=? AND country_id=?', [l.sport, cid]);
    db.run('INSERT INTO leagues (ref,sport,country_id,name,slug,type,season,top) VALUES (?,?,?,?,?,?,?,?)', l.ref, l.sport, cid, l.name, slug, l.type || 'league', l.season || '', l.top ? 1 : 0);
    id = db.get('SELECT id FROM leagues WHERE ref=?', l.ref).id;
    ids.league.set(l.ref, id);
    return id;
  }
  function upTeam(t, sport) {
    let id = ids.team.get(t.ref);
    if (id) return id;
    const cid = t.countryCode ? upCountry({ code: t.countryCode }) : null;
    const slug = uniqueSlug('teams', 'slug', t.slug || slugify(t.name), 'sport=?', [sport]);
    db.run('INSERT INTO teams (ref,sport,country_id,name,slug,logo_url) VALUES (?,?,?,?,?,?)', t.ref, sport, cid, t.name, slug, t.logo || '');
    id = db.get('SELECT id FROM teams WHERE ref=?', t.ref).id;
    ids.team.set(t.ref, id);
    return id;
  }

  /* ---------- reference ---------- */
  async function reference() {
    const ref = await provider.referenceData();
    db.tx(() => {
      (ref.countries || []).forEach(upCountry);
      (ref.leagues || []).forEach((l) => { upLeague(l); db.run('UPDATE leagues SET name=?, season=?, type=? WHERE ref=?', l.name, l.season || '', l.type || 'league', l.ref); });
      (ref.teams || []).forEach((t) => upTeam(t, t.sport));
    });
    const fb = await provider.feedBookmakers();
    db.tx(() => ((fb || []).filter((b) => b && b.ref && b.name) || []).forEach((b) => db.run('INSERT INTO feed_bookmakers (ref,name,seen_at) VALUES (?,?,?) ON CONFLICT(ref) DO UPDATE SET name=excluded.name, seen_at=excluded.seen_at', b.ref, b.name, nowSec())));
    status.counts.leagues = ids.league.size; status.counts.teams = ids.team.size;
  }

  /* ---------- matches ---------- */
  const sigOf = (r) => [r.status, r.minute, r.period, r.hs, r.as_, r.hths, r.htas, r.periods, r.kickoff, r.round].join('|');
  function upMatch(m) {
    if (m.league) upLeague(Object.assign({ sport: m.sport }, m.league));
    let lid = ids.league.get(m.leagueRef);
    if (!lid) return null; // unknown league and no descriptor: skip rather than guess
    if (m.homeTeam) upTeam(m.homeTeam, m.sport);
    if (m.awayTeam) upTeam(m.awayTeam, m.sport);
    const hid = ids.team.get(m.homeRef), aid = ids.team.get(m.awayRef);
    if (!hid || !aid) return null;
    const periods = m.periods ? JSON.stringify(m.periods) : null;
    const row = { status: m.status, minute: m.minute == null ? null : m.minute, period: m.period == null ? null : m.period, hs: m.homeScore == null ? null : m.homeScore,
      as_: m.awayScore == null ? null : m.awayScore, hths: m.htHome == null ? null : m.htHome, htas: m.htAway == null ? null : m.htAway, periods, kickoff: m.kickoff, round: m.round || '' };
    const old = db.get('SELECT id,status,minute,period,hs,as_,hths,htas,periods,kickoff,round FROM matches WHERE ref=?', m.ref);
    if (!old) {
      db.run('INSERT INTO matches (ref,sport,league_id,season,round,home_id,away_id,kickoff,status,minute,period,hs,as_,hths,htas,periods,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        m.ref, m.sport, lid, m.season || '', row.round, hid, aid, row.kickoff, row.status, row.minute, row.period, row.hs, row.as_, row.hths, row.htas, periods, nowSec());
      const id = db.get('SELECT id FROM matches WHERE ref=?', m.ref).id;
      ids.match.set(m.ref, id);
      return { id, created: true };
    }
    ids.match.set(m.ref, old.id);
    if (sigOf(old) === sigOf(row)) return { id: old.id, changed: false };
    db.run('UPDATE matches SET status=?,minute=?,period=?,hs=?,as_=?,hths=?,htas=?,periods=?,kickoff=?,round=?,updated_at=? WHERE id=?',
      row.status, row.minute, row.period, row.hs, row.as_, row.hths, row.htas, periods, row.kickoff, row.round, nowSec(), old.id);
    return { id: old.id, changed: true };
  }
  function upMatches(list) {
    const changed = [];
    db.tx(() => list.forEach((m) => {
      states.set(m.ref, m);
      const r = upMatch(m);
      if (r && (r.created || r.changed)) changed.push(r.id);
    }));
    return changed;
  }
  const sports = () => (cfg.sports.length ? cfg.sports.filter((s) => provider.sports.includes(s)) : provider.sports);

  async function fixtures() {
    const t = nowSec();
    const from = t - cfg.windowPastDays * DAY, to = t + cfg.windowFutureDays * DAY;
    let n = 0;
    for (const sport of sports()) {
      const list = await provider.fixtures({ sport, from, to });
      n += list.length;
      const ch = upMatches(list);
      if (ch.length && hub) hub.matchesChanged(ch);
    }
    status.counts.fixturesLastRun = n;
  }

  // Live matches that vanished from the live feed must be resolved by fixtures; the live job just applies deltas.
  async function live() {
    let all = [];
    for (const sport of sports()) all = all.concat(await provider.live({ sport }));
    const ch = upMatches(all);
    if (ch.length && hub) hub.matchesChanged(ch);
    status.counts.live = all.length;
    // anything we think is live but the feed no longer lists: refresh via fixtures soon
    const stale = db.get("SELECT COUNT(*) n FROM matches WHERE status IN ('live','halftime','break') AND updated_at < ?", nowSec() - 120).n;
    if (stale && nowSec() - lastStaleFix > 60) { lastStaleFix = nowSec(); fixtures().catch((e) => log('fixtures (stale-live) failed: ' + e.message)); }
  }

  /* ---------- odds ---------- */
  async function odds(onlyLive) {
    const t = nowSec();
    const rows = db.all("SELECT id,ref,sport,status FROM matches WHERE status IN ('live','halftime','break') OR (? = 0 AND status='scheduled' AND kickoff BETWEEN ? AND ?)",
      onlyLive ? 1 : 0, t - 3600, t + 2 * DAY);
    const list = rows.map((r) => states.get(r.ref) || { ref: r.ref, sport: r.sport, status: r.status });
    if (!list.length) return;
    const out = await provider.odds({ matches: list, live: !!onlyLive });
    const changed = new Set();
    db.tx(() => out.forEach((o) => {
      const mid = ids.match.get(o.matchRef) || (db.get('SELECT id FROM matches WHERE ref=?', o.matchRef) || {}).id;
      if (!mid || !(o.value > 1)) return;
      const old = db.get('SELECT value FROM odds_current WHERE match_id=? AND bookmaker_ref=? AND market=? AND selection=?', mid, o.bookmaker, o.market, o.selection);
      if (!old) { db.run('INSERT INTO odds_current (match_id,bookmaker_ref,market,selection,value,prev,updated_at) VALUES (?,?,?,?,?,?,?)', mid, o.bookmaker, o.market, o.selection, o.value, null, t); changed.add(mid); }
      else if (old.value !== o.value) { db.run('UPDATE odds_current SET prev=?, value=?, updated_at=? WHERE match_id=? AND bookmaker_ref=? AND market=? AND selection=?', old.value, o.value, t, mid, o.bookmaker, o.market, o.selection); changed.add(mid); }
    }));
    if (changed.size && hub) hub.oddsChanged(Array.from(changed));
    status.counts.oddsRows = out.length;
  }

  /* ---------- standings (scheduled for top leagues; any other league is fetched on demand when a page needs it) ---------- */
  async function fetchStandings(l) {
    const groups = await provider.standings(l);
    if (!groups || !groups.length) return false;
    const out = groups.map((g) => ({ group: g.group || '', rows: g.rows.map((r) => Object.assign({}, r, { teamId: ids.team.get(r.teamRef) || null })).filter((r) => r.teamId) }));
    db.run('INSERT INTO standings (league_id,data,fetched_at) VALUES (?,?,?) ON CONFLICT(league_id) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at', l.id, JSON.stringify(out), nowSec());
    return true;
  }
  async function standings() {
    const lgs = db.all("SELECT id,ref,sport,name FROM leagues WHERE active=1 AND type='league'" + (provider.isMock ? '' : ' AND top=1') + ' ORDER BY top DESC');
    let n = 0;
    for (const l of lgs) { try { if (await fetchStandings(l)) n++; } catch (e) { log('standings ' + l.ref + ': ' + e.message); } }
    status.counts.standings = n;
  }
  const stInflight = new Map();
  async function ensureStandings(leagueId) {
    const l = db.get("SELECT id,ref,sport,name,type FROM leagues WHERE id=? AND type='league'", leagueId);
    if (!l) return;
    const f = db.get('SELECT fetched_at FROM standings WHERE league_id=?', leagueId);
    if (f && nowSec() - f.fetched_at < cfg.intervals.standingsSec) return;
    if (stInflight.has(leagueId)) return stInflight.get(leagueId);
    const p = fetchStandings(l).catch((e) => log('standings ' + l.ref + ': ' + e.message)).then(() => { stInflight.delete(leagueId); });
    stInflight.set(leagueId, p);
    return p;
  }

  /* ---------- on-demand details (cached, coalesced) ---------- */
  const inflight = new Map();
  function detailTtl(m, fetchedAt) {
    if (LIVE.includes(m.status)) return 12;
    if (m.status === 'finished') return fetchedAt && fetchedAt < m.kickoff + 3 * 3600 ? 60 : 6 * 3600;
    const soon = m.kickoff - nowSec();
    return soon < 3600 ? 300 : 1800;
  }
  async function ensureDetail(matchId) {
    const m = db.get('SELECT id,ref,sport,status,kickoff,league_id FROM matches WHERE id=?', matchId);
    if (!m) return;
    const f = db.get('SELECT MAX(fetched_at) t FROM match_details WHERE match_id=?', matchId);
    const fetchedAt = f && f.t || 0;
    if (nowSec() - fetchedAt < detailTtl(m, fetchedAt)) return;
    if (inflight.has(matchId)) return inflight.get(matchId);
    const p = (async () => {
      try {
        const d = await provider.matchDetail(states.get(m.ref) || { ref: m.ref, sport: m.sport, kickoff: m.kickoff });
        if (!d) { db.run("INSERT OR REPLACE INTO match_details (match_id,kind,data,fetched_at) VALUES (?,?,?,?)", matchId, 'meta', '{}', nowSec()); return; }
        db.tx(() => ['events', 'stats', 'lineups', 'h2h'].forEach((k) => {
          if (d[k] !== undefined) db.run('INSERT OR REPLACE INTO match_details (match_id,kind,data,fetched_at) VALUES (?,?,?,?)', matchId, k, JSON.stringify(d[k]), nowSec());
        }));
        if (hub && LIVE.includes(m.status)) hub.matchesChanged([matchId], true);
      } catch (e) { log('detail ' + m.ref + ': ' + e.message); } finally { inflight.delete(matchId); }
    })();
    inflight.set(matchId, p);
    return p;
  }
  async function ensureSquad(teamId) {
    const t = db.get('SELECT id,ref,sport,name FROM teams WHERE id=?', teamId);
    if (!t) return;
    const f = db.get('SELECT fetched_at FROM squads WHERE team_id=?', teamId);
    if (f && nowSec() - f.fetched_at < 24 * 3600) return;
    try {
      const sq = await provider.squad(t);
      db.run('INSERT OR REPLACE INTO squads (team_id,data,fetched_at) VALUES (?,?,?)', teamId, JSON.stringify(sq || []), nowSec());
    } catch (e) { log('squad ' + t.ref + ': ' + e.message); }
  }

  /* ---------- housekeeping ---------- */
  function cleanup() {
    const cut = nowSec() - (cfg.windowPastDays + 2) * DAY;
    db.tx(() => {
      db.run("DELETE FROM odds_current WHERE match_id IN (SELECT id FROM matches WHERE kickoff < ?)", cut);
      db.run('DELETE FROM match_details WHERE match_id IN (SELECT id FROM matches WHERE kickoff < ?)', cut);
      db.run('DELETE FROM matches WHERE kickoff < ?', cut);
      db.run('DELETE FROM clicks WHERE ts < ?', nowSec() - 400 * DAY);
    });
    ids.match.clear();
    for (const [ref, m] of states) if (m.kickoff < cut) states.delete(ref);
  }

  /* ---------- scheduler ---------- */
  const JOBS = {
    reference: { fn: reference, every: () => cfg.intervals.referenceSec },
    fixtures: { fn: fixtures, every: () => cfg.intervals.fixturesSec },
    standings: { fn: standings, every: () => cfg.intervals.standingsSec },
    live: { fn: live, every: () => cfg.intervals.liveSec },
    odds: { fn: () => odds(false), every: () => cfg.intervals.oddsSec },
    liveOdds: { fn: () => odds(true), every: () => cfg.intervals.liveOddsSec },
    cleanup: { fn: async () => cleanup(), every: () => 6 * 3600 }
  };
  async function runJob(name) {
    const job = JOBS[name];
    if (!job) throw new Error('unknown job ' + name);
    if (running.has(name)) return { skipped: true };
    running.add(name);
    const s = status.jobs[name] || (status.jobs[name] = { runs: 0, errors: 0 });
    const t0 = Date.now();
    try { await job.fn(); s.lastOk = nowSec(); s.lastMs = Date.now() - t0; s.runs++; s.lastError = ''; }
    catch (e) { s.errors++; s.lastError = e.message; status.lastError = name + ': ' + e.message; log('job ' + name + ' failed: ' + e.message); }
    finally { running.delete(name); }
    return s;
  }
  function loop(name) {
    if (stopped) return;
    const job = JOBS[name];
    const tick = async () => { await runJob(name); if (!stopped) { const t = setTimeout(tick, Math.max(2, job.every()) * 1000); t.unref && t.unref(); timers.push(t); } };
    tick();
  }
  // Switching from the demo provider to a real one: remove the simulated data (and the demo bookmakers that point at
  // example.com) so nothing fake survives on a live site. Your own bookmakers, rules and ad slots are kept.
  function purgeDemoIfSwitched() {
    const prev = (db.get("SELECT value FROM settings WHERE key='data_mode'") || {}).value;
    if (prev !== 'mock' || provider.isMock) return;
    log('Data provider changed from demo to "' + provider.name + '": removing simulated matches, teams and demo bookmakers');
    db.tx(() => {
      ['odds_current', 'match_details', 'standings', 'squads', 'matches', 'teams', 'leagues', 'countries', 'feed_bookmakers'].forEach((t) => db.run('DELETE FROM ' + t));
      const demo = db.all("SELECT id FROM bookmakers WHERE provider_ref LIKE 'mock-%' AND affiliate_url LIKE 'https://example.com/%'");
      demo.forEach((b) => { db.run('DELETE FROM bookmaker_geo WHERE bookmaker_id=?', b.id); db.run('DELETE FROM bookmakers WHERE id=?', b.id); });
    });
  }
  async function start() {
    purgeDemoIfSwitched();
    warm();
    if (db.get('SELECT COUNT(*) n FROM leagues').n === 0 || (cfg.syncEnabled && !provider.isMock)) await runJob('reference');
    else if (provider.isMock) await runJob('reference');
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('data_mode', ?)", provider.isMock ? 'mock' : 'live');
    await runJob('fixtures'); await runJob('live'); await runJob('odds');
    runJob('standings');
    if (!cfg.syncEnabled) return;
    ['reference', 'fixtures', 'standings', 'live', 'odds', 'liveOdds', 'cleanup'].forEach((n, i) => { const t = setTimeout(() => loop(n), 1500 + i * 400); t.unref && t.unref(); timers.push(t); });
  }
  function stop() { stopped = true; timers.forEach(clearTimeout); }

  return { start, stop, runJob, jobs: Object.keys(JOBS), ensureDetail, ensureSquad, ensureStandings, upMatches, warm, reference, fixtures, live, odds, standings,
    status() { return Object.assign({}, status, { provider: provider.name, providerStatus: provider.status ? provider.status() : null, running: Array.from(running) }); } };
}
module.exports = { create };
