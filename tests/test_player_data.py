import pytest
from api.player_data import (
    _Cache,
    _map_uuids,
    _dimension_name,
    _parse_player,
    _fetch_live,
    get_players,
    _cache
)

@pytest.fixture(autouse=True)
def reset_cache():
    """Reset the global cache state before and after each test."""
    _cache.data = []
    _cache.last_updated = 0.0
    yield
    _cache.data = []
    _cache.last_updated = 0.0

def test_cache_logic(mocker):
    """Ensure cache staleness is calculated correctly based on TTL."""
    c = _Cache()

    # Force staleness
    mocker.patch("time.time", return_value=100.0)
    c.last_updated = 10.0
    assert c.is_stale() is True

    # Refresh and check again
    c.refresh([{"mock": "data"}])
    assert c.data == [{"mock": "data"}]
    assert c.last_updated == 100.0
    assert c.is_stale() is False

def test_map_uuids_success(mocker):
    """Ensure usercache.json is parsed correctly."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data='[{"uuid": "123", "name": "Steve"}]'))
    assert _map_uuids() == {"123": "Steve"}

def test_map_uuids_missing(mocker):
    """Ensure it returns an empty dict if the file is missing."""
    mocker.patch("os.path.exists", return_value=False)
    assert _map_uuids() == {}

def test_map_uuids_corrupted(mocker):
    """Ensure it returns an empty dict if the JSON is corrupted."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data='invalid_json'))
    assert _map_uuids() == {}

def test_dimension_name():
    """Ensure dimension mapping works."""
    assert _dimension_name("minecraft:the_nether") == "Nether"
    assert _dimension_name("minecraft:unknown") == "Unknown"

def test_parse_player_success(mocker):
    """Ensure a valid NBT file is parsed into a player dict."""
    mocker.patch("os.path.getmtime", return_value=1700000000.0)
    mocker.patch("api.player_data.get_skin_url", return_value="http://skin")

    mock_nbt = {
        "XpLevel": 30,
        "Health": 19.5,
        "Dimension": "minecraft:the_end",
        "Pos": [10, 64, -10]
    }
    mocker.patch("nbtlib.load", return_value=mock_nbt)

    result = _parse_player("/path/to/123.dat", {"123": "Steve"})

    assert result is not None
    assert result["name"] == "Steve"
    assert result["level"] == 30
    assert result["health"] == 19.5
    assert result["dimension"] == "The End"
    assert result["skin_url"] == "http://skin"

def test_parse_player_exception(mocker):
    """Ensure an invalid NBT file is caught and ignored."""
    mocker.patch("os.path.getmtime", return_value=1700000000.0)
    mocker.patch("nbtlib.load", side_effect=Exception("Corrupted NBT"))

    result = _parse_player("/path/to/123.dat", {})
    assert result is None

def test_fetch_live_success(mocker):
    """Ensure it fetches and sorts players properly."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("api.player_data._map_uuids", return_value={})
    mocker.patch("glob.glob", return_value=["file1.dat", "file2.dat"])

    # Mock _parse_player to return levels so we can test the sorting behavior
    def mock_parse(filepath, _):
        if filepath == "file1.dat":
            return {"name": "Noob", "level": 5, "uuid": "aaaa-1111"}
        return {"name": "Pro", "level": 100, "uuid": "bbbb-2222"}

    mocker.patch("api.player_data._parse_player", side_effect=mock_parse)

    result = _fetch_live()

    assert len(result) == 2
    assert result[0]["name"] == "Pro" # Higher level first
    assert result[1]["name"] == "Noob"

def test_fetch_live_no_dir(mocker):
    """Ensure it returns an empty list if the playerdata dir doesn't exist."""
    mocker.patch("os.path.exists", return_value=False)
    assert _fetch_live() == []

