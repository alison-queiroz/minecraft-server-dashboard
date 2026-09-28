"""Player routes: the roster (/api/players), the server operators (/api/ops),
a player's EssentialsX homes (read/create/update/delete, owner only) and the
two force-resync endpoints (dashboard admins, or the deploy pipeline's shared
secret), throttled by a per-worker cooldown.
"""
from __future__ import annotations

import hmac
import math
import os
import threading
import time
from functools import wraps
from typing import Any, Optional, Tuple

from flask import Blueprint, abort, jsonify, request
from werkzeug.exceptions import TooManyRequests

from ..auth import _json_body, require_admin, require_auth
from ..essentials_homes import (
    create_essentials_home,
    delete_essentials_home,
    read_essentials_homes,
    update_essentials_home,
)
from ..home_visibility import _carry_home_visibility
from ..ownership import _require_owned_player
from ..player_data import get_op_names, get_players, invalidate_caches

bp = Blueprint("players", __name__)


@bp.route("/api/players", methods=["GET"])
@require_auth
def players_endpoint():
    return jsonify(get_players())


@bp.route("/api/players/<uuid>/homes", methods=["GET"])
@require_auth
def player_homes_endpoint(uuid: str):
    """Returns the EssentialsX homes for one of the caller's players.

    Homes are not part of /api/players (they are private unless marked public;
    see /api/profile/homes and /api/players/<uuid>/public-profile).
    UUID must be in the standard hyphenated format (e.g. 550e8400-e29b-41d4-a716-446655440000).
    Non-hyphenated Bedrock UUIDs (starting with 00000000-0000-0000-0009) will
    return an empty list since EssentialsX only manages Java players.
    """
    _require_owned_player(uuid)
    homes = read_essentials_homes(uuid)
    return jsonify(homes)


_MAX_HOME_NAME_LEN = 64
_MAX_WORLD_NAME_LEN = 64
# Minecraft's world border sits at ±30M; anything beyond is not a real position.
_MAX_HOME_COORD = 30_000_000.0


def _is_valid_home_name(name: Any) -> bool:
    return isinstance(name, str) and bool(name.strip()) and len(name) <= _MAX_HOME_NAME_LEN


def _is_valid_world_name(world: Any) -> bool:
    return isinstance(world, str) and bool(world.strip()) and len(world) <= _MAX_WORLD_NAME_LEN


def _parse_home_coords(body: dict) -> Optional[Tuple[float, float, float]]:
    """(x, y, z) from a request body, or None unless all three are finite
    numbers inside the world border. Flask's JSON parser accepts NaN/Infinity
    literals, which would otherwise be written straight into the YAML."""
    coords = []
    for key in ("x", "y", "z"):
        raw = body.get(key)
        if raw is None or isinstance(raw, bool):
            return None
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(value) or abs(value) > _MAX_HOME_COORD:
            return None
        coords.append(value)
    return coords[0], coords[1], coords[2]


@bp.route("/api/players/<uuid>/homes", methods=["POST"])
@require_auth
def create_player_home_endpoint(uuid: str):
    """Create a new home in EssentialsX for the given player UUID.

    Body JSON: { name, x, y, z, world }
    Returns 409 if a home with that name already exists.
    """
    _require_owned_player(uuid)
    body = _json_body()
    name = body.get("name")
    world = body.get("world")
    coords = _parse_home_coords(body)
    if not _is_valid_home_name(name) or not _is_valid_world_name(world) or coords is None:
        abort(400)
    ok = create_essentials_home(uuid, name.strip(), coords[0], coords[1], coords[2], world)
    if not ok:
        abort(409)
    return jsonify({"ok": True}), 201


