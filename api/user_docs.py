"""users/{uid} profile documents, read with the Firebase Admin SDK.

Shared by the ownership check, the account/profile routes and the homes
visibility rules, so every users/{uid} read goes through _read_user_doc.
"""
from __future__ import annotations

from typing import Any, Tuple

_ACCOUNT_TYPES = ("java", "bedrock", "admin")


def _accounts_of(user_data: dict) -> dict:
    """The {java, bedrock, admin} -> name-or-None map of a users/{uid} doc."""
    raw = user_data.get("minecraftAccounts")
    raw = raw if isinstance(raw, dict) else {}
    return {t: (str(raw[t]) if raw.get(t) else None) for t in _ACCOUNT_TYPES}


def _read_user_doc(uid: str) -> Tuple[Any, dict]:
    """(Firestore client, users/{uid} data or {}), read with the Admin SDK."""
    from firebase_admin import firestore as admin_firestore
    db = admin_firestore.client()
    snap = db.collection("users").document(uid).get()
    return db, ((snap.to_dict() or {}) if snap.exists else {})