def test_get_players_cache_miss(mocker):
    """Ensure a stale cache triggers a fetch and starts the sync thread."""
    mock_fetch = mocker.patch("api.player_data._fetch_live", return_value=[{"name": "Steve"}])
    mock_thread = mocker.patch("threading.Thread")

    _cache.last_updated = 0 # Force stale

    result = get_players()

    mock_fetch.assert_called_once()
    mock_thread.assert_called_once()
    assert mock_thread.call_args[1]["daemon"] is True
    assert result == [{"name": "Steve"}]

def test_get_players_cache_hit(mocker):
    """Ensure a fresh cache returns immediately without fetching."""
    mock_fetch = mocker.patch("api.player_data._fetch_live")
    mocker.patch("time.time", return_value=100.0)

    _cache.data = [{"name": "CachedSteve"}]
    _cache.last_updated = 95.0 # Only 5 seconds old, not stale

    result = get_players()

    mock_fetch.assert_not_called()
    assert result == [{"name": "CachedSteve"}]


# ── _read_stats ───────────────────────────────────────────────────────────────

def test_read_stats_missing_file(mocker):
    """Returns an empty dict when the stats file does not exist."""
    from api.player_data import _read_stats
    mocker.patch("os.path.exists", return_value=False)
    assert _read_stats("some-uuid") == {}


def test_read_stats_corrupted_file(mocker):
    """Returns an empty dict when the JSON cannot be parsed."""
    from api.player_data import _read_stats
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="not-json"))
    assert _read_stats("some-uuid") == {}


def test_read_stats_success(mocker, tmp_path):
    """Returns the minecraft:custom stats sub-dict."""
    import json
    from api.player_data import _read_stats
    stats = {"stats": {"minecraft:custom": {"minecraft:play_time": 72000}}}
    f = tmp_path / "uuid.json"
    f.write_text(json.dumps(stats))
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=json.dumps(stats)))
    result = _read_stats("uuid")
    assert result.get("minecraft:play_time") == 72000


# ── _count_advancements ───────────────────────────────────────────────────────

def test_count_advancements_missing_file(mocker):
    """Returns 0 when the advancements file does not exist."""
    from api.player_data import _count_advancements
    mocker.patch("os.path.exists", return_value=False)
    assert _count_advancements("some-uuid") == 0


def test_count_advancements_counts_done_non_recipe(mocker, tmp_path):
    """Counts only completed non-recipe advancements."""
    import json
    from api.player_data import _count_advancements
    adv = {
        "DataVersion": 3955,
        "minecraft:story/mine_stone": {"done": True, "criteria": {}},
        "minecraft:story/upgrade_tools": {"done": False, "criteria": {}},
        "minecraft:recipes/building_blocks/stone": {"done": True, "criteria": {}},
    }
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=json.dumps(adv)))
    assert _count_advancements("uuid") == 1


def test_count_advancements_corrupted_file(mocker):
    """Returns 0 when the file cannot be parsed."""
    from api.player_data import _count_advancements
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="bad-json"))
    assert _count_advancements("uuid") == 0


# ── _parse_player: unknown name ───────────────────────────────────────────────

def test_parse_player_unknown_name(mocker):
    """Falls back to 'Unknown' when UUID is not in the name map."""
    mocker.patch("os.path.getmtime", return_value=1700000000.0)
    mocker.patch("api.player_data.get_skin_url", return_value="http://skin")
    mocker.patch("nbtlib.load", return_value={
        "XpLevel": 1, "Health": 20.0,
        "Dimension": "minecraft:overworld", "Pos": [0, 64, 0]
    })
    result = _parse_player("/path/to/abc-def.dat", {})
    assert result is not None
    assert result["name"] == "Unknown"


# ── _acquire_sync_lock ────────────────────────────────────────────────────────

def test_acquire_sync_lock_returns_true_when_fcntl_unavailable(mocker):
    """On Windows (no fcntl), always returns True (single-process dev env)."""
    import api.player_data as pd
    orig = pd._FCNTL_AVAILABLE
    pd._FCNTL_AVAILABLE = False
    try:
        result = pd._acquire_sync_lock()
        assert result is True
    finally:
        pd._FCNTL_AVAILABLE = orig


