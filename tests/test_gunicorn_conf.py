"""Tests for gunicorn.conf.py (loaded as a plain module, as gunicorn does)."""
import runpy
from pathlib import Path

import pytest

_CONF = Path(__file__).resolve().parent.parent / "gunicorn.conf.py"


def _load(monkeypatch, **env):
    for key in ("GUNICORN_BIND", "GUNICORN_WORKERS", "GUNICORN_THREADS"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return runpy.run_path(str(_CONF))


def test_defaults_are_threaded_workers(monkeypatch):
    """Defaults: 2 gthread workers x 4 threads, 60 s timeout, 30 s graceful shutdown."""
    conf = _load(monkeypatch)
    assert conf["worker_class"] == "gthread"
    assert conf["workers"] == 2
    assert conf["threads"] == 4
    assert conf["timeout"] == 60
    assert conf["graceful_timeout"] == 30
    assert conf["bind"] == "127.0.0.1:5000"


def test_worker_and_thread_counts_come_from_env(monkeypatch):
    """GUNICORN_WORKERS / GUNICORN_THREADS / GUNICORN_BIND override the defaults."""
    conf = _load(monkeypatch, GUNICORN_WORKERS="3", GUNICORN_THREADS="8", GUNICORN_BIND="0.0.0.0:8000")
    assert (conf["workers"], conf["threads"], conf["bind"]) == (3, 8, "0.0.0.0:8000")


def test_preload_stays_disabled(monkeypatch):
    """preload_app must stay False or the per-worker sync-leader election breaks."""
    assert _load(monkeypatch)["preload_app"] is False


def test_post_fork_starts_background_sync(monkeypatch, mocker):
    """post_fork starts this worker's background sync thread (leader or standby)."""
    start = mocker.patch("api.player_sync.start_background_sync")
    _load(monkeypatch)["post_fork"](server=None, worker=None)
    start.assert_called_once_with()


@pytest.mark.parametrize("value", ["zero", ""])
def test_invalid_thread_count_fails_fast(monkeypatch, value):
    """A malformed GUNICORN_THREADS is a startup error rather than a silent default."""
    with pytest.raises(ValueError):
        _load(monkeypatch, GUNICORN_THREADS=value)
