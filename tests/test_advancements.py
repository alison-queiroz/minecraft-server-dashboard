"""Tests for api/advancements.py."""
import json
import os
import pytest

import api.advancements as adv_module
from api.advancements import _label, _description, get_advancements, get_description


# ── _label ────────────────────────────────────────────────────────────────────

def test_label_unknown_id_with_no_separator():
    """Returns the raw id when there is no colon separator."""
    assert _label("no_namespace_here") == "no_namespace_here"


def test_label_id_with_no_path_separator():
    """Returns the raw id when the path has no slash."""
    assert _label("minecraft:storynoslash") == "minecraft:storynoslash"


def test_label_uses_labels_dict_when_available(mocker):
    """Returns the human-readable label from the loaded JSON data."""
    mocker.patch.object(adv_module, "_LABELS", {
        "minecraft:story": {"mine_stone": "Stone Age"}
    })
    assert _label("minecraft:story/mine_stone") == "Stone Age"


def test_label_falls_back_to_title_case_when_key_missing(mocker):
    """Falls back to title-cased ID when the key is not in the labels dict."""
    mocker.patch.object(adv_module, "_LABELS", {})
    # Expected fallback: adv_id.replace("_"," ").replace(":"," › ").title()
    result = _label("minecraft:story/mine_stone")
    assert "Mine Stone" in result


# ── _description ──────────────────────────────────────────────────────────────

def test_description_returns_empty_string_for_unknown():
    assert _description("minecraft:story/nonexistent") == ""


def test_description_returns_value_when_present(mocker):
    mocker.patch.object(adv_module, "_DESCRIPTIONS", {
        "minecraft:story/mine_stone": "Obtain any type of pickaxe."
    })
    assert _description("minecraft:story/mine_stone") == "Obtain any type of pickaxe."


# ── get_description (public helper) ──────────────────────────────────────────

def test_get_description_delegates_to_descriptions_dict(mocker):
    mocker.patch.object(adv_module, "_DESCRIPTIONS", {"minecraft:nether/root": "Entered the Nether"})
    assert get_description("minecraft:nether/root") == "Entered the Nether"


def test_get_description_returns_empty_for_missing():
    assert get_description("minecraft:nether/no_such_adv") == ""


# ── get_advancements ──────────────────────────────────────────────────────────

def test_get_advancements_missing_file(mocker):
    """Returns empty result when the player's advancement file does not exist."""
    mocker.patch("os.path.exists", return_value=False)
    result = get_advancements("069a79f4-44e9-4726-a5be-fca90e38aaf5")
    assert result == {"completed": [], "total": 0, "by_category": {}}


