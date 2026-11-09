'use strict';
// server/presets.js — bookmakers that are built into the package, so they exist without using the admin.
// A preset is only created if no bookmaker with that name exists yet, and is never overwritten afterwards:
// whatever you change in the admin stays as you set it.
// Countries where 1xBet must not be promoted: territories its own partner terms prohibit, plus countries where regulators
// reportedly list it as unauthorised. BQ is Bonaire, Sint Eustatius and Saba together. Bump RULES_VERSION when this list changes
// and the new countries are added once to existing installs (rules you deleted later in the admin are not re-added after that).
const RULES_VERSION = 2;
const BLOCKED = ['AU', 'CW', 'FR', 'NL', 'ES', 'US', 'GB', 'AW', 'BQ', 'AL', 'AM', 'CL', 'CO', 'HR', 'CY', 'CZ', 'EE', 'GI', 'GR', 'IT', 'LV', 'LT', 'MT', 'MD', 'MK', 'PL', 'RO', 'UY'];
const PRESETS = [
  {
    name: '1xBet', short_code: '1X', color: '#0a5ea8', logo_url: '/assets/logos/1xbet.png', offer: '',
    affiliate_url: 'https://reffpa.com/L?tag=d_6306719m_1599c_&site=6306719&ad=1599',
    sort_order: 10,
    // Shown to every visitor except these countries.
    rules: [['all', '*', 'allow']].concat(BLOCKED.map((c) => ['country', c, 'block']))
  }
];
// Ready-made banners from partner programs. Created once, never overwritten; shown by country like any ad.
const AD_PRESETS = [
  {
    slot_key: 'infeed', name: '1xBet banner 320x100 (in-feed)', betting_related: 1, priority: 0,
    ad_code: '<div style="text-align:center"><iframe scrolling="no" frameBorder="0" style="padding:0;margin:0;border:0" width="320" height="100" src="https://refbanners.com/I?tag=d_6306719m_2811c_&site=6306719&ad=2811"></iframe></div>',
    rules: [['all', '*', 'show']].concat(BLOCKED.map((c) => ['country', c, 'hide']))
  }
];
const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const getV = (db, k) => Number((db.get('SELECT value v FROM settings WHERE key=?', k) || {}).v || 0);
const setV = (db, k) => db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', k, String(RULES_VERSION));

function installAds(db) {
  AD_PRESETS.forEach((a) => {
    const key = 'preset_ad_rules_' + norm(a.name);
    if (getV(db, key) >= RULES_VERSION) return;
    a.rules.forEach((r) => {
      const nm = a.name + (r[0] === 'all' ? '' : ' (' + r[1] + ' off)');
      if (db.get('SELECT id FROM ad_creatives WHERE name=?', nm)) return;
      db.run("INSERT INTO ad_creatives (slot_key,name,scope_type,scope_value,mode,ad_code,fallback_code,image_url,link_url,alt_text,betting_related,priority,active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))",
        a.slot_key, nm, r[0], r[1], r[2], r[2] === 'show' ? a.ad_code : '', '', '', '', '', a.betting_related, a.priority);
    });
    setV(db, key);
  });
}

function install(db) {
  installAds(db);
  PRESETS.forEach((p) => {
    const found = db.all('SELECT id,name FROM bookmakers').filter((b) => norm(b.name) === norm(p.name))[0];
    let id;
    if (found) {
      id = found.id;
      if (p.logo_url) db.run("UPDATE bookmakers SET logo_url=? WHERE id=? AND logo_url=''", p.logo_url, id);
    } else {
      id = Number(db.run('INSERT INTO bookmakers (name,short_code,color,logo_url,provider_ref,affiliate_url,offer,terms_url,license_text,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
        p.name, p.short_code, p.color, p.logo_url, '', p.affiliate_url, p.offer, '', '', p.sort_order).lastInsertRowid);
    }
    const key = 'preset_rules_' + norm(p.name);
    if (getV(db, key) < RULES_VERSION) {
      p.rules.forEach((r) => db.run('INSERT OR IGNORE INTO bookmaker_geo (bookmaker_id,scope_type,scope_value,mode) VALUES (?,?,?,?)', id, r[0], r[1], r[2]));
      setV(db, key);
    }
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
