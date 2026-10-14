'use strict';
// server/index.js — boots the whole site. Run with:  node --disable-warning=ExperimentalWarning server/index.js
const http = require('http');
const path = require('path');
const config = require('./config');
const dbmod = require('./db');
const seed = require('./seed');
const storeMod = require('./store-sqlite');
const { GeoIP } = require('./geo/geoip');
const providers = require('./providers');
const syncMod = require('./services/sync');
const hubMod = require('./services/hub');
const appMod = require('./app');
const B = require('../shared/bookmakers');

async function start(overrides) {
  const cfg = config.load((overrides && overrides.root) || path.join(__dirname, '..'), overrides && overrides.env);
  const log = (overrides && overrides.log) || ((m) => console.log(new Date().toISOString() + ' ' + m));
  const db = dbmod.open(cfg.dbPath);
  seed.run(db, { demoBookmakers: cfg.provider === 'mock' });
  const store = storeMod.create(db);
  const geoip = new GeoIP();
  try { const n = geoip.loadFromDb(db); log('geoip: ' + n + ' ranges loaded' + (n ? '' : ' (run "npm run geoip:update" to enable IP-based country detection)')); } catch (e) { log('geoip: ' + e.message); }

  const provider = providers.create(cfg, log);
  const holder = {};
  const hub = hubMod.create({ store, maxPerIp: cfg.sseMaxPerIp, log, getBk: (cc) => (holder.app ? holder.app.getBk(cc) : B.resolve(store.bookmakerConfig(), cc)) });
  const sync = syncMod.create({ db, provider, cfg, hub, log });
  const app = appMod.create({ cfg, db, store, sync, hub, geoip, log });
  holder.app = app;

  if (cfg.provider === 'mock') log('DATA_PROVIDER=mock: demo data and simulated odds (' + provider.status().mode + ')');
  if (!cfg.adminPass) log('ADMIN_PASS is not set: the admin panel is disabled until you set it in .env');

  const server = http.createServer((req, res) => { app.handler(req, res); });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 20000;
  server.requestTimeout = 0; // SSE connections are long-lived
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(cfg.port, cfg.host, resolve); });
  const port = server.address().port;
  log('LiveScoreNow listening on http://' + cfg.host + ':' + port);

  await sync.start();
  log('initial sync done: ' + db.get('SELECT COUNT(*) n FROM matches').n + ' matches');

  async function close() {
    sync.stop(); hub.closeAll();
    await new Promise((r) => server.close(r));
    db.close();
  }
  return { cfg, db, store, sync, hub, app, server, port, close };
}

if (require.main === module) {
  start().then((s) => {
    const bye = () => { s.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
    process.on('SIGTERM', bye); process.on('SIGINT', bye);
  }).catch((e) => { console.error('Failed to start:', e); process.exit(1); });
}
module.exports = { start };
