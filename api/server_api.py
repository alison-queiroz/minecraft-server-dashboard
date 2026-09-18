# Production runs Python 3.9, where PEP 604 unions (`int | None`) in an
# annotation are evaluated at runtime and raise. Defer annotations so modern
# syntax stays safe — enforced across api/ by tests/test_python39_compat.py.
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import threading
import time
from collections import defaultdict
from functools import wraps
from pathlib import Path
from typing import Optional, Tuple

from flask import Flask, jsonify, request, abort, g
from flask_compress import Compress

from .player_data import get_players, get_op_names, read_essentials_homes, create_essentials_home, update_essentials_home, delete_essentials_home, get_uuid_to_name
from .firestore_sync import read_local_snapshots
from .firebase_init import ensure_initialized
from .online_edition import bedrock_online_count

# Google Drive API imports
from google.oauth2 import service_account
from googleapiclient.discovery import build

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Gzip/Brotli-compress JSON responses (players/analytics payloads shrink a lot);
# only kicks in when the client sends Accept-Encoding, so it's a no-op in tests.
Compress(app)

_FIREBASE_INITIALIZED = False

def _init_firebase():
    """Delegates to the shared initializer; mirrors its result into the module
    flag that require_auth checks (kept for backward-compat and test patching)."""
    global _FIREBASE_INITIALIZED
    if _FIREBASE_INITIALIZED:
        return
    _FIREBASE_INITIALIZED = ensure_initialized()


# ── In-memory rate limiter (per Firebase UID, falls back to IP) ───────────────
_RL_WINDOW = 60   # seconds
_RL_MAX = 10      # max verify attempts per window per key
_rl_lock = threading.Lock()
_rl_attempts: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(key: str) -> bool:
    """Returns True if the request is within limits, False if it should be rejected."""
    now = time.time()
    with _rl_lock:
        window = [t for t in _rl_attempts[key] if now - t < _RL_WINDOW]
        _rl_attempts[key] = window
        # Evict other fully-stale keys so the dict can't grow unbounded under
        # many distinct callers.
        for stale_key in [
            k for k, v in _rl_attempts.items()
            if k != key and (not v or now - v[-1] >= _RL_WINDOW)
        ]:
            del _rl_attempts[stale_key]
        if len(window) >= _RL_MAX:
            return False
        _rl_attempts[key].append(now)
        return True


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        _init_firebase()
        if not _FIREBASE_INITIALIZED:
            # Firebase unavailable — refuse all requests rather than silently
            # falling back to unauthenticated access.
            abort(503)
        from firebase_admin import auth as firebase_auth
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            abort(401)
        token = auth_header[len("Bearer "):]
        try:
            decoded = firebase_auth.verify_id_token(token)
        except Exception as exc:
            logger.warning("Token verification failed: %s", exc)
            abort(401)
        g.auth_uid = decoded.get("uid")
        return f(*args, **kwargs)
    return decorated


import re as _re

_UUID_RE = _re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", _re.IGNORECASE
)


def _is_valid_uuid(uuid: str) -> bool:
    """Strict hyphenated-UUID check, shared by the homes and advancements routes
    to block path-traversal / arbitrary-file inputs before any filesystem use."""
    return bool(_UUID_RE.match(uuid or ""))


def _optional_uid() -> Optional[str]:
    """Return the caller's Firebase uid if a valid Bearer token is present,
    else None. Never aborts — for endpoints that stay public but reveal more
    (e.g. the online player roster) only to authenticated callers."""
    if not _FIREBASE_INITIALIZED:
        return None
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    try:
        from firebase_admin import auth as firebase_auth
        decoded = firebase_auth.verify_id_token(auth_header[len("Bearer "):])
        return decoded.get("uid")
    except Exception:
        return None


# uid -> (fetched_at, {lowercase linked names}). Cached so the ownership check
# does not hit Firestore on every homes request (which would burn the read
# quota and, once exhausted, break homes). Stale entries are served if a later
# refresh fails.
_owner_cache: dict[str, Tuple[float, set]] = {}
_OWNER_CACHE_TTL = 600.0  # seconds
_owner_cache_lock = threading.Lock()


