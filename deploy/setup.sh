#!/usr/bin/env bash
# Installer for a Namecheap VPS (Pulsar / Quasar / Stellar, unmanaged, Ubuntu 22.04/24.04 or Debian 12).
# Run as root from the unzipped project folder:
#     sudo bash deploy/setup.sh yourdomain.com you@email.com
#
# Safe to run on a server that already hosts something else (e.g. the Pitchside forum): it adds its own nginx site,
# picks a free local port, never removes other sites, never resets the firewall. Re-running it upgrades the app and
# keeps your .env and database.
set -euo pipefail
DOMAIN="${1:-}"; EMAIL="${2:-}"
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
[ -n "$DOMAIN" ] || { echo "Usage: sudo bash deploy/setup.sh yourdomain.com you@email.com"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/livescorenow

# --- sanity checks -----------------------------------------------------------------------------------------------
. /etc/os-release 2>/dev/null || true
case "${ID:-}" in ubuntu|debian) ;; *) echo "This script supports Ubuntu/Debian only (found: ${PRETTY_NAME:-unknown}). On a cPanel/AlmaLinux VPS reinstall the OS as plain Ubuntu 22.04/24.04 from the Namecheap panel."; exit 1;; esac
# cPanel/Apache (or anything that isn't nginx) already on 80/443 would clash with nginx.
for p in 80 443; do
  holder="$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | sed 's/users:(("//; s/"//' || true)"
  if [ -n "$holder" ] && [ "$holder" != "nginx" ]; then echo "Port $p is used by '$holder'. Stop/disable it (or use a plain Ubuntu image without cPanel) and run again."; exit 1; fi
done
SERVER_IP="$(curl -4fsS --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
resolves_here() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | grep -qx "$SERVER_IP"; }
if ! resolves_here "$DOMAIN"; then echo "!! $DOMAIN does not point to this server ($SERVER_IP) yet. The site will install, but HTTPS will be skipped until DNS is fixed (rerun this script afterwards)."; DNS_OK=0; else DNS_OK=1; fi
NAMES="$DOMAIN"; CERT_NAMES=(-d "$DOMAIN")
if [[ "$DOMAIN" != www.* ]] && resolves_here "www.$DOMAIN"; then NAMES="$DOMAIN www.$DOMAIN"; CERT_NAMES+=(-d "www.$DOMAIN"); fi

echo "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx certbot python3-certbot-nginx rsync
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<13)){console.error("Need Node >= 22.13, have "+process.version);process.exit(1)}'

# --- small servers: add swap if there is none ---------------------------------------------------------------------
if [ "$(swapon --show --noheadings | wc -l)" = 0 ] && [ ! -f /swapfile ]; then
  echo "==> Adding 1 GB swap (safety net)"; fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab || true
fi

echo "==> Creating service user and installing app to $APP"
id lsn >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin lsn
mkdir -p "$APP"
rsync -a --delete --exclude '.env' --exclude 'data/' --exclude 'dist' --exclude '.git' --exclude 'node_modules' "$SRC"/ "$APP"/
mkdir -p "$APP/data" "$APP/backups"

# --- pick a free local port (the forum or another app may already use 3000) ---------------------------------------
if [ -f "$APP/.env" ] && grep -q '^PORT=' "$APP/.env"; then PORT="$(grep '^PORT=' "$APP/.env" | head -1 | cut -d= -f2 | tr -dc 0-9)"
else
  PORT=3100; while ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q .; do PORT=$((PORT+1)); done
fi
if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  sed -i "s|^ADMIN_PASS=.*|ADMIN_PASS=$PASS|; s|^SITE_URL=.*|SITE_URL=https://$DOMAIN|; s|^CONTACT_EMAIL=.*|CONTACT_EMAIL=hello@$DOMAIN|; s|^PORT=.*|PORT=$PORT|" "$APP/.env"
  echo "    Admin login created:  user=admin  password=$PASS   (saved in $APP/.env)"
fi
chown -R lsn:lsn "$APP/data" "$APP/backups"; chown root:lsn "$APP/.env"; chmod 640 "$APP/.env"

echo "==> Installing systemd service (app listens on 127.0.0.1:$PORT)"
cp "$APP/deploy/livescorenow.service" /etc/systemd/system/livescorenow.service
systemctl daemon-reload
systemctl enable livescorenow
systemctl restart livescorenow
sleep 3
systemctl is-active --quiet livescorenow && echo "    service is running" || { journalctl -u livescorenow -n 30 --no-pager; exit 1; }

echo "==> Configuring nginx for $NAMES (existing sites are left untouched)"
sed "s/SERVER_NAMES/$NAMES/g; s/APP_PORT/$PORT/g" "$APP/deploy/nginx.conf" > /etc/nginx/sites-available/livescorenow
ln -sf /etc/nginx/sites-available/livescorenow /etc/nginx/sites-enabled/livescorenow
nginx -t && systemctl reload nginx

# Firewall: only open ports if ufw is already active (never enable/reset it here)
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx Full' >/dev/null || true; ufw allow OpenSSH >/dev/null || true; fi

echo "==> Loading the visitor IP→country database (needed for region targeting)"
( cd "$APP" && runuser -u lsn -- node --disable-warning=ExperimentalWarning scripts/update-geoip.js ) || echo "    (geoip download failed — run it later:  cd $APP && runuser -u lsn -- node scripts/update-geoip.js)"
systemctl restart livescorenow

echo "==> Scheduling GeoIP refresh (monthly) and database backup (daily, keeps 14)"
echo "0 4 3 * * lsn cd $APP && /usr/bin/node --disable-warning=ExperimentalWarning scripts/update-geoip.js >/dev/null 2>&1 && systemctl restart livescorenow" > /etc/cron.d/livescorenow-geoip
echo "30 3 * * * lsn /usr/bin/node --disable-warning=ExperimentalWarning $APP/scripts/backup-db.js >/dev/null 2>&1" > /etc/cron.d/livescorenow-backup

if [ -n "$EMAIL" ] && [ "$DNS_OK" = 1 ]; then
  echo "==> Requesting HTTPS certificate"
  certbot --nginx "${CERT_NAMES[@]}" -m "$EMAIL" --agree-tos --no-eff-email --redirect -n || echo "    certbot failed — check DNS, then run:  certbot --nginx ${CERT_NAMES[*]}"
elif [ -n "$EMAIL" ]; then echo "==> Skipping HTTPS (DNS not pointing here yet). After fixing DNS run:  certbot --nginx ${CERT_NAMES[*]} -m $EMAIL --agree-tos --redirect"; fi
echo
echo "Done. Open https://$DOMAIN  and  https://$DOMAIN/admin  (login is in $APP/.env)."
echo "Right now DATA_PROVIDER=mock (demo data). Edit $APP/.env, set DATA_PROVIDER=apifootball and API_FOOTBALL_KEY, then: systemctl restart livescorenow"
