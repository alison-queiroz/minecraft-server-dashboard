"""Tests for api/player_sync.py: the flock leader election, the file watchers,
the sync-leader loop (debounce, interval, backoff, skin/resync invalidation),
standby takeover and the once-per-worker thread start."""
import pytest

import api.player_data as pd
import api.player_sync as ps
from api.player_data import _cache

pytestmark = pytest.mark.usefixtures("reset_player_cache")

UUID_A = "069a79f4-44e9-4726-a5be-fca90e38aaf5"


# ── _acquire_sync_lock ────────────────────────────────────────────────────────

def test_acquire_sync_lock_returns_true_when_fcntl_unavailable(mocker):
    """On Windows (no fcntl), always returns True (single-process dev env)."""
    import api.player_sync as ps
    orig = ps._FCNTL_AVAILABLE
    ps._FCNTL_AVAILABLE = False
    try:
        result = ps._acquire_sync_lock()
        assert result is True
    finally:
        ps._FCNTL_AVAILABLE = orig


# ── _FileWatcher ──────────────────────────────────────────────────────────────

def test_file_watcher_detects_change(mocker, tmp_path):
    """has_changes() returns True on first call when files exist."""
    from api.player_sync import _FileWatcher

    f = tmp_path / "player.dat"
    f.write_bytes(b"data")
    watcher = _FileWatcher(str(tmp_path))
    assert watcher.has_changes() is True


def test_file_watcher_no_change_on_second_call(mocker, tmp_path):
    """has_changes() returns False on the second call when nothing changed."""
    from api.player_sync import _FileWatcher

    f = tmp_path / "player.dat"
    f.write_bytes(b"data")
    watcher = _FileWatcher(str(tmp_path))
    watcher.has_changes()  # first call records mtimes
    assert watcher.has_changes() is False


def test_file_watcher_detects_modification_and_removal(tmp_path):
    """An mtime change and a deleted file both count as changes, and deleted paths are forgotten."""
    import os
    from api.player_sync import _FileWatcher

    f = tmp_path / "player.dat"
    f.write_bytes(b"data")
    watcher = _FileWatcher(str(tmp_path))
    watcher.has_changes()
    os.utime(f, (1_000_000, 1_000_000))
    assert watcher.has_changes() is True
    f.unlink()
    assert watcher.has_changes() is True
    assert watcher._mtimes == {}


def test_file_watcher_tolerates_file_vanishing_between_glob_and_stat(mocker, tmp_path):
    """A temp file deleted between glob and stat is skipped instead of raising."""
    from api.player_sync import _FileWatcher

    mocker.patch("glob.glob", return_value=[str(tmp_path / "gone.dat")])
    watcher = _FileWatcher(str(tmp_path))
    assert watcher.has_changes() is False


# ── sync lock helper ──────────────────────────────────────────────────────────

@pytest.fixture
def fake_fcntl(mocker, tmp_path):
    """Pretend fcntl exists (POSIX) with a temp lock path and no lock held yet."""
    fake = mocker.MagicMock(LOCK_EX=1, LOCK_NB=2)
    mocker.patch.object(ps, "fcntl", fake, create=True)
    mocker.patch.object(ps, "_FCNTL_AVAILABLE", True)
    mocker.patch.object(pd, "_SYNC_LOCK_PATH", str(tmp_path / "sync.lock"))
    mocker.patch.object(ps, "_sync_lock_fd", None)
    return fake


def test_acquire_sync_lock_success_when_fcntl_available(fake_fcntl) -> None:
    """Returns True and keeps the locked handle open for the life of the process."""
    assert ps._acquire_sync_lock() is True
    fake_fcntl.flock.assert_called_once()
    assert ps._sync_lock_fd is not None and not ps._sync_lock_fd.closed
    ps._sync_lock_fd.close()


