'use strict';
// server/presets.js — bookmakers that are built into the package, so they exist without using the admin.
// A preset is only created if no bookmaker with that name exists yet, and is never overwritten afterwards:
// whatever you change in the admin stays as you set it.
// Countries where 1xBet must not be promoted: territories its own partner terms prohibit, plus countries where regulators
// reportedly list it as unauthorised. BQ is Bonaire, Sint Eustatius and Saba together. Bump RULES_VERSION when this list changes
// and the new countries are added once to existing installs (rules you deleted later in the admin are not re-added after that).
const RULES_VERSION = 2;
const BLOCKED = ['AU', 'CW', 'FR', 'NL', 'ES', 'US', 'GB', 'AW', 'BQ', 'AL', 'AM', 'CL', 'CO', 'HR', 'CY', 'CZ', 'EE', 'GI', 'GR', 'IT', 'LV', 'LT', 'MT', 'MD', 'MK', 'PL', 'RO', 'UY'];
// CoinRoyale is hidden only in these for now (US, UK, France); add more here when their country list is known, and bump CR_VERSION.
const CR_BLOCKED = ['US', 'GB', 'FR'];
const CR_VERSION = 2;
// Crypto.Games is hidden only in these for now (US, UK, France); add more when their country list is known.
const CG_BLOCKED = ['US', 'GB', 'FR'];
const PRESETS = [
  {
    name: '1xBet', short_code: '1X', color: '#0a5ea8', logo_url: '/assets/logos/1xbet.png', offer: '',
    affiliate_url: 'https://reffpa.com/L?tag=d_6306719m_1599c_&site=6306719&ad=1599',
    sort_order: -20,
    // Shown to every visitor except these countries.
    rules: [['all', '*', 'allow']].concat(BLOCKED.map((c) => ['country', c, 'block']))
  },
  {
    // No odds feed for this one: it appears in the "Top bookmakers" list and the banners, not beside match odds.
    name: 'CoinRoyale', short_code: 'CR', color: '#241056', logo_url: '/assets/logos/coinroyale.png', offer: 'Bitcoin casino & sportsbook',
    affiliate_url: 'https://coinroyale.com/',
    sort_order: -10,
    rules: [['all', '*', 'allow']].concat(CR_BLOCKED.map((c) => ['country', c, 'block']))
  },
  {
    // A casino with its own games, not a bookmaker: listed in "Top casinos", never used for match odds or "Bet now" boxes.
    name: 'Crypto.Games', kind: 'casino', short_code: 'CG', color: '#4a2a14', logo_url: '/assets/logos/cryptogames.png', offer: 'Crypto casino games',
    affiliate_url: 'http://crypto.games/',
    sort_order: -5,
    rules: [['all', '*', 'allow']].concat(CG_BLOCKED.map((c) => ['country', c, 'block']))
  }
];
// Order in the "Top bookmakers" list: 1xBet first, CoinRoyale second. Applied once to existing installs;
// if you change the order in the admin afterwards, it stays as you set it.
const ORDER = [['1xBet', -20], ['CoinRoyale', -10], ['Crypto.Games', -5]];
// Ready-made banners from partner programs. Created once, never overwritten; shown by country like any ad.
const AD_PRESETS = [
  {
    slot_key: 'infeed', name: '1xBet banner 320x100 (in-feed)', betting_related: 1, priority: 0,
    ad_code: '<div style="text-align:center"><iframe scrolling="no" frameBorder="0" style="padding:0;margin:0;border:0" width="320" height="100" src="https://refbanners.com/I?tag=d_6306719m_2811c_&site=6306719&ad=2811"></iframe></div>',
    rules: [['all', '*', 'show']].concat(BLOCKED.map((c) => ['country', c, 'hide']))
  }
];
// Extra in-feed ad positions (between the match rows) and the CoinRoyale test banners that fill them.
const SLOT_PRESETS = [
  { slot_key: 'infeed2', label: 'In-feed native (after 6th league)', placement: 'infeed', width: 320, height: 100, betting_related: 1, sort_order: 8 },
  { slot_key: 'infeed3', label: 'In-feed native (after 12th league)', placement: 'infeed', width: 320, height: 100, betting_related: 1, sort_order: 9 },
  // Bottom of the right sidebar, below the 1xBet / bookmaker box, so it never moves the 1xBet placements.
  { slot_key: 'sidebar-3', label: 'Right sidebar – below offers (partner test)', placement: 'sidebar', width: 300, height: 250, betting_related: 1, sort_order: 10 },
  { slot_key: 'infeed4', label: 'In-feed native (after 9th league, casino)', placement: 'infeed', width: 320, height: 100, betting_related: 1, sort_order: 11 },
  // Right under the "Top casinos" box, below the bookmakers, so it never moves 1xBet.
  { slot_key: 'sidebar-casino', label: 'Right sidebar – under Top casinos', placement: 'sidebar', width: 300, height: 250, betting_related: 1, sort_order: 12 }
];
const IMG_ADS = [
  { slot_key: 'infeed2', name: 'CoinRoyale test banner A', image_url: '/assets/ads/coinroyale-320x100-a.png', link_url: 'https://coinroyale.com/', alt_text: 'CoinRoyale – Bitcoin casino and sportsbook' },
  { slot_key: 'infeed3', name: 'CoinRoyale test banner B', image_url: '/assets/ads/coinroyale-320x100-b.png', link_url: 'https://coinroyale.com/', alt_text: 'CoinRoyale – Sportsbook' },
  { slot_key: 'sidebar-3', name: 'CoinRoyale test banner C (sidebar)', image_url: '/assets/ads/coinroyale-300x250-c.png', link_url: 'https://coinroyale.com/', alt_text: 'CoinRoyale – Bitcoin sportsbook and casino' },
  { slot_key: 'infeed4', name: 'Crypto.Games test banner', image_url: '/assets/ads/cryptogames-320x100.png', link_url: 'http://crypto.games/', alt_text: 'Crypto.Games – crypto casino', blocked: CG_BLOCKED },
  { slot_key: 'sidebar-casino', name: 'Crypto.Games test banner (sidebar)', image_url: '/assets/ads/cryptogames-300x250.png', link_url: 'http://crypto.games/', alt_text: 'Crypto.Games – crypto casino', blocked: CG_BLOCKED }
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

function installImageAds(db) {
  SLOT_PRESETS.forEach((x) => db.run('INSERT OR IGNORE INTO ad_slots (slot_key,label,placement,width,height,betting_related,sort_order) VALUES (?,?,?,?,?,?,?)', x.slot_key, x.label, x.placement, x.width, x.height, x.betting_related, x.sort_order));
  IMG_ADS.forEach((a) => {
    const key = 'preset_img_ad_' + norm(a.name);
    if (getV(db, key) >= RULES_VERSION) return;
    const rules = [['all', '*', 'show']].concat((a.blocked || CR_BLOCKED).map((c) => ['country', c, 'hide']));
    rules.forEach((r) => {
      const nm = a.name + (r[0] === 'all' ? '' : ' (' + r[1] + ' off)');
      if (db.get('SELECT id FROM ad_creatives WHERE name=?', nm)) return;
      db.run("INSERT INTO ad_creatives (slot_key,name,scope_type,scope_value,mode,ad_code,fallback_code,image_url,link_url,alt_text,betting_related,priority,active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,0,1,datetime('now'))",
        a.slot_key, nm, r[0], r[1], r[2], '', '', r[2] === 'show' ? a.image_url : '', r[2] === 'show' ? a.link_url : '', r[2] === 'show' ? a.alt_text : '');
    });
    setV(db, key);
  });
}

function install(db) {
  installAds(db);
  installImageAds(db);
  PRESETS.forEach((p) => {
    const found = db.all('SELECT id,name FROM bookmakers').filter((b) => norm(b.name) === norm(p.name))[0];
    let id;
    if (found) {
      id = found.id;
      if (p.logo_url) db.run("UPDATE bookmakers SET logo_url=? WHERE id=? AND logo_url=''", p.logo_url, id);
      if (p.kind) db.run("UPDATE bookmakers SET kind=? WHERE id=? AND kind='sportsbook'", p.kind, id);
    } else {
      id = Number(db.run('INSERT INTO bookmakers (name,short_code,color,logo_url,provider_ref,affiliate_url,offer,terms_url,license_text,active,sort_order,kind) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)',
        p.name, p.short_code, p.color, p.logo_url, '', p.affiliate_url, p.offer, '', '', p.sort_order, p.kind || 'sportsbook').lastInsertRowid);
    }
    const key = 'preset_rules_' + norm(p.name);
    if (getV(db, key) < RULES_VERSION) {
      p.rules.forEach((r) => db.run('INSERT OR IGNORE INTO bookmaker_geo (bookmaker_id,scope_type,scope_value,mode) VALUES (?,?,?,?)', id, r[0], r[1], r[2]));
      setV(db, key);
    }
  });
  // One-time: CoinRoyale used to be hidden in the full 1xBet country list; keep only CR_BLOCKED.
  const crKey = 'preset_cr_countries';
  if (Number((db.get('SELECT value v FROM settings WHERE key=?', crKey) || {}).v || 0) < CR_VERSION) {
    const keep = new Set(CR_BLOCKED);
    db.all("SELECT id,name FROM ad_creatives WHERE name LIKE 'CoinRoyale test banner%' AND scope_type='country'").forEach((r) => {
      const m = /\((\w\w) off\)$/.exec(r.name);
      if (m && !keep.has(m[1])) db.run('DELETE FROM ad_creatives WHERE id=?', r.id);
    });
    const bk = db.all('SELECT id,name FROM bookmakers').filter((x) => norm(x.name) === 'coinroyale')[0];
    if (bk) db.all("SELECT scope_value FROM bookmaker_geo WHERE bookmaker_id=? AND scope_type='country' AND mode='block'", bk.id).forEach((r) => {
      if (!keep.has(r.scope_value)) db.run("DELETE FROM bookmaker_geo WHERE bookmaker_id=? AND scope_type='country' AND scope_value=? AND mode='block'", bk.id, r.scope_value);
    });
    db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', crKey, String(CR_VERSION));
  }
  ORDER.forEach(([name, pos]) => {
    const key = 'preset_order_' + norm(name);
    if (Number((db.get('SELECT value v FROM settings WHERE key=?', key) || {}).v || 0) >= 1) return;
    const row = db.all('SELECT id,name FROM bookmakers').filter((x) => norm(x.name) === norm(name))[0];
    if (row) db.run('UPDATE bookmakers SET sort_order=? WHERE id=?', pos, row.id);
    db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', key, '1');
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