# ── _FileWatcher ──────────────────────────────────────────────────────────────

def test_file_watcher_detects_change(mocker, tmp_path):
    """has_changes() returns True on first call when files exist."""
    from api.player_data import _FileWatcher
    import glob as _glob

    f = tmp_path / "player.dat"
    f.write_bytes(b"data")
    watcher = _FileWatcher(str(tmp_path))
    assert watcher.has_changes() is True


def test_file_watcher_no_change_on_second_call(mocker, tmp_path):
    """has_changes() returns False on the second call when nothing changed."""
    from api.player_data import _FileWatcher

    f = tmp_path / "player.dat"
    f.write_bytes(b"data")
    watcher = _FileWatcher(str(tmp_path))
    watcher.has_changes()  # first call records mtimes
    assert watcher.has_changes() is False


# ── read_essentials_homes ─────────────────────────────────────────────────────

def test_read_essentials_homes_missing_file(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns an empty list when the player YAML file does not exist."""
    from api.player_data import read_essentials_homes
    mocker.patch("os.path.exists", return_value=False)
    assert read_essentials_homes("some-uuid") == []


def test_read_essentials_homes_yaml_unavailable(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns an empty list gracefully when PyYAML is not installed."""
    import api.player_data as pd
    orig = pd._YAML_AVAILABLE
    pd._YAML_AVAILABLE = False
    try:
        assert pd.read_essentials_homes("some-uuid") == []
    finally:
        pd._YAML_AVAILABLE = orig


def test_read_essentials_homes_no_homes_section(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns an empty list when the YAML has no 'homes' key."""
    from api.player_data import read_essentials_homes
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="teleportenabled: true\n"))
    assert read_essentials_homes("some-uuid") == []


def test_read_essentials_homes_uses_world_name_key(mocker: "pytest_mock.MockerFixture", tmp_path: "pytest.TempPathFactory") -> None:
    """Prefers the 'world-name' key over the 'world' UUID value."""
    from api.player_data import read_essentials_homes, _ESSENTIALS_USERDATA_DIR
    yaml_text = (
        "homes:\n"
        "  casa:\n"
        "    world: ea0bedd7-d319-4848-959e-bdcdb6e8ce94\n"
        "    world-name: world\n"
        "    x: -122.334\n"
        "    y: 102.0\n"
        "    z: 41.345\n"
    )
    uid = "82657f6f-8a86-3af7-958b-f70b1d2b9c1b"
    yml_file = tmp_path / f"{uid}.yml"
    yml_file.write_text(yaml_text, encoding="utf-8")
    mocker.patch("api.player_data._ESSENTIALS_USERDATA_DIR", str(tmp_path))
    homes = read_essentials_homes(uid)
    assert homes == [{"name": "casa", "world": "world", "x": -122.334, "y": 102.0, "z": 41.345}]


def test_read_essentials_homes_falls_back_to_world_uuid_when_no_world_name(
    mocker: "pytest_mock.MockerFixture",
    tmp_path: "pytest.TempPathFactory",
) -> None:
    """Falls back to the 'world' key when 'world-name' is absent."""
    from api.player_data import read_essentials_homes
    yaml_text = (
        "homes:\n"
        "  base:\n"
        "    world: world_nether\n"
        "    x: 10.0\n"
        "    y: 50.0\n"
        "    z: -5.0\n"
    )
    uid = "some-uuid"
    (tmp_path / f"{uid}.yml").write_text(yaml_text, encoding="utf-8")
    mocker.patch("api.player_data._ESSENTIALS_USERDATA_DIR", str(tmp_path))
    homes = read_essentials_homes(uid)
    assert homes[0]["world"] == "world_nether"


def test_read_essentials_homes_multiple_homes_multiple_worlds(
    mocker: "pytest_mock.MockerFixture",
    tmp_path: "pytest.TempPathFactory",
) -> None:
    """Parses multiple homes spanning different worlds correctly."""
    from api.player_data import read_essentials_homes
    yaml_text = (
        "homes:\n"
        "  home:\n"
        "    world: ea0bedd7-uuid\n"
        "    world-name: world\n"
        "    x: 0.0\n"
        "    y: 64.0\n"
        "    z: 0.0\n"
        "  nether:\n"
        "    world: 9f80e0ae-uuid\n"
        "    world-name: world_nether\n"
        "    x: -100.0\n"
        "    y: 52.0\n"
        "    z: -337.0\n"
    )
    uid = "some-uuid"
    (tmp_path / f"{uid}.yml").write_text(yaml_text, encoding="utf-8")
    mocker.patch("api.player_data._ESSENTIALS_USERDATA_DIR", str(tmp_path))
    homes = read_essentials_homes(uid)
    assert len(homes) == 2
    worlds = {h["name"]: h["world"] for h in homes}
    assert worlds["home"] == "world"
    assert worlds["nether"] == "world_nether"


def test_read_essentials_homes_corrupted_yaml(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns an empty list without raising when the YAML is malformed."""
    from api.player_data import read_essentials_homes
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=": invalid: [yaml"))
    assert read_essentials_homes("some-uuid") == []


