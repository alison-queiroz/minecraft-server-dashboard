#!/usr/bin/env bash
# setup-nginx-map.sh
# Removes legacy /map/ -> Bluemap reverse-proxy blocks from the nginx config.
# The map is now served via the dedicated subdomain (exvegan-minecraft-map.duckdns.org)
# so the same-origin proxy is no longer needed and causes F5-refresh issues.
# Safe to run multiple times.

set -euo pipefail

# ── Find the active nginx config for this site ──────────────────────────────
SITE_CONF=""
for f in \
  /etc/nginx/sites-enabled/default \
  /etc/nginx/sites-enabled/exvegan-dashboard \
  /etc/nginx/sites-enabled/dashboard \
  /etc/nginx/conf.d/default.conf \
  /etc/nginx/conf.d/principal.conf \
  /etc/nginx/conf.d/dashboard.conf; do
  if [ -f "$f" ] && grep -qE 'var/www/dashboard|exvegan-minecraft-server' "$f"; then
    SITE_CONF="$f"
    break
  fi
done

if [ -z "$SITE_CONF" ]; then
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -f "$f" ] && SITE_CONF="$f" && break
  done
fi

if [ -z "$SITE_CONF" ]; then
  echo "[INFO] Could not locate nginx site config — nothing to do."
  exit 0
fi

echo "[INFO] Using nginx config: $SITE_CONF"

# ── Remove /map/ proxy block if present ──────────────────────────────────────
if grep -q 'location.*\/map' "$SITE_CONF"; then
  echo "[INFO] Removing legacy /map/ proxy blocks..."
  # Remove 'location = /map/...json' block
  sudo sed -i '/location = \/map\/maps\/world\/live\/players\.json/,/^[[:space:]]*}/d' "$SITE_CONF"
  # Remove 'location ^~ /map/' or 'location /map/' block
  sudo sed -i '/location[[:space:]]*\(\^~[[:space:]]*\)\?\/map\//,/^[[:space:]]*}/d' "$SITE_CONF"
  echo "[INFO] Removed /map/ proxy blocks."
else
  echo "[INFO] No /map/ proxy blocks found — nothing to remove."
fi

# ── Test & reload ─────────────────────────────────────────────────────────────
if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "[SUCCESS] nginx reloaded."
else
  echo "[ERROR] nginx config test failed after edit." >&2
  exit 1
fi
  exit 1
fi
