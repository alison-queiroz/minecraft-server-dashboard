"""Locate per-player files in the Minecraft world folder across save-format versions."""
from __future__ import annotations

import os


def player_files_dir(mc_dir: str, new_name: str, legacy_name: str) -> str:
    """Return the directory holding one kind of per-player file.

    Minecraft 26.1+ keeps them under world/players/<new_name> (data, stats, advancements);
    older worlds used world/<legacy_name> (playerdata, stats, advancements). The new
    location wins when it exists, so a migrated world never reads stale legacy files.
    """
    path = os.path.join(mc_dir, "world", "players", new_name)
    return path if os.path.isdir(path) else os.path.join(mc_dir, "world", legacy_name)