def test_get_advancements_corrupted_json(mocker):
    """Returns empty result when the JSON file is corrupt."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="not-json{"))
    result = get_advancements("069a79f4-44e9-4726-a5be-fca90e38aaf5")
    assert result == {"completed": [], "total": 0, "by_category": {}}


def test_get_advancements_filters_recipes_and_data_version(mocker, tmp_path):
    """Skips recipe unlocks and the DataVersion key."""
    adv_data = {
        "DataVersion": 3955,
        "minecraft:recipes/building_blocks/stone": {"done": True, "criteria": {}},
        "minecraft:story/mine_stone": {"done": True, "criteria": {}},
    }
    adv_file = tmp_path / "069a79f4-44e9-4726-a5be-fca90e38aaf5.json"
    adv_file.write_text(json.dumps(adv_data))

    mocker.patch.object(adv_module, "_ADVANCEMENTS_DIR", str(tmp_path))

    result = get_advancements("069a79f4-44e9-4726-a5be-fca90e38aaf5")
    # Only the non-recipe advancement should appear
    assert result["total"] == 1
    assert result["completed"][0]["id"] == "minecraft:story/mine_stone"


def test_get_advancements_skips_undone_advancements(mocker, tmp_path):
    """Only includes advancements where done=True."""
    adv_data = {
        "minecraft:story/mine_stone": {"done": True, "criteria": {}},
        "minecraft:story/upgrade_tools": {"done": False, "criteria": {}},
    }
    adv_file = tmp_path / "069a79f4-44e9-4726-a5be-fca90e38aaf5.json"
    adv_file.write_text(json.dumps(adv_data))

    mocker.patch.object(adv_module, "_ADVANCEMENTS_DIR", str(tmp_path))

    result = get_advancements("069a79f4-44e9-4726-a5be-fca90e38aaf5")
    assert result["total"] == 1


def test_get_advancements_groups_by_category(mocker, tmp_path):
    """Groups completed advancements into the by_category dict correctly."""
    adv_data = {
        "minecraft:story/mine_stone":    {"done": True, "criteria": {}},
        "minecraft:story/upgrade_tools": {"done": True, "criteria": {}},
        "minecraft:nether/root":         {"done": True, "criteria": {}},
    }
    adv_file = tmp_path / "069a79f4-44e9-4726-a5be-fca90e38aaf5.json"
    adv_file.write_text(json.dumps(adv_data))

    mocker.patch.object(adv_module, "_ADVANCEMENTS_DIR", str(tmp_path))
    mocker.patch.object(adv_module, "_CATEGORY_LABELS", {
        "minecraft:story": "Story",
        "minecraft:nether": "Nether",
    })

    result = get_advancements("069a79f4-44e9-4726-a5be-fca90e38aaf5")
    assert result["total"] == 3
    assert len(result["by_category"]["Story"]) == 2
    assert len(result["by_category"]["Nether"]) == 1


def test_get_advancements_skips_non_dict_values(mocker, tmp_path):
    """Skips entries whose value is not a dict (malformed advancement data)."""
    adv_data = {
        "minecraft:story/mine_stone": {"done": True, "criteria": {}},
        "minecraft:story/some_other": "not_a_dict",
    }
    adv_file = tmp_path / "069a79f4-44e9-4726-a5be-fca90e38aaf5.json"
    adv_file.write_text(json.dumps(adv_data))

    mocker.patch.object(adv_module, "_ADVANCEMENTS_DIR", str(tmp_path))

    result = get_advancements("069a79f4-44e9-4726-a5be-fca90e38aaf5")
    assert result["total"] == 1


def test_get_advancements_no_namespace_category(mocker, tmp_path):
    """Uses 'Other' as category when adv_id has no namespace separator."""
    adv_data = {
        "nocolon": {"done": True, "criteria": {}},
    }
    adv_file = tmp_path / "069a79f4-44e9-4726-a5be-fca90e38aaf5.json"
    adv_file.write_text(json.dumps(adv_data))

    mocker.patch.object(adv_module, "_ADVANCEMENTS_DIR", str(tmp_path))

    result = get_advancements("069a79f4-44e9-4726-a5be-fca90e38aaf5")
    assert result["total"] == 1
    assert "Other" in result["by_category"]


# ── Module-level labels file error handler ────────────────────────────────────

def test_labels_file_load_error_sets_empty_data():
    """Lines 17-19: when advancement_labels.json is unreadable the module
    gracefully falls back to an empty dict (no labels / descriptions)."""
    import importlib
    import sys
    import builtins

    real_open = builtins.open

    def selective_open(file, *args, **kwargs):
        if "advancement_labels.json" in str(file):
            raise OSError("simulated read error")
        return real_open(file, *args, **kwargs)

    # Remove the cached module so reload re-executes module-level code
    sys.modules.pop("api.advancements", None)

    from unittest.mock import patch
    with patch("builtins.open", side_effect=selective_open):
        import api.advancements as reloaded

    assert reloaded._LABELS_DATA == {}

    # Reload once more (without the patch) to restore normal state for other tests
    sys.modules.pop("api.advancements", None)
    import api.advancements  # re-import with real open so labels are loaded again
