'use strict';
// server/lib/http.js — small, dependency-free HTTP toolkit.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
  // No CSP on purpose: ad networks inject scripts from many origins. Add one once your ad stack is final.
};

function compressible(type) { return /text|javascript|json|xml|svg/.test(type || ''); }

const compCache = new Map();
function encode(buf, ae, key) {
  let enc = null;
  if (/\bbr\b/.test(ae)) enc = 'br'; else if (/\bgzip\b/.test(ae)) enc = 'gzip';
  if (!enc) return { buf, enc: null };
  const ck = key ? key + '|' + enc : null;
  if (ck && compCache.has(ck)) return { buf: compCache.get(ck), enc };
  const out = enc === 'br'
    ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
    : zlib.gzipSync(buf, { level: 6 });
  if (ck) { if (compCache.size > 400) compCache.clear(); compCache.set(ck, out); }
  return { buf: out, enc };
}

function send(req, res, status, body, headers, cacheKey) {
  const h = Object.assign({}, SECURITY_HEADERS, headers || {});
  Object.keys(h).forEach((k) => { if (h[k] === null) delete h[k]; }); // pass null to drop a default header (used by /embed)
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? '' : String(body));
  if (buf.length > 1024 && compressible(h['Content-Type'])) {
    const r = encode(buf, (req && req.headers['accept-encoding']) || '', cacheKey);
    buf = r.buf;
    if (r.enc) h['Content-Encoding'] = r.enc;
    h['Vary'] = h['Vary'] ? h['Vary'] + ', Accept-Encoding' : 'Accept-Encoding';
  }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  res.end(req && req.method === 'HEAD' ? undefined : buf);
}

function json(req, res, status, obj, headers) {
  send(req, res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
}
function html(req, res, status, body, headers) {
  send(req, res, status, body, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache' }, headers));
}
function redirect(res, location, status, headers) {
  res.writeHead(status || 302, Object.assign({}, SECURITY_HEADERS, { Location: location, 'Cache-Control': 'no-store' }, headers || {}));
  res.end();
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { out[k] = p.slice(i + 1).trim(); }
  });
  return out;
}
function cookie(name, value, o) {
  o = o || {};
  let s = name + '=' + encodeURIComponent(value) + '; Path=' + (o.path || '/');
  if (o.maxAge != null) s += '; Max-Age=' + o.maxAge;
  s += '; SameSite=Lax';
  if (o.secure) s += '; Secure';
  if (o.httpOnly) s += '; HttpOnly';
  return s;
}

function readBody(req, limit) {
  limit = limit || 256 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function clientIp(req, trustProxy) {
  let ip = '';
  if (trustProxy) {
    ip = String(req.headers['cf-connecting-ip'] || '').trim()
      || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || String(req.headers['x-real-ip'] || '').trim();
  }
  if (!ip) ip = (req.socket && req.socket.remoteAddress) || '';
  return ip.replace(/^::ffff:/, '');
}

/* ---------- static files ---------- */
function serveStatic(req, res, root, relPath, opts) {
  opts = opts || {};
  let p;
  try { p = decodeURIComponent(relPath); } catch (e) { return false; }
  if (p.includes('\0')) return false;
  const full = path.normalize(path.join(root, p));
  if (full !== root && !full.startsWith(root + path.sep)) return false;
  let st;
  try { st = fs.statSync(full); } catch (e) { return false; }
  if (st.isDirectory()) return false;
  const ext = path.extname(full).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
  const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': opts.cache || 'public, max-age=300' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, Object.assign({}, SECURITY_HEADERS, headers)); res.end(); return true; }
  send(req, res, 200, fs.readFileSync(full), headers, full + '|' + etag);
  return true;
}

/* ---------- rate limiting ---------- */
function makeLimiter(max, windowMs) {
  const hits = new Map();
  const timer = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, Math.max(windowMs, 10000));
  if (timer.unref) timer.unref();
  return function check(key) {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    e.n++;
    return { ok: e.n <= max, remaining: Math.max(0, max - e.n), retry: Math.ceil((e.reset - now) / 1000) };
  };
}

/* ---------- TTL cache ---------- */
function makeCache(maxEntries) {
  const m = new Map();
  return {
    get(k) { const e = m.get(k); if (!e) return undefined; if (e.exp <= Date.now()) { m.delete(k); return undefined; } return e.v; },
    set(k, v, ttlMs) { if (m.size >= (maxEntries || 500)) { const first = m.keys().next().value; m.delete(first); } m.set(k, { v, exp: Date.now() + ttlMs }); },
    clear() { m.clear(); }
  };
}

/* ---------- basic auth ---------- */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function parseBasic(req) {
  const h = req.headers.authorization || '';
  if (!/^Basic /i.test(h)) return null;
  const raw = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = raw.indexOf(':');
  if (i < 0) return null;
  return { user: raw.slice(0, i), pass: raw.slice(i + 1) };
}

module.exports = { MIME, SECURITY_HEADERS, send, json, html, redirect, parseCookies, cookie, readBody, readJson, clientIp, serveStatic, makeLimiter, makeCache, safeEqual, parseBasic };
