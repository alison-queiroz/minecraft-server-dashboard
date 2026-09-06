"""Helpers to sync player data to Firestore in the background."""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

from .firebase_init import ensure_initialized

logger = logging.getLogger(__name__)

# Local fallback file for analytics snapshots (one JSON object per line).
# Written on every sync so analytics works even when Firestore is unavailable.
_LOCAL_SNAPSHOTS_PATH = os.environ.get(
    "LOCAL_SNAPSHOTS_PATH",
    os.path.join(os.path.dirname(__file__), "..", "analytics_snapshots.jsonl"),
)
_LOCAL_SNAPSHOTS_MAX_DAYS = 365

# Retained for backward-compat / tests; the real init state lives in firebase_init.
_firebase_initialized = False

# Serializes appends so concurrent sync threads can't interleave and corrupt
# the JSONL file (the old full read-rewrite had no lock).
_snapshot_write_lock = threading.Lock()
_writes_since_prune = 0
_PRUNE_EVERY = 1440  # prune stale lines once per ~day of minute snapshots


def _ensure_firebase() -> bool:
    """Initialize Firebase Admin SDK if not already done. Returns True on success."""
    global _firebase_initialized
    _firebase_initialized = ensure_initialized()
    return _firebase_initialized


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


def _prune_local_snapshots(now_ts: int) -> None:
    """Drop snapshot lines older than the retention window (single rewrite).

    Called from _write_local_snapshot on a schedule (not every write) while the
    snapshot write lock is held.
    """
    path = os.path.abspath(_LOCAL_SNAPSHOTS_PATH)
    if not os.path.exists(path):
        return
    cutoff = now_ts - _LOCAL_SNAPSHOTS_MAX_DAYS * 86_400
    kept: list[str] = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                if json.loads(line).get("ts", 0) >= cutoff:
                    kept.append(line)
            except json.JSONDecodeError:
                pass
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write("\n".join(kept) + ("\n" if kept else ""))
    os.replace(tmp, path)


def _write_local_snapshot(ts: int, count: int) -> None:
    """Append one analytics snapshot line to the local JSONL file.

    O(1) append under a lock (concurrent writers previously could interleave a
    full read-rewrite and truncate/duplicate the file). Stale entries are pruned
    on a schedule via _prune_local_snapshots rather than on every write. Only
    {ts, count} is stored: the online-name roster is never read back and was
    pure storage/wire waste.
    """
    global _writes_since_prune
    try:
        path = os.path.abspath(_LOCAL_SNAPSHOTS_PATH)
        entry = json.dumps({"ts": ts, "count": count})
        with _snapshot_write_lock:
            with open(path, "a") as f:
                f.write(entry + "\n")
            _writes_since_prune += 1
            if _writes_since_prune >= _PRUNE_EVERY:
                _writes_since_prune = 0
                _prune_local_snapshots(ts)
    except Exception as exc:
        logger.debug("Could not write local snapshot: %s", exc)


def read_local_snapshots(since: int) -> list[dict[str, Any]]:
    """Read snapshots from the local JSONL fallback file."""
    path = os.path.abspath(_LOCAL_SNAPSHOTS_PATH)
    if not os.path.exists(path):
        return []
    results = []
    try:
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    snap = json.loads(line)
                    if snap.get("ts", 0) >= since:
                        results.append(snap)
                except json.JSONDecodeError:
                    pass
    except Exception as exc:
        logger.debug("Could not read local snapshots: %s", exc)
    return sorted(results, key=lambda s: s.get("ts", 0))


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


def sync_players(players: list[dict[str, Any]]) -> None:
    """Upsert all players into Firestore and write an analytics snapshot.
    Also writes the snapshot locally as a fallback for when Firestore is unavailable."""
    now = datetime.now(timezone.utc)
    ts = int(now.timestamp())
    _, online_count = _get_online_from_server()

    # Always write to local file regardless of Firestore availability
    _write_local_snapshot(ts, online_count)

    if not _ensure_firebase():
        return
    try:
        from firebase_admin import firestore as fb_firestore  # lazy import

        db = fb_firestore.client()
        batch = db.batch()
        for player in players:
            ref = db.collection("players").document(player["uuid"])
            batch.set(ref, _to_native(player))

        # Write analytics snapshot (minute-level granularity). Only {ts, count}
        # is stored — the online-name roster is never read back by any consumer.
        snapshot_id = now.strftime("%Y-%m-%dT%H:%M")
        snapshot_ref = db.collection("snapshots").document(snapshot_id)
        batch.set(snapshot_ref, {
            "ts": ts,
            "count": online_count,
        }, merge=True)

        batch.commit()
        logger.debug("Synced %d player(s) to Firestore.", len(players))
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Firestore player sync failed: %s", exc)
