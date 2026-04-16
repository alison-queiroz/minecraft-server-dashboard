"""Helpers to sync player data to Firestore in the background."""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Local fallback file for analytics snapshots (one JSON object per line).
# Written on every sync so analytics works even when Firestore is unavailable.
_LOCAL_SNAPSHOTS_PATH = os.environ.get(
    "LOCAL_SNAPSHOTS_PATH",
    os.path.join(os.path.dirname(__file__), "..", "analytics_snapshots.jsonl"),
)
_LOCAL_SNAPSHOTS_MAX_DAYS = 365

_firebase_initialized = False
_firebase_init_warned = False


def _ensure_firebase() -> bool:
    """Initialize Firebase Admin SDK if not already done. Returns True on success."""
    global _firebase_initialized, _firebase_init_warned
    if _firebase_initialized:
        return True
    try:
        import firebase_admin
        from firebase_admin import credentials
        # Avoid re-initializing if another code path already did it
        if not firebase_admin._apps:
            sa_path = os.environ.get(
                "FIREBASE_SA_KEY",
                "/home/opc/minecraft/firebase-service-account.json",
            )
            cred = credentials.Certificate(sa_path)
            firebase_admin.initialize_app(cred)
        _firebase_initialized = True
        return True
    except Exception as exc:
        if not _firebase_init_warned:
            logger.warning("Firebase init failed in sync thread: %s", exc)
            _firebase_init_warned = True
        else:
            logger.debug("Firebase init failed in sync thread: %s", exc)
        return False


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


def _write_local_snapshot(ts: int, online: list[str], count: int) -> None:
    """Append a snapshot to the local JSONL file, pruning entries older than 1 year."""
    try:
        path = os.path.abspath(_LOCAL_SNAPSHOTS_PATH)
        cutoff = ts - _LOCAL_SNAPSHOTS_MAX_DAYS * 86_400
        entry = json.dumps({"ts": ts, "online": online, "count": count})

        # Read existing lines, filter stale ones, append new entry
        existing: list[str] = []
        if os.path.exists(path):
            with open(path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        if json.loads(line).get("ts", 0) >= cutoff:
                            existing.append(line)
                    except json.JSONDecodeError:
                        pass
        existing.append(entry)
        with open(path, "w") as f:
            f.write("\n".join(existing) + "\n")
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
    return sorted(results, key=lambda s: s["ts"])


_LOG_FILE = os.environ.get("MC_LOG_FILE", "logs/latest.log")


def _get_online_from_server() -> tuple[list[str], int]:
    """Parse the server's latest.log to determine which players are currently online.
    Tracks join/leave events from the beginning of the log file.
    Falls back to ([], 0) if the log file is unreadable."""
    if not os.path.exists(_LOG_FILE):
        logger.debug("Log file not found: %s", _LOG_FILE)
        return [], 0
    online: set[str] = set()
    join_re  = re.compile(r'\[.*?/INFO\].*?: (\S+) joined the game')
    leave_re = re.compile(r'\[.*?/INFO\].*?: (\S+) left the game')
    try:
        with open(_LOG_FILE, "r", errors="replace") as f:
            for line in f:
                m = join_re.search(line)
                if m:
                    online.add(m.group(1))
                    continue
                m = leave_re.search(line)
                if m:
                    online.discard(m.group(1))
    except Exception as exc:
        logger.debug("Could not parse log file: %s", exc)
        return [], 0
    names = sorted(online)
    return names, len(names)


def sync_players(players: list[dict[str, Any]]) -> None:
    """Upsert all players into Firestore and write an analytics snapshot.
    Also writes the snapshot locally as a fallback for when Firestore is unavailable."""
    now = datetime.now(timezone.utc)
    ts = int(now.timestamp())
    online_names, online_count = _get_online_from_server()

    # Always write to local file regardless of Firestore availability
    _write_local_snapshot(ts, online_names, online_count)

    if not _ensure_firebase():
        return
    try:
        from firebase_admin import firestore as fb_firestore  # lazy import

        db = fb_firestore.client()
        batch = db.batch()
        for player in players:
            ref = db.collection("players").document(player["uuid"])
            batch.set(ref, _to_native(player))

        # Write analytics snapshot (minute-level granularity)
        snapshot_id = now.strftime("%Y-%m-%dT%H:%M")
        snapshot_ref = db.collection("snapshots").document(snapshot_id)
        batch.set(snapshot_ref, {
            "ts": ts,
            "online": online_names,
            "count": online_count,
        }, merge=True)

        batch.commit()
        logger.debug("Synced %d player(s) to Firestore.", len(players))
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Firestore player sync failed: %s", exc)
