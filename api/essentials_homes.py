"""EssentialsX homes: read, create, update and delete the /sethome entries in a
player's EssentialsX userdata YAML (plugins/Essentials/userdata/<uuid>.yml).

Writes replace the file atomically (temp file + os.replace). Without PyYAML
every call degrades to "no homes" / False.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

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

logger = logging.getLogger(__name__)

# Same MINECRAFT_DIR data root as api/player_data.py.
_MC_DIR = os.environ.get("MINECRAFT_DIR", ".")
# EssentialsX stores per-player YAML as plugins/Essentials/userdata/<uuid>.yml
_ESSENTIALS_USERDATA_DIR = os.path.join(_MC_DIR, "plugins", "Essentials", "userdata")


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
        # Write the canonical EssentialsX schema: `world-name` (the key
        # read_essentials_homes and the plugin prefer) plus yaw/pitch, which
        # EssentialsX expects and would otherwise treat as 0/absent.
        homes[home_name] = {
            "world-name": world,
            "x": x,
            "y": y,
            "z": z,
            "yaw": 0.0,
            "pitch": 0.0,
        }
        data["homes"] = homes
        dir_name = os.path.dirname(yml_path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)
        _write_essentials_yaml_atomic(yml_path, data)
        logger.info("Created EssentialsX home '%s' for %s", home_name, uuid)
        return True
    except (OSError, _yaml.YAMLError):
        # Genuine I/O or serialization failure — log loudly and report failure.
        # Programming errors (e.g. bad types) are left to surface as a 500 so
        # they are not silently masked as "already exists".
        logger.error("Failed to create EssentialsX home '%s' for %s", home_name, uuid, exc_info=True)
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
    except (OSError, _yaml.YAMLError):
        logger.error("Failed to update EssentialsX home '%s' for %s", home_name, uuid, exc_info=True)
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
    except (OSError, _yaml.YAMLError):
        logger.error("Failed to delete EssentialsX home '%s' for %s", home_name, uuid, exc_info=True)
        return False
