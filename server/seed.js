'use strict';
// server/seed.js — idempotent first-run seeding (sports, regions, demo bookmakers/rules/ad slots).
const countries = require('./geo/countries');
const seed = require('../shared/seed-data');
const mockData = require('../shared/mock-data');

function run(db, opts) {
  opts = opts || {};
  db.tx(() => {
    mockData.SPORTS.forEach((s, i) => db.run('INSERT INTO sports (id,name,icon,sort_order) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order', s.id, s.name, s.icon, i));
    countries.REGIONS.forEach((r) => db.run('INSERT OR IGNORE INTO regions (code,name,countries) VALUES (?,?,?)', r.code, r.name, r.countries.join(',')));
    seed.countryRules.forEach((c) => db.run('INSERT OR IGNORE INTO country_rules (country_code,betting_content,min_age,rg_text,rg_url,license_text) VALUES (?,?,?,?,?,?)', c.country_code, c.betting_content, c.min_age, c.rg_text, c.rg_url, c.license_text));
    seed.adSlots.forEach((a) => db.run('INSERT OR IGNORE INTO ad_slots (slot_key,label,placement,width,height,betting_related,sort_order) VALUES (?,?,?,?,?,?,?)', a.slot_key, a.label, a.placement, a.width, a.height, a.betting_related, a.sort_order));
    const hasBk = db.get('SELECT COUNT(*) n FROM bookmakers').n;
    if (!hasBk && opts.demoBookmakers !== false) {
      seed.bookmakers.forEach((b) => db.run('INSERT INTO bookmakers (id,name,short_code,color,provider_ref,affiliate_url,offer,terms_url,license_text,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)',
        b.id, b.name, b.short_code, b.color, b.provider_ref, b.affiliate_url, b.offer, b.terms_url, b.license_text, b.sort_order));
      seed.rules.forEach((r) => db.run('INSERT INTO bookmaker_geo (bookmaker_id,scope_type,scope_value,mode,affiliate_url,offer,license_text,sort_order) VALUES (?,?,?,?,?,?,?,?)',
        r.bookmaker_id, r.scope_type, r.scope_value, r.mode, r.affiliate_url || null, r.offer || null, r.license_text || null, r.sort_order == null ? null : r.sort_order));
    }
    if (!db.get('SELECT COUNT(*) n FROM ad_creatives').n && opts.demoBookmakers !== false && (seed.adCreatives || []).length) {
      seed.adCreatives.forEach((a) => db.run('INSERT INTO ad_creatives (slot_key,name,scope_type,scope_value,mode,ad_code) VALUES (?,?,?,?,?,?)', a.slot_key, a.name, a.scope_type, a.scope_value, a.mode || 'show', a.ad_code || ''));
    }
    [['odds_format', 'decimal'], ['site_tagline', 'Live scores, fixtures & odds'], ['footer_note', '']].forEach((kv) => db.run('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)', kv[0], kv[1]));
  });
}
module.exports = { run };
