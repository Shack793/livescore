'use strict';
// server/store-sqlite.js — read API used by shared/pages.js. shared/store-memory.js implements the same
// interface for the standalone preview, so the same page code renders in both places.
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

const MATCH_SQL = `SELECT m.id, m.ref, m.sport, m.kickoff, m.status, m.minute, m.period, m.hs, m.as_ AS aws, m.hths, m.htas, m.periods, m.round, m.season,
  l.id lid, l.name lname, l.slug lslug, l.type ltype, l.top ltop, l.active lactive, l.sport lsport,
  c.code ccode, c.name cname, c.slug cslug, c.kind ckind,
  h.id hid, h.name hname, h.slug hslug, h.logo_url hlogo, a.id aid, a.name aname, a.slug aslug, a.logo_url alogo
  FROM matches m JOIN leagues l ON l.id=m.league_id JOIN countries c ON c.id=l.country_id
  JOIN teams h ON h.id=m.home_id JOIN teams a ON a.id=m.away_id`;

function shape(r) {
  if (!r) return null;
  return {
    id: r.id, ref: r.ref, sport: r.sport, kickoff: r.kickoff, status: r.status, minute: r.minute, period: r.period,
    hs: r.hs, as: r.aws, hths: r.hths, htas: r.htas, periods: J(r.periods, null), round: r.round, season: r.season,
    league: { id: r.lid, name: r.lname, slug: r.lslug, type: r.ltype, top: r.ltop, active: r.lactive, sport: r.lsport },
    country: { code: r.ccode, name: r.cname, slug: r.cslug, kind: r.ckind },
    home: { id: r.hid, name: r.hname, slug: r.hslug, logo: r.hlogo }, away: { id: r.aid, name: r.aname, slug: r.aslug, logo: r.alogo }
  };
}

