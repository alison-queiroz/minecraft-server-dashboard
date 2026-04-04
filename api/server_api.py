import logging
import os
import time
from functools import wraps

from flask import Flask, jsonify, request, abort

from .player_data import get_players
from .firestore_sync import read_local_snapshots

# Google Drive API imports
from google.oauth2 import service_account
from googleapiclient.discovery import build

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)

_FIREBASE_INITIALIZED = False

def _init_firebase():
    global _FIREBASE_INITIALIZED
    if _FIREBASE_INITIALIZED:
        return
    try:
        import firebase_admin
        from firebase_admin import credentials
        # Guard against re-initialization if the background sync thread already
        # called firebase_admin.initialize_app() in this worker process.
        if not firebase_admin._apps:
            sa_path = os.environ.get("FIREBASE_SA_KEY", "/home/opc/minecraft/firebase-service-account.json")
            cred = credentials.Certificate(sa_path)
            firebase_admin.initialize_app(cred)
        _FIREBASE_INITIALIZED = True
        logger.info("Firebase Admin SDK initialized.")
    except Exception as exc:
        logger.warning("Firebase Admin SDK not available (%s). API is UNPROTECTED.", exc)


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        _init_firebase()
        if not _FIREBASE_INITIALIZED:
            return f(*args, **kwargs)
        from firebase_admin import auth as firebase_auth
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            abort(401)
        token = auth_header[len("Bearer "):]
        try:
            firebase_auth.verify_id_token(token)
        except Exception as exc:
            logger.warning("Token verification failed: %s", exc)
            abort(401)
        return f(*args, **kwargs)
    return decorated


@app.route("/api/players", methods=["GET"])
@require_auth
def players_endpoint():
    return jsonify(get_players())


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
            return {
                "online": True,
                "version": s.version.name,
                "players": {"online": players_online, "max": players_max},
                "motd": {"clean": [motd_text]},
                "protocol": {"version": s.version.protocol, "name": s.version.name},
            }
        except Exception as exc:
            logger.warning("Java server ping failed: %s", exc)
            return {"online": False}

    return jsonify(_cached_status("java", fetch))


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

@app.route("/api/analytics", methods=["GET"])
@require_auth
def analytics_endpoint():
    """Return player-count snapshots for the requested period.

    Always reads from the local JSONL file (written on every sync).
    Also merges Firestore snapshots for periods before the local file existed.
    Results are deduped by ts and sorted ascending.
    """
    period = request.args.get("period", "week")
    seconds_back = _PERIOD_SECONDS.get(period, _PERIOD_SECONDS["week"])
    since = int(time.time()) - seconds_back

    # Start with local data — always available and always correct
    local = read_local_snapshots(since)
    seen_ts: set[int] = {s["ts"] for s in local}

    # Attempt to supplement with Firestore data (historical, before local file existed)
    _init_firebase()
    if _FIREBASE_INITIALIZED:
        try:
            from firebase_admin import firestore as admin_firestore
            db = admin_firestore.client()
            snaps = (
                db.collection("snapshots")
                .where("ts", ">=", since)
                .order_by("ts")
                .stream()
            )
            for s in snaps:
                ts = s.get("ts")
                if ts and ts not in seen_ts:
                    local.append({"ts": ts, "count": s.get("count", 0), "online": s.get("online", [])})
                    seen_ts.add(ts)
        except Exception as exc:
            logger.warning("Analytics Firestore query failed: %s", exc)

    results = sorted(local, key=lambda s: s["ts"])
    return jsonify(results)


# ── Advancements endpoint ──────────────────────────────────────────────────────

@app.route("/api/advancements/<uuid>", methods=["GET"])
@require_auth
def advancements_endpoint(uuid: str):
    """Return completed advancements for a Java player UUID."""
    # Basic UUID format validation to prevent path traversal
    import re
    if not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", uuid, re.IGNORECASE):
        return jsonify({"error": "Invalid UUID"}), 400
    from .advancements import get_advancements
    return jsonify(get_advancements(uuid))
