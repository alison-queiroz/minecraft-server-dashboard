"""Request authentication and authorization shared by the API blueprints.

Firebase ID-token checks (require_auth, _optional_uid), the admin allow-lists
read from the environment (require_admin, _is_services_admin) and the small
request-input helpers every area uses.

_FIREBASE_INITIALIZED is the single source of truth for "Firebase is usable":
other modules read it as ``auth._FIREBASE_INITIALIZED`` at call time (never
``from .auth import _FIREBASE_INITIALIZED``, which would freeze a copy), so
tests patch it in one place: ``api.auth._FIREBASE_INITIALIZED``.
"""
# Production runs Python 3.9, where PEP 604 unions (`int | None`) in an
# annotation are evaluated at runtime and raise. Defer annotations so modern
# syntax stays safe — enforced across api/ by tests/test_python39_compat.py.
from __future__ import annotations

import logging
import os
import re
from functools import wraps
from typing import Optional

from flask import abort, g, request

from .firebase_init import ensure_initialized

logger = logging.getLogger(__name__)


# ── Firebase ID tokens ───────────────────────────────────────────────────────

_FIREBASE_INITIALIZED = False

def _init_firebase():
    """Delegates to the shared initializer; mirrors its result into the module
    flag that require_auth checks (kept for backward-compat and test patching)."""
    global _FIREBASE_INITIALIZED
    if _FIREBASE_INITIALIZED:
        return
    _FIREBASE_INITIALIZED = ensure_initialized()


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


def _optional_uid() -> Optional[str]:
    """Return the caller's Firebase uid if a valid Bearer token is present,
    else None. Never aborts — for endpoints that stay public but reveal more
    (e.g. the online player roster) only to authenticated callers. Uses the
    same lazy Firebase init as require_auth, so a fresh worker does not treat
    signed-in callers as anonymous; anonymous calls skip the init entirely."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    _init_firebase()
    if not _FIREBASE_INITIALIZED:
        return None
    try:
        from firebase_admin import auth as firebase_auth
        decoded = firebase_auth.verify_id_token(auth_header[len("Bearer "):])
        return decoded.get("uid")
    except Exception:
        return None


# ── Admin allow-lists (comma-separated Firebase uids in the environment) ─────

def _uids_from_env(name: str) -> set[str]:
    raw = os.environ.get(name, "")
    return {uid.strip() for uid in raw.split(",") if uid.strip()}


def _services_admin_uids() -> set[str]:
    return _uids_from_env("SERVICES_CATALOG_ADMIN_UIDS")


def _is_services_admin(uid: Optional[str]) -> bool:
    if not uid:
        return False
    return uid in _services_admin_uids()


def _admin_uids() -> set[str]:
    """Dashboard admins: ADMIN_UIDS, or SERVICES_CATALOG_ADMIN_UIDS when that
    is unset/blank (so existing deployments keep a working admin list)."""
    return _uids_from_env("ADMIN_UIDS") or _services_admin_uids()


def require_admin(f):
    """Route decorator, stacked under require_auth: 403 unless the caller's
    Firebase uid is one of _admin_uids()."""
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = getattr(g, "auth_uid", None)
        if not uid or uid not in _admin_uids():
            abort(403)
        return f(*args, **kwargs)
    return decorated


# ── Request input ────────────────────────────────────────────────────────────

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


def _is_valid_uuid(uuid: str) -> bool:
    """Strict hyphenated-UUID check, shared by the homes and advancements routes
    to block path-traversal / arbitrary-file inputs before any filesystem use."""
    return bool(_UUID_RE.fullmatch(uuid or ""))


def _json_body() -> dict:
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}
