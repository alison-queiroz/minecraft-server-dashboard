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
try:
    import yaml as _yaml
    _YAML_AVAILABLE = True
except ImportError:
    _YAML_AVAILABLE = False
    import logging as _startup_log
    _startup_log.getLogger(__name__).warning(
        "PyYAML is not installed — EssentialsX homes will be unavailable. "
        "Run: pip install pyyaml"
    )

from .skin_resolver import get_skin_url, _url_resolution_cache, _url_resolved_at
from .firestore_sync import sync_players

logger = logging.getLogger(__name__)

_PLAYERDATA_DIR = os.path.join("world", "playerdata")
_STATS_DIR = os.path.join("world", "stats")
_USERCACHE_FILE = "usercache.json"
_OPS_FILE = "ops.json"
_SR_PLAYERS_DIR = os.path.join("plugins", "SkinsRestorer", "players")  # watched for skin changes
# EssentialsX stores per-player YAML as plugins/Essentials/userdata/<uuid>.yml
_ESSENTIALS_USERDATA_DIR = os.path.join("plugins", "Essentials", "userdata")
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


def _load_op_uuids() -> set[str]:
    """Returns the set of UUIDs listed in ops.json (case-insensitive)."""
    if not os.path.exists(_OPS_FILE):
        return set()
    try:
        with open(_OPS_FILE, "r") as f:
            return {entry["uuid"].lower() for entry in json.load(f) if "uuid" in entry}
    except Exception:
        logger.warning("Failed to parse %s", _OPS_FILE)
        return set()


def get_op_names() -> list[str]:
    """Returns the list of OP player names from ops.json."""
    if not os.path.exists(_OPS_FILE):
        return []
    try:
        with open(_OPS_FILE, "r") as f:
            return [entry["name"] for entry in json.load(f) if "name" in entry]
    except Exception:
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


def read_essentials_homes(uuid: str) -> list[dict[str, Any]]:
    """Read in-game homes set with /sethome from the EssentialsX userdata YAML.

    EssentialsX stores player data at::

        plugins/Essentials/userdata/<uuid>.yml

    The ``homes`` section looks like::

        homes:
          home:
            world: world
            x: 100.5
            y: 64.0
            z: -200.3
          base:
            world: world_nether
            x: 50.0
            y: 100.0
            z: 75.0

    Returns a list of dicts with keys: name, world, x, y, z.
    Returns an empty list when PyYAML is unavailable, the file is missing,
    or the player has no homes defined.
    """
    if not _YAML_AVAILABLE:
        return []
    yml_path = os.path.join(_ESSENTIALS_USERDATA_DIR, f"{uuid}.yml")
    if not os.path.exists(yml_path):
        return []
    try:
        with open(yml_path, "r", encoding="utf-8") as fh:
            data = _yaml.safe_load(fh)
        if not isinstance(data, dict):
            return []
        homes_raw = data.get("homes")
        if not isinstance(homes_raw, dict):
            return []
        homes: list[dict[str, Any]] = []
        for name, meta in homes_raw.items():
            if not isinstance(meta, dict):
                continue
            homes.append({
                "name": str(name),
                "world": str(meta.get("world-name") or meta.get("world", "world")),
                "x": float(meta.get("x", 0.0)),
                "y": float(meta.get("y", 64.0)),
                "z": float(meta.get("z", 0.0)),
            })
        return homes
    except Exception:
        logger.warning("Failed to read EssentialsX userdata for %s", uuid)
        return []


def _write_essentials_yaml_atomic(yml_path: str, data: dict) -> None:
    """Write a YAML file atomically using a temp file + os.replace."""
    import tempfile
    dir_name = os.path.dirname(yml_path) or "."
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=dir_name, suffix=".tmp", delete=False
    ) as tmp:
        _yaml.dump(data, tmp, allow_unicode=True, default_flow_style=False)
        tmp_name = tmp.name
    os.replace(tmp_name, yml_path)


