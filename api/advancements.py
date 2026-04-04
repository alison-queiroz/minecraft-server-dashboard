"""Read Minecraft advancement data from world/advancements/{uuid}.json."""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_ADVANCEMENTS_DIR = os.path.join("world", "advancements")

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


def _description(adv_id: str) -> str:
    """Return a short description for a Minecraft advancement ID."""
    # Strip leading 'minecraft:' for key lookup (key format: 'minecraft:story/mine_stone')
    return _DESCRIPTIONS.get(adv_id, "")


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


def get_advancements(uuid: str) -> dict[str, Any]:
    """Return advancement data for a player UUID.

    Returns a dict with:
      - completed: list of {id, label, category} for each completed advancement
      - total: count of completed advancements (vanilla only, excludes recipe unlocks)
      - by_category: {category_label: [list of completed advancement labels]}
    """
    path = os.path.join(_ADVANCEMENTS_DIR, f"{uuid}.json")
    if not os.path.exists(path):
        return {"completed": [], "total": 0, "by_category": {}}

    try:
        with open(path, "r") as f:
            raw: dict[str, Any] = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Cannot read advancements for %s: %s", uuid, exc)
        return {"completed": [], "total": 0, "by_category": {}}

    completed: list[dict[str, str]] = []
    by_category: dict[str, list[str]] = {}

    for adv_id, value in raw.items():
        # Skip recipe unlocks and DataVersion key
        if adv_id == "DataVersion" or "recipe" in adv_id:
            continue
        if not isinstance(value, dict):
            continue
        if not value.get("done", False):
            continue

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
