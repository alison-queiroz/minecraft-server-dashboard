from __future__ import annotations

import glob
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

import nbtlib

from .skin_resolver import get_skin_url

logger = logging.getLogger(__name__)

_PLAYERDATA_DIR = os.path.join("world", "playerdata")
_USERCACHE_FILE = "usercache.json"
_CACHE_TTL = 15

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


def _parse_player(filepath: str, uuid_to_name: dict[str, str]) -> Optional[dict[str, Any]]:
    uuid = os.path.basename(filepath).replace(".dat", "")
    name = uuid_to_name.get(uuid, "Unknown")
    last_seen = datetime.fromtimestamp(os.path.getmtime(filepath)).strftime("%Y-%m-%d %H:%M")
    try:
        nbt_data = nbtlib.load(filepath)
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
        _cache.refresh(_fetch_live())
    return _cache.data
