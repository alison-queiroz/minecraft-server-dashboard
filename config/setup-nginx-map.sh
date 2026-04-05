#!/usr/bin/env bash
# setup-nginx-map.sh
# Injects a postMessage sender + SW unregistration script into the BlueMap
# nginx config via sub_filter, so the Angular dashboard can read the iframe
# URL cross-origin on all browsers (including Android Chrome).
# Target file (from nginx -T): /etc/nginx/conf.d/minecraft_map.conf
# Idempotent: removes any previous injection then re-injects fresh.

set -euo pipefail

BLUEMAP_CONF="/etc/nginx/conf.d/minecraft_map.conf"

if [ ! -f "$BLUEMAP_CONF" ]; then
  echo "[ERROR] BlueMap nginx config not found at $BLUEMAP_CONF" >&2
  exit 1
fi

echo "[INFO] Using BlueMap config: $BLUEMAP_CONF"

# ── Remove any previous injection (idempotent cleanup) ───────────────────────
if grep -q 'bluemap-url\|sub_filter_once\|sub_filter_types\|Accept-Encoding ""\|no-store.*revalidate\|Pragma.*no-cache' "$BLUEMAP_CONF" 2>/dev/null; then
  echo "[INFO] Removing previous injection directives..."
  sudo sed -i '/proxy_set_header Accept-Encoding "";/d' "$BLUEMAP_CONF"
  sudo sed -i '/sub_filter_once off;/d' "$BLUEMAP_CONF"
  sudo sed -i '/sub_filter_types text\/html;/d' "$BLUEMAP_CONF"
  sudo sed -i '/sub_filter.*bluemap-url/d' "$BLUEMAP_CONF"
  sudo sed -i '/add_header Cache-Control.*no-store/d' "$BLUEMAP_CONF"
  sudo sed -i '/add_header Pragma.*no-cache/d' "$BLUEMAP_CONF"
  echo "[INFO] Old directives removed."
fi

# ── Inject fresh sub_filter block ────────────────────────────────────────────
echo "[INFO] Injecting sub_filter postMessage + SW-unregister script..."
# Inserted after "proxy_pass http://127.0.0.1:8100;":
#   - Accept-Encoding "": disables gzip so sub_filter can parse the HTML body
#   - Cache-Control no-store: prevents Chrome (incl. Android) from caching the
#     page via HTTP cache or the BlueMap service worker's cache.put()
#   - sub_filter: replaces </body> with an inline <script> that:
#       1. Unregisters any BlueMap service worker (self-healing on first load)
#       2. Posts the iframe's current href to any parent window every second
#          ("*" target so it works from any dashboard origin/PWA mode)
sudo sed -i 's|proxy_pass http://127.0.0.1:8100;|proxy_pass http://127.0.0.1:8100;\n        proxy_set_header Accept-Encoding "";\n        add_header Cache-Control "no-cache, no-store, must-revalidate" always;\n        add_header Pragma "no-cache" always;\n        sub_filter_once off;\n        sub_filter_types text/html;\n        sub_filter '"'"'</body>'"'"' '"'"'<script>if("serviceWorker"in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(s){s.unregister()})})}setInterval(function(){try{window.parent.postMessage({type:"bluemap-url",href:location.href},"*")}catch(e){}},1000)</script></body>'"'"';|' "$BLUEMAP_CONF"
echo "[INFO] Injection added."

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
