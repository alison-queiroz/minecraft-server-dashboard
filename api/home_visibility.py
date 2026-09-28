"""Homes visibility: which of a player's EssentialsX homes are public.

users/{uid}.publicHomes maps a player UUID to the names of that player's
homes shown on the player card. Profiles that predate it carry the old
browser-written users/{uid}.savedHomes [{name, isPublic, ...}], whose names
were prefixed "Player:" when several Java accounts were linked; it is read as
a fallback until the owner next changes that player's visibility.

Shared by the homes routes (a delete/rename carries the flag along) and the
profile routes (listing, toggling and the public player card).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from flask import g

from .player_data import get_uuid_to_name
from .user_docs import _accounts_of, _read_user_doc

logger = logging.getLogger(__name__)

_BEDROCK_UUID_PREFIX = "00000000-0000-0000-0009"


def _linked_java_players(accounts: dict, uuid_to_name: dict) -> list:
    """(type, name, uuid) for the linked java/admin accounts that resolve to a
    Java player in usercache — the ones EssentialsX keeps homes for."""
    by_name: dict = {}
    for uuid, name in uuid_to_name.items():
        if not uuid.startswith(_BEDROCK_UUID_PREFIX):
            by_name.setdefault(name.lower(), (name, uuid))
    players = []
    for account_type in ("java", "admin"):
        linked = accounts.get(account_type)
        match = by_name.get(linked.lower()) if linked else None
        if match and all(match[1] != p[2] for p in players):
            players.append((account_type, match[0], match[1]))
    return players


def _public_home_names(user_data: dict, uuid: str, player_name: str, single_player: bool) -> set:
    """Names of the player's homes marked public; empty (private) by default."""
    stored = user_data.get("publicHomes")
    if isinstance(stored, dict) and isinstance(stored.get(uuid), list):
        return {str(n) for n in stored[uuid]}
    legacy = user_data.get("savedHomes")
    names = set()
    prefix = f"{player_name}:"
    for entry in legacy if isinstance(legacy, list) else []:
        if not isinstance(entry, dict) or entry.get("isPublic") is not True:
            continue
        stored_name = str(entry.get("name", ""))
        if stored_name.startswith(prefix):
            names.add(stored_name[len(prefix):])
        elif single_player:
            names.add(stored_name)
    return names


def _effective_public_homes(user_data: dict, uuids: set) -> dict:
    """{uuid: set of public home names} for the given player UUIDs."""
    uuid_to_name = get_uuid_to_name()
    single = len(_linked_java_players(_accounts_of(user_data), uuid_to_name)) == 1
    return {u: _public_home_names(user_data, u, uuid_to_name.get(u, ""), single) for u in uuids}


def _write_public_homes(db: Any, uid: str, public_by_uuid: dict) -> None:
    db.collection("users").document(uid).set(
        {"publicHomes": {u: sorted(names) for u, names in public_by_uuid.items()}}, merge=True
    )


def _carry_home_visibility(uuid: str, name: str, new_name: Optional[str]) -> None:
    """Keep visibility in step with a dashboard delete (new_name=None: a
    re-created home starts private again) or rename (the flag moves along).
    Best-effort: the EssentialsX change has already happened."""
    uid = getattr(g, "auth_uid", None)
    try:
        db, user_data = _read_user_doc(uid)
        public = _effective_public_homes(user_data, {uuid})[uuid]
        if name not in public:
            return
        public.discard(name)
        if new_name:
            public.add(new_name)
        _write_public_homes(db, uid, {uuid: public})
    except Exception as exc:
        logger.warning("Home visibility update failed for %s/%s: %s", uuid, name, exc)
