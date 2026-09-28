"""Pytest session setup.

Disable the background Firestore-sync thread during tests. It is auto-started
when api.player_sync is imported (api.server_api imports it); left running,
its periodic sync calls sync_players() in the background and can pollute mocks
(e.g. a patched logger.warning) in unrelated tests. This must run before
api.player_sync is imported, which pytest guarantees by loading conftest.py
before test modules.
"""
import os
import sys

import pytest

os.environ.setdefault("AUTO_START_BG_SYNC", "0")


@pytest.fixture(autouse=True)
def _reset_server_api_process_state():
    """Reset the API's process-wide caches/throttles (Drive client and listings
    in routes.backups, resync cooldown in routes.players) through
    api.server_api._reset_for_tests around every test that has it loaded."""
    def _reset() -> None:
        module = sys.modules.get("api.server_api")
        if module is not None:
            module._reset_for_tests()
    _reset()
    yield
    _reset()


@pytest.fixture
def client():
    """Provides a test client for the Flask application."""
    from api.server_api import app
    app.config["TESTING"] = True
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture
def route_state(tmp_path, monkeypatch):
    """Reset process-wide globals around a route test so results are order-
    independent: Firebase init state (shared via firebase_init, mirrored in
    api.auth), the status cache and the ownership cache. The password-attempt
    store points at a per-test SQLite file. Route test modules opt in with
    ``pytestmark = pytest.mark.usefixtures("route_state")``."""
    import api.auth as auth
    import api.firebase_init as fb_init
    import api.ownership as ownership
    from api.routes import accounts, status

    def _reset() -> None:
        fb_init._reset_for_tests()
        auth._FIREBASE_INITIALIZED = False
        status._STATUS_CACHE.clear()
        with ownership._owner_cache_lock:
            ownership._owner_cache.clear()
    monkeypatch.setattr(accounts, "_VERIFY_RATE_LIMIT_DB", str(tmp_path / "verify_rate_limit.sqlite3"))
    _reset()
    yield
    _reset()


@pytest.fixture
def reset_player_cache():
    """Reset api.player_data's player cache before and after a test (shared by
    test_player_data.py and test_player_sync.py via ``pytestmark``)."""
    import api.player_data as pd
    pd._cache.data = []
    pd._cache.last_updated = 0.0
    pd._cache.loaded = False
    yield
    pd._cache.data = []
    pd._cache.last_updated = 0.0
    pd._cache.loaded = False
    # A deferred background refresh that a test never ran still holds the lock.
    if pd._refresh_lock.locked():
        pd._refresh_lock.release()


@pytest.fixture
def reset_sync_state():
    """Reset the shared Firebase init state and the per-worker snapshot index
    around a test so init-path and index assertions don't depend on order
    (test_firestore_sync.py and test_snapshot_store.py opt in via pytestmark)."""
    import api.firebase_init as fb_init
    import api.snapshot_store as snapshot_store
    fb_init._reset_for_tests()
    snapshot_store._snapshot_index.reset(None)
    yield
    fb_init._reset_for_tests()
    snapshot_store._snapshot_index.reset(None)