def create_essentials_home(
    uuid: str,
    home_name: str,
    x: float,
    y: float,
    z: float,
    world: str,
) -> bool:
    """Create a new home in the EssentialsX userdata YAML for the given player.

    Returns True on success, False if the home already exists (use PUT to update),
    or if the YAML backend is unavailable.
    Creates the userdata file when the player has no YAML yet.
    """
    if not _YAML_AVAILABLE:
        return False
    yml_path = os.path.join(_ESSENTIALS_USERDATA_DIR, f"{uuid}.yml")
    try:
        if os.path.exists(yml_path):
            with open(yml_path, "r", encoding="utf-8") as fh:
                data = _yaml.safe_load(fh)
            if not isinstance(data, dict):
                data = {}
        else:
            data = {}
        homes = data.get("homes")
        if not isinstance(homes, dict):
            homes = {}
        if home_name in homes:
            return False  # already exists — caller should use PUT
        homes[home_name] = {"world": world, "x": x, "y": y, "z": z}
        data["homes"] = homes
        dir_name = os.path.dirname(yml_path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)
        _write_essentials_yaml_atomic(yml_path, data)
        logger.info("Created EssentialsX home '%s' for %s", home_name, uuid)
        return True
    except Exception:
        logger.warning("Failed to create EssentialsX home '%s' for %s", home_name, uuid)
        return False


def update_essentials_home(
    uuid: str,
    home_name: str,
    x: float,
    y: float,
    z: float,
    world: str,
    new_name: Optional[str] = None,
) -> bool:
    """Update coordinates (and optionally rename) a home in EssentialsX userdata YAML.

    Returns True on success, False if the home or file was not found.
    """
    if not _YAML_AVAILABLE:
        return False
    yml_path = os.path.join(_ESSENTIALS_USERDATA_DIR, f"{uuid}.yml")
    if not os.path.exists(yml_path):
        return False
    try:
        with open(yml_path, "r", encoding="utf-8") as fh:
            data = _yaml.safe_load(fh)
        if not isinstance(data, dict):
            return False
        homes = data.get("homes")
        if not isinstance(homes, dict) or home_name not in homes:
            return False
        entry = dict(homes[home_name]) if isinstance(homes[home_name], dict) else {}
        # Preserve whichever world key EssentialsX wrote originally
        if "world-name" in entry:
            entry["world-name"] = world
        else:
            entry["world"] = world
        entry["x"] = x
        entry["y"] = y
        entry["z"] = z
        target_name = new_name if (new_name and new_name != home_name) else home_name
        if target_name != home_name:
            del homes[home_name]
        homes[target_name] = entry
        data["homes"] = homes
        _write_essentials_yaml_atomic(yml_path, data)
        logger.info("Updated EssentialsX home '%s' for %s", home_name, uuid)
        return True
    except Exception:
        logger.warning("Failed to update EssentialsX home '%s' for %s", home_name, uuid)
        return False


def delete_essentials_home(uuid: str, home_name: str) -> bool:
    """Delete a home from EssentialsX userdata YAML.

    Returns True on success, False if the home or file was not found.
    """
    if not _YAML_AVAILABLE:
        return False
    yml_path = os.path.join(_ESSENTIALS_USERDATA_DIR, f"{uuid}.yml")
    if not os.path.exists(yml_path):
        return False
    try:
        with open(yml_path, "r", encoding="utf-8") as fh:
            data = _yaml.safe_load(fh)
        if not isinstance(data, dict):
            return False
        homes = data.get("homes")
        if not isinstance(homes, dict) or home_name not in homes:
            return False
        del homes[home_name]
        data["homes"] = homes
        _write_essentials_yaml_atomic(yml_path, data)
        logger.info("Deleted EssentialsX home '%s' for %s", home_name, uuid)
        return True
    except Exception:
        logger.warning("Failed to delete EssentialsX home '%s' for %s", home_name, uuid)
        return False


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
            "homes": read_essentials_homes(uuid),
        }
    except Exception:
        logger.warning("Failed to parse NBT for %s (%s)", name, filepath)
        return None


