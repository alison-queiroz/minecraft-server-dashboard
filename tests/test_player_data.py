import threading

import pytest
import api.player_data as pd
from api.player_data import (
    _Cache,
    _map_uuids,
    _dimension_name,
    _parse_player,
    _fetch_live,
    get_players,
    _cache
)

UUID_A = "069a79f4-44e9-4726-a5be-fca90e38aaf5"
UUID_B = "853c80ef-3c37-49fd-aa49-938b674adae6"


pytestmark = pytest.mark.usefixtures("reset_player_cache")


class _DeferredThread:
    """threading.Thread stand-in whose target runs only when the test calls run()."""

    def __init__(self, registry, target=None, args=(), daemon=None, name=None):
        self.registry, self.target, self.args, self.daemon, self.name = registry, target, args, daemon, name

    def start(self):
        self.registry.append(self)

    def run(self):
        self.target(*self.args)


@pytest.fixture
def deferred_threads(mocker):
    """Capture threads started by player_data instead of running them."""
    started = []
    mocker.patch(
        "api.player_data.threading.Thread",
        side_effect=lambda *a, **kw: _DeferredThread(started, *a, **kw),
    )
    return started


def _stale_cache(data):
    """Put the cache in the 'loaded but stale' state with the given list."""
    _cache.refresh(data)
    _cache.last_updated -= pd._CACHE_TTL + 1


def test_cache_logic(mocker):
    """Ensure cache staleness is calculated correctly based on TTL."""
    c = _Cache()
    assert c.loaded is False

    # Force staleness
    mocker.patch("time.time", return_value=100.0)
    c.last_updated = 10.0
    assert c.is_stale() is True

    # Refresh and check again
    c.refresh([{"mock": "data"}])
    assert c.data == [{"mock": "data"}]
    assert c.last_updated == 100.0
    assert c.is_stale() is False
    assert c.loaded is True

    # Invalidation marks stale but keeps serving the data.
    c.invalidate()
    assert c.is_stale() is True
    assert c.data == [{"mock": "data"}] and c.loaded is True

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

def test_get_uuid_to_name_reads_usercache_without_rescan(mocker):
    """The public accessor maps UUIDs to names straight from usercache.json."""
    mocker.patch("api.player_data._map_uuids", return_value={UUID_A: "Steve"})
    fetch = mocker.patch("api.player_data._fetch_live")
    assert pd.get_uuid_to_name() == {UUID_A: "Steve"}
    fetch.assert_not_called()

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
    warning = mocker.patch("api.player_data.logger.warning")

    result = _parse_player("/path/to/123.dat", {})
    assert result is None
    assert warning.call_args.kwargs.get("exc_info") is True

def test_fetch_live_success(mocker):
    """Ensure it fetches and sorts players properly."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("api.player_data._map_uuids", return_value={})
    mocker.patch("api.player_data._load_op_uuids", return_value={UUID_B})
    mocker.patch("glob.glob", return_value=[f"{UUID_A}.dat", f"{UUID_B}.dat"])

    # Mock _parse_player to return levels so we can test the sorting behavior
    def mock_parse(filepath, _):
        if filepath == f"{UUID_A}.dat":
            return {"name": "Noob", "level": 5, "uuid": UUID_A}
        return {"name": "Pro", "level": 100, "uuid": UUID_B}

    mocker.patch("api.player_data._parse_player", side_effect=mock_parse)

    result = _fetch_live()

    assert len(result) == 2
    assert result[0]["name"] == "Pro" # Higher level first
    assert result[1]["name"] == "Noob"
    assert result[0]["is_op"] is True and result[1]["is_op"] is False


def test_fetch_live_ignores_save_temp_files(mocker):
    """Minecraft's '<uuid>-<random>.dat' save temp files (and other names) are never parsed."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("api.player_data._map_uuids", return_value={})
    mocker.patch("api.player_data._load_op_uuids", return_value=set())
    mocker.patch("glob.glob", return_value=[
        f"/pd/{UUID_A}.dat", f"/pd/{UUID_A}-4812345.dat", "/pd/notes.dat",
    ])
    parse = mocker.patch("api.player_data._parse_player", return_value={"uuid": UUID_A, "level": 1})

    assert len(_fetch_live()) == 1
    parse.assert_called_once_with(f"/pd/{UUID_A}.dat", {})


def test_fetch_live_no_dir(mocker):
    """Ensure it returns an empty list if the playerdata dir doesn't exist."""
    mocker.patch("os.path.exists", return_value=False)
    assert _fetch_live() == []


