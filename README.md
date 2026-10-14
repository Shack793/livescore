# LiveScoreNow

Live at **https://livescorenow.xyz** (sister site: https://www.pitchsideforum.com).

A Flashscore-style live-scores site (no news) built to earn from **banner ads and betting affiliate links**.

* Live scores, fixtures, results, standings, team pages, match pages (events, stats, line-ups, H2H, odds), search, favourites ("My teams"), pinned leagues, light/dark mode, odds format (decimal / fractional / American), time-zone setting. 9 sports.
* Teams, leagues and countries are **imported automatically** from the data provider. Nothing is entered by hand.
* **Bookmakers are shown per visitor country/region.** A visitor in Ghana sees different bookmakers (and different affiliate links and offers) from one in the UK, Germany or the US — and in countries where you switch betting content off, they see no betting content at all.
* **Follow teams with no account:** ☆ on any match or team page; your list lives in the browser, shows in the left menu and on *My teams*, can be opened on another device with a copy-link (no login), and optional alerts (goal, kick-off, half-time, full-time) pop up while the site is open. The site is installable to the phone home screen.
* Live odds and scores are pushed to the page in real time (Server-Sent Events), no refresh needed.
* No user accounts. Admin panel for bookmakers, region rules, compliance text, ad slots, leagues, and affiliate-click reports.
* **Zero npm dependencies.** Needs only Node.js ≥ 22.13 (uses the built-in SQLite). Nothing to compile.

```
npm test               # 69 automated tests
npm start              # http://localhost:3000   (demo data, no key needed)
```

---

## 1. Try it in 2 minutes

```bash
cp .env.example .env          # leave DATA_PROVIDER=mock for now
# set ADMIN_PASS in .env to enable /admin
npm start
```
Open http://localhost:3000. With `ALLOW_CC_QUERY=true` (or `NODE_ENV=development`) you can append `?cc=GH`, `?cc=GB`, `?cc=US`… to see exactly what visitors from that country get.

`dist/index.html` (also delivered separately) is a **single-file version for Netlify** — drag it onto https://app.netlify.com/drop. It runs the same page code with simulated data and has a "viewing as" country switcher in the corner.

## 2. Put it on your Namecheap Quasar VPS

Works on any Namecheap unmanaged VPS (Pulsar, Quasar, Stellar) running **plain Ubuntu 22.04/24.04 or Debian 12**. If your VPS came with cPanel/AlmaLinux, reinstall the OS as plain Ubuntu from the Namecheap VPS panel first (the script detects Apache/cPanel on ports 80/443 and stops rather than breaking anything).

1. **DNS:** in Namecheap *Domain List → Manage → Advanced DNS*, add an **A record** `@` → your VPS IP, and `www` → the same IP. (Using a subdomain such as `scores.yourdomain.com`? Add an A record for `scores` and pass that name to the script.) Wait a few minutes for it to resolve.
2. **Upload** the zip to the VPS (`scp livescorenow.zip root@YOUR_IP:/root/`), then:
   ```bash
   ssh root@YOUR_IP
   apt-get update && apt-get install -y unzip
   unzip livescorenow.zip && cd livescorenow
   sudo bash deploy/setup.sh yourdomain.com you@email.com
   ```
3. Visit `https://yourdomain.com` and `https://yourdomain.com/admin` (the admin password is printed once and stored in `/opt/livescorenow/.env`).

What the script does: installs Node 22 + nginx + certbot, creates a service user, installs to `/opt/livescorenow`, adds 1 GB swap if the server has none, picks a **free local port** (starting at 3100) so it does not clash with other apps, adds its own nginx site (SSE buffering off), loads the IP→country database, schedules its monthly refresh and a **daily database backup** (`/opt/livescorenow/backups`, newest 14 kept), and requests an HTTPS certificate once DNS points at the server.

**Sharing the VPS with the Pitchside forum:** fine. Each site gets its own nginx `server` block and domain, and its own local port; the script never removes other nginx sites and never touches the firewall rules (it only opens 80/443 if `ufw` is already on). Give Pitchside a different local port than LiveScoreNow's (see `PORT` in `/opt/livescorenow/.env`). Two Node apps plus nginx fit comfortably on a Quasar.