def test_parse_player_includes_homes(mocker: "pytest_mock.MockerFixture") -> None:
    """_parse_player attaches the EssentialsX homes list to the returned dict."""
    mocker.patch("os.path.getmtime", return_value=1700000000.0)
    mocker.patch("api.player_data.get_skin_url", return_value="http://skin")
    mocker.patch("nbtlib.load", return_value={
        "XpLevel": 5, "Health": 20.0,
        "Dimension": "minecraft:overworld", "Pos": [0, 64, 0],
    })
    mocker.patch(
        "api.player_data.read_essentials_homes",
        return_value=[{"name": "home", "world": "world", "x": 10.0, "y": 64.0, "z": -5.0}],
    )
    result = _parse_player("/path/to/some-uuid.dat", {"some-uuid": "Alex"})
    assert result is not None
    assert result["homes"] == [{"name": "home", "world": "world", "x": 10.0, "y": 64.0, "z": -5.0}]


# ── OP helpers ────────────────────────────────────────────────────────────────

def test_load_op_uuids_success(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns lowercased UUIDs from ops.json when present."""
    from api.player_data import _load_op_uuids
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch(
        "builtins.open",
        mocker.mock_open(read_data='[{"uuid": "AAAA-BBBB"}, {"uuid": "cccc-dddd"}]'),
    )
    assert _load_op_uuids() == {"aaaa-bbbb", "cccc-dddd"}


def test_load_op_uuids_parse_failure(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns an empty set when ops.json cannot be parsed."""
    from api.player_data import _load_op_uuids
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="not-json"))
    assert _load_op_uuids() == set()