def test_parse_player_file_vanished_mid_save(mocker):
    """A player file renamed away mid-save is skipped for this scan instead of failing it."""
    mocker.patch("os.path.getmtime", side_effect=FileNotFoundError("gone"))
    debug = mocker.patch("api.player_data.logger.debug")
    assert _parse_player(f"/pd/{UUID_A}.dat", {}) is None
    debug.assert_called_once()


def test_get_players_first_load_blocks_and_does_not_sync(mocker, deferred_threads):
    """The very first call loads synchronously; no Firestore sync is triggered by a request."""
    mock_fetch = mocker.patch("api.player_data._fetch_live", return_value=[{"name": "Steve"}])
    sync = mocker.patch("api.player_sync.sync_players")

    result = get_players()

    mock_fetch.assert_called_once()
    assert result == [{"name": "Steve"}]
    assert _cache.loaded is True
    assert deferred_threads == []
    sync.assert_not_called()


def test_get_players_first_load_runs_once_for_concurrent_callers(mocker):
    """Concurrent requests on a cold worker share a single rescan (no thundering herd)."""
    release = threading.Event()

    def slow_fetch():
        release.wait(5)
        return [{"name": "Steve"}]

    fetch = mocker.patch("api.player_data._fetch_live", side_effect=slow_fetch)
    results = []
    threads = [threading.Thread(target=lambda: results.append(get_players())) for _ in range(4)]
    for t in threads:
        t.start()
    release.set()
    for t in threads:
        t.join(5)

    fetch.assert_called_once()
    assert results == [[{"name": "Steve"}]] * 4


def test_get_players_cache_hit(mocker):
    """Ensure a fresh cache returns immediately without fetching."""
    mock_fetch = mocker.patch("api.player_data._fetch_live")
    mocker.patch("time.time", return_value=100.0)

    _cache.data = [{"name": "CachedSteve"}]
    _cache.last_updated = 95.0 # Only 5 seconds old, not stale
    _cache.loaded = True

    result = get_players()

    mock_fetch.assert_not_called()
    assert result == [{"name": "CachedSteve"}]


def test_get_players_serves_stale_and_refreshes_once_in_background(mocker, deferred_threads):
    """A stale cache is returned at once while exactly one background refresh runs."""
    fetch = mocker.patch("api.player_data._fetch_live", return_value=[{"name": "New"}])
    sync = mocker.patch("api.player_sync.sync_players")
    _stale_cache([{"name": "Old"}])

    assert get_players() == [{"name": "Old"}]
    assert get_players() == [{"name": "Old"}]  # a second request while the refresh is in flight
    assert len(deferred_threads) == 1
    assert deferred_threads[0].daemon is True
    fetch.assert_not_called()

    deferred_threads[0].run()

    fetch.assert_called_once()
    assert not pd._refresh_lock.locked()
    assert get_players() == [{"name": "New"}]
    assert len(deferred_threads) == 1
    sync.assert_not_called()


def test_get_players_background_refresh_failure_keeps_stale_data(mocker, deferred_threads):
    """A failed background rescan is logged, releases the lock, and the old list keeps serving."""
    mocker.patch("api.player_data._fetch_live", side_effect=OSError("disk"))
    warning = mocker.patch("api.player_data.logger.warning")
    _stale_cache([{"name": "Old"}])

    get_players()
    deferred_threads[0].run()

    assert not pd._refresh_lock.locked()
    assert warning.call_args.kwargs.get("exc_info") is True
    assert get_players() == [{"name": "Old"}]
    assert len(deferred_threads) == 2  # still stale, so the next request retries


def test_get_players_skips_refresh_when_another_thread_just_refreshed(mocker, deferred_threads):
    """If the cache became fresh between the staleness check and the lock, no refresh starts."""
    _stale_cache([{"name": "Old"}])
    mocker.patch.object(_cache, "is_stale", side_effect=[True, False])

    assert get_players() == [{"name": "Old"}]
    assert deferred_threads == []
    assert not pd._refresh_lock.locked()


def test_get_players_thread_start_failure_serves_stale(mocker):
    """If the refresh thread cannot start, the lock is released and stale data is served."""
    thread = mocker.MagicMock()
    thread.start.side_effect = RuntimeError("can't start new thread")
    mocker.patch("api.player_data.threading.Thread", return_value=thread)
    warning = mocker.patch("api.player_data.logger.warning")
    _stale_cache([{"name": "Old"}])

    assert get_players() == [{"name": "Old"}]
    assert not pd._refresh_lock.locked()
    warning.assert_called_once()


