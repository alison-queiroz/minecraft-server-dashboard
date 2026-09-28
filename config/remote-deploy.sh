#!/usr/bin/env bash
# remote-deploy.sh
# Server-side half of the deploy, shared by deploy.bat and
# .github/workflows/release.yml so the two pipelines cannot drift. Both upload
# this script, the setup-nginx-*.sh helpers and the tarballs into the deploy
# inbox (~/.dashboard-deploy — the directory this script lives in) and run:
#
#   bash ~/.dashboard-deploy/remote-deploy.sh backend nginx resync
#   bash ~/.dashboard-deploy/remote-deploy.sh frontend
#
# Phases run in the order given; the first failure stops the run (exit != 0).
#   backend            deploy_api.tar.gz is staged, byte-compiled, its deps
#                      installed and the app import-tested BEFORE the live tree
#                      is touched. Then: stop -> swap api/ (old kept as api.prev)
#                      -> start -> poll /api/healthz; automatic rollback when the
#                      new release does not answer within DEPLOY_HEALTH_TIMEOUT.
#   nginx              setup-nginx-map.sh + setup-nginx-compression.sh.
#   resync             POST /api/internal/force-resync with the service's own
#                      INTERNAL_API_SECRET (never on a command line). Warn-only.
#   frontend           deploy_build.tar.gz is staged and verified against
#                      ngsw.json, then published into the live docroot in place:
#                      assets and hashed chunks first, entry files (index.html,
#                      ngsw.json, ...) last. Files dropped from the build stay
#                      DEPLOY_PRUNE_DAYS days for open tabs / service workers.
#   backend-rollback   put api.prev back and restart.
#   frontend-rollback  republish the previous build (dashboard.release.prev).
#
# Runs as the SSH user (opc); privileged steps go through `sudo -n`. Layout,
# rollback and the manual nginx settings are documented in config/README.md.

set -euo pipefail

INBOX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$INBOX/$(basename "${BASH_SOURCE[0]}")"

# ── Configuration (DEPLOY_* environment variables override the defaults) ─────
SERVICE="${DEPLOY_SERVICE:-minecraft-api.service}"
API_ROOT="${DEPLOY_API_ROOT:-/home/opc/minecraft}"
WWW_DIR="${DEPLOY_WWW_DIR:-/var/www/dashboard}"
PYTHON="${DEPLOY_PYTHON:-python3}"            # interpreter the service runs on
API_URL="${DEPLOY_API_URL:-http://127.0.0.1:5000}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-30}" # seconds
PRUNE_DAYS="${DEPLOY_PRUNE_DAYS:-14}"
SKIP_IMPORT_CHECK="${DEPLOY_SKIP_IMPORT_CHECK:-0}"

API_TAR="$INBOX/deploy_api.tar.gz"
WEB_TAR="$INBOX/deploy_build.tar.gz"

# Backend layout: everything under API_ROOT, so each mv is an atomic rename.
API_LIVE="$API_ROOT/api"
API_PREV="$API_ROOT/api.prev"
API_FAILED="$API_ROOT/api.failed"
API_STAGE="$API_ROOT/.deploy-staging"
API_FILES=(run.py gunicorn.conf.py)   # shipped next to api/, backed up as <file>.prev

# Frontend layout: siblings of the docroot (same filesystem, never served).
WWW_STAGE="$WWW_DIR.staging"
WWW_RELEASE="$WWW_DIR.release"        # pristine copy of the build that is live
WWW_RELEASE_PREV="$WWW_DIR.release.prev"
# Published last, in this order: service-worker scripts, the manifest,
# index.html, and finally ngsw.json — its hashTable covers index.html and the
# manifest, so it must not go live before them.
ENTRY_FILES=(ngsw-worker.js safety-worker.js worker-basic.min.js manifest.webmanifest index.html ngsw.json)

BACKEND_SWAPPING=0
PUBLISHED=0
STALE_SIBLINGS=0

