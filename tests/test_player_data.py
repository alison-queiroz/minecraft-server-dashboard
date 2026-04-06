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
