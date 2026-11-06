'use strict';
// server/presets.js — bookmakers that are built into the package, so they exist without using the admin.
// A preset is only created if no bookmaker with that name exists yet, and is never overwritten afterwards:
// whatever you change in the admin stays as you set it.
const PRESETS = [
  {
    name: '1xBet', short_code: '1X', color: '#0a5ea8', logo_url: '/assets/logos/1xbet.png', offer: '',
    affiliate_url: 'https://reffpa.com/L?tag=d_6306719m_1599c_&site=6306719&ad=1599',
    sort_order: 10,
    // Shown to every visitor except these countries.
    rules: [['all', '*', 'allow'], ['country', 'GB', 'block'], ['country', 'FR', 'block'], ['country', 'US', 'block']]
  }
];
const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function install(db) {
  PRESETS.forEach((p) => {
    const exists = db.all('SELECT id,name FROM bookmakers').some((b) => norm(b.name) === norm(p.name));
    if (exists) { if (p.logo_url) db.run("UPDATE bookmakers SET logo_url=? WHERE logo_url='' AND REPLACE(REPLACE(LOWER(name),' ',''),'-','')=?", p.logo_url, norm(p.name)); return; }
    const id = Number(db.run('INSERT INTO bookmakers (name,short_code,color,logo_url,provider_ref,affiliate_url,offer,terms_url,license_text,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
      p.name, p.short_code, p.color, p.logo_url, '', p.affiliate_url, p.offer, '', '', p.sort_order).lastInsertRowid);
    p.rules.forEach((r) => db.run('INSERT OR IGNORE INTO bookmaker_geo (bookmaker_id,scope_type,scope_value,mode) VALUES (?,?,?,?)', id, r[0], r[1], r[2]));
  });
}

// Connect odds: any bookmaker with no feed reference yet gets every feed entry that has the same name (all sports).
function linkFeed(db) {
  const feed = db.all('SELECT ref,name FROM feed_bookmakers');
  if (!feed.length) return;
  db.all("SELECT id,name FROM bookmakers WHERE provider_ref=''").forEach((b) => {
    const refs = feed.filter((f) => norm(f.name) === norm(b.name)).map((f) => f.ref);
    if (refs.length) db.run("UPDATE bookmakers SET provider_ref=?, updated_at=datetime('now') WHERE id=?", refs.join(',').slice(0, 600), b.id);
  });
}
module.exports = { install, linkFeed, PRESETS };