# ── Helpers ──────────────────────────────────────────────────────────────────
# Logging never fails: if the SSH session drops, the run must still finish
# (or roll back) instead of dying on a write to a closed stdout.
log()  { printf '[INFO] %s\n' "$*" || true; }
ok()   { printf '[SUCCESS] %s\n' "$*" || true; }
warn() { printf '[WARN] %s\n' "$*" >&2 || true; }
die()  { printf '[ERROR] %s\n' "$*" >&2 || true; exit 1; }

# Run a command as root: directly when already root, else via sudo without
# ever prompting (a prompt would hang the non-interactive SSH session).
priv() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi
}

require_cmds() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "required command not found on the server: $cmd"
  done
}

# Scripts uploaded from Windows may carry a UTF-8 BOM and CRLF line endings.
strip_bom_crlf() { sed -i '1s/^\xEF\xBB\xBF//;s/\r$//' "$@"; }

# True when both files have identical content. cmp ships in diffutils, which
# a minimal image may lack; sha1sum (coreutils) is always there.
same_content() {
  if command -v cmp >/dev/null 2>&1; then
    cmp -s "$1" "$2"
  else
    [ "$(sha1sum <"$1")" = "$(sha1sum <"$2")" ]
  fi
}

clear_pycache() {
  find "$1" -name '__pycache__' -type d -prune -exec rm -rf {} +
  find "$1" -name '*.pyc' -type f -delete
}

# Sorted (byte order, as `comm` needs) list of regular files under $1,
# relative to it.
list_files() {
  (cd "$1" && find . -type f -printf '%P\n' | LC_ALL=C sort)
}

show_service_logs() {
  warn "last log lines of $SERVICE:"
  priv journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
}

WORK="$(mktemp -d)"
on_exit() {
  local status=$?
  if [ "$BACKEND_SWAPPING" -eq 1 ]; then
    warn "backend: interrupted in the middle of the swap (exit $status) - restoring the previous release."
    backend_restore || warn "backend: automatic restore FAILED - inspect $API_ROOT and 'journalctl -u $SERVICE' by hand."
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap on_exit EXIT

acquire_lock() {
  if ! command -v flock >/dev/null 2>&1; then
    warn "flock not found - concurrent deploys will not be serialized."
    return 0
  fi
  exec 9>"$INBOX/.deploy.lock"
  if ! flock -n 9; then
    log "another deploy is running on this server - waiting for it (up to 10 min)..."
    flock -w 600 9 || die "timed out waiting for $INBOX/.deploy.lock."
  fi
}

# ── Backend ──────────────────────────────────────────────────────────────────

# Poll the API until it answers.
#   strict: GET /api/healthz must return 200 {"ok": true} (the new release).
#   alive:  any HTTP answer counts — used after a rollback, because a release
#           that predates /api/healthz answers it with a 404.
wait_for_api() {
  local mode="$1" deadline=$((SECONDS + HEALTH_TIMEOUT)) resp code body
  local ok_re='"ok":[[:space:]]*true'
  while :; do
    resp="$(curl -s -m 3 -w '\n%{http_code}' "$API_URL/api/healthz" 2>/dev/null || true)"
    code="${resp##*$'\n'}"
    body="${resp%$'\n'*}"
    if [ "$mode" = strict ]; then
      if [ "$code" = 200 ] && [[ "$body" =~ $ok_re ]]; then return 0; fi
    elif [ -n "$code" ] && [ "$code" != 000 ]; then
      return 0
    fi
    if systemctl is-failed --quiet "$SERVICE"; then
      warn "backend: $SERVICE entered the failed state."
      return 1
    fi
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 1
  done
}

# The unit file is not in the repo, so print how systemd actually launches the
# API (handy when a first deploy behaves unexpectedly) and, unless
# DEPLOY_PYTHON is set, follow its interpreter when ExecStart is a Python
# binary or lives in a virtualenv — pip and the checks must target the
# environment the service imports from. Otherwise: python3, as before.
describe_service() {
  local load exec_start workdir bin
  load="$(systemctl show -p LoadState --value "$SERVICE" 2>/dev/null || true)"
  [ "$load" = loaded ] || die "backend: systemd unit $SERVICE is not loaded (LoadState=${load:-unknown})."
  exec_start="$(systemctl show -p ExecStart --value "$SERVICE" 2>/dev/null \
    | sed -n 's/.*argv\[\]=\([^;]*\);.*/\1/p' | head -n 1 || true)"
  workdir="$(systemctl show -p WorkingDirectory --value "$SERVICE" 2>/dev/null || true)"
  if [ -z "${DEPLOY_PYTHON:-}" ] && [ -n "$exec_start" ]; then
    bin="${exec_start%% *}"
    case "${bin##*/}" in
      python | python3 | python3.*) PYTHON="$bin" ;;
      *) if [ -f "${bin%/*}/../pyvenv.cfg" ] && [ -x "${bin%/*}/python3" ]; then PYTHON="${bin%/*}/python3"; fi ;;
    esac
  fi
  log "backend: $SERVICE runs '${exec_start:-?}' in '${workdir:-?}'; using $PYTHON for pip and checks."
}

