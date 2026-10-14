#!/usr/bin/env bash
# Upgrade an existing install from a newly unzipped copy:  sudo bash deploy/update.sh
# Keeps .env, the database and backups; restarts the service.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"; APP=/opt/livescorenow
[ -d "$APP" ] || { echo "$APP not found — run deploy/setup.sh first."; exit 1; }
rsync -a --delete --exclude '.env' --exclude 'data/' --exclude 'backups/' --exclude 'dist' --exclude '.git' --exclude 'node_modules' "$SRC"/ "$APP"/
PORT="$(grep '^PORT=' "$APP/.env" | head -1 | cut -d= -f2 | tr -dc 0-9)"
cp "$APP/deploy/livescorenow.service" /etc/systemd/system/livescorenow.service && systemctl daemon-reload
chown root:lsn "$APP/.env"; systemctl restart livescorenow; sleep 3
curl -fsS "http://127.0.0.1:${PORT:-3000}/" -o /dev/null && echo "Updated and healthy." || { journalctl -u livescorenow -n 30 --no-pager; exit 1; }