def test_acquire_sync_lock_returns_false_when_locked(fake_fcntl, mocker) -> None:
    """Returns False when flock raises (held by another worker) and closes the attempt's fd."""
    fake_fcntl.flock.side_effect = OSError("locked")
    handle = mocker.MagicMock()
    mocker.patch("os.fdopen", return_value=handle)
    assert ps._acquire_sync_lock() is False
    handle.close.assert_called_once()
    assert ps._sync_lock_fd is None


def test_acquire_sync_lock_returns_false_when_lock_file_unopenable(fake_fcntl, mocker) -> None:
    """An unopenable lock file (e.g. owned by another user) is logged and loses the election."""
    mocker.patch("os.open", side_effect=PermissionError("denied"))
    warning = mocker.patch("api.player_sync.logger.warning")
    assert ps._acquire_sync_lock() is False
    assert warning.call_args.kwargs.get("exc_info") is True
    fake_fcntl.flock.assert_not_called()


# ── background sync loop (sync leader) ────────────────────────────────────────

class _StopLoop(Exception):
    pass


class _Clock:
    """Fake wall clock: time.sleep advances it; stops the loop after max_ticks sleeps."""

    def __init__(self, max_ticks, on_tick=None):
        self.now = 1_000_000.0
        self.ticks = 0
        self.max_ticks = max_ticks
        self.on_tick = on_tick

    def time(self):
        return self.now

    def sleep(self, seconds):
        if self.ticks >= self.max_ticks:
            raise _StopLoop()
        self.ticks += 1
        self.now += seconds
        if self.on_tick:
            self.on_tick(self.ticks)


class _Watcher:
    """_FileWatcher stand-in; the first value answers the baseline call."""

    def __init__(self, changes):
        self._changes = list(changes)

    def has_changes(self):
        value = self._changes.pop(0) if self._changes else False
        if isinstance(value, Exception):
            raise value
        return value


def _run_loop(mocker, clock, watchers=None):
    """Run _background_sync_loop under the fake clock until it is stopped."""
    mocker.patch("time.time", side_effect=clock.time)
    mocker.patch("time.sleep", side_effect=clock.sleep)
    if watchers is not None:
        mocker.patch("api.player_sync._FileWatcher", side_effect=watchers)
    with pytest.raises(_StopLoop):
        ps._background_sync_loop()


def _no_changes():
    return [_Watcher([]), _Watcher([]), _Watcher([])]


def test_leader_loop_syncs_at_start_then_once_per_interval(mocker):
    """The leader syncs on its first poll, then every _SYNC_MIN_INTERVAL, writing fresh data."""
    fresh = [{"uuid": UUID_A, "level": 1}]
    mocker.patch("api.player_data._fetch_live", return_value=fresh)
    sync = mocker.patch("api.player_sync.sync_players")
    clock = _Clock(max_ticks=14)  # 14 polls x 5 s = 70 s

    _run_loop(mocker, clock, _no_changes())

    assert sync.call_count == 2  # t=5 s and t=65 s
    sync.assert_called_with(fresh)
    assert _cache.data == fresh and _cache.loaded


def test_leader_loop_debounces_while_player_files_change(mocker):
    """No sync runs until player .dat files have been quiet for _SYNC_DEBOUNCE seconds."""
    mocker.patch("api.player_data._fetch_live", return_value=[])
    synced_at = []
    clock = _Clock(max_ticks=6)
    mocker.patch("api.player_sync.sync_players", side_effect=lambda _: synced_at.append(clock.now))
    playerdata = _Watcher([False, True, True, False, False, False, False])

    _run_loop(mocker, clock, [playerdata, _Watcher([]), _Watcher([])])

    # Changes seen at t=5 and t=10 → first sync once 10 s have been quiet (t=20).
    assert synced_at == [clock.now - 10]