backend_stage() {
  local f
  [ -f "$API_TAR" ] || die "backend: $API_TAR not found (upload it first)."
  log "backend: staging the new release in $API_STAGE..."
  rm -rf "$API_STAGE"
  mkdir -p "$API_STAGE"
  tar -xzf "$API_TAR" -C "$API_STAGE" --no-same-owner
  clear_pycache "$API_STAGE"
  for f in api/__init__.py api/server_api.py api/routes/__init__.py api/requirements.txt "${API_FILES[@]}"; do
    [ -f "$API_STAGE/$f" ] || die "backend: the uploaded release is missing $f."
  done
}

# Everything here runs against the staged copy; a failure leaves the live
# release (and the running service) untouched.
backend_validate() {
  log "backend: byte-compiling the staged sources with $("$PYTHON" -V 2>&1)..."
  "$PYTHON" - "$API_STAGE" <<'PY' || die "backend: staged sources do not compile on the server's Python - live release untouched."
import pathlib
import sys

failed = False
for path in sorted(pathlib.Path(sys.argv[1]).rglob("*.py")):
    try:
        compile(path.read_bytes(), str(path), "exec", dont_inherit=True)
    except SyntaxError as exc:
        print("  {}".format(exc), file=sys.stderr)
        failed = True
sys.exit(1 if failed else 0)
PY

  # requirements-lock.txt pins the whole transitive tree for Python 3.9 on
  # Linux (the same constraints CI tests with), so the server gets exactly the
  # versions CI ran. A release without a lock falls back to the bare pins.
  local constraints=()
  if [ -f "$API_STAGE/api/requirements-lock.txt" ]; then
    constraints=(-c "$API_STAGE/api/requirements-lock.txt")
  else
    warn "backend: no api/requirements-lock.txt in the release - installing without constraints."
  fi
  log "backend: installing dependencies from the staged requirements.txt (+ lock)..."
  "$PYTHON" -m pip install -q -r "$API_STAGE/api/requirements.txt" ${constraints[@]+"${constraints[@]}"} \
    || die "backend: pip install failed - live release untouched."

  if [ "$SKIP_IMPORT_CHECK" = 1 ]; then
    warn "backend: DEPLOY_SKIP_IMPORT_CHECK=1 - skipping the import smoke test."
    return 0
  fi
  # Import exactly what the service imports (run.py -> api.server_api) from the
  # staged tree, with the background Firestore sync disabled and no .pyc
  # written. Catches missing dependencies and import-time errors (e.g. 3.9
  # incompatibilities) while the old release is still serving.
  log "backend: import smoke test of the staged app..."
  if ! (cd "$API_STAGE" && AUTO_START_BG_SYNC=0 PYTHONDONTWRITEBYTECODE=1 \
        timeout 120 "$PYTHON" -c 'import run') >"$WORK/import.log" 2>&1; then
    tail -n 30 "$WORK/import.log" >&2
    die "backend: the staged app fails to import - live release untouched (set DEPLOY_SKIP_IMPORT_CHECK=1 to bypass)."
  fi
}

