"""Helpers to sync player data to Firestore in the background."""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _to_native(value: Any) -> Any:
    """Recursively convert nbtlib / non-serialisable types to plain Python."""
    if isinstance(value, dict):
        return {k: _to_native(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_native(v) for v in value]
    # bool must be checked before int (bool is a subclass of int)
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    if isinstance(value, str) or value is None:
        return value
    return str(value)


def sync_players(players: list[dict[str, Any]]) -> None:
    """Batch-upsert all players into Firestore `players/{uuid}`."""
    try:
        from firebase_admin import firestore as fb_firestore  # lazy import

        db = fb_firestore.client()
        batch = db.batch()
        for player in players:
            ref = db.collection("players").document(player["uuid"])
            batch.set(ref, _to_native(player))
        batch.commit()
        logger.debug("Synced %d player(s) to Firestore.", len(players))
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Firestore player sync failed: %s", exc)