function create(db) {
  let bkCache = null;
  const store = {
    kind: 'sqlite',
    invalidate() { bkCache = null; },

    sports() { return db.all('SELECT id,name,icon FROM sports WHERE active=1 ORDER BY sort_order'); },
    setting(k, d) { const r = db.get('SELECT value FROM settings WHERE key=?', k); return r ? r.value : d; },
    isMock() { return store.setting('data_mode', '') === 'mock'; },

    bookmakerConfig() {
      if (bkCache) return bkCache;
      bkCache = {
        bookmakers: db.all('SELECT * FROM bookmakers'),
        rules: db.all('SELECT * FROM bookmaker_geo'),
        regions: db.all('SELECT * FROM regions').map((r) => ({ code: r.code, name: r.name, countries: String(r.countries || '').split(',').filter(Boolean) })),
        countryRules: db.all('SELECT * FROM country_rules')
      };
      return bkCache;
    },
    adCreatives() { return db.all('SELECT * FROM ad_creatives WHERE active=1 ORDER BY priority DESC, id'); },
    adSlots() { return db.all('SELECT * FROM ad_slots WHERE active=1 ORDER BY sort_order'); },

    matches(o) {
      const w = [], p = [];
      if (o.sport) { w.push('m.sport=?'); p.push(o.sport); }
      if (o.from != null) { w.push('m.kickoff>=?'); p.push(o.from); }
      if (o.to != null) { w.push('m.kickoff<?'); p.push(o.to); }
      if (o.leagueId) { w.push('m.league_id=?'); p.push(o.leagueId); }
      if (o.teamId) { w.push('(m.home_id=? OR m.away_id=?)'); p.push(o.teamId, o.teamId); }
      if (o.live) w.push("m.status IN ('live','halftime','break')");
      if (o.finished) w.push("m.status='finished'");
      if (o.scheduled) w.push("m.status='scheduled'");
      w.push('l.active=1');
      const order = o.desc ? 'DESC' : 'ASC';
      const sql = MATCH_SQL + ' WHERE ' + w.join(' AND ') + ' ORDER BY m.kickoff ' + order + ', m.id' + (o.limit ? ' LIMIT ' + (o.limit | 0) : '');
      return db.all(sql, ...p).map(shape);
    },
    match(id) { return shape(db.get(MATCH_SQL + ' WHERE m.id=?', id)); },
    matchesByIds(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 400) {
        const c = ids.slice(i, i + 400);
        db.all(MATCH_SQL + ' WHERE m.id IN (' + c.map(() => '?').join(',') + ')', ...c).forEach((r) => out.push(shape(r)));
      }
      return out;
    },
    matchByRef(ref) { return shape(db.get(MATCH_SQL + ' WHERE m.ref=?', ref)); },
    detail(matchId) {
      const out = { events: [], stats: [], lineups: null, h2h: [], fetched_at: 0 };
      db.all('SELECT kind,data,fetched_at FROM match_details WHERE match_id=?', matchId).forEach((r) => { out[r.kind] = J(r.data, out[r.kind]); out.fetched_at = Math.max(out.fetched_at, r.fetched_at); });
      return out;
    },
    standings(leagueId) { const r = db.get('SELECT data,fetched_at FROM standings WHERE league_id=?', leagueId); return r ? { groups: J(r.data, []), fetched_at: r.fetched_at } : null; },
    squad(teamId) { const r = db.get('SELECT data FROM squads WHERE team_id=?', teamId); return r ? J(r.data, []) : null; },

    menu(sport) {
      const rows = db.all(`SELECT l.id,l.name,l.slug,l.type,l.top,c.id cid,c.code,c.name cname,c.slug cslug,c.kind
        FROM leagues l JOIN countries c ON c.id=l.country_id WHERE l.sport=? AND l.active=1
        ORDER BY (c.kind='region') DESC, c.name COLLATE NOCASE, l.top DESC, l.name COLLATE NOCASE`, sport);
      const by = new Map();
      rows.forEach((r) => {
        let g = by.get(r.cid);
        if (!g) { g = { country: { code: r.code, name: r.cname, slug: r.cslug, kind: r.kind }, leagues: [] }; by.set(r.cid, g); }
        g.leagues.push({ id: r.id, name: r.name, slug: r.slug, type: r.type, top: r.top });
      });
      return Array.from(by.values());
    },
    topLeagues(sport) {
      return db.all(`SELECT l.id,l.name,l.slug,c.code,c.name cname,c.slug cslug FROM leagues l JOIN countries c ON c.id=l.country_id
        WHERE l.sport=? AND l.active=1 AND l.top=1 ORDER BY l.name`, sport).map((r) => ({ id: r.id, name: r.name, slug: r.slug, country: { code: r.code, name: r.cname, slug: r.cslug } }));
    },
    league(sport, countrySlug, leagueSlug) {
      const r = db.get(`SELECT l.id,l.name,l.slug,l.type,l.season,l.top,l.sport,c.code,c.name cname,c.slug cslug,c.kind FROM leagues l JOIN countries c ON c.id=l.country_id
        WHERE l.sport=? AND c.slug=? AND l.slug=? AND l.active=1`, sport, countrySlug, leagueSlug);
      return r ? { id: r.id, name: r.name, slug: r.slug, type: r.type, season: r.season, top: r.top, sport: r.sport, country: { code: r.code, name: r.cname, slug: r.cslug, kind: r.kind } } : null;
    },
    country(sport, slug) {
      const c = db.get('SELECT * FROM countries WHERE slug=?', slug);
      if (!c) return null;
      const leagues = db.all('SELECT id,name,slug,type,top,season FROM leagues WHERE sport=? AND country_id=? AND active=1 ORDER BY top DESC, name', sport, c.id);
      return leagues.length ? { code: c.code, name: c.name, slug: c.slug, kind: c.kind, leagues } : null;
    },
    team(id) {
      const r = db.get('SELECT t.id,t.ref,t.sport,t.name,t.slug,t.logo_url,c.code,c.name cname,c.slug cslug FROM teams t LEFT JOIN countries c ON c.id=t.country_id WHERE t.id=?', id);
      return r ? { id: r.id, ref: r.ref, sport: r.sport, name: r.name, slug: r.slug, logo: r.logo_url, country: r.code ? { code: r.code, name: r.cname, slug: r.cslug } : null } : null;
    },
    teamsByIds(ids) {
      const out = new Map();
      for (let i = 0; i < ids.length; i += 400) {
        const c = ids.slice(i, i + 400);
        db.all('SELECT id,name,slug,sport,logo_url FROM teams WHERE id IN (' + c.map(() => '?').join(',') + ')', ...c).forEach((r) => out.set(r.id, { id: r.id, name: r.name, slug: r.slug, sport: r.sport, logo: r.logo_url }));
      }
      return out;
    },
    teamLeagues(teamId) {
      return db.all(`SELECT DISTINCT l.id,l.name,l.slug,c.slug cslug,c.name cname,c.code FROM matches m JOIN leagues l ON l.id=m.league_id JOIN countries c ON c.id=l.country_id
        WHERE (m.home_id=? OR m.away_id=?) AND l.active=1`, teamId, teamId).map((r) => ({ id: r.id, name: r.name, slug: r.slug, country: { code: r.code, name: r.cname, slug: r.cslug } }));
    },
    oddsRows(ids) {
      const out = new Map();
      if (!ids.length) return out;
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        db.all('SELECT match_id,bookmaker_ref,market,selection,value,prev FROM odds_current WHERE match_id IN (' + chunk.map(() => '?').join(',') + ')', ...chunk)
          .forEach((r) => { let a = out.get(r.match_id); if (!a) out.set(r.match_id, a = []); a.push(r); });
      }
      return out;
    },
    liveCounts() {
      const o = {};
      db.all("SELECT sport, COUNT(*) n FROM matches WHERE status IN ('live','halftime','break') GROUP BY sport").forEach((r) => { o[r.sport] = r.n; });
      return o;
    },
    search(q, limit) {
      q = String(q || '').trim().replace(/[%_]/g, ' ');
      if (q.length < 2) return { teams: [], leagues: [] };
      const like = '%' + q + '%', start = q + '%';
      limit = limit || 8;
      const teams = db.all(`SELECT t.id,t.name,t.slug,t.sport,t.logo_url FROM teams t WHERE t.name LIKE ? ORDER BY (t.name LIKE ?) DESC, length(t.name) LIMIT ?`, like, start, limit)
        .map((t) => ({ id: t.id, name: t.name, slug: t.slug, sport: t.sport, logo: t.logo_url }));
      const leagues = db.all(`SELECT l.id,l.name,l.slug,l.sport,c.slug cslug,c.name cname,c.code FROM leagues l JOIN countries c ON c.id=l.country_id
        WHERE l.active=1 AND (l.name LIKE ? OR c.name LIKE ?) ORDER BY (l.name LIKE ?) DESC, l.top DESC LIMIT ?`, like, like, start, limit)
        .map((l) => ({ id: l.id, name: l.name, slug: l.slug, sport: l.sport, country: { code: l.code, name: l.cname, slug: l.cslug } }));
      return { teams, leagues };
    },
    allForSitemap() {
      return {
        leagues: db.all('SELECT l.sport,l.slug,c.slug cslug FROM leagues l JOIN countries c ON c.id=l.country_id WHERE l.active=1'),
        teams: db.all('SELECT id,slug FROM teams ORDER BY id LIMIT 20000')
      };
    }
  };
  return store;
}
module.exports = { create, shape, MATCH_SQL };
