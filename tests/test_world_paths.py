"""Tests for api/world_paths.py."""
import os

from api.world_paths import player_files_dir


def test_player_files_dir_prefers_26_1_layout(tmp_path):
    """Uses world/players/<new_name> when the 26.1+ folder exists."""
    new_dir = tmp_path / "world" / "players" / "data"
    new_dir.mkdir(parents=True)
    (tmp_path / "world" / "playerdata").mkdir()

    assert player_files_dir(str(tmp_path), "data", "playerdata") == str(new_dir)


def test_player_files_dir_falls_back_to_legacy_layout(tmp_path):
    """Uses world/<legacy_name> for worlds saved before 26.1."""
    (tmp_path / "world" / "playerdata").mkdir(parents=True)

    assert player_files_dir(str(tmp_path), "data", "playerdata") == os.path.join(
        str(tmp_path), "world", "playerdata"
    )


def test_player_files_dir_falls_back_when_nothing_exists(tmp_path):
    """Returns the legacy path when neither folder exists, so callers keep their missing-dir handling."""
    assert player_files_dir(str(tmp_path), "stats", "stats") == os.path.join(str(tmp_path), "world", "stats")
