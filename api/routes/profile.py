"""Profile routes: GET /api/profile (does the caller have a linked account),
the caller's homes grouped by linked Java account with their visibility
(GET /api/profile/homes, PUT /api/profile/homes/visibility) and the public
player card (GET /api/players/<uuid>/public-profile).

The public/private rules for homes live in api/home_visibility.py.
"""
from __future__ import annotations

import logging
from typing import Optional

from flask import Blueprint, abort, g, jsonify

from ..auth import _is_valid_uuid, _json_body, require_auth
from ..essentials_homes import read_essentials_homes
from ..home_visibility import (
    _BEDROCK_UUID_PREFIX,
    _effective_public_homes,
    _linked_java_players,
    _public_home_names,
    _write_public_homes,
)
from ..ownership import _require_owned_player
from ..player_data import get_uuid_to_name
from ..user_docs import _accounts_of, _read_user_doc
from .players import _is_valid_home_name

logger = logging.getLogger(__name__)

bp = Blueprint("profile", __name__)


@bp.route("/api/profile", methods=["GET"])
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
        _, user_data = _read_user_doc(uid)
        accounts = user_data.get("minecraftAccounts") or {}
    except Exception as exc:
        logger.warning("Profile lookup failed for uid %s: %s", uid, exc)
        return jsonify({"error": "Failed to read profile"}), 503
    has_linked = any(bool(v) for v in accounts.values())
    return jsonify({"hasLinkedAccount": has_linked})


# ── Homes & locations visibility (private unless marked public) ─────────────

_MAX_VISIBILITY_CHANGES = 200


@bp.route("/api/profile/homes", methods=["GET"])
@require_auth
def profile_homes_endpoint():
    """The caller's EssentialsX homes, grouped by linked Java account.

    Returns { "accounts": [{ "type", "name", "uuid",
    "homes": [{ name, world, x, y, z, isPublic }] }] } — one entry per linked
    java/admin account with a Java player (Bedrock players have no homes).
    """
    uid = getattr(g, "auth_uid", None)
    try:
        _, user_data = _read_user_doc(uid)
    except Exception as exc:
        logger.warning("Profile homes lookup failed for uid %s: %s", uid, exc)
        return jsonify({"error": "Failed to read profile"}), 503
    uuid_to_name = get_uuid_to_name()
    players = _linked_java_players(_accounts_of(user_data), uuid_to_name)
    accounts = []
    for account_type, name, uuid in players:
        public = _public_home_names(user_data, uuid, name, len(players) == 1)
        homes = [{**h, "isPublic": h["name"] in public} for h in read_essentials_homes(uuid)]
        accounts.append({"type": account_type, "name": name, "uuid": uuid, "homes": homes})
    return jsonify({"accounts": accounts})


@bp.route("/api/profile/homes/visibility", methods=["PUT"])
@require_auth
def profile_homes_visibility_endpoint():
    """Show or hide the caller's homes on their player card.

    Body JSON: { "homes": [{ "uuid", "name", "isPublic": bool }] } (1-200
    entries); every uuid must be one of the caller's players. Returns { ok }.
    """
    entries = _json_body().get("homes")
    if not isinstance(entries, list) or not 0 < len(entries) <= _MAX_VISIBILITY_CHANGES:
        abort(400)
    changes = []
    for entry in entries:
        if not isinstance(entry, dict):
            abort(400)
        uuid, name, is_public = entry.get("uuid"), entry.get("name"), entry.get("isPublic")
        if not isinstance(uuid, str) or not _is_valid_home_name(name) or not isinstance(is_public, bool):
            abort(400)
        changes.append((uuid, name, is_public))
    for uuid in sorted({c[0] for c in changes}):
        _require_owned_player(uuid)
    uid = getattr(g, "auth_uid", None)
    try:
        db, user_data = _read_user_doc(uid)
        public = _effective_public_homes(user_data, {c[0] for c in changes})
        for uuid, name, is_public in changes:
            if is_public:
                public[uuid].add(name)
            else:
                public[uuid].discard(name)
        _write_public_homes(db, uid, public)
    except Exception as exc:
        logger.warning("Home visibility write failed for uid %s: %s", uid, exc)
        return jsonify({"error": "Failed to save home visibility"}), 503
    return jsonify({"ok": True})


def _public_profile_of(name: str) -> Optional[dict]:
    """users/{uid} data of the user who linked this player name, via the
    usernames/{name} reverse lookup — only if that user still links it."""
    from firebase_admin import firestore as admin_firestore
    db = admin_firestore.client()
    lookup = db.collection("usernames").document(name).get()
    uid = (lookup.to_dict() or {}).get("uid") if lookup.exists else None
    if not uid:
        return None
    _, user_data = _read_user_doc(uid)
    linked = {v.lower() for v in _accounts_of(user_data).values() if v}
    return user_data if name.lower() in linked else None


def _public_locations(user_data: dict) -> list:
    locations = user_data.get("savedLocations")
    return [
        {
            "id": str(loc.get("id", "")),
            "name": str(loc.get("name", "")),
            "mapHash": str(loc.get("mapHash", "")),
            "description": str(loc.get("description", "")),
        }
        for loc in (locations if isinstance(locations, list) else [])
        if isinstance(loc, dict) and loc.get("isPublic") is True
    ]


@bp.route("/api/players/<uuid>/public-profile", methods=["GET"])
@require_auth
def public_profile_endpoint(uuid: str):
    """What any signed-in user may see about a player on the player card.

    Returns { "locations": [{ id, name, mapHash, description }],
    "homes": [{ name, world, x, y, z }] }: the linking user's saved locations
    and this player's homes that were marked public. Nothing else of the
    owner's profile leaves the server.
    """
    if not _is_valid_uuid(uuid):
        abort(400)
    uuid_to_name = get_uuid_to_name()
    name = uuid_to_name.get(uuid)
    empty = {"locations": [], "homes": []}
    if not name:
        return jsonify(empty)
    try:
        user_data = _public_profile_of(name)
    except Exception as exc:
        logger.warning("Public profile lookup failed for %s: %s", uuid, exc)
        return jsonify({"error": "Failed to read public profile"}), 503
    if user_data is None:
        return jsonify(empty)
    homes = []
    if not uuid.startswith(_BEDROCK_UUID_PREFIX):
        single = len(_linked_java_players(_accounts_of(user_data), uuid_to_name)) == 1
        public = _public_home_names(user_data, uuid, name, single)
        if public:
            homes = [h for h in read_essentials_homes(uuid) if h["name"] in public]
    return jsonify({"locations": _public_locations(user_data), "homes": homes})
