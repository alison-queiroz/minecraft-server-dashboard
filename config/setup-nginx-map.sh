#!/usr/bin/env bash
# setup-nginx-map.sh
# Injects a postMessage sender + SW unregistration script into the BlueMap
# nginx config via sub_filter, so the Angular dashboard can read the iframe
# URL cross-origin on all browsers (including Android Chrome).
# Target file (from nginx -T): /etc/nginx/conf.d/minecraft_map.conf
# Idempotent: removes any previous injection and re-injects fresh — on a temp
# copy. nginx is only touched when the result differs from what is live:
# back up, install, `nginx -t`, reload; a failed test restores the backups.

# SC2016: the $variables in single quotes are nginx's, literal on purpose.
# SC2024: `sudo tee FILE <input` - tee does the privileged write; the input
#         is a temp/backup file this script can already read.
# shellcheck disable=SC2016,SC2024

set -euo pipefail

NGINX_DIR="/etc/nginx"
BLUEMAP_CONF="$NGINX_DIR/conf.d/minecraft_map.conf"
# http-level map{} blocks the injected directives read from. conf.d/*.conf is
# included inside http{} (compression.conf relies on the same), so maps in
# their own file are visible to the BlueMap server block.
VARS_CONF="$NGINX_DIR/conf.d/minecraft_map_vars.conf"
# Backups live outside conf.d so nginx never loads them.
BLUEMAP_BACKUP="$NGINX_DIR/minecraft_map.conf.bak"
VARS_BACKUP="$NGINX_DIR/minecraft_map_vars.conf.bak"

# Only the HTML page (the one sub_filter rewrites) is fetched uncompressed and
# marked no-store; tiles, textures and live JSON keep BlueMap's compression and
# are revalidated (no-cache) instead of re-downloaded uncompressed on every
# map open. An empty map value makes nginx omit the header entirely.
VARS_CONTENT='# Managed by config/setup-nginx-map.sh (dashboard repo) - do not edit by hand.
# Scopes the BlueMap cache/encoding overrides injected into minecraft_map.conf.
map $sent_http_content_type $bluemap_cache_control {
    "~*^text/html"  "no-cache, no-store, must-revalidate";
    default         "no-cache";
}
map $sent_http_content_type $bluemap_pragma {
    "~*^text/html"  "no-cache";
    default         "";
}
# The request is proxied before the response type is known, so HTML is
# recognised by URI: "/", directory-style and extension-less paths, *.htm(l).
map $uri $bluemap_accept_encoding {
    "~(/|\.html?|/[^/.]+)$"  "";
    default                  $http_accept_encoding;
}'

if [ ! -f "$BLUEMAP_CONF" ]; then
  echo "[ERROR] BlueMap nginx config not found at $BLUEMAP_CONF" >&2
  exit 1
fi

echo "[INFO] Using BlueMap config: $BLUEMAP_CONF"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$BLUEMAP_CONF" "$work/site.conf"
printf '%s\n' "$VARS_CONTENT" >"$work/vars.conf"

# ── Remove any previous injection (idempotent cleanup) ───────────────────────
# Both generations: the old unscoped directives and the map-driven ones.
sed -i \
  -e '/proxy_set_header Accept-Encoding "";/d' \
  -e '/proxy_set_header Accept-Encoding \$bluemap_accept_encoding;/d' \
  -e '/sub_filter_once off;/d' \
  -e '/sub_filter_types text\/html;/d' \
  -e '/sub_filter.*bluemap-url/d' \
  -e '/add_header Cache-Control.*no-store/d' \
  -e '/add_header Cache-Control \$bluemap_cache_control always;/d' \
  -e '/add_header Pragma.*no-cache/d' \
  -e '/add_header Pragma \$bluemap_pragma always;/d' \
  "$work/site.conf"

# ── Inject fresh sub_filter block ────────────────────────────────────────────
# Inserted after "proxy_pass http://127.0.0.1:8100;":
#   - Accept-Encoding: empty (= not sent) for HTML only, so BlueMap answers
#     uncompressed and sub_filter can parse the body; everything else keeps
#     the browser's Accept-Encoding
#   - Cache-Control no-store (+ Pragma) on HTML: prevents Chrome (incl.
#     Android) from caching the page via HTTP cache or the BlueMap service
#     worker's cache.put(); other responses get no-cache (revalidate)
#   - sub_filter: replaces </body> with an inline <script> that:
#       1. Unregisters any BlueMap service worker (self-healing on first load)
#       2. Posts the iframe's current href to any parent window every second
#          ("*" target so it works from any dashboard origin/PWA mode)
sed -i 's|proxy_pass http://127.0.0.1:8100;|proxy_pass http://127.0.0.1:8100;\n        proxy_set_header Accept-Encoding $bluemap_accept_encoding;\n        add_header Cache-Control $bluemap_cache_control always;\n        add_header Pragma $bluemap_pragma always;\n        sub_filter_once off;\n        sub_filter_types text/html;\n        sub_filter '"'"'</body>'"'"' '"'"'<script>if("serviceWorker"in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(s){s.unregister()})})}setInterval(function(){try{window.parent.postMessage({type:"bluemap-url",href:location.href},"*")}catch(e){}},1000)</script></body>'"'"';|' "$work/site.conf"

if ! grep -q 'bluemap-url' "$work/site.conf"; then
  echo "[ERROR] 'proxy_pass http://127.0.0.1:8100;' not found in $BLUEMAP_CONF - nothing injected, config left untouched." >&2
  exit 1
fi

# ── Apply only when something changed ────────────────────────────────────────
same_file() { [ -f "$2" ] && [ "$(cat "$1")" = "$(cat "$2")" ]; }
if same_file "$work/site.conf" "$BLUEMAP_CONF" && same_file "$work/vars.conf" "$VARS_CONF"; then
  echo "[INFO] BlueMap injection already up to date - nginx not reloaded."
  exit 0
fi

echo "[INFO] Backing up to $BLUEMAP_BACKUP and installing the new injection..."
sudo cp -p "$BLUEMAP_CONF" "$BLUEMAP_BACKUP"
had_vars=0
if [ -f "$VARS_CONF" ]; then
  had_vars=1
  sudo cp -p "$VARS_CONF" "$VARS_BACKUP"
fi
# tee rewrites in place, keeping the live file's owner, mode and SELinux label.
sudo tee "$VARS_CONF" <"$work/vars.conf" >/dev/null
sudo tee "$BLUEMAP_CONF" <"$work/site.conf" >/dev/null
if [ "$had_vars" -eq 0 ] && command -v restorecon >/dev/null 2>&1; then
  sudo restorecon "$VARS_CONF" || true
fi

# ── Test & reload ─────────────────────────────────────────────────────────────
echo "[INFO] Testing nginx configuration..."
if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "[SUCCESS] nginx reloaded."
else
  echo "[ERROR] nginx config test failed - restoring the previous BlueMap config." >&2
  sudo tee "$BLUEMAP_CONF" <"$BLUEMAP_BACKUP" >/dev/null
  if [ "$had_vars" -eq 1 ]; then
    sudo tee "$VARS_CONF" <"$VARS_BACKUP" >/dev/null
  else
    sudo rm -f "$VARS_CONF"
  fi
  sudo nginx -t || true
  exit 1
fi
