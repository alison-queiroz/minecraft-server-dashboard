from __future__ import annotations

import glob
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

try:
    import fcntl
    _FCNTL_AVAILABLE = True
except ImportError:
    _FCNTL_AVAILABLE = False  # Windows (dev only)

import nbtlib

from .skin_resolver import get_skin_url
from .firestore_sync import sync_players

logger = logging.getLogger(__name__)

_PLAYERDATA_DIR = os.path.join("world", "playerdata")
_STATS_DIR = os.path.join("world", "stats")
_USERCACHE_FILE = "usercache.json"
_CACHE_TTL = 60  # seconds — also controls Firestore sync frequency

_SYNC_LOCK_PATH = "/tmp/minecraft-api-bg-sync.lock"
_sync_lock_fd = None


def _acquire_sync_lock() -> bool:
    """Try to acquire an exclusive file lock so only one Gunicorn worker
    runs the background sync thread (avoids duplicate Firestore writes)."""
    global _sync_lock_fd
    if not _FCNTL_AVAILABLE:
        return True  # single-process dev env, always run
    try:
        _sync_lock_fd = open(_SYNC_LOCK_PATH, "w")
        fcntl.flock(_sync_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True  # lock held for lifetime of this process
    except OSError:
        return False  # another worker already holds the lock


_DIMENSIONS: dict[str, str] = {
    "minecraft:overworld": "Overworld",
    "minecraft:the_nether": "Nether",
    "minecraft:the_end": "The End",
}


@dataclass
class _Cache:
    data: list[dict[str, Any]] = field(default_factory=list)
    last_updated: float = 0.0

    def is_stale(self) -> bool:
        return time.time() - self.last_updated > _CACHE_TTL

    def refresh(self, data: list[dict[str, Any]]) -> None:
        self.data = data
        self.last_updated = time.time()


_cache = _Cache()


def _map_uuids() -> dict[str, str]:
    if not os.path.exists(_USERCACHE_FILE):
        return {}
    try:
        with open(_USERCACHE_FILE, "r") as f:
            return {entry["uuid"]: entry["name"] for entry in json.load(f)}
    except (json.JSONDecodeError, KeyError):
        logger.warning("Failed to parse %s", _USERCACHE_FILE)
        return {}


def _dimension_name(dim_id: Any) -> str:
    return _DIMENSIONS.get(str(dim_id), "Unknown")


def _read_stats(uuid: str) -> dict[str, Any]:
    """Returns the minecraft:custom stats dict for a given player UUID, or {}."""
    stats_file = os.path.join(_STATS_DIR, f"{uuid}.json")
    if not os.path.exists(stats_file):
        return {}
    try:
        with open(stats_file, "r") as f:
            data = json.load(f)
        return data.get("stats", {}).get("minecraft:custom", {})
    except Exception:
        return {}


_ADVANCEMENTS_DIR = os.path.join("world", "advancements")


def _count_advancements(uuid: str) -> int:
    """Quick count of completed non-recipe advancements for the given UUID."""
    adv_file = os.path.join(_ADVANCEMENTS_DIR, f"{uuid}.json")
    if not os.path.exists(adv_file):
        return 0
    try:
        with open(adv_file, "r") as f:
            data = json.load(f)
        return sum(
            1 for k, v in data.items()
            if k != "DataVersion" and "recipe" not in k
            and isinstance(v, dict) and v.get("done", False)
        )
    except Exception:
        return 0


def _parse_player(filepath: str, uuid_to_name: dict[str, str]) -> Optional[dict[str, Any]]:
    uuid = os.path.basename(filepath).replace(".dat", "")
    name = uuid_to_name.get(uuid, "Unknown")
    last_seen = datetime.fromtimestamp(os.path.getmtime(filepath)).strftime("%Y-%m-%d %H:%M")
    try:
        nbt_data = nbtlib.load(filepath)
        custom_stats = _read_stats(uuid)
        # play_time is in ticks (20/s); 72 000 ticks = 1 hour
        play_ticks = int(custom_stats.get("minecraft:play_time", 0))
        play_hours = round(play_ticks / 72_000, 1)
        return {
            "name": name,
            "uuid": uuid,
            "level": int(nbt_data.get("XpLevel", 0)),
            "health": round(float(nbt_data.get("Health", 0)), 1),
            "dimension": _dimension_name(nbt_data.get("Dimension", "Unknown")),
            "pos": nbt_data.get("Pos", [0, 0, 0]),
            "last_seen": last_seen,
            "skin_url": get_skin_url(name, uuid),
            "is_raw_skin": True,
            "play_hours": play_hours,
            "advancement_count": _count_advancements(uuid),
        }
    except Exception:
        logger.warning("Failed to parse NBT for %s (%s)", name, filepath)
        return None


def _fetch_live() -> list[dict[str, Any]]:
    if not os.path.exists(_PLAYERDATA_DIR):
        return []
    uuid_to_name = _map_uuids()
    players = [
        player
        for filepath in glob.glob(os.path.join(_PLAYERDATA_DIR, "*.dat"))
        if (player := _parse_player(filepath, uuid_to_name)) is not None
    ]
    players.sort(key=lambda p: p["level"], reverse=True)
    return players


def get_players() -> list[dict[str, Any]]:
    if _cache.is_stale():
        fresh = _fetch_live()
        _cache.refresh(fresh)
        threading.Thread(target=sync_players, args=(fresh,), daemon=True).start()
    return _cache.data


class _FileWatcher:
    """Watches a directory for .dat file mtime changes."""

    def __init__(self, directory: str) -> None:
        self.directory = directory
        self._mtimes: dict[str, float] = {}

    def has_changes(self) -> bool:
        changed = False
        for filepath in glob.glob(os.path.join(self.directory, "*.dat")):
            mtime = os.path.getmtime(filepath)
            if self._mtimes.get(filepath) != mtime:
                self._mtimes[filepath] = mtime
                changed = True
        return changed


def _background_sync_loop() -> None:
    """Event-driven Firestore sync: fires when player .dat files change.

    Behaviour:
    - Polls for file changes every 5 s (cheap mtime check, no I/O)
    - Debounce: waits 10 s of quiet before syncing (absorbs burst saves)
    - Rate-limit: minimum 60 s between consecutive Firestore writes
    - Backoff: on error, increases wait up to 5 min before retrying
    """
    watcher = _FileWatcher(_PLAYERDATA_DIR)
    last_sync: float = 0.0
    last_change: float = 0.0
    backoff: float = 0.0
    _DEBOUNCE  = 10.0   # seconds of quiet before syncing
    _MIN_INTERVAL = 60.0  # minimum seconds between syncs

    while True:
        time.sleep(5)

        if watcher.has_changes():
            last_change = time.time()

        if last_change == 0.0:
            continue  # nothing has changed yet since startup

        now = time.time()
        quiet_for   = now - last_change
        since_last  = now - last_sync + backoff

        if quiet_for >= _DEBOUNCE and since_last >= _MIN_INTERVAL:
            try:
                get_players()
                last_sync = time.time()
                backoff = 0.0
                logger.debug("Event-driven sync completed.")
            except Exception:
                backoff = min(backoff + 60.0, 300.0)
                logger.warning("Background player sync failed (backoff %.0fs)", backoff, exc_info=True)


_bg_sync_thread: threading.Thread | None = None
if _acquire_sync_lock():
    _bg_sync_thread = threading.Thread(
        target=_background_sync_loop, daemon=True, name="player-bg-sync"
    )
    _bg_sync_thread.start()
    logger.info("Background sync thread started (this worker is the sync leader).")
else:
    logger.info("Background sync lock not acquired — another worker is the sync leader.")
