'use strict';
// server/geo/resolve.js — works out which country a visitor is in.
//
// Order of precedence:
//   1. ?cc=GH            explicit override in the URL (testing / shareable "view as" links)
//   2. lsn_cc cookie     the visitor picked a country in the selector
//   3. CDN/proxy header  CF-IPCountry (Cloudflare), CloudFront-Viewer-Country, X-Vercel-IP-Country, X-Country-Code
//                        — ONLY when TRUST_PROXY=true, otherwise anyone could spoof them
//   4. IP lookup         self-hosted DB-IP table (see geoip.js)
//   5. DEFAULT_COUNTRY   from .env (may be empty -> unknown)
// An unknown country is 'ZZ': only bookmakers with a worldwide ("all") rule can appear.
const { isValid } = require('./countries');
const { parseCookies, clientIp } = require('../lib/http');

function clean(code) {
  code = String(code || '').trim().toUpperCase();
  if (code === 'UK') code = 'GB';
  return /^[A-Z]{2}$/.test(code) && isValid(code) ? code : '';
}

function resolveCountry(req, url, cfg, geoip) {
  // ?cc=XX lets you preview any region. It is disabled in production unless ALLOW_CC_QUERY=true (visitors could abuse it
  // to see offers meant for other countries). The visitor-facing country picker uses a cookie instead.
  const q = cfg.allowCcQuery === false ? '' : clean(url && url.searchParams && url.searchParams.get('cc'));
  if (q) return { code: q, source: 'query' };

  const ck = clean(parseCookies(req).lsn_cc);
  if (ck) return { code: ck, source: 'cookie' };

  if (cfg.trustProxy) {
    const h = req.headers;
    const hv = clean(h['cf-ipcountry'] || h['cloudfront-viewer-country'] || h['x-vercel-ip-country'] || h['x-country-code']);
    if (hv) return { code: hv, source: 'header' };
  }

  const ip = clientIp(req, cfg.trustProxy);
  const g = geoip && geoip.lookup(ip);
  if (g && clean(g)) return { code: clean(g), source: 'ip' };

  if (cfg.defaultCountry && clean(cfg.defaultCountry)) return { code: clean(cfg.defaultCountry), source: 'default' };
  return { code: 'ZZ', source: 'unknown' };
}

module.exports = { resolveCountry, clean };