def _linked_minecraft_names(uid: Optional[str]) -> set:
    """Lowercase Minecraft usernames linked to this Firebase uid.

    Cached for _OWNER_CACHE_TTL. On a Firestore error a stale cached value is
    returned when available; otherwise the error propagates so the caller can
    decide how to degrade.
    """
    if not uid:
        return set()
    now = time.time()
    with _owner_cache_lock:
        cached = _owner_cache.get(uid)
    if cached and now - cached[0] < _OWNER_CACHE_TTL:
        return cached[1]
    try:
        from firebase_admin import firestore as admin_firestore
        db = admin_firestore.client()
        snap = db.collection("users").document(uid).get()
        accounts = (snap.to_dict() or {}).get("minecraftAccounts") or {} if snap.exists else {}
        names = {str(v).lower() for v in accounts.values() if v}
        with _owner_cache_lock:
            _owner_cache[uid] = (now, names)
        return names
    except Exception as exc:
        logger.warning("Ownership lookup failed for uid %s: %s", uid, exc)
        if cached:
            return cached[1]  # serve stale on a transient Firestore error
        raise


def _user_owns_player(uuid: str) -> bool:
    """True if the authenticated caller owns the given Minecraft player UUID.

    Resolves the UUID to a username (usercache) and checks it against the
    caller's linked Minecraft accounts. Prevents one authenticated user from
    reading/mutating another player's EssentialsX homes (IDOR).

    If Firestore is unavailable and no cached ownership data exists, the check
    degrades to allow (availability over strict IDOR protection) rather than
    break homes for every user during an outage — logged loudly, self-heals.
    """
    uid = getattr(g, "auth_uid", None)
    if not uid:
        return False
    name = get_uuid_to_name().get(uuid)
    if not name:
        return False
    try:
        linked = _linked_minecraft_names(uid)
    except Exception:
        logger.warning(
            "Ownership check degraded for uid %s (Firestore unavailable, no cache) — allowing", uid
        )
        return True
    return name.lower() in linked


def _services_catalog_path() -> Path:
    default_path = Path(__file__).resolve().parents[1] / "src" / "assets" / "services-catalog.json"
    return Path(os.environ.get("SERVICES_CATALOG_PATH", str(default_path)))


def _services_admin_uids() -> set[str]:
    raw = os.environ.get("SERVICES_CATALOG_ADMIN_UIDS", "")
    return {uid.strip() for uid in raw.split(",") if uid.strip()}


def _is_services_admin(uid: Optional[str]) -> bool:
    if not uid:
        return False
    return uid in _services_admin_uids()


def _load_services_catalog() -> dict:
    path = _services_catalog_path()
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _validate_services_catalog(payload: dict) -> Tuple[bool, str]:
    updated_at = payload.get("updatedAt")
    sections = payload.get("sections")

    if not isinstance(updated_at, str) or not updated_at.strip():
        return False, "updatedAt must be a non-empty string"
    if not isinstance(sections, list):
        return False, "sections must be an array"

    for section in sections:
        if not isinstance(section, dict):
            return False, "each section must be an object"
        if not isinstance(section.get("title"), str) or not section["title"].strip():
            return False, "section.title must be a non-empty string"
        if not isinstance(section.get("description"), str):
            return False, "section.description must be a string"
        services = section.get("services")
        if not isinstance(services, list):
            return False, "section.services must be an array"

        for service in services:
            if not isinstance(service, dict):
                return False, "each service must be an object"
            if not isinstance(service.get("name"), str) or not service["name"].strip():
                return False, "service.name must be a non-empty string"
            if not isinstance(service.get("access"), str) or not service["access"].strip():
                return False, "service.access must be a non-empty string"
            host = service.get("host")
            if host is not None and not isinstance(host, str):
                return False, "service.host must be a string when provided"
            port = service.get("port")
            if port is not None and (not isinstance(port, int) or port <= 0):
                return False, "service.port must be a positive integer when provided"

    return True, ""