# Non-code files that exist only on the server (e.g. a credential someone
# dropped into api/) must survive the directory swap: the old scp-on-top deploy
# never deleted anything, and api.prev is replaced by the next deploy. Stale
# *.py modules are deliberately NOT carried over — dropping them is the point.
carry_over_untracked() {
  local rel
  [ -d "$API_LIVE" ] || return 0
  while IFS= read -r rel; do
    if [ -e "$API_STAGE/api/$rel" ]; then continue; fi
    case "$rel" in
      *.py)
        log "backend: api/$rel is no longer part of the release (a copy stays in api.prev)."
        ;;
      *)
        mkdir -p "$(dirname "$API_STAGE/api/$rel")"
        cp -p "$API_LIVE/$rel" "$API_STAGE/api/$rel"
        warn "backend: carried over server-only file api/$rel - commit it or move it out of api/."
        ;;
    esac
  done < <(cd "$API_LIVE" && find . -type f ! -name '*.pyc' ! -path '*/__pycache__/*' -printf '%P\n')
}

# Put the previous release back and start the service. Idempotent and safe
# from any point of the swap: it relies on the invariants backend_swap sets up
# before stopping anything ("<file>.prev exists" <=> "<file> existed before").
backend_restore() {
  local f rc=0
  BACKEND_SWAPPING=0
  priv systemctl stop "$SERVICE" || warn "backend: could not stop $SERVICE."
  if [ -d "$API_PREV" ]; then
    rm -rf "$API_FAILED" || rc=1
    if [ -d "$API_LIVE" ]; then mv -T "$API_LIVE" "$API_FAILED" || rc=1; fi
    mv -T "$API_PREV" "$API_LIVE" || rc=1
  fi
  for f in "${API_FILES[@]}"; do
    if [ -e "$API_ROOT/$f.prev" ]; then
      mv -f "$API_ROOT/$f.prev" "$API_ROOT/$f" || rc=1
    else
      rm -f "$API_ROOT/$f" || rc=1
    fi
  done
  if [ -d "$API_LIVE" ]; then clear_pycache "$API_LIVE" || true; fi
  priv systemctl start "$SERVICE" || rc=1
  return "$rc"
}

backend_swap() {
  local f
  # Rollback snapshot of the top-level files, taken before anything stops.
  rm -rf "$API_PREV"
  for f in "${API_FILES[@]}"; do
    rm -f "$API_ROOT/$f.prev"
    if [ -e "$API_ROOT/$f" ]; then cp -p "$API_ROOT/$f" "$API_ROOT/$f.prev"; fi
  done
  if [ -f "$API_ROOT/gunicorn.conf.py" ] && ! same_content "$API_ROOT/gunicorn.conf.py" "$API_STAGE/gunicorn.conf.py"; then
    log "backend: gunicorn.conf.py on the server differs from the release (old copy kept as gunicorn.conf.py.prev):"
    diff -u "$API_ROOT/gunicorn.conf.py" "$API_STAGE/gunicorn.conf.py" >"$WORK/gunicorn.diff" 2>&1 || true
    head -n 40 "$WORK/gunicorn.diff" || true
  fi
  carry_over_untracked

  # Stop -> swap -> start: no worker ever runs a mix of old and new modules
  # (handlers import some modules lazily). The API is down from here until the
  # new workers answer — typically a few seconds, same as a plain restart.
  BACKEND_SWAPPING=1
  log "backend: stopping $SERVICE and swapping api/ -> api.prev..."
  priv systemctl stop "$SERVICE"
  if [ -d "$API_LIVE" ]; then mv -T "$API_LIVE" "$API_PREV"; fi
  mv -T "$API_STAGE/api" "$API_LIVE"
  for f in "${API_FILES[@]}"; do mv -f "$API_STAGE/$f" "$API_ROOT/$f"; done
  clear_pycache "$API_LIVE"
  log "backend: starting $SERVICE..."
  priv systemctl start "$SERVICE"
  BACKEND_SWAPPING=0
  rm -rf "$API_STAGE"
}

