"""Player data read from the Minecraft server directory (MINECRAFT_DIR).

Parses the players' .dat (NBT) and stats files, usercache.json and ops.json
into this worker's player list, served stale-while-revalidate by
get_players(); invalidate_caches() drops it (and the skin caches) and asks the
sync leader to do the same. The leader election and sync loop live in
api/player_sync.py, the EssentialsX homes in api/essentials_homes.py.
"""
from __future__ import annotations

import glob
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

import nbtlib

from .advancements import count_completed
from .skin_resolver import clear_skin_caches, get_skin_url

logger = logging.getLogger(__name__)

# All Minecraft server-data paths derive from a single base dir so the app can
# run outside the one production VM. Default "." keeps the previous
# CWD-relative behaviour; set MINECRAFT_DIR to relocate the data root.
_MC_DIR = os.environ.get("MINECRAFT_DIR", ".")
_PLAYERDATA_DIR = os.path.join(_MC_DIR, "world", "playerdata")
_STATS_DIR = os.path.join(_MC_DIR, "world", "stats")
_USERCACHE_FILE = os.path.join(_MC_DIR, "usercache.json")
_OPS_FILE = os.path.join(_MC_DIR, "ops.json")
_SR_PLAYERS_DIR = os.path.join(_MC_DIR, "plugins", "SkinsRestorer", "players")  # watched for skin changes
_CACHE_TTL = 60  # seconds a worker serves its player list before refreshing it
# Real player files only: Minecraft saves through a temp "<uuid>-<random>.dat"
# in the same directory, which must never be parsed as a player.
_PLAYER_FILE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.dat"
)

# The sync leader's flock file (api/player_sync.py) and the marker next to it
# that invalidate_caches() touches. They live here, not in player_sync,
# because every worker touches the marker and player_sync imports this module.
import tempfile as _tempfile
_SYNC_LOCK_PATH = os.environ.get(
    "SYNC_LOCK_PATH",
    os.path.join(_tempfile.gettempdir(), "minecraft-api-bg-sync.lock"),
)
# Touched by invalidate_caches() in any worker; watched by the sync leader.
_RESYNC_REQUEST_PATH = _SYNC_LOCK_PATH + ".resync"
# Held by whoever rebuilds _cache: the one background refresh, the sync
# leader, invalidate_caches(), or the very first (blocking) load.
_refresh_lock = threading.Lock()


_DIMENSIONS: dict[str, str] = {
    "minecraft:overworld": "Overworld",
    "minecraft:the_nether": "Nether",
    "minecraft:the_end": "The End",
}


@dataclass
class _Cache:
    """This worker's player list.

    Writers hold _refresh_lock. Readers only take the current ``data``
    reference, which is replaced wholesale (never mutated) on refresh.
    """
    data: list[dict[str, Any]] = field(default_factory=list)
    last_updated: float = 0.0
    loaded: bool = False

    def is_stale(self) -> bool:
        return time.time() - self.last_updated > _CACHE_TTL

    def refresh(self, data: list[dict[str, Any]]) -> None:
        self.data = data
        self.last_updated = time.time()
        self.loaded = True

    def invalidate(self) -> None:
        """Mark stale; the current list is still served until a refresh lands."""
        self.last_updated = 0.0


_cache = _Cache()


def _load_op_uuids() -> set[str]:
    """Returns the set of UUIDs listed in ops.json (case-insensitive)."""
    if not os.path.exists(_OPS_FILE):
        return set()
    try:
        with open(_OPS_FILE, "r") as f:
            return {entry["uuid"].lower() for entry in json.load(f) if "uuid" in entry}
    except Exception:
        logger.warning("Failed to parse %s", _OPS_FILE, exc_info=True)
        return set()


def get_op_names() -> list[str]:
    """Returns the list of OP player names from ops.json."""
    if not os.path.exists(_OPS_FILE):
        return []
    try:
        with open(_OPS_FILE, "r") as f:
            return [entry["name"] for entry in json.load(f) if "name" in entry]
    except Exception:
        logger.warning("Failed to read OP names from %s", _OPS_FILE, exc_info=True)
        return []


def _map_uuids() -> dict[str, str]:
    if not os.path.exists(_USERCACHE_FILE):
        return {}
    try:
        with open(_USERCACHE_FILE, "r") as f:
            return {entry["uuid"]: entry["name"] for entry in json.load(f)}
    except (json.JSONDecodeError, KeyError):
        logger.warning("Failed to parse %s", _USERCACHE_FILE)
        return {}


