"""Which Minecraft players the signed-in caller owns.

A player UUID is resolved to its name through usercache and checked against
the caller's linked accounts (users/{uid}.minecraftAccounts). The linked names
are cached per worker so the homes routes do not read Firestore on every
request, and every check fails closed when ownership cannot be determined.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional, Tuple

from flask import abort, g, jsonify

from .auth import _is_valid_uuid
from .player_data import get_uuid_to_name
from .user_docs import _read_user_doc

logger = logging.getLogger(__name__)

# uid -> (fetched_at, {lowercase linked names}). Cached so the ownership check
# does not hit Firestore on every homes request (which would burn the read
# quota and, once exhausted, break homes). Stale entries are served if a later
# refresh fails.
_owner_cache: dict[str, Tuple[float, set]] = {}
_OWNER_CACHE_TTL = 600.0  # seconds
# A cached miss older than this is re-read once: the account may have just been
# linked through another gunicorn worker, whose cache invalidation we can't see.
_OWNER_MISS_RECHECK_AGE = 5.0  # seconds
_owner_cache_lock = threading.Lock()


class _OwnershipUnavailable(Exception):
    """Ownership could not be determined: Firestore failed and nothing is cached."""


def _linked_minecraft_names(uid: Optional[str], max_age: float = _OWNER_CACHE_TTL) -> set:
    """Lowercase Minecraft usernames linked to this Firebase uid.

    Served from the cache while the entry is younger than ``max_age``. On a
    Firestore error a stale cached value is returned when available; otherwise
    _OwnershipUnavailable is raised so callers fail closed.
    """
    if not uid:
        return set()
    now = time.time()
    with _owner_cache_lock:
        cached = _owner_cache.get(uid)
    if cached and now - cached[0] < max_age:
        return cached[1]
    try:
        _, user_data = _read_user_doc(uid)
        accounts = user_data.get("minecraftAccounts") or {}
        names = {str(v).lower() for v in accounts.values() if v}
        with _owner_cache_lock:
            _owner_cache[uid] = (now, names)
        return names
    except Exception as exc:
        logger.warning("Ownership lookup failed for uid %s: %s", uid, exc)
        if cached:
            return cached[1]  # serve stale on a transient Firestore error
        raise _OwnershipUnavailable(uid) from exc


def _invalidate_owner_cache(uid: str) -> None:
    """Forget the cached linked names for uid (after a link/unlink)."""
    with _owner_cache_lock:
        _owner_cache.pop(uid, None)


def _user_owns_player(uuid: str) -> bool:
    """True if the authenticated caller owns the given Minecraft player UUID.

    Resolves the UUID to a username (usercache) and checks it against the
    caller's linked Minecraft accounts. Prevents one authenticated user from
    reading/mutating another player's EssentialsX homes (IDOR).

    Raises _OwnershipUnavailable (never allows) when Firestore is down and
    nothing is cached for the caller.
    """
    uid = getattr(g, "auth_uid", None)
    if not uid:
        return False
    name = get_uuid_to_name().get(uuid)
    if not name:
        return False
    if name.lower() in _linked_minecraft_names(uid):
        return True
    return name.lower() in _linked_minecraft_names(uid, max_age=_OWNER_MISS_RECHECK_AGE)


def _require_owned_player(uuid: str) -> None:
    """Abort unless uuid is a well-formed UUID of one of the caller's players:
    400 for a malformed UUID, 403 for someone else's player, and 503 (JSON
    error) when ownership can't be checked — fails closed, never open."""
    if not _is_valid_uuid(uuid):
        abort(400)
    try:
        owned = _user_owns_player(uuid)
    except _OwnershipUnavailable:
        response = jsonify({"error": "Ownership check unavailable, please retry shortly"})
        response.status_code = 503
        abort(response)
    if not owned:
        abort(403)