Day-to-day:
- Logs: `journalctl -u livescorenow -f` · Restart: `systemctl restart livescorenow` · Config: `/opt/livescorenow/.env`
- **Update to a new version:** unzip the new zip on the server, then `sudo bash deploy/update.sh` (keeps your `.env`, database and backups).
- Restore a backup: stop the service, copy a file from `/opt/livescorenow/backups/` over `/opt/livescorenow/data/livescorenow.db`, start the service.
- Namecheap has no extra firewall in front of an unmanaged VPS, so keep `ufw` on with only SSH, 80 and 443 open.

> The scripts were syntax-checked but **have not been run on a real Quasar server** (none available here). Read `deploy/setup.sh` once — it is short — and run it on the server; send me any error text and I will fix it.

## 3. Real scores and odds

Set in `.env`:
```
DATA_PROVIDER=apifootball
API_FOOTBALL_KEY=your-key
```
then `npm run provider:check` (read-only) and `systemctl restart livescorenow`. Switching from `mock` automatically deletes the simulated teams/matches **and the demo bookmakers** so nothing fake stays on a live site; bookmakers you added yourself are kept.

**Read these caveats:**

* The API-Football adapter (`server/providers/apifootball.js`) was written from the public v3 documentation and **has not been run against a live key**. `npm run provider:check` shows what each endpoint returns so you can confirm it maps correctly; all field mapping is in that one file.
* **Live (in-play) odds per bookmaker** depend on your API plan and on what the provider returns; if live odds arrive without a bookmaker name, they cannot be matched to your affiliate partners. Pre-match odds per bookmaker are the safe path. Verify with `provider:check` and a plan that includes odds.
* **Only football has a real adapter.** Basketball, tennis, hockey, etc. run on demo data only. For real data in those sports add a provider module (the contract is documented at the top of `server/providers/index.js`; about 150 lines per feed) — or set `SPORTS=football` in `.env` and the other tabs will simply be empty.
* **API quota.** Defaults poll live scores every 20s and live odds every 30s. Raise `LIVE_INTERVAL_SEC` etc. if your plan has a low daily limit; the admin dashboard shows each job's last run and errors.
* Pull odds **from the same feed for all visitors** and let the region rules decide who sees which bookmaker. If a bookmaker gives you its own odds/affiliate feed, write a small provider that returns `{matchRef, bookmaker, market, selection, value}` rows (see the contract) — nothing else in the site needs to change.

## 4. Region targeting (the part that earns)

**Detecting the visitor's country** (first match wins): `?cc=` (only if `ALLOW_CC_QUERY=true`) → the country they picked in the flag menu (cookie) → CDN header `CF-IPCountry` (Cloudflare) when `TRUST_PROXY=true` → the self-hosted DB-IP database (`npm run geoip:update`, monthly, free, CC-BY: the footer carries the attribution) → `DEFAULT_COUNTRY` → unknown (`ZZ`).

**Which bookmakers appear** — Admin → *Bookmakers & regions*. Every bookmaker has rules:

| Rule | Meaning |
|---|---|
| Country `GH` — Show | visible in Ghana |
| Region `WEST_AFRICA` — Show | visible in every country in that group (edit groups under *Region groups*) |
| Everywhere — Show | visible worldwide |
| Country `GB` — **Hide** | never shown in the UK, even if a region rule shows it |

The **most specific rule wins** (country › region › everywhere); at the same level **Hide beats Show**; a bookmaker with **no matching rule is hidden** (safe default). Each rule can also override the **affiliate link**, **offer text**, **licence text** and **priority** for that scope (e.g. a different tracking link for Nigeria). Use *Test a region* on that page to see exactly what a country gets.

**Odds follow the same rules.** Each bookmaker is mapped to its feed's name ("Odds feed bookmaker"). The list shows the first visible bookmaker's 1X2/winner price; the match page compares all visible ones and highlights the best price. Live updates are filtered per country on the server — a visitor is never sent a price from a bookmaker they may not see.

**Affiliate links** never appear in page HTML. Buttons point to `/go/<id>`, which re-checks the visitor's country, fills `{subid}` `{country}` `{match}` `{placement}` into your tracking URL, logs the click (country, placement, match — **no IP address**) and redirects. A bookmaker not permitted in the visitor's country just redirects home. Click reports are on the admin dashboard.

**Country compliance** — Admin → *Country compliance*: per country set the minimum age, responsible-gambling text/link, licence text, and **"Hide ALL betting content"** (no odds, no bookmakers, no betting ads). The demo seeds the US, India and UAE as *hidden* — **you must decide this for every country you serve; the defaults are placeholders, not legal advice.**

