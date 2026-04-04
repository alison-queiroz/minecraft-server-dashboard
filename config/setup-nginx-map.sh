#!/usr/bin/env bash
# setup-nginx-map.sh
# Injects a postMessage sender script into the BlueMap nginx config via
# sub_filter, so the Angular dashboard can read the iframe URL cross-origin.
# Target file (from nginx -T output): /etc/nginx/conf.d/minecraft_map.conf
# Safe to run multiple times (idempotent).

set -euo pipefail

BLUEMAP_CONF="/etc/nginx/conf.d/minecraft_map.conf"
DASHBOARD_APP_ORIGIN="https://exvegan-minecraft-server.duckdns.org"

if [ ! -f "$BLUEMAP_CONF" ]; then
  echo "[ERROR] BlueMap nginx config not found at $BLUEMAP_CONF" >&2
  exit 1
fi

echo "[INFO] Using BlueMap config: $BLUEMAP_CONF"

if grep -q 'bluemap-url' "$BLUEMAP_CONF"; then
  echo "[INFO] postMessage injection already present — nothing to do."
else
  echo "[INFO] Injecting sub_filter postMessage script..."
  # Insert sub_filter directives after "proxy_pass http://127.0.0.1:8100;"
  # sub_filter replaces </body> with the script + </body> in every HTML response.
  # proxy_set_header Accept-Encoding "" ensures upstream sends uncompressed HTML
  # so sub_filter can parse it (sub_filter does not work on gzipped bodies).
  sudo sed -i 's|proxy_pass http://127.0.0.1:8100;|proxy_pass http://127.0.0.1:8100;\n        proxy_set_header Accept-Encoding "";\n        sub_filter_once off;\n        sub_filter_types text/html;\n        sub_filter '"'"'</body>'"'"' '"'"'<script>setInterval(function(){try{window.parent.postMessage({type:"bluemap-url",href:location.href},"'"${DASHBOARD_APP_ORIGIN}"'")}catch(e){}},1000)</script></body>'"'"';|' "$BLUEMAP_CONF"
  echo "[INFO] postMessage injection added."
fi

# ── Test & reload ─────────────────────────────────────────────────────────────
echo "[INFO] Testing nginx configuration..."
if sudo nginx -t 2>/dev/null; then
  sudo systemctl reload nginx
  echo "[SUCCESS] nginx reloaded."
else
  echo "[ERROR] nginx config test failed." >&2
  sudo nginx -t
  exit 1
fi

set -euo pipefail

DASHBOARD_DOMAIN="exvegan-minecraft-server.duckdns.org"
BLUEMAP_DOMAIN="exvegan-minecraft-map.duckdns.org"
DASHBOARD_APP_ORIGIN="https://${DASHBOARD_DOMAIN}"

# ── Helper: find nginx config containing a keyword ───────────────────────────
find_conf() {
  local keyword="$1"
  for f in \
    /etc/nginx/sites-enabled/default \
    /etc/nginx/sites-enabled/exvegan-dashboard \
    /etc/nginx/sites-enabled/dashboard \
    /etc/nginx/sites-enabled/exvegan-map \
    /etc/nginx/sites-enabled/bluemap \
    /etc/nginx/conf.d/default.conf \
    /etc/nginx/conf.d/principal.conf \
    /etc/nginx/conf.d/dashboard.conf \
    /etc/nginx/conf.d/map.conf; do
    if [ -f "$f" ] && grep -qiE "$keyword" "$f" 2>/dev/null; then
      echo "$f"; return 0
    fi
  done
  # Fallback: scan all
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -f "$f" ] && grep -qiE "$keyword" "$f" 2>/dev/null && echo "$f" && return 0
  done
  return 1
}

