"""Read Minecraft advancement data from world/advancements/{uuid}.json."""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Iterator

logger = logging.getLogger(__name__)

_ADVANCEMENTS_DIR = os.path.join(os.environ.get("MINECRAFT_DIR", "."), "world", "advancements")

_LABELS_FILE = os.path.join(os.path.dirname(__file__), "advancement_labels.json")
try:
    with open(_LABELS_FILE, "r", encoding="utf-8") as _f:
        _LABELS_DATA = json.load(_f)
except (OSError, json.JSONDecodeError) as _e:
    logger.error("Failed to load advancement_labels.json: %s", _e)
    _LABELS_DATA = {}

_LABELS: dict[str, dict[str, str]] = _LABELS_DATA.get("labels", {})
_CATEGORY_LABELS: dict[str, str] = _LABELS_DATA.get("categories", {})
_DESCRIPTIONS: dict[str, str] = _LABELS_DATA.get("descriptions", {})


def _label(adv_id: str) -> str:
    """Return a human-readable label for a Minecraft advancement ID."""
    parts = adv_id.split(":", 1)
    if len(parts) != 2:
        return adv_id
    namespace_part = parts[0] + ":"  # e.g. "minecraft:"
    path = parts[1]                  # e.g. "story/mine_stone"
    path_parts = path.split("/", 1)
    if len(path_parts) != 2:
        return adv_id
    category_key = namespace_part + path_parts[0]  # e.g. "minecraft:story"
    sub_key = path_parts[1]                          # e.g. "mine_stone"
    cat = _LABELS.get(category_key, {})
    return cat.get(sub_key, adv_id.replace("_", " ").replace(":", " › ").title())


def _read_raw(uuid: str) -> dict[str, Any]:
    """Return the player's parsed advancements file, or {} when there is none.

    Raises OSError / ValueError when the file exists but cannot be read or parsed.
    """
    path = os.path.join(_ADVANCEMENTS_DIR, f"{uuid}.json")
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        raw = json.load(f)
    return raw if isinstance(raw, dict) else {}


def _completed_ids(raw: dict[str, Any]) -> Iterator[str]:
    """Yield completed advancement IDs, skipping recipe unlocks and DataVersion."""
    for adv_id, value in raw.items():
        if adv_id == "DataVersion" or "recipe" in adv_id:
            continue
        if isinstance(value, dict) and value.get("done", False):
            yield adv_id


def count_completed(uuid: str) -> int:
    """Number of completed non-recipe advancements for a player (0 if unreadable)."""
    try:
        return sum(1 for _ in _completed_ids(_read_raw(uuid)))
    except (OSError, ValueError):
        # Minecraft rewrites this file while the player is online; a torn read
        # just means the count is refreshed on the next scan.
        logger.debug("Cannot count advancements for %s", uuid, exc_info=True)
        return 0


def get_advancements(uuid: str) -> dict[str, Any]:
    """Return advancement data for a player UUID.

    Returns a dict with:
      - completed: list of {id, label, category} for each completed advancement
      - total: count of completed advancements (vanilla only, excludes recipe unlocks)
      - by_category: {category_label: [list of completed advancement labels]}
    """
    try:
        raw = _read_raw(uuid)
    except (OSError, ValueError) as exc:
        logger.warning("Cannot read advancements for %s: %s", uuid, exc)
        return {"completed": [], "total": 0, "by_category": {}}

    completed: list[dict[str, str]] = []
    by_category: dict[str, list[str]] = {}

    for adv_id in _completed_ids(raw):
        label = _label(adv_id)
        # Determine category
        parts = adv_id.split(":", 1)
        if len(parts) == 2:
            path_parts = parts[1].split("/", 1)
            cat_key = parts[0] + ":" + path_parts[0]
            cat_label = _CATEGORY_LABELS.get(cat_key, cat_key.title())
        else:
            cat_label = "Other"

        # description omitted from list response — fetched lazily on demand
        completed.append({"id": adv_id, "label": label, "category": cat_label})
        by_category.setdefault(cat_label, []).append(label)

    return {
        "completed": completed,
        "total": len(completed),
        "by_category": by_category,
    }


def get_description(adv_id: str) -> str:
    """Return the description for a single advancement ID."""
    return _DESCRIPTIONS.get(adv_id, "")