phase_backend() {
  require_cmds tar curl find timeout
  describe_service
  require_cmds "$PYTHON"
  backend_stage
  backend_validate
  backend_swap

  log "backend: waiting up to ${HEALTH_TIMEOUT}s for $API_URL/api/healthz..."
  if wait_for_api strict; then
    rm -f "$API_TAR"
    ok "backend: new release is live (previous one kept in $API_PREV)."
    return 0
  fi

  warn "backend: /api/healthz did not answer 200 within ${HEALTH_TIMEOUT}s - rolling back."
  show_service_logs
  backend_restore || die "backend: ROLLBACK FAILED - the API may be down; inspect $API_ROOT and 'journalctl -u $SERVICE'."
  if wait_for_api alive; then
    die "backend: rolled back to the previous release, which is serving again (failed release kept in $API_FAILED). Deploy aborted."
  fi
  show_service_logs
  die "backend: rolled back, but the previous release is not answering either - check the service."
}

phase_backend_rollback() {
  [ -d "$API_PREV" ] || die "backend-rollback: no previous release kept at $API_PREV."
  log "backend-rollback: restoring $API_PREV..."
  backend_restore || die "backend-rollback: restore failed - inspect $API_ROOT by hand."
  if ! wait_for_api alive; then
    show_service_logs
    die "backend-rollback: previous release restored, but the API is not answering."
  fi
  ok "backend-rollback: previous release restored and serving (rolled-back release kept in $API_FAILED)."
}

# ── nginx ────────────────────────────────────────────────────────────────────
phase_nginx() {
  local script
  for script in setup-nginx-map.sh setup-nginx-compression.sh; do
    [ -f "$INBOX/$script" ] || die "nginx: $INBOX/$script not found (upload it first)."
    strip_bom_crlf "$INBOX/$script"
    log "nginx: running $script..."
    priv bash "$INBOX/$script"
  done
}

# ── Firestore force-resync ───────────────────────────────────────────────────

# stdin: shell-style KEY=VALUE words. Prints the value of $1 (last one wins);
# $2 = 1 treats '#' as a comment (EnvironmentFile syntax).
env_pick() {
  python3 -c '
import shlex
import sys

name, comments = sys.argv[1], sys.argv[2] == "1"
value = ""
for word in shlex.split(sys.stdin.read(), comments=comments):
    key, sep, val = word.partition("=")
    if sep and key == name:
        value = val
sys.stdout.write(value)
' "$1" "$2"
}

# Value of $1 in the unit definition: Environment= first, then every
# EnvironmentFile= in order (systemd lets the files override Environment=).
unit_env_value() {
  local name="$1" value="" line path v
  v="$(systemctl show -p Environment --value "$SERVICE" 2>/dev/null | env_pick "$name" 0 || true)"
  if [ -n "$v" ]; then value="$v"; fi
  while IFS= read -r line; do
    path="${line%% *}"          # "/etc/sysconfig/x (ignore_errors=no)" -> path
    [ -n "$path" ] || continue
    v="$(priv cat "$path" 2>/dev/null | env_pick "$name" 1 || true)"
    if [ -n "$v" ]; then value="$v"; fi
  done < <(systemctl show -p EnvironmentFiles --value "$SERVICE" 2>/dev/null || true)
  printf '%s' "$value"
}

# Value of $1 as the running service sees it. The secret only ever travels
# through pipes and variables — never argv, so it cannot show up in `ps`.
# Prefers the live process environment (covers Environment=, EnvironmentFile=
# and drop-ins at once); falls back to the unit definition.
service_env_value() {
  local name="$1" pid value=""
  pid="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || true)"
  if [ -n "$pid" ] && [ "$pid" != 0 ]; then
    value="$(priv cat "/proc/$pid/environ" 2>/dev/null | tr '\0' '\n' | sed -n "s/^$name=//p" | tail -n 1 || true)"
  fi
  if [ -z "$value" ]; then value="$(unit_env_value "$name")"; fi
  printf '%s' "${value%$'\r'}"
}

