#!/usr/bin/env bash
# setup-nginx-compression.sh
# Provisions Brotli static serving for the dashboard on nginx (Oracle Linux 9).
# The build ships pre-compressed .br/.gz siblings (scripts/precompress.mjs); this
# makes nginx serve them via brotli_static / gzip_static instead of compressing
# on the fly. Without it, Brotli silently falls back to gzip.
#
# Idempotent: safe to run on every deploy. Installs the module only when
# missing, rewrites the config only when it differs, and reloads only on change.

set -euo pipefail

MODULE_SO="/usr/lib64/nginx/modules/ngx_http_brotli_static_module.so"
CONF="/etc/nginx/conf.d/compression.conf"
# No trailing newline here: `$(cat)` below strips one, so this must match what
# `cat` returns for the file we write (which does end in a newline).
CONF_CONTENT='brotli_static on;
gzip_static on;'

changed=0

# ── 1. Ensure the Brotli module is installed ────────────────────────────────
if [ ! -f "$MODULE_SO" ]; then
  echo "[INFO] nginx Brotli module missing — installing nginx-mod-brotli..."
  sudo dnf install -y nginx-mod-brotli
  changed=1
  if [ ! -f "$MODULE_SO" ]; then
    echo "[ERROR] nginx-mod-brotli installed but $MODULE_SO not found." >&2
    exit 1
  fi
else
  echo "[INFO] Brotli module already present."
fi

# ── 2. Ensure the static-serving config is in place ─────────────────────────
if [ ! -f "$CONF" ] || [ "$(cat "$CONF")" != "$CONF_CONTENT" ]; then
  echo "[INFO] Writing $CONF ..."
  printf '%s\n' "$CONF_CONTENT" | sudo tee "$CONF" >/dev/null
  changed=1
else
  echo "[INFO] $CONF already up to date."
fi

# ── 3. Test & reload only when something changed ────────────────────────────
if [ "$changed" -eq 1 ]; then
  echo "[INFO] Testing nginx configuration..."
  if sudo nginx -t; then
    sudo systemctl reload nginx
    echo "[SUCCESS] Brotli static serving active; nginx reloaded."
  else
    echo "[ERROR] nginx config test failed — reverting compression.conf." >&2
    sudo rm -f "$CONF"
    sudo nginx -t
    exit 1
  fi
else
  echo "[INFO] No changes needed."
fi