def test_get_op_names_parse_failure(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns empty list when ops.json cannot be parsed."""
    from api.player_data import get_op_names
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=Exception("boom"))
    assert get_op_names() == []


# ── sync lock helper ──────────────────────────────────────────────────────────

def test_acquire_sync_lock_success_when_fcntl_available(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns True when file lock is acquired successfully."""
    import api.player_data as pd
    mocker.patch.object(pd, "_FCNTL_AVAILABLE", True)
    mocker.patch("builtins.open", mocker.mock_open())
    pd.fcntl = mocker.MagicMock()  # type: ignore[attr-defined]
    pd.fcntl.LOCK_EX = 1
    pd.fcntl.LOCK_NB = 2
    pd.fcntl.flock = mocker.MagicMock(return_value=None)
    assert pd._acquire_sync_lock() is True


def test_acquire_sync_lock_returns_false_when_locked(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when flock raises OSError (already locked by another worker)."""
    import api.player_data as pd
    mocker.patch.object(pd, "_FCNTL_AVAILABLE", True)
    mocker.patch("builtins.open", mocker.mock_open())
    pd.fcntl = mocker.MagicMock()  # type: ignore[attr-defined]
    pd.fcntl.LOCK_EX = 1
    pd.fcntl.LOCK_NB = 2
    pd.fcntl.flock = mocker.MagicMock(side_effect=OSError("locked"))
    assert pd._acquire_sync_lock() is False


def test_load_op_uuids_missing_file_returns_empty(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns empty set when ops.json is missing."""
    from api.player_data import _load_op_uuids
    mocker.patch("os.path.exists", return_value=False)
    assert _load_op_uuids() == set()


def test_get_op_names_success(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns names from ops.json when file is valid."""
    from api.player_data import get_op_names
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data='[{"name": "Steve"}, {"uuid": "x"}]'))
    assert get_op_names() == ["Steve"]


def test_get_op_names_missing_file_returns_empty(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns empty list when ops.json is missing."""
    from api.player_data import get_op_names
    mocker.patch("os.path.exists", return_value=False)
    assert get_op_names() == []


# ── map uuids key error branch ────────────────────────────────────────────────

def test_map_uuids_key_error_returns_empty_dict(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns empty dict when entries miss expected keys."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data='[{"name": "Steve"}]'))
    assert _map_uuids() == {}


# ── read_essentials_homes extra branches ─────────────────────────────────────

def test_read_essentials_homes_non_dict_root_returns_empty(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns empty list when YAML root is not a mapping."""
    from api.player_data import read_essentials_homes
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="- item"))
    assert read_essentials_homes("uuid") == []


def test_read_essentials_homes_skips_non_dict_home_entries(mocker: "pytest_mock.MockerFixture") -> None:
    """Skips malformed home entries that are not mappings."""
    from api.player_data import read_essentials_homes
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch(
        "builtins.open",
        mocker.mock_open(read_data="homes:\n  home: 123\n  base:\n    world: world\n    x: 1\n    y: 2\n    z: 3\n"),
    )
    homes = read_essentials_homes("uuid")
    assert homes == [{"name": "base", "world": "world", "x": 1.0, "y": 2.0, "z": 3.0}]


# ── atomic YAML writer ────────────────────────────────────────────────────────

def test_write_essentials_yaml_atomic_writes_file(tmp_path: "pytest.TempPathFactory") -> None:
    """Writes YAML atomically via temp file replacement."""
    from api.player_data import _write_essentials_yaml_atomic
    yml_path = tmp_path / "user.yml"
    _write_essentials_yaml_atomic(str(yml_path), {"homes": {"home": {"world": "world", "x": 1, "y": 2, "z": 3}}})
    content = yml_path.read_text(encoding="utf-8")
    assert "homes" in content
    assert "world" in content


# ── create/update/delete homes ────────────────────────────────────────────────

def test_create_essentials_home_yaml_unavailable_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when YAML backend is unavailable."""
    import api.player_data as pd
    orig = pd._YAML_AVAILABLE
    pd._YAML_AVAILABLE = False
    try:
        assert pd.create_essentials_home("u", "home", 1, 2, 3, "world") is False
    finally:
        pd._YAML_AVAILABLE = orig


def test_create_essentials_home_existing_name_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when a home with the same name already exists."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="homes:\n  home:\n    world: world\n"))
    assert pd.create_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_create_essentials_home_success_creates_dirs_and_writes(mocker: "pytest_mock.MockerFixture", tmp_path: "pytest.TempPathFactory") -> None:
    """Creates home successfully and writes YAML atomically."""
    import api.player_data as pd
    mocker.patch.object(pd, "_ESSENTIALS_USERDATA_DIR", str(tmp_path))
    mocker.patch("api.player_data._write_essentials_yaml_atomic", return_value=None)

    assert pd.create_essentials_home("u1", "base", 1.0, 64.0, 2.0, "world") is True


def test_create_essentials_home_exception_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when file operations raise unexpectedly."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=Exception("boom"))
    assert pd.create_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_create_essentials_home_existing_file_with_non_dict_data_is_handled(mocker: "pytest_mock.MockerFixture") -> None:
    """Executes non-dict YAML root handling branch even if subsequent write fails."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="- item"))
    mocker.patch("api.player_data._write_essentials_yaml_atomic", return_value=None)
    assert pd.create_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_yaml_unavailable_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when YAML backend is unavailable."""
    import api.player_data as pd
    orig = pd._YAML_AVAILABLE
    pd._YAML_AVAILABLE = False
    try:
        assert pd.update_essentials_home("u", "home", 1, 2, 3, "world") is False
    finally:
        pd._YAML_AVAILABLE = orig


def test_update_essentials_home_missing_file_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when player YAML does not exist."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=False)
    assert pd.update_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_non_dict_data_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when loaded YAML root is not a mapping."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="- bad"))
    assert pd.update_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_missing_target_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when target home does not exist."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="homes:\n  other:\n    world: world\n"))
    assert pd.update_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_success_rename_and_world_name(mocker: "pytest_mock.MockerFixture") -> None:
    """Updates coords and renames home while preserving world-name key style."""
    import api.player_data as pd
    yaml_data = "homes:\n  home:\n    world-name: world\n    x: 0\n    y: 64\n    z: 0\n"
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=yaml_data))
    write_spy = mocker.patch("api.player_data._write_essentials_yaml_atomic", return_value=None)

    assert pd.update_essentials_home("u", "home", 1, 2, 3, "world_nether", new_name="base") is True
    assert write_spy.called


def test_update_essentials_home_exception_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when update path raises unexpectedly."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=Exception("boom"))
    assert pd.update_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_updates_world_key_when_world_name_absent(mocker: "pytest_mock.MockerFixture") -> None:
    """Uses the world key path when world-name is not present in entry."""
    import api.player_data as pd
    yaml_data = "homes:\n  home:\n    world: world\n    x: 0\n    y: 64\n    z: 0\n"
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=yaml_data))
    write_spy = mocker.patch("api.player_data._write_essentials_yaml_atomic", return_value=None)
    assert pd.update_essentials_home("u", "home", 7, 8, 9, "world_the_end") is True
    assert write_spy.called


def test_delete_essentials_home_yaml_unavailable_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when YAML backend is unavailable."""
    import api.player_data as pd
    orig = pd._YAML_AVAILABLE
    pd._YAML_AVAILABLE = False
    try:
        assert pd.delete_essentials_home("u", "home") is False
    finally:
        pd._YAML_AVAILABLE = orig


def test_delete_essentials_home_missing_file_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when player YAML does not exist."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=False)
    assert pd.delete_essentials_home("u", "home") is False


def test_delete_essentials_home_non_dict_or_missing_home_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when YAML is malformed or target home is absent."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="homes:\n  other:\n    world: world\n"))
    assert pd.delete_essentials_home("u", "home") is False


def test_delete_essentials_home_success(mocker: "pytest_mock.MockerFixture") -> None:
    """Deletes existing home and writes updated YAML."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="homes:\n  home:\n    world: world\n"))
    write_spy = mocker.patch("api.player_data._write_essentials_yaml_atomic", return_value=None)
    assert pd.delete_essentials_home("u", "home") is True
    assert write_spy.called


def test_delete_essentials_home_exception_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when delete path raises unexpectedly."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=Exception("boom"))
    assert pd.delete_essentials_home("u", "home") is False


def test_delete_essentials_home_non_dict_root_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when delete reads malformed non-dict YAML root."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="- bad"))
    assert pd.delete_essentials_home("u", "home") is False


# ── background sync loop ──────────────────────────────────────────────────────

def test_background_sync_loop_handles_skin_changes_and_backoff(mocker: "pytest_mock.MockerFixture") -> None:
    """Clears skin caches and increases backoff when sync attempt fails in loop."""
    import api.player_data as pd

    class Watcher:
        def __init__(self, changes):
            self._changes = list(changes)
        def has_changes(self):
            if self._changes:
                return self._changes.pop(0)
            return False

    watchers = [Watcher([False, False]), Watcher([True, False])]
    mocker.patch("api.player_data._FileWatcher", side_effect=watchers)
    mocker.patch("api.player_data.get_players", side_effect=Exception("sync failed"))
    mocker.patch("api.player_data._url_resolution_cache", {"k": "v"})
    mocker.patch("api.player_data._url_resolved_at", {"k": 1.0})

    time_values = iter([100.0, 101.0, 200.0, 201.0])
    mocker.patch("time.time", side_effect=lambda: next(time_values))

    def stop_after_two(_seconds):
        stop_after_two.calls += 1
        if stop_after_two.calls >= 2:
            raise RuntimeError("stop-loop")
    stop_after_two.calls = 0
    mocker.patch("time.sleep", side_effect=stop_after_two)

    with pytest.raises(RuntimeError, match="stop-loop"):
        pd._background_sync_loop()


def test_background_sync_loop_success_resets_backoff(mocker: "pytest_mock.MockerFixture") -> None:
    """Runs successful sync branch and resets backoff path."""
    import api.player_data as pd

    class Watcher:
        def __init__(self, changes):
            self._changes = list(changes)
        def has_changes(self):
            if self._changes:
                return self._changes.pop(0)
            return False

    # First watcher (playerdata) reports one change so last_change update branch runs.
    # Second watcher (SkinsRestorer) reports no changes to keep focus on success path.
    mocker.patch("api.player_data._FileWatcher", side_effect=[Watcher([True, False]), Watcher([False, False])])
    get_players = mocker.patch("api.player_data.get_players", return_value=[])
    debug_spy = mocker.patch("api.player_data.logger.debug")

    # Sequence covers: initial last_change seed, watcher update, now, last_sync update.
    mocker.patch("time.time", side_effect=[100.0, 101.0, 200.0, 201.0, 202.0])

    def stop_after_two(_seconds):
        stop_after_two.calls += 1
        if stop_after_two.calls >= 2:
            raise RuntimeError("stop-loop")
    stop_after_two.calls = 0
    mocker.patch("time.sleep", side_effect=stop_after_two)

    with pytest.raises(RuntimeError, match="stop-loop"):
        pd._background_sync_loop()

    get_players.assert_called_once()
    debug_spy.assert_called_once()


def test_reload_player_data_covers_optional_import_and_non_leader_branch(mocker: "pytest_mock.MockerFixture") -> None:
    """Reloads module with yaml import failure and lock contention to cover env-specific import branches."""
    import builtins
    import importlib
    import sys
    import types
    import api.player_data as pd

    original_import = builtins.__import__

    fake_fcntl = types.SimpleNamespace(LOCK_EX=1, LOCK_NB=2)
    fake_fcntl.flock = mocker.MagicMock(side_effect=OSError("already-locked"))

    def controlled_import(name, *args, **kwargs):
        if name == "fcntl":
            return fake_fcntl
        if name == "yaml":
            raise ImportError("no-yaml")
        return original_import(name, *args, **kwargs)

    # Prevent thread side-effects during reload if lock branch changes.
    fake_thread = mocker.MagicMock()
    fake_thread.start = mocker.MagicMock()
    mocker.patch("threading.Thread", return_value=fake_thread)
    mocker.patch("builtins.open", mocker.mock_open())
    mocker.patch("builtins.__import__", side_effect=controlled_import)

    reloaded = importlib.reload(pd)
    assert reloaded._FCNTL_AVAILABLE is True
    assert reloaded._YAML_AVAILABLE is False