phase_resync() {
  local secret hdr out
  require_cmds curl python3
  secret="$(service_env_value INTERNAL_API_SECRET)"
  if [ -z "$secret" ]; then
    warn "resync: INTERNAL_API_SECRET is not set for $SERVICE - skipping (the endpoint refuses requests without it)."
    return 0
  fi
  # Header goes through a 0600 file read by curl (-H @file), not argv.
  hdr="$WORK/resync.header"
  (umask 077 && printf 'X-Internal-Secret: %s\n' "$secret" >"$hdr")
  secret=""
  log "resync: forcing a Firestore resync..."
  if out="$(curl -sS -f -m 120 -X POST -H "@$hdr" "$API_URL/api/internal/force-resync" 2>&1)"; then
    ok "resync: Firestore resync triggered: $out"
  else
    warn "resync: force-resync call failed: $out - check 'journalctl -u $SERVICE'."
  fi
  rm -f "$hdr"
}

# ── Frontend (runs as root, see as_root) ─────────────────────────────────────

# Make a staged tree look like what the old `sudo tar -x` into the docroot
# produced, minus the builder's uid: owned like the docroot, world-readable,
# and on SELinux labelled like everything else under /var/www. Files copied
# into the docroot later inherit the docroot's label, exactly as before.
normalize_tree() {
  chown -R --reference="$WWW_DIR" "$1"
  chmod -R u=rwX,go=rX "$1"
  if command -v selinuxenabled >/dev/null 2>&1 && selinuxenabled && command -v restorecon >/dev/null 2>&1; then
    restorecon -R "$1"
  fi
}

# Refuse to publish a build that is incomplete or corrupt: every file the
# Angular service worker will fetch must exist and match its ngsw.json hash,
# and every local script/stylesheet index.html references must exist.
validate_build() {
  local dir="$1"
  [ -s "$dir/index.html" ] || die "frontend: $dir/index.html is missing or empty."
  [ -s "$dir/ngsw.json" ] || die "frontend: $dir/ngsw.json is missing or empty."
  python3 - "$dir" <<'PY' || die "frontend: build in $dir failed validation - live site untouched."
import hashlib
import json
import pathlib
import re
import sys
import urllib.parse

root = pathlib.Path(sys.argv[1])
try:
    table = json.loads((root / "ngsw.json").read_text(encoding="utf-8"))["hashTable"]
except (ValueError, KeyError, TypeError) as exc:
    sys.exit("  ngsw.json is unreadable: {!r}".format(exc))
problems = [] if table else ["ngsw.json hashTable is empty"]
for url, digest in table.items():
    path = root / urllib.parse.unquote(url.lstrip("/"))
    if not path.is_file():
        problems.append("missing " + url)
    elif hashlib.sha1(path.read_bytes()).hexdigest() != digest:
        problems.append("hash mismatch " + url)
index = (root / "index.html").read_text(encoding="utf-8", errors="replace")
for ref in re.findall(r'(?:src|href)="([^":?#]+\.(?:js|css))"', index):
    if not (root / ref.lstrip("/")).is_file():
        problems.append("index.html references missing " + ref)
for problem in problems[:20]:
    print("  " + problem, file=sys.stderr)
if problems:
    sys.exit(1)
print("[INFO] frontend: build verified - {} files match ngsw.json.".format(len(table)))
PY
}