# ── 1. Remove /map/ proxy from dashboard config ───────────────────────────────
echo "[INFO] Looking for dashboard nginx config..."
DASH_CONF=$(find_conf "${DASHBOARD_DOMAIN}|var/www/dashboard") || true
if [ -n "$DASH_CONF" ]; then
  echo "[INFO] Dashboard config: $DASH_CONF"
  if grep -q 'location.*\/map' "$DASH_CONF"; then
    echo "[INFO] Removing /map/ proxy block from dashboard config..."
    sudo sed -i '/location[[:space:]]*\(\^~[[:space:]]*\)\?\/map\//,/^[[:space:]]*}/d' "$DASH_CONF"
    sudo sed -i '/location = \/map\/maps\/world\/live\/players\.json/,/^[[:space:]]*}/d' "$DASH_CONF"
    echo "[INFO] Removed /map/ proxy blocks."
  else
    echo "[INFO] No /map/ proxy block in dashboard config — nothing to remove."
  fi
else
  echo "[WARN] Dashboard nginx config not found — skipping step 1."
fi

# ── 2. Inject postMessage in BlueMap nginx config ─────────────────────────────
echo "[INFO] Looking for BlueMap nginx config..."
BLUEMAP_CONF=$(find_conf "${BLUEMAP_DOMAIN}|bluemap|25565") || true
if [ -z "$BLUEMAP_CONF" ]; then
  echo "[WARN] BlueMap nginx config not found. Skipping postMessage injection."
  echo "[INFO] To enable Capture Position, add the following to your BlueMap nginx location block:"
  echo "    sub_filter_once off;"
  echo "    sub_filter '</body>' '<script>setInterval(function(){try{window.parent.postMessage({type:\"bluemap-url\",href:location.href},\"${DASHBOARD_APP_ORIGIN}\")}catch(e){}},1000)</script></body>';"
else
  echo "[INFO] BlueMap config: $BLUEMAP_CONF"
  if grep -q 'bluemap-url' "$BLUEMAP_CONF"; then
    echo "[INFO] postMessage injection already present — nothing to add."
  else
    echo "[INFO] Injecting postMessage script via sub_filter..."
    # The injected script posts the iframe's current href to the dashboard every second
    SCRIPT="<script>setInterval(function(){try{window.parent.postMessage({type:\"bluemap-url\",href:location.href},\"${DASHBOARD_APP_ORIGIN}\")}catch(e){}},1000)<\/script>"
    # Add sub_filter directives inside the first location / { block in the BlueMap config
    sudo sed -i "s|location \/ {|location / {\n        sub_filter_once off;\n        sub_filter '</body>' '${SCRIPT}</body>';|" "$BLUEMAP_CONF"
    echo "[INFO] postMessage injection added."
  fi
fi

# ── Test & reload ─────────────────────────────────────────────────────────────
echo "[INFO] Testing nginx configuration..."
if sudo nginx -t 2>/dev/null; then
  sudo systemctl reload nginx
  echo "[SUCCESS] nginx reloaded."
else
  echo "[ERROR] nginx config test failed. Rolling back..." >&2
  sudo nginx -t
  exit 1
fi

set -euo pipefail

MAP_UPSTREAM="https://exvegan-minecraft-map.duckdns.org"

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
  echo "[ERROR] Could not locate nginx site config."
  exit 1
fi

echo "[INFO] Using nginx config: $SITE_CONF"

# ── Ensure /map/ proxy block is present ──────────────────────────────────────
if grep -q 'location.*\/map' "$SITE_CONF"; then
  echo "[INFO] /map/ proxy block already present — nothing to add."
else
  echo "[INFO] Inserting /map/ proxy block..."
  # Insert before the closing } of the server block
  sudo sed -i "s|^\(}[[:space:]]*$\)|    location ^~ /map/ {\n        proxy_pass ${MAP_UPSTREAM}/;\n        proxy_set_header Host exvegan-minecraft-map.duckdns.org;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade \$http_upgrade;\n        proxy_set_header Connection \"upgrade\";\n        proxy_read_timeout 300s;\n        proxy_buffering off;\n    }\n\1|" "$SITE_CONF"
  echo "[INFO] Proxy block inserted."
fi

# ── Test & reload ─────────────────────────────────────────────────────────────
if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "[SUCCESS] nginx reloaded."
else
  echo "[ERROR] nginx config test failed." >&2
  exit 1
fi

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
