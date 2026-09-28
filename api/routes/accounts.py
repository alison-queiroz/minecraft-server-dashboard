"""Minecraft account linking: POST /api/profile/accounts links a java,
bedrock or admin account once the player's AuthMe password checks out, and
DELETE /api/profile/accounts/<type> unlinks one. Both write users/{uid} and
the usernames/{name} reverse lookup server-side with the Admin SDK.

Password attempts are rate-limited per caller uid and per target username in
a SQLite file shared by every gunicorn worker.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Optional, Tuple

from flask import Blueprint, g, jsonify

from ..auth import _json_body, require_auth
from ..ownership import _invalidate_owner_cache
from ..player_data import get_op_names, get_uuid_to_name
from ..user_docs import _ACCOUNT_TYPES, _accounts_of, _read_user_doc

logger = logging.getLogger(__name__)

bp = Blueprint("accounts", __name__)


_AUTHME_DB_PATH = os.environ.get(
    "AUTHME_DB",
    "/home/opc/minecraft/plugins/AuthMe/authme.db",
)
# bcrypt hash of a throwaway secret, checked when the username is unknown so a
# miss costs the same bcrypt time as a wrong password (no enumeration by timing).
_DUMMY_BCRYPT_HASH = b"$2b$10$Nz1ImKPqrvrAV9lZUsPs7eJN0fu/LqWWUuryI4pfwD.EI3daZ3yNu"

# Password attempts are counted in a small SQLite file so every gunicorn worker
# shares one budget and a restart doesn't reset it. Each attempt spends from two
# budgets: the caller's uid (one account hammering) and the target username
# (many Google accounts guessing one player's password).
_VERIFY_RATE_LIMIT_DB = os.environ.get(
    "VERIFY_RATE_LIMIT_DB",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "verify_rate_limit.sqlite3"),
)
_RL_UID_WINDOW = 60.0
_RL_UID_MAX = 10
_RL_USERNAME_WINDOW = 15 * 60.0
_RL_USERNAME_MAX = 5

# Java names plus Floodgate's Bedrock prefixes (e.g. ".Steve"). Also keeps the
# name safe as a Firestore document id (no "/", no whitespace).
_MC_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.*-]{1,64}$")
_MAX_PASSWORD_LEN = 256
_BCRYPT_MAX_BYTES = 72


class _AuthMeUnavailable(Exception):
    """The AuthMe database could not be opened or queried."""


def _authme_password_matches(username: str, password: str) -> bool:
    """True if password is the player's AuthMe password: bcrypt, or the legacy
    $SHA$<salt>$<hash> format where hash = sha256(sha256_hex(password) + salt).

    The DB is opened read-only and queried by the lowercased name (AuthMe
    stores ``username`` lowercase), so the column index is used.
    """
    import sqlite3
    import bcrypt as _bcrypt

    try:
        conn = sqlite3.connect(Path(_AUTHME_DB_PATH).resolve().as_uri() + "?mode=ro", uri=True)
        try:
            row = conn.execute(
                "SELECT password FROM authme WHERE username = ?", (username.lower(),)
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.OperationalError as exc:
        raise _AuthMeUnavailable(str(exc)) from exc

    stored = str(row[0]) if row and row[0] else ""
    secret = password.encode("utf-8")
    # bcrypt only ever uses the first 72 bytes. AuthMe's jBCrypt truncates
    # silently, while bcrypt>=5 raises ValueError instead, so truncate the same way.
    bcrypt_secret = secret[:_BCRYPT_MAX_BYTES]
    if stored.startswith(("$2a$", "$2y$", "$2b$")):
        # The bcrypt package only accepts the $2b$ spelling of the same algorithm.
        return _bcrypt.checkpw(bcrypt_secret, ("$2b$" + stored[4:]).encode("utf-8"))
    if stored.startswith("$SHA$"):
        parts = stored.split("$")  # ['', 'SHA', salt, hash]
        if len(parts) == 4:
            inner = hashlib.sha256(secret).hexdigest()
            outer = hashlib.sha256((inner + parts[2]).encode("utf-8")).hexdigest()
            return hmac.compare_digest(outer, parts[3])
    if row is not None:
        logger.warning("Unrecognised AuthMe password hash for user %s", username)
    _bcrypt.checkpw(bcrypt_secret, _DUMMY_BCRYPT_HASH)
    return False


def _consume_verify_attempt(uid: str, username: str) -> bool:
    """Record one password attempt. False (and nothing recorded) once the uid's
    or the target username's budget for its window is spent. Raises
    sqlite3.Error when the store is unusable, so callers can fail closed."""
    import sqlite3

    now = time.time()
    budgets = (
        (f"uid:{uid}", _RL_UID_WINDOW, _RL_UID_MAX),
        (f"user:{username.lower()}", _RL_USERNAME_WINDOW, _RL_USERNAME_MAX),
    )
    conn = sqlite3.connect(_VERIFY_RATE_LIMIT_DB, timeout=5.0, isolation_level=None)
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS attempts (key TEXT NOT NULL, ts REAL NOT NULL)")
        conn.execute("CREATE INDEX IF NOT EXISTS attempts_key_ts ON attempts (key, ts)")
        # IMMEDIATE takes the write lock up front: check-then-insert is atomic across workers.
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                "DELETE FROM attempts WHERE ts <= ?", (now - max(_RL_UID_WINDOW, _RL_USERNAME_WINDOW),)
            )
            allowed = all(
                conn.execute(
                    "SELECT COUNT(*) FROM attempts WHERE key = ? AND ts > ?", (key, now - window)
                ).fetchone()[0] < limit
                for key, window, limit in budgets
            )
            if allowed:
                conn.executemany(
                    "INSERT INTO attempts (key, ts) VALUES (?, ?)", [(key, now) for key, _, _ in budgets]
                )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()
    return allowed


def _account_error(status: int, code: str, message: str) -> Tuple[Any, int]:
    """Error response for the account endpoints; the frontend branches on ``code``."""
    return jsonify({"error": message, "code": code}), status


def _password_check_error(uid: str, username: str, password: str) -> Optional[Tuple[Any, int]]:
    """Validate the credentials, spend a rate-limit attempt and verify the AuthMe
    password. None when the password is correct, else the error response."""
    if not username or not password:
        return _account_error(400, "invalid_request", "Missing username or password")
    if not _MC_USERNAME_RE.fullmatch(username) or len(password) > _MAX_PASSWORD_LEN:
        return _account_error(400, "invalid_request", "Invalid username or password")
    try:
        allowed = _consume_verify_attempt(uid, username)
    except Exception as exc:
        logger.error("Password-attempt store unavailable at %s: %s", _VERIFY_RATE_LIMIT_DB, exc)
        return _account_error(503, "unavailable", "Verification is temporarily unavailable")
    if not allowed:
        return _account_error(429, "rate_limited", "Too many attempts. Please wait.")
    try:
        valid = _authme_password_matches(username, password)
    except _AuthMeUnavailable as exc:
        logger.warning("AuthMe DB not available at %s: %s", _AUTHME_DB_PATH, exc)
        return _account_error(503, "unavailable", "AuthMe database not available")
    except Exception as exc:
        logger.error("AuthMe password verification error: %s", exc)
        return _account_error(500, "failed", "Verification failed")
    if not valid:
        return _account_error(403, "invalid_credentials", "Incorrect in-game credentials")
    return None


def _canonical_player_name(username: str) -> str:
    """The usercache spelling of a player name (AuthMe matches any case, while
    player cards and ownership use the real name); the input when unknown."""
    lowered = username.lower()
    return next((n for n in get_uuid_to_name().values() if n.lower() == lowered), username)


def _is_server_operator(username: str) -> bool:
    lowered = username.lower()
    return any(n.lower() == lowered for n in get_op_names())


def _save_account_link(uid: str, account_type: str, name: Optional[str]) -> dict:
    """Set (or clear, with name=None) one linked account on users/{uid} and keep
    the usernames/{name} reverse lookup in step, in one batch. The previous
    name's lookup is dropped only when it points at this uid (or is a legacy
    entry without one) and no other account type still uses that name."""
    db, user_data = _read_user_doc(uid)
    accounts = _accounts_of(user_data)
    previous = accounts[account_type]
    accounts[account_type] = name
    batch = db.batch()
    if previous and previous not in accounts.values():
        previous_ref = db.collection("usernames").document(previous)
        previous_snap = previous_ref.get()
        owner = (previous_snap.to_dict() or {}).get("uid") if previous_snap.exists else None
        if previous_snap.exists and (not owner or owner == uid):
            batch.delete(previous_ref)
    batch.set(db.collection("users").document(uid), {"minecraftAccounts": accounts}, merge=True)
    if name:
        batch.set(
            db.collection("usernames").document(name), {"uid": uid, "type": account_type}, merge=True
        )
    batch.commit()
    return accounts


@bp.route("/api/profile/accounts", methods=["POST"])
@require_auth
def link_account_endpoint():
    """Link a Minecraft account to the caller after verifying its AuthMe password.

    Body JSON: { "type": "java" | "bedrock" | "admin", "username", "password" }
    The admin account must be a server operator (ops.json). The link and the
    usernames/{name} reverse lookup are written here with the Admin SDK; the
    browser can no longer write them (see firestore.rules).
    Returns { "minecraftAccounts": { java, bedrock, admin } }; errors are
    { "error", "code" } with code invalid_request | not_operator | rate_limited
    | invalid_credentials | unavailable | failed.
    """
    uid = getattr(g, "auth_uid", None)
    body = _json_body()
    account_type = body.get("type")
    username = str(body.get("username") or "").strip()
    password = str(body.get("password") or "")
    if account_type not in _ACCOUNT_TYPES:
        return _account_error(400, "invalid_request", "Unknown account type")
    if account_type == "admin" and username and not _is_server_operator(username):
        return _account_error(403, "not_operator", "Only server operators can be linked as admin")
    error = _password_check_error(uid, username, password)
    if error:
        return error
    try:
        accounts = _save_account_link(uid, account_type, _canonical_player_name(username))
    except Exception as exc:
        logger.warning("Linking the %s account failed for uid %s: %s", account_type, uid, exc)
        return _account_error(503, "unavailable", "Failed to save the linked account")
    _invalidate_owner_cache(uid)
    return jsonify({"minecraftAccounts": accounts})


@bp.route("/api/profile/accounts/<account_type>", methods=["DELETE"])
@require_auth
def unlink_account_endpoint(account_type: str):
    """Unlink one account type from the caller.

    Returns { "minecraftAccounts": { java, bedrock, admin } }.
    """
    if account_type not in _ACCOUNT_TYPES:
        return _account_error(400, "invalid_request", "Unknown account type")
    uid = getattr(g, "auth_uid", None)
    try:
        accounts = _save_account_link(uid, account_type, None)
    except Exception as exc:
        logger.warning("Unlinking the %s account failed for uid %s: %s", account_type, uid, exc)
        return _account_error(503, "unavailable", "Failed to unlink the account")
    _invalidate_owner_cache(uid)
    return jsonify({"minecraftAccounts": accounts})