@bp.route("/api/players/<uuid>/homes/<path:name>", methods=["PUT"])
@require_auth
def update_player_home_endpoint(uuid: str, name: str):
    """Update coordinates (and optionally rename) a home in EssentialsX.

    Body JSON: { x, y, z, world, new_name? }
    Returns 404 if the home or player file does not exist.
    """
    _require_owned_player(uuid)
    body = _json_body()
    world = body.get("world")
    coords = _parse_home_coords(body)
    new_name = body.get("new_name") or None
    if (
        len(name) > _MAX_HOME_NAME_LEN
        or not _is_valid_world_name(world)
        or coords is None
        or (new_name is not None and not _is_valid_home_name(new_name))
    ):
        abort(400)
    new_name = new_name.strip() if new_name else None
    ok = update_essentials_home(uuid, name, coords[0], coords[1], coords[2], world, new_name)
    if not ok:
        abort(404)
    if new_name and new_name != name:
        _carry_home_visibility(uuid, name, new_name)
    return jsonify({"ok": True})


@bp.route("/api/players/<uuid>/homes/<path:name>", methods=["DELETE"])
@require_auth
def delete_player_home_endpoint(uuid: str, name: str):
    """Delete a home from EssentialsX userdata YAML.

    Returns 404 if the home or player file does not exist.
    """
    _require_owned_player(uuid)
    if len(name) > _MAX_HOME_NAME_LEN:
        abort(400)
    ok = delete_essentials_home(uuid, name)
    if not ok:
        abort(404)
    _carry_home_visibility(uuid, name, None)
    return jsonify({"ok": True})


@bp.route("/api/ops", methods=["GET"])
@require_auth
def ops_endpoint():
    """Returns the list of OP player names from ops.json."""
    return jsonify(get_op_names())


# A resync rescans every player, writes Firestore and flushes the skin cache,
# so user-triggered ones are throttled (per worker process).
_RESYNC_COOLDOWN = 60.0  # seconds
_resync_lock = threading.Lock()
_last_resync_at: Optional[float] = None


def _resync_cooldown(f):
    """Route decorator: allow one call per _RESYNC_COOLDOWN seconds; later
    calls get a 429 with Retry-After until the window has passed."""
    @wraps(f)
    def decorated(*args, **kwargs):
        global _last_resync_at
        now = time.monotonic()
        with _resync_lock:
            elapsed = None if _last_resync_at is None else now - _last_resync_at
            allowed = elapsed is None or elapsed >= _RESYNC_COOLDOWN
            if allowed:
                _last_resync_at = now
        if not allowed:
            raise TooManyRequests(retry_after=int(_RESYNC_COOLDOWN - elapsed) + 1)
        return f(*args, **kwargs)
    return decorated


@bp.route("/api/players/force-resync", methods=["POST"])
@require_auth
@require_admin
@_resync_cooldown
def force_resync_endpoint():
    """Force-invalidates the player cache so the next read re-fetches from disk
    and pushes fresh skin URLs to Firestore. Useful after an in-game /skin change."""
    return _force_resync_response()


@bp.route("/api/internal/force-resync", methods=["POST"])
def internal_force_resync_endpoint():
    """Force-resync used by the deploy pipeline. Bypasses Firebase auth but
    requires a shared secret (INTERNAL_API_SECRET) in the X-Internal-Secret
    header. remote_addr is NOT trusted: behind a same-host reverse proxy every
    external request appears to originate from 127.0.0.1, so a loopback check
    alone would expose this endpoint publicly. Fails closed when unconfigured."""
    secret = os.environ.get("INTERNAL_API_SECRET", "")
    provided = request.headers.get("X-Internal-Secret", "")
    if not secret or not hmac.compare_digest(secret.encode("utf-8"), provided.encode("utf-8")):
        abort(403)
    return _force_resync_response()


def _force_resync_response():
    """Shared body of both force-resync endpoints: drop the player + skin caches
    (the sync leader follows within ~5 s) and report the player count."""
    invalidate_caches()
    fresh = get_players()
    return jsonify({"ok": True, "players": len(fresh)})


def _reset_for_tests() -> None:
    """Test hook: forget the resync cooldown so tests are order-independent."""
    global _last_resync_at
    with _resync_lock:
        _last_resync_at = None