## 5. Ads

Admin → *Ad slots*: leaderboard, two sidebar boxes, left skyscraper, in-feed (after the 3rd competition), match-page strip, mobile sticky. For each: paste any ad-network tag (AdSense, Ad Manager, a plain `<a><img>` banner…), restrict by country (include/exclude), mark **betting-related** (auto-hidden where betting is off), and set fallback code. Slots with **no code** show a built-in geo-targeted bookmaker banner (each bookmaker used at most once per page). Ads load lazily and are injected so third-party `<script>` tags execute.

**Consent:** visitors in the EEA, UK and Switzerland get a consent banner and third-party ad code does not run until they accept. This is a simple placeholder — **it is not a certified CMP**. If you serve those regions with programmatic ads (AdSense etc.) you will need a Google-certified consent platform; Google requires one.

## 6. Before you go live — checklist

- [ ] Replace the 5 demo bookmakers with your real partners (Admin → Bookmakers). Demo links point to `example.com`.
- [ ] Put your real tracking URLs, offers and licence text per country.
- [ ] Review **every** country: allow or hide betting content. Betting advertising is illegal or restricted in many places, and many jurisdictions require licence numbers, age warnings and specific responsible-gambling wording in the ad itself.
- [ ] Have a lawyer review `/terms/`, `/privacy/`, `/cookies/` (they are templates) and your affiliate agreements.
- [ ] Check your data provider's terms allow public display and commercial use, and that attribution/logo rules are followed.
- [ ] Choose an ad network that accepts betting/affiliate content for your traffic.
- [ ] Keep `ADMIN_PASS` long and unique; consider restricting `/admin` by IP (commented example in `deploy/nginx.conf`).
- [ ] Back up `data/livescorenow.db` (it holds your bookmakers, rules and click log).

## 7. Project map

```
server/index.js            boots everything          server/app.js     routes, /go redirect, sitemap
server/admin.js            admin API                 server/seed.js    first-run data
server/services/sync.js    provider → SQLite jobs    server/services/hub.js   live push (SSE), per-country odds
server/providers/          mock.js, apifootball.js   + the contract to add more feeds (index.js)
server/geo/                countries/regions, DB-IP lookup, country resolution
shared/                    code that runs on server AND browser: pages.js, views.js, bookmakers.js (region rules),
                           odds.js, util.js, mock-world.js (demo engine), store-memory.js (preview store)
public/assets/             app.js (progressive enhancement), style.css       public/admin/   admin UI
scripts/                   update-geoip.js, provider-check.js, build-preview.js
deploy/                    setup.sh, update.sh, nginx.conf, livescorenow.service      tests/   69 tests
```
Pages are rendered on the server (good for SEO and every page view is an ad impression); JavaScript only adds live updates, favourites, filters and settings, and the pages work without it.

## 8. Not included / known gaps

* No news feed (by request), no user accounts, no background push notifications (alerts work while the site is open in a tab; true push when the site is closed can be added later without accounts, using Web Push), no player pages, no FIFA/ranking tables, no multi-language UI.
* The real adapter supplies standings for football leagues only (cup groups/knockouts are not modelled).
* Only football has a real-data adapter; other sports are demo-only until you add feeds.
* Odds are indicative only and the site is not a bookmaker; show the bookmaker's own terms.

## Linking with Pitchside Forum

Set `FORUM_URL` (and optionally `FORUM_NAME`, `FORUM_MATCH_URL`) in `.env`. LiveScoreNow then shows a forum tab in the sport bar, a box in the left menu, a footer link, and a "Discuss this match" link on every match page. The default deep link is `FORUM_URL/search?q={query}`; change it with `FORUM_MATCH_URL` (placeholders `{query} {home} {away} {league}`).

**Forum → LiveScoreNow:** add a nav link to `https://livescorenow.example/`, and embed live scores:

```html
<iframe src="https://livescorenow.example/embed/live/?limit=10&theme=light"
        width="100%" height="520" style="border:0" loading="lazy"></iframe>
```

Embed params: `/embed/live/` or `/embed/<sport>/`; `limit` (1-60, default 15), `theme` (light|dark), `odds=1` to show bookmaker odds (off by default; embeds carry no ads). Add other embedding sites via `EMBED_ORIGINS`.

Clicking any match row opens the match page in a new tab.