# Atomically replace one file of the docroot with $1/$2 (temp name in the
# target directory + rename), skipping it when the content is unchanged so
# its mtime/ETag stay stable.
publish_file() {
  local src="$1/$2" dst="$WWW_DIR/$2" tmp ext
  if [ ! -f "$dst" ] || ! same_content "$src" "$dst"; then
    tmp="${dst%/*}/.${dst##*/}.deploy-tmp"
    cp --preserve=mode,ownership "$src" "$tmp"
    mv -fT "$tmp" "$dst"
    PUBLISHED=$((PUBLISHED + 1))
  fi
  # A pre-compressed sibling the new build no longer ships (e.g. the file fell
  # under precompress.mjs's size threshold) would keep being served by
  # brotli_static/gzip_static instead of the file just published.
  case "$2" in *.br | *.gz) return 0 ;; esac
  for ext in br gz; do
    if [ -e "$dst.$ext" ] && [ ! -e "$src.$ext" ]; then
      rm -f "$dst.$ext"
      STALE_SIBLINGS=$((STALE_SIBLINGS + 1))
    fi
  done
}

# Publish the build at $1 into the live docroot. The site is never emptied and
# never shows an index.html whose chunks are not there yet:
#   1. new directories, then every non-entry file (chunks, assets, siblings);
#   2. entry files in ENTRY_FILES order (.br/.gz before the raw file).
# An interruption during step 1 leaves the old version fully intact.
publish_build() {
  local src="$1" rel entry entry_re="" total pruned=0
  local new_list="$WORK/new.list" prev_list="$WORK/prev.list"
  PUBLISHED=0
  STALE_SIBLINGS=0

  find "$WWW_DIR" -name '.*.deploy-tmp' -type f -delete   # leftovers of an interrupted run
  list_files "$src" >"$new_list"
  total="$(wc -l <"$new_list")"
  for entry in "${ENTRY_FILES[@]}"; do entry_re="${entry_re:+$entry_re|}${entry//./\\.}"; done
  entry_re="^($entry_re)(\\.br|\\.gz)?\$"

  while IFS= read -r rel; do
    if [ ! -d "$WWW_DIR/$rel" ]; then
      mkdir "$WWW_DIR/$rel"
      chown --reference="$src/$rel" "$WWW_DIR/$rel"
      chmod --reference="$src/$rel" "$WWW_DIR/$rel"
    fi
  done < <(cd "$src" && find . -mindepth 1 -type d -printf '%P\n' | LC_ALL=C sort)

  while IFS= read -r rel; do
    publish_file "$src" "$rel"
  done < <(grep -Ev "$entry_re" "$new_list" || true)

  for entry in "${ENTRY_FILES[@]}"; do
    for rel in "$entry.br" "$entry.gz" "$entry"; do
      if [ -f "$src/$rel" ]; then publish_file "$src" "$rel"; fi
    done
  done
  log "frontend: published $PUBLISHED new/changed of $total files; removed $STALE_SIBLINGS stale .br/.gz siblings."

  # Files that just left the build get mtime=now, so the prune below measures
  # "days since they stopped being current", not "days since they were built".
  # Without a release snapshot (first run of this script) the live tree IS the
  # previous build.
  if [ -d "$WWW_RELEASE" ]; then
    list_files "$WWW_RELEASE" >"$prev_list"
  else
    (cd "$WWW_DIR" && find . -type f ! -path '*/.*' -printf '%P\n' | LC_ALL=C sort) >"$prev_list"
  fi
  while IFS= read -r rel; do
    if [ -f "$WWW_DIR/$rel" ]; then touch -c "$WWW_DIR/$rel"; fi
  done < <(LC_ALL=C comm -23 "$prev_list" "$new_list")

  # Prune what is neither in the current build nor recently superseded. Dot
  # paths (.well-known/ for ACME, temp files) are never touched.
  while IFS= read -r rel; do
    rm -f "$WWW_DIR/$rel"
    pruned=$((pruned + 1))
  done < <(cd "$WWW_DIR" && find . -type f ! -path '*/.*' -mmin +"$((PRUNE_DAYS * 24 * 60))" -printf '%P\n' \
             | LC_ALL=C sort | LC_ALL=C comm -23 - "$new_list")
  find "$WWW_DIR" -mindepth 1 -type d -empty ! -path '*/.*' -delete
  log "frontend: pruned $pruned files superseded more than $PRUNE_DAYS days ago."
}

