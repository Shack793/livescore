'use strict';
// server/config.js — zero-dependency .env loader + typed settings.
const fs = require('fs');
const path = require('path');

function parseEnv(text) {
  const out = {};
  String(text).split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) return;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  });
  return out;
}

function loadEnvFile(file) {
  try {
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    Object.keys(parsed).forEach((k) => { if (process.env[k] === undefined) process.env[k] = parsed[k]; });
  } catch (e) { /* no .env file: rely on real environment */ }
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : d; }
function bool(v, d) { if (v == null || v === '') return d; return /^(1|true|yes|on)$/i.test(String(v)); }

function load(root, overrides) {
  root = root || path.join(__dirname, '..');
  loadEnvFile(path.join(root, '.env'));
  const e = Object.assign({}, process.env, overrides || {});
  const cfg = {
    root: root,
    env: e.NODE_ENV || 'development',
    host: e.HOST || '127.0.0.1',
    port: num(e.PORT, 3000),
    siteName: e.SITE_NAME || 'LiveScoreNow',
    siteUrl: (e.SITE_URL || 'http://localhost:' + num(e.PORT, 3000)).replace(/\/+$/, ''),
    siteTz: e.SITE_TZ || 'Africa/Accra',
    adminUser: e.ADMIN_USER || 'admin',
    adminPass: e.ADMIN_PASS || '',
    dbPath: path.resolve(root, e.DB_PATH || './data/livescorenow.db'),
    provider: (e.DATA_PROVIDER || 'mock').toLowerCase(),
    // Multi-sport mode (DATA_PROVIDER=multi): each sport has exactly ONE feed.
    // Football comes from FOOTBALL_PROVIDER (sportmonks, apifootball, or failover
    // for API-Football + Sportmonks quota fallback); basketball comes from
    // API-Sports when BASKETBALL_PROVIDER=apibasketball.
    footballProvider: (e.FOOTBALL_PROVIDER || 'sportmonks').toLowerCase(),
    basketballProvider: (e.BASKETBALL_PROVIDER || '').toLowerCase(),
    // API-Sports sells every sport under one account key; API_SPORTS_KEY is the
    // explicit name, API_FOOTBALL_KEY is the historical one. Accept both.
    apiSportsKey: e.API_SPORTS_KEY || e.API_FOOTBALL_KEY || '',
    basketballBase: (e.BASKETBALL_BASE || 'https://v1.basketball.api-sports.io').replace(/\/+$/, ''),
    // Comma-separated API-Basketball league IDs to follow (empty = all active leagues, e.g. 12 NBA).
    basketballLeagues: String(e.BASKETBALL_LEAGUES || '').split(',').map((s) => Number(s.trim())).filter((n) => n > 0),
    // Minimum gap between API-Basketball calls. Pro plans allow far more than
    // the Free plan's 10/min, so 1 s keeps bursts safe without slowing sync much.
    basketballMinGapMs: num(e.BASKETBALL_MIN_GAP_MS, 1000),
    basketballFixturesSec: num(e.BASKETBALL_FIXTURES_SEC, 900),
    basketballLiveSec: num(e.BASKETBALL_LIVE_SEC, 60),
    basketballOdds: bool(e.BASKETBALL_ODDS, true),
    // Odds per game are cached this long (seconds) and each sync pass fetches at
    // most BASKETBALL_ODDS_MAX games, so live odds never eat the daily quota.
    basketballOddsSec: num(e.BASKETBALL_ODDS_SEC, 600),
    basketballOddsMax: num(e.BASKETBALL_ODDS_MAX, 12),
    apiFootballKey: e.API_FOOTBALL_KEY || '',
    apiFootballBase: e.API_FOOTBALL_BASE || 'https://v3.football.api-sports.io',
    // DATA_PROVIDER=failover: primary football feed first, fall back to the other
    // when its daily quota runs out (see providers/failover.js).
    failoverPrimary: (e.FAILOVER_PRIMARY || 'apifootball').toLowerCase(),
    failoverSecondary: (e.FAILOVER_SECONDARY || 'sportmonks').toLowerCase(),
    sportmonksToken: e.SPORTMONKS_TOKEN || '',
    sportmonksBase: e.SPORTMONKS_BASE || 'https://api.sportmonks.com/v3',
    // Comma-separated Sportmonks league IDs to follow (empty = every league in your plan).
    // Ours: 8 EPL, 82 Bundesliga, 301 Ligue 1, 384 Serie A, 564 La Liga.
    sportmonksLeagues: String(e.SPORTMONKS_LEAGUES || '').split(',').map((s) => Number(s.trim())).filter((n) => n > 0),
    mockRealtime: bool(e.MOCK_REALTIME, false),
    defaultCountry: (e.DEFAULT_COUNTRY || '').toUpperCase(),
    // Only true when running behind your own nginx/Cloudflare: lets us trust X-Forwarded-For and CF-IPCountry.
    trustProxy: bool(e.TRUST_PROXY, false),
    allowCcQuery: bool(e.ALLOW_CC_QUERY, (e.NODE_ENV || 'development') !== 'production'),
    contactEmail: e.CONTACT_EMAIL || '',
    // Sister community site (Pitchside Forum). Empty = no forum links are shown.
    forumUrl: (e.FORUM_URL || '').replace(/\/+$/, ''),
    forumName: e.FORUM_NAME || 'Pitchside Forum',
    forumMatchUrl: e.FORUM_MATCH_URL || '',   // optional template, e.g. https://forum.com/search?q={query}  ({home} {away} {league} {query})
    // Origins allowed to put /embed/* widgets in an iframe (space/comma separated). Defaults to the forum's origin.
    embedOrigins: String(e.EMBED_ORIGINS || '').split(/[\s,]+/).filter(Boolean),
    syncEnabled: bool(e.SYNC_ENABLED, true),
    intervals: {
      liveSec: num(e.LIVE_INTERVAL_SEC, e.DATA_PROVIDER === 'sportmonks' ? 15 : e.DATA_PROVIDER === 'apifootball' ? 20 : e.DATA_PROVIDER === 'multi' ? 20 : 5),
      fixturesSec: num(e.FIXTURES_INTERVAL_SEC, e.DATA_PROVIDER === 'multi' ? 600 : 300),
      oddsSec: num(e.ODDS_INTERVAL_SEC, e.DATA_PROVIDER === 'sportmonks' ? 600 : e.DATA_PROVIDER === 'multi' ? 300 : 60),
      liveOddsSec: num(e.LIVE_ODDS_INTERVAL_SEC, e.DATA_PROVIDER === 'sportmonks' ? 60 : e.DATA_PROVIDER === 'apifootball' ? 30 : e.DATA_PROVIDER === 'multi' ? 60 : 10),
      standingsSec: num(e.STANDINGS_INTERVAL_SEC, 6 * 3600),
      referenceSec: num(e.REFERENCE_INTERVAL_SEC, 24 * 3600)
    },
    windowPastDays: num(e.WINDOW_PAST_DAYS, 3),
    windowFutureDays: num(e.WINDOW_FUTURE_DAYS, 7),
    // sports the sync loop pulls (comma separated); real provider only supports football today
    sports: String(e.SPORTS || '').split(',').map((s) => s.trim()).filter(Boolean),
    sseMaxPerIp: num(e.SSE_MAX_PER_IP, 8),
    apiRatePerMin: num(e.API_RATE_PER_MIN, 240)
  };
  cfg.isProd = cfg.env === 'production';
  return cfg;
}

module.exports = { load, parseEnv };
