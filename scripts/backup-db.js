#!/usr/bin/env node
// Consistent online backup of the SQLite database into ./backups (keeps the newest 14). Run daily by cron (see deploy/setup.sh).
const path = require('path'); const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const root = path.join(__dirname, '..');
let dbPath = process.env.DB_PATH;
if (!dbPath) { try { const m = fs.readFileSync(path.join(root, '.env'), 'utf8').match(/^DB_PATH=(.*)$/m); dbPath = m && m[1].split('#')[0].trim(); } catch (e) { /* no .env */ } }
dbPath = path.resolve(root, dbPath || './data/livescorenow.db');
const dir = path.join(root, 'backups'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'livescorenow-' + new Date().toISOString().slice(0, 10) + '.db');
try { fs.unlinkSync(out); } catch (e) { /* none */ }
const db = new DatabaseSync(dbPath); db.exec("VACUUM INTO '" + out.replace(/'/g, "''") + "'"); db.close();
fs.readdirSync(dir).filter((f) => /^livescorenow-.*\.db$/.test(f)).sort().slice(0, -14).forEach((f) => fs.unlinkSync(path.join(dir, f)));
console.log('backup written', out);
