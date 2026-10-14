'use strict';
// Downloads the free DB-IP "IP to Country Lite" database (CC BY 4.0) and loads it into SQLite.
//   npm run geoip:update                  download the latest monthly file automatically
//   npm run geoip:update -- --file x.csv  load a file you downloaded yourself (.csv or .csv.gz)
// Re-run monthly (a cron line is in the README). The site keeps working with the old data while you do.
const fs = require('fs');
const zlib = require('zlib');
const config = require('../server/config');
const dbmod = require('../server/db');
const { parseCsv, saveToDb } = require('../server/geo/geoip');

async function main() {
  const cfg = config.load();
  const i = process.argv.indexOf('--file');
  let buf;
  if (i !== -1) buf = fs.readFileSync(process.argv[i + 1]);
  else {
    const d = new Date();
    for (let back = 0; back < 3 && !buf; back++) {
      const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
      const url = 'https://download.db-ip.com/free/dbip-country-lite-' + dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '.csv.gz';
      process.stdout.write('Downloading ' + url + ' ... ');
      try { const r = await fetch(url); if (!r.ok) { console.log('HTTP ' + r.status); continue; } buf = Buffer.from(await r.arrayBuffer()); console.log((buf.length / 1048576).toFixed(1) + ' MB'); }
      catch (e) { console.log('failed: ' + e.message); }
    }
    if (!buf) { console.error('Could not download. Download the file manually from https://db-ip.com/db/download/ip-to-country-lite and run: npm run geoip:update -- --file <path>'); process.exit(1); }
  }
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const rows = parseCsv(buf.toString('utf8'));
  if (rows.length < 1000) { console.error('File looks wrong: only ' + rows.length + ' valid ranges parsed. Nothing was changed.'); process.exit(1); }
  const db = dbmod.open(cfg.dbPath);
  saveToDb(db, rows);
  db.close();
  console.log('Loaded ' + rows.length + ' IP ranges. Restart the site to use them:  sudo systemctl restart livescorenow');
}
main().catch((e) => { console.error(e); process.exit(1); });