phase_frontend() {
  [ -f "$WEB_TAR" ] || die "frontend: $WEB_TAR not found (upload it first)."
  [ -d "$WWW_DIR" ] || die "frontend: docroot $WWW_DIR does not exist."
  require_cmds tar python3 comm
  umask 022
  log "frontend: staging the new build in $WWW_STAGE..."
  rm -rf "$WWW_STAGE"
  mkdir "$WWW_STAGE"
  tar -xzf "$WEB_TAR" -C "$WWW_STAGE" --no-same-owner --no-same-permissions
  normalize_tree "$WWW_STAGE"
  validate_build "$WWW_STAGE"

  log "frontend: publishing into $WWW_DIR (entry files last)..."
  publish_build "$WWW_STAGE"
  rm -rf "$WWW_RELEASE_PREV"
  if [ -d "$WWW_RELEASE" ]; then mv -T "$WWW_RELEASE" "$WWW_RELEASE_PREV"; fi
  mv -T "$WWW_STAGE" "$WWW_RELEASE"
  rm -f "$WEB_TAR"
  ok "frontend: new build is live (rollback source kept in $WWW_RELEASE_PREV)."
}

phase_frontend_rollback() {
  [ -d "$WWW_RELEASE_PREV" ] || die "frontend-rollback: no previous build kept at $WWW_RELEASE_PREV."
  require_cmds python3 comm
  umask 022
  validate_build "$WWW_RELEASE_PREV"
  log "frontend-rollback: republishing $WWW_RELEASE_PREV..."
  publish_build "$WWW_RELEASE_PREV"
  # Swap the two snapshots, so running the rollback again rolls forward.
  rm -rf "$WWW_RELEASE.swap"
  if [ -d "$WWW_RELEASE" ]; then mv -T "$WWW_RELEASE" "$WWW_RELEASE.swap"; fi
  mv -T "$WWW_RELEASE_PREV" "$WWW_RELEASE"
  if [ -d "$WWW_RELEASE.swap" ]; then mv -T "$WWW_RELEASE.swap" "$WWW_RELEASE_PREV"; fi
  ok "frontend-rollback: previous build is live again."
}

# The frontend phases need root for nearly every step (the docroot is
# root-owned), so they run as one root child process instead of hundreds of
# individual sudo calls. sudo resets the environment; forward the settings.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$1"; return; fi
  sudo -n env DEPLOY_WWW_DIR="$WWW_DIR" DEPLOY_PRUNE_DAYS="$PRUNE_DAYS" \
    bash "$SELF" __as-root "$1"
}

# ── Entry point ──────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
usage: bash $SELF PHASE [PHASE...]
phases: backend nginx resync frontend backend-rollback frontend-rollback
EOF
}

main() {
  local phase
  # A dropped SSH connection must not kill the run halfway (e.g. between
  # stopping the service and swapping the release back in).
  trap '' HUP PIPE
  if [ "${1:-}" = "__as-root" ]; then
    [ "$(id -u)" -eq 0 ] || die "internal: __as-root must run as root."
    case "${2:-}" in
      phase_frontend | phase_frontend_rollback) "$2"; return ;;
      *) die "internal: unknown root task '${2:-}'." ;;
    esac
  fi
  if [ "$#" -eq 0 ]; then usage >&2; exit 2; fi
  for phase in "$@"; do
    case "$phase" in
      backend | nginx | resync | frontend | backend-rollback | frontend-rollback) ;;
      *) usage >&2; die "unknown phase: $phase" ;;
    esac
  done

  acquire_lock
  for phase in "$@"; do
    log "=== $phase ==="
    case "$phase" in
      backend) phase_backend ;;
      nginx) phase_nginx ;;
      resync) phase_resync ;;
      frontend) as_root phase_frontend ;;
      backend-rollback) phase_backend_rollback ;;
      frontend-rollback) as_root phase_frontend_rollback ;;
    esac
  done
  ok "remote-deploy: '$*' finished in ${SECONDS}s."
}

main "$@"