def _fetch_live() -> list[dict[str, Any]]:
    if not os.path.exists(_PLAYERDATA_DIR):
        return []
    uuid_to_name = _map_uuids()
    op_uuids = _load_op_uuids()
    players = [
        player
        for filepath in glob.glob(os.path.join(_PLAYERDATA_DIR, "*.dat"))
        if (player := _parse_player(filepath, uuid_to_name)) is not None
    ]
    for p in players:
        p["is_op"] = p["uuid"].lower() in op_uuids
    players.sort(key=lambda p: p["level"], reverse=True)
    return players


def get_players() -> list[dict[str, Any]]:
    if _cache.is_stale():
        fresh = _fetch_live()
        _cache.refresh(fresh)
        threading.Thread(target=sync_players, args=(fresh,), daemon=True).start()
    return _cache.data


class _FileWatcher:
    """Watches a directory for file mtime changes."""

    def __init__(self, directory: str, pattern: str = "*.dat") -> None:
        self.directory = directory
        self.pattern = pattern
        self._mtimes: dict[str, float] = {}

    def has_changes(self) -> bool:
        changed = False
        for filepath in glob.glob(os.path.join(self.directory, self.pattern)):
            mtime = os.path.getmtime(filepath)
            if self._mtimes.get(filepath) != mtime:
                self._mtimes[filepath] = mtime
                changed = True
        return changed


def _background_sync_loop() -> None:
    """Event-driven Firestore sync: fires when player .dat files change.

    Behaviour:
    - Performs an immediate sync on first startup so Firestore is current
      after every API restart/deploy.
    - Polls for file changes every 5 s (cheap mtime check, no I/O)
    - Debounce: waits 10 s of quiet before syncing (absorbs burst saves)
    - Rate-limit: minimum 60 s between consecutive Firestore writes
    - Backoff: on error, increases wait up to 5 min before retrying
    - Also watches SkinsRestorer player files; evicts the URL cache when they
      change so the next sync fetches the updated skin URL from disk.
    """
    playerdata_watcher = _FileWatcher(_PLAYERDATA_DIR)
    sr_watcher = _FileWatcher(_SR_PLAYERS_DIR, pattern="*")
    last_sync: float = 0.0
    backoff: float = 0.0
    _DEBOUNCE  = 10.0   # seconds of quiet before syncing
    _MIN_INTERVAL = 60.0  # minimum seconds between syncs

    # Trigger an immediate sync on startup so Firestore reflects the current
    # code (e.g. newly added EssentialsX homes) without waiting for a .dat change.
    last_change = time.time() - _DEBOUNCE
    next_sync_after: float = 0.0  # 0 = fire immediately on first iteration

    while True:
        time.sleep(5)

        if playerdata_watcher.has_changes():
            last_change = time.time()

        if sr_watcher.has_changes():
            _url_resolution_cache.clear()
            _url_resolved_at.clear()
            _cache.last_updated = 0.0
            last_change = time.time()
            logger.info("SkinsRestorer player files changed — skin URL cache cleared.")

        now = time.time()
        quiet_for = now - last_change

        if quiet_for >= _DEBOUNCE and now >= next_sync_after:
            try:
                # Always force a fresh fetch so _fetch_live() is called even
                # if the 60-second player cache has not expired yet.
                _cache.last_updated = 0.0
                get_players()
                last_sync = time.time()
                backoff = 0.0
                next_sync_after = last_sync + _MIN_INTERVAL
                logger.debug("Event-driven sync completed.")
            except Exception:
                backoff = min(backoff + 60.0, 300.0)
                next_sync_after = now + _MIN_INTERVAL + backoff
                logger.warning("Background player sync failed (next retry in %.0fs)", _MIN_INTERVAL + backoff, exc_info=True)


_bg_sync_thread: threading.Thread | None = None
if _acquire_sync_lock():
    _bg_sync_thread = threading.Thread(
        target=_background_sync_loop, daemon=True, name="player-bg-sync"
    )
    _bg_sync_thread.start()
    logger.info("Background sync thread started (this worker is the sync leader).")
else:
    logger.info("Background sync lock not acquired — another worker is the sync leader.")
