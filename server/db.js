'use strict';
// server/db.js — SQLite via Node's built-in node:sqlite (no native module to compile).
// Requires Node >= 22.13 (node:sqlite without a flag).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sports (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS countries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'country'
);
CREATE TABLE IF NOT EXISTS leagues (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, sport TEXT NOT NULL, country_id INTEGER NOT NULL,
  name TEXT NOT NULL, slug TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'league', season TEXT NOT NULL DEFAULT '',
  top INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, logo_url TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_leagues_country ON leagues(country_id, sport);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, sport TEXT NOT NULL, country_id INTEGER,
  name TEXT NOT NULL, slug TEXT NOT NULL, logo_url TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, sport TEXT NOT NULL, league_id INTEGER NOT NULL,
  season TEXT NOT NULL DEFAULT '', round TEXT NOT NULL DEFAULT '', home_id INTEGER NOT NULL, away_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', minute INTEGER, period INTEGER,
  hs INTEGER, as_ INTEGER, hths INTEGER, htas INTEGER, periods TEXT, updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_matches_kick ON matches(sport, kickoff);
CREATE INDEX IF NOT EXISTS idx_matches_league ON matches(league_id, kickoff);
CREATE INDEX IF NOT EXISTS idx_matches_home ON matches(home_id, kickoff);
CREATE INDEX IF NOT EXISTS idx_matches_away ON matches(away_id, kickoff);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE TABLE IF NOT EXISTS match_details (
  match_id INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY (match_id, kind)
);
CREATE TABLE IF NOT EXISTS standings (
  league_id INTEGER PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS squads (
  team_id INTEGER PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS odds_current (
  match_id INTEGER NOT NULL, bookmaker_ref TEXT NOT NULL, market TEXT NOT NULL, selection TEXT NOT NULL,
  value REAL NOT NULL, prev REAL, updated_at INTEGER NOT NULL, PRIMARY KEY (match_id, bookmaker_ref, market, selection)
);
CREATE INDEX IF NOT EXISTS idx_odds_match ON odds_current(match_id);
CREATE TABLE IF NOT EXISTS feed_bookmakers (
  ref TEXT PRIMARY KEY, name TEXT NOT NULL, seen_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bookmakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, short_code TEXT NOT NULL, color TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '', provider_ref TEXT NOT NULL DEFAULT '', affiliate_url TEXT NOT NULL,
  offer TEXT NOT NULL DEFAULT '', terms_url TEXT NOT NULL DEFAULT '', license_text TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bookmaker_geo (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bookmaker_id INTEGER NOT NULL, scope_type TEXT NOT NULL, scope_value TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'allow', affiliate_url TEXT, offer TEXT, license_text TEXT, sort_order INTEGER,
  UNIQUE (bookmaker_id, scope_type, scope_value),
  FOREIGN KEY (bookmaker_id) REFERENCES bookmakers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS regions (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, countries TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS country_rules (
  country_code TEXT PRIMARY KEY, betting_content INTEGER NOT NULL DEFAULT 1, min_age INTEGER NOT NULL DEFAULT 18,
  rg_text TEXT NOT NULL DEFAULT '', rg_url TEXT NOT NULL DEFAULT '', license_text TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ad_slots (
  slot_key TEXT PRIMARY KEY, label TEXT NOT NULL, placement TEXT NOT NULL DEFAULT '', width INTEGER, height INTEGER,
  ad_code TEXT NOT NULL DEFAULT '', fallback_code TEXT NOT NULL DEFAULT '', betting_related INTEGER NOT NULL DEFAULT 0,
  countries_include TEXT NOT NULL DEFAULT '', countries_exclude TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, bookmaker_id INTEGER NOT NULL, country TEXT NOT NULL DEFAULT '',
  match_id INTEGER, placement TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_clicks_ts ON clicks(ts);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS geoip (
  family INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, cc TEXT NOT NULL
);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  raw.exec(SCHEMA);

  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  let depth = 0;

  const db = {
    raw,
    all(sql, ...p) { return stmt(sql).all(...p); },
    get(sql, ...p) { return stmt(sql).get(...p); },
    run(sql, ...p) { return stmt(sql).run(...p); },
    exec(sql) { raw.exec(sql); },
    tx(fn) {
      if (depth > 0) return fn();
      raw.exec('BEGIN');
      depth++;
      try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { try { raw.exec('ROLLBACK'); } catch (x) { /* ignore */ } throw e; } finally { depth--; }
    },
    close() { try { raw.close(); } catch (e) { /* ignore */ } }
  };
  return db;
}

module.exports = { open };