def get_uuid_to_name() -> dict[str, str]:
    """Public accessor: UUID → last-known Minecraft username (from usercache.json).

    Used by the API layer to resolve a target player UUID to a name for
    ownership checks without triggering a full player rescan.
    """
    return _map_uuids()


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
        # Minecraft rewrites stats while the player is online; a torn read
        # just means play time is refreshed on the next scan.
        logger.debug("Failed to read stats for %s", uuid, exc_info=True)
        return {}


def _parse_player(filepath: str, uuid_to_name: dict[str, str]) -> Optional[dict[str, Any]]:
    uuid = os.path.basename(filepath).replace(".dat", "")
    name = uuid_to_name.get(uuid, "Unknown")
    try:
        last_seen = datetime.fromtimestamp(os.path.getmtime(filepath)).strftime("%Y-%m-%d %H:%M")
    except OSError:
        # Minecraft briefly renames the file away while saving it.
        logger.debug("Player file %s vanished mid-save; skipped this scan.", filepath)
        return None
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
            "advancement_count": count_completed(uuid),
        }
    except Exception:
        logger.warning("Failed to parse NBT for %s (%s)", name, filepath, exc_info=True)
        return None


def _fetch_live() -> list[dict[str, Any]]:
    if not os.path.exists(_PLAYERDATA_DIR):
        return []
    uuid_to_name = _map_uuids()
    op_uuids = _load_op_uuids()
    players = [
        player
        for filepath in glob.glob(os.path.join(_PLAYERDATA_DIR, "*.dat"))
        if _PLAYER_FILE.fullmatch(os.path.basename(filepath))
        and (player := _parse_player(filepath, uuid_to_name)) is not None
    ]
    for p in players:
        p["is_op"] = p["uuid"].lower() in op_uuids
    players.sort(key=lambda p: p["level"], reverse=True)
    return players


def _refresh_cache() -> list[dict[str, Any]]:
    """Rescan disk into _cache and return the new list. Caller holds _refresh_lock."""
    fresh = _fetch_live()
    _cache.refresh(fresh)
    return fresh


def _refresh_in_background() -> None:
    """Body of the single background refresh; releases the lock get_players took."""
    try:
        _refresh_cache()
    except Exception:
        logger.warning("Background player refresh failed; serving the previous list.", exc_info=True)
    finally:
        _refresh_lock.release()


def get_players() -> list[dict[str, Any]]:
    """Return this worker's player list without making requests wait on a rescan.

    Stale-while-revalidate: once loaded, a stale list is returned immediately
    and at most one background thread per worker rescans disk (the lock is
    taken non-blocking, so concurrent requests never queue behind it). Only the
    very first load, when there is nothing to serve yet, blocks.

    Never writes to Firestore; only the sync leader does (player_sync._background_sync_loop).
    The returned list and its dicts are shared across threads: do not mutate.
    """
    if not _cache.loaded:
        with _refresh_lock:
            if not _cache.loaded:
                _refresh_cache()
        return _cache.data
    if _cache.is_stale() and _refresh_lock.acquire(blocking=False):
        if not _cache.is_stale():
            _refresh_lock.release()  # refreshed between the check and the acquire
            return _cache.data
        try:
            threading.Thread(
                target=_refresh_in_background, daemon=True, name="player-cache-refresh"
            ).start()
        except RuntimeError:
            _refresh_lock.release()
            logger.warning("Could not start the background player refresh.", exc_info=True)
    return _cache.data


def invalidate_caches() -> None:
    """Forget this worker's player and skin caches and ask the sync leader to do the same.

    For the force-resync endpoints. Waits for an in-flight rescan (so it cannot
    land after, and undo, the invalidation), then marks the list stale: the next
    get_players() still answers at once and refreshes in the background. The
    leader clears its caches within ~5 s, and its next regular sync (<= ~1 min)
    writes every player doc whose content (e.g. skin URL) changed.
    """
    with _refresh_lock:
        clear_skin_caches()
        _cache.invalidate()
    _request_leader_resync()


def _request_leader_resync() -> None:
    """Touch the marker file the sync leader's loop watches (works across workers)."""
    try:
        os.close(os.open(_RESYNC_REQUEST_PATH, os.O_WRONLY | os.O_CREAT, 0o600))
        os.utime(_RESYNC_REQUEST_PATH)
    except OSError:
        logger.warning("Could not signal the sync leader via %s", _RESYNC_REQUEST_PATH, exc_info=True)