def test_leader_loop_clears_skin_caches_on_skinsrestorer_change(mocker):
    """A SkinsRestorer player-file change clears skin caches and invalidates the player list."""
    mocker.patch("api.player_data._fetch_live", return_value=[])
    mocker.patch("api.player_sync.sync_players")
    clear = mocker.patch("api.player_sync.clear_skin_caches")
    invalidate = mocker.spy(_cache, "invalidate")

    _run_loop(mocker, _Clock(max_ticks=2), [_Watcher([]), _Watcher([False, False, True]), _Watcher([])])

    clear.assert_called_once()
    invalidate.assert_called_once()


def test_leader_loop_honours_resync_request_from_any_worker(mocker, tmp_path):
    """invalidate_caches() in another worker touches the marker; the leader clears its skin caches."""
    mocker.patch.object(pd, "_RESYNC_REQUEST_PATH", str(tmp_path / "sync.lock.resync"))
    mocker.patch.object(pd, "_PLAYERDATA_DIR", str(tmp_path / "playerdata"))
    mocker.patch.object(pd, "_SR_PLAYERS_DIR", str(tmp_path / "sr"))
    mocker.patch("api.player_data._fetch_live", return_value=[])
    mocker.patch("api.player_sync.sync_players")
    clear = mocker.patch("api.player_sync.clear_skin_caches")

    def on_tick(tick):
        if tick == 2:
            pd._request_leader_resync()  # what invalidate_caches() does cross-process

    _run_loop(mocker, _Clock(max_ticks=3, on_tick=on_tick))

    clear.assert_called_once()


def test_leader_loop_backs_off_on_sync_failure(mocker):
    """Failed syncs are retried after _SYNC_MIN_INTERVAL plus a growing backoff (capped at 5 min)."""
    mocker.patch("api.player_data._fetch_live", return_value=[])
    clock = _Clock(max_ticks=80)  # 400 s
    attempts = []
    mocker.patch("api.player_sync.sync_players", side_effect=lambda _: attempts.append(clock.now) or (_ for _ in ()).throw(RuntimeError("firestore down")))
    warning = mocker.patch("api.player_sync.logger.warning")

    _run_loop(mocker, clock, _no_changes())

    gaps = [b - a for a, b in zip(attempts, attempts[1:])]
    assert gaps == [120.0, 180.0]
    assert warning.call_args.kwargs.get("exc_info") is True
    assert not pd._refresh_lock.locked()


def test_leader_loop_recovers_after_failure(mocker):
    """After a failed sync, a successful one resets the backoff to the normal interval."""
    mocker.patch("api.player_data._fetch_live", return_value=[])
    clock = _Clock(max_ticks=60)  # 300 s
    attempts = []

    def flaky(_):
        attempts.append(clock.now)
        if len(attempts) == 1:
            raise RuntimeError("blip")

    mocker.patch("api.player_sync.sync_players", side_effect=flaky)
    mocker.patch("api.player_sync.logger.warning")

    _run_loop(mocker, clock, _no_changes())

    gaps = [b - a for a, b in zip(attempts, attempts[1:])]
    assert gaps[:3] == [120.0, 60.0, 60.0]


def test_leader_loop_survives_polling_errors(mocker):
    """An unexpected error while polling is logged and the leader keeps syncing."""
    mocker.patch("api.player_data._fetch_live", return_value=[])
    sync = mocker.patch("api.player_sync.sync_players")
    warning = mocker.patch("api.player_sync.logger.warning")

    _run_loop(mocker, _Clock(max_ticks=1), [_Watcher([False, OSError("glob")]), _Watcher([]), _Watcher([])])

    warning.assert_called_once()
    sync.assert_called_once()


# ── leader election / standby ─────────────────────────────────────────────────

def test_sync_thread_leader_runs_loop_without_warmup(mocker):
    """The worker that wins the lock runs the leader loop (its first sync warms the cache)."""
    mocker.patch("api.player_sync._acquire_sync_lock", return_value=True)
    loop = mocker.patch("api.player_sync._background_sync_loop")
    warm = mocker.patch("api.player_data.get_players")

    ps._sync_thread_main()

    loop.assert_called_once()
    warm.assert_not_called()


