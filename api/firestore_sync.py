"""Helpers to sync player data to Firestore in the background.

sync_players (called only by the sync leader) writes the minute's analytics
snapshot and the player docs that changed; the local JSONL snapshot store it
appends to lives in api/snapshot_store.py.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any, Optional, Tuple

from .firebase_init import ensure_initialized
from .snapshot_store import _write_local_snapshot

logger = logging.getLogger(__name__)


def _ensure_firebase() -> bool:
    """Initialize Firebase Admin SDK if not already done. Returns True on success."""
    return ensure_initialized()


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


# Leader-only sync state (see sync_players), guarded by _sync_lock.
_written_hashes: dict[str, str] = {}  # uuid -> hash of the last committed doc
_last_snapshot_minute: Optional[str] = None
_sync_lock = threading.Lock()

_MC_HOST = os.environ.get("MC_HOST", "localhost")
_MC_PORT = int(os.environ.get("MC_PORT", "25565"))


def _get_online_from_server() -> tuple[list[str], int]:
    """Return the current online roster from the live Java server via mcstatus.

    This is the same authoritative source used by /api/status — replacing the
    old latest.log scraping, which re-read the whole (potentially huge) file
    every minute, missed players across log rotations / crash-without-leave, and
    could be fooled by chat lines. `count` comes from players.online (accurate
    even when the player sample is truncated); names come from the sample when
    available. Returns ([], 0) if the server is unreachable.
    """
    try:
        from mcstatus import JavaServer
        status = JavaServer(_MC_HOST, _MC_PORT, timeout=3).status()
        players = getattr(status, "players", None)
        count = int(getattr(players, "online", 0) or 0) if players is not None else 0
        sample = getattr(players, "sample", None) if players is not None else None
        names = sorted(p.name for p in sample) if sample else []
        return names, count
    except Exception as exc:
        logger.debug("mcstatus query for online players failed: %s", exc)
        return [], 0


def _doc_hash(doc: dict[str, Any]) -> str:
    """Stable content hash of a Firestore-ready player doc."""
    canonical = json.dumps(doc, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def sync_players(players: list[dict[str, Any]]) -> None:
    """Write this minute's analytics snapshot and the player docs that changed.

    Only the sync leader calls this (player_sync._background_sync_loop), so a
    snapshot line / player doc is written by one process, not once per worker.

    - Analytics: at most one {ts, count} snapshot per UTC minute, appended to
      the local JSONL (always, even without Firestore) and upserted to
      Firestore ``snapshots/<YYYY-MM-DDTHH:MM>``.
    - Players: ``players/<uuid>`` is written only when the doc's content hash
      differs from the last successful commit by this process, so a quiet
      server costs one write per minute instead of N+1. The first sync after
      start (empty hash map) writes every player; a failed commit leaves the
      hashes untouched so those docs are retried on the next sync.
    - Players that disappear from disk are never deleted: their last doc stays
      in Firestore (unchanged upsert-only behaviour).
    """
    global _last_snapshot_minute
    with _sync_lock:
        now = datetime.now(timezone.utc)
        minute = now.strftime("%Y-%m-%dT%H:%M")
        snapshot: Optional[dict[str, int]] = None
        if minute != _last_snapshot_minute:
            ts = int(now.timestamp())
            _, online_count = _get_online_from_server()
            _write_local_snapshot(ts, online_count)
            _last_snapshot_minute = minute
            snapshot = {"ts": ts, "count": online_count}

        if not _ensure_firebase():
            return
        changed: list[Tuple[str, dict[str, Any], str]] = []
        for player in players:
            doc = _to_native(player)
            digest = _doc_hash(doc)
            if _written_hashes.get(player["uuid"]) != digest:
                changed.append((player["uuid"], doc, digest))
        if not changed and snapshot is None:
            return
        try:
            from firebase_admin import firestore as fb_firestore  # lazy import

            db = fb_firestore.client()
            batch = db.batch()
            for uuid, doc, _ in changed:
                batch.set(db.collection("players").document(uuid), doc)
            if snapshot is not None:
                batch.set(db.collection("snapshots").document(minute), snapshot, merge=True)
            batch.commit()
        except Exception:  # pylint: disable=broad-except
            logger.warning("Firestore player sync failed", exc_info=True)
            return
        for uuid, _, digest in changed:
            _written_hashes[uuid] = digest
        logger.debug("Synced %d of %d player doc(s) to Firestore.", len(changed), len(players))
