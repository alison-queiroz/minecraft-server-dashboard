"""Server status: GET /api/status (Java) and GET /api/bedrock-status ping the
local Minecraft servers (replacing the external api.mcsrvstat.us calls), and
GET /api/healthz is the deploy pipeline's liveness probe.

Pings are cached per worker for _STATUS_CACHE_TTL seconds; the Java player
roster (names + UUIDs) is only sent to signed-in callers.
"""
from __future__ import annotations

import logging
import os
import time

from flask import Blueprint, Response, jsonify

from ..auth import _optional_uid
from ..online_edition import bedrock_online_count

logger = logging.getLogger(__name__)

bp = Blueprint("status", __name__)


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


@bp.route("/api/status", methods=["GET"])
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


@bp.route("/api/bedrock-status", methods=["GET"])
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


# ── Health check ───────────────────────────────────────────────────────────────

@bp.route("/api/healthz", methods=["GET"])
def healthz_endpoint() -> Response:
    """Liveness probe polled by config/remote-deploy.sh after a restart.
    Unauthenticated and free of I/O (no Minecraft ping, no Firestore) so it
    only proves the app imported and a worker is serving; never cached."""
    response = jsonify({"ok": True})
    response.headers["Cache-Control"] = "no-store"
    return response