# ── invalidate_caches ─────────────────────────────────────────────────────────

@pytest.fixture
def resync_marker(tmp_path, mocker):
    """Point the leader-resync marker at a temp path."""
    marker = tmp_path / "sync.lock.resync"
    mocker.patch.object(pd, "_RESYNC_REQUEST_PATH", str(marker))
    return marker


def test_invalidate_caches_marks_stale_clears_skins_and_signals_leader(mocker, resync_marker, deferred_threads):
    """Skin caches are cleared, the list stays served while stale, and the leader marker is touched."""
    clear = mocker.patch("api.player_data.clear_skin_caches")
    _cache.refresh([{"name": "Old"}])

    pd.invalidate_caches()

    clear.assert_called_once()
    assert _cache.is_stale() and _cache.loaded
    assert resync_marker.exists()
    assert get_players() == [{"name": "Old"}]
    assert len(deferred_threads) == 1  # one background refresh, request not blocked


def test_invalidate_caches_waits_for_in_flight_refresh(mocker, resync_marker):
    """Invalidation takes the refresh lock, so an in-flight rescan cannot overwrite it afterwards."""
    clear = mocker.patch("api.player_data.clear_skin_caches")
    pd._refresh_lock.acquire()
    worker = threading.Thread(target=pd.invalidate_caches)
    try:
        worker.start()
        worker.join(0.2)
        assert worker.is_alive()
        clear.assert_not_called()
    finally:
        pd._refresh_lock.release()
    worker.join(5)
    clear.assert_called_once()


def test_invalidate_caches_logs_when_marker_cannot_be_written(mocker, tmp_path):
    """A marker write failure is logged; the local invalidation still happens."""
    mocker.patch.object(pd, "_RESYNC_REQUEST_PATH", str(tmp_path / "missing-dir" / "marker"))
    mocker.patch("api.player_data.clear_skin_caches")
    warning = mocker.patch("api.player_data.logger.warning")
    _cache.refresh([])

    pd.invalidate_caches()

    assert _cache.is_stale()
    assert warning.call_args.kwargs.get("exc_info") is True


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


def test_read_stats_corrupted_file_logs_debug(mocker):
    """Logs the swallowed parse error at debug level with the traceback."""
    import api.player_data as pd
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="not-json"))
    debug = mocker.patch.object(pd.logger, "debug")
    assert pd._read_stats("some-uuid") == {}
    assert debug.call_args.kwargs.get("exc_info") is True


# ── advancement count (shared helper) ─────────────────────────────────────────

def test_parse_player_uses_shared_advancement_counter(mocker):
    """advancement_count comes from advancements.count_completed (one shared recipe filter)."""
    mocker.patch("os.path.getmtime", return_value=1700000000.0)
    mocker.patch("api.player_data.get_skin_url", return_value="http://skin")
    mocker.patch("nbtlib.load", return_value={"XpLevel": 1, "Health": 20.0})
    counter = mocker.patch("api.player_data.count_completed", return_value=7)
    result = _parse_player("/path/to/abc.dat", {"abc": "Steve"})
    counter.assert_called_once_with("abc")
    assert result["advancement_count"] == 7


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


# ── _parse_player: homes stay private ────────────────────────────────────────

def test_parse_player_omits_homes(mocker: "pytest_mock.MockerFixture") -> None:
    """_parse_player never ships EssentialsX homes: the player list (and its
    Firestore copy) is visible to every user, and homes are private unless
    their owner marks them public (served by /api/players/<uuid>/public-profile)."""
    mocker.patch("os.path.getmtime", return_value=1700000000.0)
    mocker.patch("api.player_data.get_skin_url", return_value="http://skin")
    mocker.patch("nbtlib.load", return_value={
        "XpLevel": 5, "Health": 20.0,
        "Dimension": "minecraft:overworld", "Pos": [0, 64, 0],
    })
    read_homes = mocker.patch("api.essentials_homes.read_essentials_homes")
    result = _parse_player("/path/to/some-uuid.dat", {"some-uuid": "Alex"})
    assert result is not None
    assert "homes" not in result
    read_homes.assert_not_called()


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
    """Returns empty list (and logs the traceback) when ops.json cannot be parsed."""
    from api.player_data import get_op_names
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=Exception("boom"))
    warning = mocker.patch("api.player_data.logger.warning")
    assert get_op_names() == []
    assert warning.call_args.kwargs.get("exc_info") is True


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