@app.route("/api/services-catalog", methods=["GET"])
@require_auth
def services_catalog_get_endpoint():
    try:
        catalog = _load_services_catalog()
    except FileNotFoundError:
        return jsonify({"error": "Services catalog file not found"}), 500
    except Exception as exc:
        logger.error("Failed to read services catalog: %s", exc)
        return jsonify({"error": "Failed to read services catalog"}), 500

    uid = getattr(g, "auth_uid", None)
    return jsonify({"catalog": catalog, "canEdit": _is_services_admin(uid)})


@app.route("/api/services-catalog", methods=["PUT"])
@require_auth
def services_catalog_put_endpoint():
    uid = getattr(g, "auth_uid", None)
    if not _is_services_admin(uid):
        abort(403)

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400

    valid, error = _validate_services_catalog(body)
    if not valid:
        return jsonify({"error": error}), 400

    path = _services_catalog_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(body, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except Exception as exc:
        logger.error("Failed to write services catalog: %s", exc)
        return jsonify({"error": "Failed to write services catalog"}), 500

    return jsonify({"ok": True})


@app.route("/api/profile", methods=["GET"])
@require_auth
def profile_endpoint():
    """Report only whether the caller has any linked Minecraft account.

    Lets the frontend route guard gate access WITHOUT loading the Firestore
    client SDK in the browser (keeps ~166 KiB off every protected route except
    the ones that genuinely need real-time Firestore). Returns just the boolean
    the guard needs — the account names live in the /profile page's own
    (Firestore) load, so they aren't shipped on every navigation. Reads
    users/{uid} fresh (not via the ownership cache) so a just-linked account is
    reflected immediately — no post-onboarding lockout.
    """
    uid = getattr(g, "auth_uid", None)
    try:
        from firebase_admin import firestore as admin_firestore
        db = admin_firestore.client()
        snap = db.collection("users").document(uid).get()
        accounts = (snap.to_dict() or {}).get("minecraftAccounts") or {} if snap.exists else {}
    except Exception as exc:
        logger.warning("Profile lookup failed for uid %s: %s", uid, exc)
        return jsonify({"error": "Failed to read profile"}), 503
    has_linked = any(bool(v) for v in accounts.values())
    return jsonify({"hasLinkedAccount": has_linked})


@app.route("/api/players", methods=["GET"])
@require_auth
def players_endpoint():
    return jsonify(get_players())


@app.route("/api/players/<uuid>/homes", methods=["GET"])
@require_auth
def player_homes_endpoint(uuid: str):
    """Returns the EssentialsX homes for the given player UUID.

    The homes are also included in the player object returned by /api/players,
    but this endpoint allows fetching them directly without loading all players.
    UUID must be in the standard hyphenated format (e.g. 550e8400-e29b-41d4-a716-446655440000).
    Non-hyphenated Bedrock UUIDs (starting with 00000000-0000-0000-0009) will
    return an empty list since EssentialsX only manages Java players.
    """
    if not _is_valid_uuid(uuid):
        abort(400)
    if not _user_owns_player(uuid):
        abort(403)
    homes = read_essentials_homes(uuid)
    return jsonify(homes)


@app.route("/api/players/<uuid>/homes", methods=["POST"])
@require_auth
def create_player_home_endpoint(uuid: str):
    """Create a new home in EssentialsX for the given player UUID.

    Body JSON: { name, x, y, z, world }
    Returns 409 if a home with that name already exists.
    """
    if not _is_valid_uuid(uuid):
        abort(400)
    if not _user_owns_player(uuid):
        abort(403)
    body = request.get_json(silent=True) or {}
    name = body.get("name")
    x = body.get("x")
    y = body.get("y")
    z = body.get("z")
    world = body.get("world")
    if any(v is None for v in (name, x, y, z, world)):
        abort(400)
    try:
        fx, fy, fz = float(x), float(y), float(z)
    except (TypeError, ValueError):
        abort(400)
    ok = create_essentials_home(uuid, str(name), fx, fy, fz, str(world))
    if not ok:
        abort(409)
    return jsonify({"ok": True}), 201


@app.route("/api/players/<uuid>/homes/<path:name>", methods=["PUT"])
@require_auth
def update_player_home_endpoint(uuid: str, name: str):
    """Update coordinates (and optionally rename) a home in EssentialsX.

    Body JSON: { x, y, z, world, new_name? }
    Returns 404 if the home or player file does not exist.
    """
    if not _is_valid_uuid(uuid):
        abort(400)
    if not _user_owns_player(uuid):
        abort(403)
    body = request.get_json(silent=True) or {}
    x = body.get("x")
    y = body.get("y")
    z = body.get("z")
    world = body.get("world")
    if any(v is None for v in (x, y, z, world)):
        abort(400)
    try:
        fx, fy, fz = float(x), float(y), float(z)
    except (TypeError, ValueError):
        abort(400)
    new_name = body.get("new_name") or None
    ok = update_essentials_home(uuid, name, fx, fy, fz, str(world), new_name)
    if not ok:
        abort(404)
    return jsonify({"ok": True})


@app.route("/api/players/<uuid>/homes/<path:name>", methods=["DELETE"])
@require_auth
def delete_player_home_endpoint(uuid: str, name: str):
    """Delete a home from EssentialsX userdata YAML.

    Returns 404 if the home or player file does not exist.
    """
    if not _is_valid_uuid(uuid):
        abort(400)
    if not _user_owns_player(uuid):
        abort(403)
    ok = delete_essentials_home(uuid, name)
    if not ok:
        abort(404)
    return jsonify({"ok": True})


@app.route("/api/ops", methods=["GET"])
@require_auth
def ops_endpoint():
    """Returns the list of OP player names from ops.json."""
    return jsonify(get_op_names())


@app.route("/api/players/force-resync", methods=["POST"])
@require_auth
def force_resync_endpoint():
    """Force-invalidates the player cache so the next read re-fetches from disk
    and pushes fresh skin URLs to Firestore. Useful after an in-game /skin change."""
    from .player_data import _cache
    from .skin_resolver import _url_resolution_cache, _url_resolved_at
    _cache.last_updated = 0.0          # mark cache stale
    _url_resolution_cache.clear()      # forget all resolved skin URLs
    _url_resolved_at.clear()
    fresh = get_players()              # re-fetch immediately
    return jsonify({"ok": True, "players": len(fresh)})


@app.route("/api/internal/force-resync", methods=["POST"])
def internal_force_resync_endpoint():
    """Force-resync used by the deploy pipeline. Bypasses Firebase auth but
    requires a shared secret (INTERNAL_API_SECRET) in the X-Internal-Secret
    header. remote_addr is NOT trusted: behind a same-host reverse proxy every
    external request appears to originate from 127.0.0.1, so a loopback check
    alone would expose this endpoint publicly. Fails closed when unconfigured."""
    secret = os.environ.get("INTERNAL_API_SECRET", "")
    provided = request.headers.get("X-Internal-Secret", "")
    if not secret or not hmac.compare_digest(secret, provided):
        abort(403)
    from .player_data import _cache
    from .skin_resolver import _url_resolution_cache, _url_resolved_at
    _cache.last_updated = 0.0
    _url_resolution_cache.clear()
    _url_resolved_at.clear()
    fresh = get_players()
    return jsonify({"ok": True, "players": len(fresh)})


@app.route("/api/backups", methods=["GET"])
@require_auth
def backups_endpoint():
    try:
        creds_path = os.environ.get("DRIVE_SA_KEY", "/home/opc/minecraft/drive-service-account.json")
        creds = service_account.Credentials.from_service_account_file(
            creds_path,
            scopes=['https://www.googleapis.com/auth/drive.readonly']
        )
        service = build('drive', 'v3', credentials=creds)

        # Determine which folder to query: requested folder or root folder
        root_folder_id = os.environ.get("DRIVE_FOLDER_ID", "YOUR_GOOGLE_DRIVE_FOLDER_ID")
        target_folder_id = request.args.get('folderId', root_folder_id)

        query = f"'{target_folder_id}' in parents and trashed = false"

        results = service.files().list(
            q=query,
            fields="files(id, name, mimeType, createdTime, size, webContentLink)",
            orderBy="folder, createdTime desc"
        ).execute()

        return jsonify(results.get('files', []))

    except FileNotFoundError as exc:
        # In local/dev fallback mode (Firebase not initialized), missing Drive
        # credentials should not fail the dashboard health checks.
        if not _FIREBASE_INITIALIZED:
            logger.warning("Drive credentials missing in dev mode: %s", exc)
            return jsonify([])
        logger.error("Drive credentials missing in protected mode: %s", exc)
        return jsonify({"error": "Failed to fetch backups"}), 500
    except Exception as exc:
        logger.error("Failed to fetch backups from Google Drive: %s", exc)
        return jsonify({"error": "Failed to fetch backups"}), 500


# ── Server status endpoints (replaces the external api.mcsrvstat.us calls) ──

_MC_HOST = os.environ.get("MC_HOST", "localhost")
_MC_PORT = int(os.environ.get("MC_PORT", "25565"))
_MC_BEDROCK_PORT = int(os.environ.get("MC_BEDROCK_PORT", "19132"))
_STATUS_CACHE: dict = {}
_STATUS_CACHE_TTL = 5  # seconds — prevents hammering the server on busy dashboards


def _cached_status(key: str, fetcher):
    entry = _STATUS_CACHE.get(key)
    if entry and time.time() - entry["ts"] < _STATUS_CACHE_TTL:
        return entry["data"]
    data = fetcher()
    _STATUS_CACHE[key] = {"data": data, "ts": time.time()}
    return data


@app.route("/api/status", methods=["GET"])
def java_status_endpoint():
    """Pings the local Java Minecraft server and returns its status."""
    def fetch():
        try:
            from mcstatus import JavaServer
            server = JavaServer(_MC_HOST, _MC_PORT)
            s = server.status()
            motd_obj = getattr(s, "motd", None)
            motd_text = (
                motd_obj.to_plain() if hasattr(motd_obj, "to_plain")
                else str(motd_obj) if motd_obj else ""
            )
            players_online = s.players.online if s.players else 0
            players_max = s.players.max if s.players else 0
            players_sample = None
            if s.players and s.players.sample:
                players_sample = [{"name": p.name, "id": str(p.id)} for p in s.players.sample]
            players = {"online": players_online, "max": players_max, "sample": players_sample}
            # Bedrock-vs-Java split from the server log (the only reliable source
            # once Floodgate linking/offline-mode makes them the same identity).
            # Omitted (not zeroed) when the log can't be read.
            bedrock = bedrock_online_count()
            if bedrock is not None:
                players["bedrock"] = min(bedrock, players_online)
            return {
                "online": True,
                "version": s.version.name,
                "players": players,
                "motd": {"clean": [motd_text]},
                "protocol": {"version": s.version.protocol, "name": s.version.name},
            }
        except Exception as exc:
            logger.warning("Java server ping failed: %s", exc)
            return {"online": False}

    data = _cached_status("java", fetch)
    # The online-player roster (names + UUIDs) is only exposed to authenticated
    # callers; anonymous callers still get the online/max counts.
    players = data.get("players")
    if isinstance(players, dict) and players.get("sample") and _optional_uid() is None:
        data = {**data, "players": {**players, "sample": None}}
    return jsonify(data)


@app.route("/api/bedrock-status", methods=["GET"])
def bedrock_status_endpoint():
    """Pings the local Bedrock/Geyser server and returns its status."""
    def fetch():
        try:
            from mcstatus import BedrockServer
            server = BedrockServer(_MC_HOST, _MC_BEDROCK_PORT)
            s = server.status()
            # mcstatus 11.x renamed players_online/players_max → players.online/players.max
            # and version.version → version.name; handle both APIs defensively.
            players = getattr(s, "players", None)
            players_online = (
                getattr(players, "online", None) if players is not None
                else getattr(s, "players_online", 0)
            ) or 0
            players_max = (
                getattr(players, "max", None) if players is not None
                else getattr(s, "players_max", 0)
            ) or 0
            version_name = (
                getattr(s.version, "name", None)
                or getattr(s.version, "version", "")
                or ""
            )
            brand = getattr(s.version, "brand", "") or ""
            protocol_ver = getattr(s.version, "protocol", None)
            motd_obj = getattr(s, "motd", None)
            motd_text = (
                motd_obj.to_plain() if hasattr(motd_obj, "to_plain")
                else str(motd_obj) if motd_obj else ""
            )
            return {
                "online": True,
                "version": f"{brand} {version_name}".strip() or None,
                "players": {"online": players_online, "max": players_max},
                "motd": {"clean": [motd_text]},
                "protocol": {"version": protocol_ver, "name": version_name},
                "port": _MC_BEDROCK_PORT,
            }
        except Exception as exc:
            logger.warning("Bedrock server ping failed: %s", exc)
            return {"online": False}

    return jsonify(_cached_status("bedrock", fetch))


# ── Analytics endpoint ───────────────────────────────────────────────────────

_PERIOD_SECONDS: dict = {
    "day":   86_400,
    "week":  7 * 86_400,
    "month": 30 * 86_400,
    "year":  365 * 86_400,
}

# Server-side bucket width per period, chosen so each period returns only a few
# dozen points regardless of how many raw minute snapshots exist.
_PERIOD_BUCKET_SECONDS: dict = {
    "day":   900,          # 15-minute buckets → ≤96 points
    "week":  6 * 3600,     # 6-hour buckets    → ≤28 points
    "month": 86_400,       # 1-day buckets     → ≤30 points
    "year":  7 * 86_400,   # 7-day buckets     → ≤52 points
}


def _aggregate_snapshots(rows: list, period: str) -> dict:
    """Bucket raw {ts, count} snapshots into a compact server-side series.

    Returns { "points": [{t, avg, peak}, ...], "summary": {peak, avg} }.
    Replaces the old behaviour of shipping every raw minute row for the browser
    to aggregate — this is the heavy lifting moved to the backend.
    """
    bucket = _PERIOD_BUCKET_SECONDS.get(period, _PERIOD_BUCKET_SECONDS["week"])
    acc: dict = {}  # bucket_start_ts -> [sum, n, max]
    peak = 0
    total = 0
    n = 0
    for row in rows:
        ts = row.get("ts")
        if ts is None:
            continue
        count = int(row.get("count", 0) or 0)
        key = (int(ts) // bucket) * bucket
        entry = acc.get(key)
        if entry is None:
            acc[key] = [count, 1, count]
        else:
            entry[0] += count
            entry[1] += 1
            if count > entry[2]:
                entry[2] = count
        if count > peak:
            peak = count
        total += count
        n += 1
    points = [
        {"t": key, "avg": round(acc[key][0] / acc[key][1]), "peak": acc[key][2]}
        for key in sorted(acc)
    ]
    summary = {"peak": peak, "avg": (round(total / n) if n else 0)}
    return {"points": points, "summary": summary}


@app.route("/api/analytics", methods=["GET"])
@require_auth
def analytics_endpoint():
    """Return pre-aggregated player-count buckets for the requested period.

    Reads raw {ts, count} snapshots from the local JSONL file (written on every
    sync) and merges Firestore history, then buckets/averages server-side so the
    browser receives only a few dozen points plus a {peak, avg} summary instead
    of every raw minute-level row.
    """
    period = request.args.get("period", "week")
    seconds_back = _PERIOD_SECONDS.get(period, _PERIOD_SECONDS["week"])
    since = int(time.time()) - seconds_back

    # Aggregate from the local JSONL only. We deliberately do NOT stream the
    # Firestore `snapshots` collection here: for long periods that was tens of
    # thousands of per-request document reads (multiplied by the 60s client
    # auto-refresh), which exhausted the Firestore free-tier read quota. The
    # local file is written on every sync and retained for a year, so it is the
    # complete, authoritative source.
    snapshots = read_local_snapshots(since)
    return jsonify(_aggregate_snapshots(snapshots, period))


# ── AuthMe password verification endpoint ───────────────────────────────────────

_AUTHME_DB_PATH = os.environ.get(
    "AUTHME_DB",
    "/home/opc/minecraft/plugins/AuthMe/authme.db",
)


@app.route("/api/verify-minecraft-password", methods=["POST"])
@require_auth
def verify_minecraft_password():
    """Verify a player's AuthMe in-game password against the SQLite database.

    Accepts JSON: { "username": "...", "password": "..." }
    Returns:       { "valid": true | false }
    """
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

    if not username or not password:
        return jsonify({"valid": False, "error": "Missing username or password"}), 400

    # Guard against excessively long inputs before touching the database.
    if len(username) > 64 or len(password) > 256:
        return jsonify({"valid": False}), 400

    # Rate-limit per authenticated Firebase UID. require_auth already verified
    # the token and set g.auth_uid, so reuse it instead of verifying again.
    rl_key = getattr(g, "auth_uid", None) or request.remote_addr or "unknown"
    if not _check_rate_limit(rl_key):
        return jsonify({"valid": False, "error": "Too many attempts. Please wait."}), 429

    try:
        import sqlite3
        import bcrypt as _bcrypt

        conn = sqlite3.connect(_AUTHME_DB_PATH)
        try:
            row = conn.execute(
                "SELECT password FROM authme WHERE LOWER(username) = LOWER(?)",
                (username,),
            ).fetchone()
        finally:
            conn.close()

        if row is None:
            # Username not registered in AuthMe — treat as invalid.
            return jsonify({"valid": False})

        stored: str = row[0]

        # ── BCrypt (primary hash) ──────────────────────────────────────────
        if stored.startswith(("$2a$", "$2y$", "$2b$")):
            normalized = ("$2b$" + stored[4:]) if stored.startswith(("$2a$", "$2y$")) else stored
            valid = _bcrypt.checkpw(password.encode("utf-8"), normalized.encode("utf-8"))
            return jsonify({"valid": valid})

        # ── SHA256 (AuthMe legacy fallback: $SHA$<salt>$hash) ─────────────
        # hash = sha256( sha256_hex(password) + salt )
        if stored.startswith("$SHA$"):
            parts = stored.split("$")  # ['', 'SHA', salt, hash]
            if len(parts) == 4:
                salt = parts[2]
                expected = parts[3]
                inner = hashlib.sha256(password.encode("utf-8")).hexdigest()
                outer = hashlib.sha256((inner + salt).encode("utf-8")).hexdigest()
                # Use constant-time comparison to prevent timing oracle attacks.
                return jsonify({"valid": hmac.compare_digest(outer, expected)})

        # Unknown hash format — cannot verify.
        logger.warning("Unknown AuthMe hash format for user %s: %s", username, stored[:10])
        return jsonify({"valid": False})

    except FileNotFoundError:
        logger.warning("AuthMe DB not found at %s", _AUTHME_DB_PATH)
        return jsonify({"valid": False, "error": "AuthMe database not available"}), 503
    except Exception as exc:
        logger.error("AuthMe password verification error: %s", exc)
        return jsonify({"valid": False, "error": "Verification failed"}), 500


# ── Advancements endpoint ──────────────────────────────────────────────────────

@app.route("/api/advancements/<uuid>", methods=["GET"])
@require_auth
def advancements_endpoint(uuid: str):
    """Return completed advancements for a Java player UUID."""
    # Strict UUID validation to prevent path traversal (shared with homes routes).
    if not _is_valid_uuid(uuid):
        return jsonify({"error": "Invalid UUID"}), 400
    from .advancements import get_advancements
    return jsonify(get_advancements(uuid))


@app.route("/api/advancements/description", methods=["GET"])
@require_auth
def advancement_description_endpoint():
    """Return the description for a single advancement id (e.g. minecraft:story/mine_stone).
    Fetched lazily by the frontend only when the user hovers / focuses a chip."""
    adv_id = request.args.get("id", "").strip()
    if not adv_id:
        return jsonify({"error": "Missing id"}), 400
    from .advancements import get_description
    return jsonify({"description": get_description(adv_id)})