def test_sync_thread_standby_warms_cache_and_takes_over(mocker):
    """A losing worker warms its cache, retries the lock, and becomes leader when it frees up."""
    acquire = mocker.patch("api.player_sync._acquire_sync_lock", side_effect=[False, False, False, True])
    loop = mocker.patch("api.player_sync._background_sync_loop")
    warm = mocker.patch("api.player_data.get_players")
    sleep = mocker.patch("time.sleep")

    ps._sync_thread_main()

    warm.assert_called_once()
    assert acquire.call_count == 4
    assert sleep.call_count == 2
    sleep.assert_called_with(ps._LEADER_RETRY_SECONDS)
    loop.assert_called_once()


def test_sync_thread_standby_warmup_failure_is_logged(mocker):
    """A failed warm-up is logged and the worker still stands by for leadership."""
    mocker.patch("api.player_sync._acquire_sync_lock", side_effect=[False, True])
    mocker.patch("api.player_sync._background_sync_loop")
    mocker.patch("api.player_data.get_players", side_effect=OSError("disk"))
    warning = mocker.patch("api.player_sync.logger.warning")

    ps._sync_thread_main()

    assert warning.call_args.kwargs.get("exc_info") is True


def test_start_background_sync_is_idempotent(mocker):
    """One background thread per worker, however many times it is called."""
    mocker.patch.object(ps, "_bg_sync_thread", None)
    thread_cls = mocker.patch("api.player_sync.threading.Thread")

    ps.start_background_sync()
    ps.start_background_sync()

    thread_cls.assert_called_once()
    assert thread_cls.call_args.kwargs["target"] is ps._sync_thread_main
    assert thread_cls.call_args.kwargs["daemon"] is True
    thread_cls.return_value.start.assert_called_once()


def test_reload_player_data_covers_optional_import_and_non_leader_branch(mocker: "pytest_mock.MockerFixture") -> None:
    """Reloads module with yaml import failure and lock contention to cover env-specific import branches."""
    import builtins
    import importlib
    import sys
    import types
    import api.essentials_homes as eh
    import api.player_sync as ps

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

    reloaded = importlib.reload(ps)
    reloaded_homes = importlib.reload(eh)
    assert reloaded._FCNTL_AVAILABLE is True
    assert reloaded_homes._YAML_AVAILABLE is False


# ── auto-start: exactly one sync thread per worker ───────────────────────────

_POST_FORK_THEN_APP = (
    "from api.player_sync import start_background_sync; start_background_sync(); import api.server_api"
)


@pytest.mark.parametrize("auto_start,code,expected", [
    ("1", "import run", 1),
    ("1", _POST_FORK_THEN_APP, 1),
    ("0", _POST_FORK_THEN_APP, 1),
    ("0", "import run", 0),
], ids=["run-py", "gunicorn-worker", "gunicorn-worker-no-autostart", "deploy-import-smoke-test"])
def test_background_sync_starts_once_per_worker_import(tmp_path, auto_start, code, expected):
    """Loading the app starts exactly one sync thread unless AUTO_START_BG_SYNC=0, and gunicorn's post_fork call never adds a second."""
    import os
    import subprocess
    import sys
    from pathlib import Path
    repo = Path(__file__).resolve().parents[1]
    env = dict(
        os.environ,
        AUTO_START_BG_SYNC=auto_start,
        SYNC_LOCK_PATH=str(tmp_path / "sync.lock"),
        MINECRAFT_DIR=str(tmp_path),
        LOCAL_SNAPSHOTS_PATH=str(tmp_path / "snapshots.jsonl"),
        PYTHONDONTWRITEBYTECODE="1",
    )
    count = "import threading; print(sum(t.name == 'player-bg-sync' for t in threading.enumerate()))"
    result = subprocess.run(
        [sys.executable, "-c", f"{code}; {count}"],
        cwd=repo, env=env, capture_output=True, text=True, timeout=120, check=True,
    )
    assert result.stdout.strip().splitlines()[-1] == str(expected)
