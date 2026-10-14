'use strict';
// scripts/build-preview.js — builds dist/index.html: ONE self-contained file (HTML+CSS+JS+demo data engine) that you can
// drag onto Netlify Drop to preview the whole site. It runs the same page code as the server, in the browser.
const fs = require('fs');
const path = require('path');
const countries = require('../server/geo/countries');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const order = ['shared/util.js', 'shared/odds.js', 'shared/bookmakers.js', 'shared/mock-data.js', 'shared/mock-world.js', 'shared/seed-data.js', 'shared/views.js', 'shared/pages.js', 'shared/store-memory.js'];
const data = { iso: countries.ISO, regions: countries.REGIONS.map((r) => ({ code: r.code, name: r.name, countries: r.countries })), consent: countries.CONSENT_COUNTRIES };
let js = order.map((f) => '/* ' + f + ' */\n' + read(f)).join('\n') + '\nwindow.LSN_PREVIEW_DATA=' + JSON.stringify(data) + ';\n' + read('public/assets/app.js') + '\n' + read('preview/runtime.js');
if (/\/assets\/|require\(/.test(js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/typeof require[^;]*/g, ''))) { /* informational only */ }
js = js.replace(/<\/script/gi, '<\\/script');
const css = read('public/assets/style.css') + `
#pvRegion{position:fixed;left:10px;bottom:10px;z-index:95;background:#0b1f33;color:#fff;border-radius:12px;padding:8px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;box-shadow:0 8px 28px rgba(0,0,0,.35);max-width:calc(100vw - 20px);font-size:12px}
#pvRegion button{border:0;background:rgba(255,255,255,.14);color:#fff;border-radius:6px;padding:4px 8px;font-weight:700}#pvRegion button.on{background:#18c37e;color:#04261a}#pvRegion small{opacity:.7;flex-basis:100%}
@media (max-width:820px){#pvRegion{bottom:64px}}
#pvModal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:120;display:flex;align-items:center;justify-content:center;padding:16px}.pvbox{background:var(--card);color:var(--ink);border-radius:12px;padding:18px;max-width:560px;width:100%}.pvbox code{word-break:break-all;background:var(--odd-bg);padding:2px 5px;border-radius:4px;display:block}
`;
const fav = 'data:image/svg+xml,' + encodeURIComponent(read('public/assets/favicon.svg'));
const html = '<!doctype html><html lang="en" class="js" data-theme="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LiveScoreNow – preview</title><meta name="robots" content="noindex"><link rel="icon" href="' + fav + '"><style>' + css + '</style></head><body><div id="root"></div><script>' + js + '</script></body></html>';
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log('dist/index.html written (' + Math.round(html.length / 1024) + ' KB)');
