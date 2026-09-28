import pytest
import json
from datetime import datetime, timezone
import api.firestore_sync as fs_module
import api.firebase_init as fb_init
import api.snapshot_store as snapshot_store
from api.firestore_sync import _to_native, sync_players


pytestmark = pytest.mark.usefixtures("reset_sync_state")


# ── _to_native ────────────────────────────────────────────────────────────────

def test_to_native_conversion():
    """Ensure complex and nested types are correctly converted to plain Python types."""
    class DummyNBTType:
        def __str__(self):
            return "dummy_string"

    mock_data = {
        "is_admin": True,
        "level": 30.0,
        "health": 20,
        "name": "Steve",
        "inventory": ["sword", {"count": 64}],
        "custom_tag": DummyNBTType(),
        "empty_val": None
    }

    result = _to_native(mock_data)

    assert result["is_admin"] is True
    assert result["level"] == 30.0
    assert result["health"] == 20
    assert result["name"] == "Steve"
    assert result["inventory"] == ["sword", {"count": 64}]
    assert result["custom_tag"] == "dummy_string"
    assert result["empty_val"] is None


def test_to_native_converts_tuple_to_list():
    assert _to_native((1, 2, 3)) == [1, 2, 3]


def test_to_native_bool_not_converted_to_int():
    """bool must remain bool (not be converted to int via the int branch)."""
    result = _to_native({"flag": True})
    assert result["flag"] is True
    assert isinstance(result["flag"], bool)


# ── _ensure_firebase ──────────────────────────────────────────────────────────

def test_ensure_firebase_already_initialized(mocker):
    """Returns True immediately without re-initializing when already done."""
    fb_init._initialized = True
    mock_init = mocker.patch("firebase_admin.initialize_app")
    result = fs_module._ensure_firebase()
    assert result is True
    mock_init.assert_not_called()


def test_ensure_firebase_success(mocker):
    """Initializes Firebase and sets the flag on success."""
    mocker.patch("firebase_admin._apps", [])
    mocker.patch("firebase_admin.credentials.Certificate")
    mocker.patch("firebase_admin.initialize_app")
    result = fs_module._ensure_firebase()
    assert result is True
    assert fb_init._initialized is True


def test_ensure_firebase_failure(mocker):
    """Returns False and leaves the flag unset when initialization fails."""
    mocker.patch("firebase_admin._apps", [])
    mocker.patch("firebase_admin.credentials.Certificate", side_effect=Exception("file not found"))
    result = fs_module._ensure_firebase()
    assert result is False
    assert fb_init._initialized is False


def test_ensure_firebase_warns_once_then_logs_retries_at_debug(mocker):
    """A persistent init failure warns on the first attempt only; retries log at debug."""
    mocker.patch("firebase_admin._apps", [])
    mocker.patch("firebase_admin.credentials.Certificate", side_effect=Exception("file not found"))
    warning = mocker.patch.object(fb_init.logger, "warning")
    debug = mocker.patch.object(fb_init.logger, "debug")
    assert fs_module._ensure_firebase() is False
    assert fs_module._ensure_firebase() is False
    warning.assert_called_once()
    debug.assert_called_once()


def test_ensure_firebase_skip_init_when_apps_already_exist(mocker):
    """Does not call initialize_app when firebase_admin._apps is non-empty."""
    mocker.patch("firebase_admin._apps", ["existing_app"])
    mocker.patch("firebase_admin.credentials.Certificate")
    mock_init = mocker.patch("firebase_admin.initialize_app")
    fs_module._ensure_firebase()
    mock_init.assert_not_called()


# ── _get_online_from_server ───────────────────────────────────────────────────

def _mock_java_server(mocker, *, online, sample):
    """Patch mcstatus.JavaServer to return a status with the given players."""
    players = type("Players", (), {"online": online, "sample": sample})()
    status = type("Status", (), {"players": players})()
    server = mocker.MagicMock()
    server.status.return_value = status
    mocker.patch("mcstatus.JavaServer", return_value=server)


def test_get_online_from_server_returns_roster_from_mcstatus(mocker):
    """Names + count come from the live mcstatus query (single source of truth)."""
    sample = [type("P", (), {"name": "Steve"})(), type("P", (), {"name": "Alex"})()]
    _mock_java_server(mocker, online=2, sample=sample)
    names, count = fs_module._get_online_from_server()
    assert count == 2
    assert names == ["Alex", "Steve"]


def test_get_online_from_server_count_without_sample(mocker):
    """Count is taken from players.online even when the sample is truncated/absent."""
    _mock_java_server(mocker, online=7, sample=None)
    names, count = fs_module._get_online_from_server()
    assert count == 7
    assert names == []


def test_get_online_from_server_unreachable_returns_empty(mocker):
    """Returns ([], 0) when the server can't be reached."""
    server = mocker.MagicMock()
    server.status.side_effect = Exception("connection refused")
    mocker.patch("mcstatus.JavaServer", return_value=server)
    names, count = fs_module._get_online_from_server()
    assert (names, count) == ([], 0)


# ── sync_players ──────────────────────────────────────────────────────────────

MINUTE_A = datetime(2026, 9, 28, 12, 0, 5, tzinfo=timezone.utc)
MINUTE_B = datetime(2026, 9, 28, 12, 1, 5, tzinfo=timezone.utc)


@pytest.fixture
def sync_env(tmp_path, mocker):
    """Hermetic sync: temp JSONL, fixed online count, controllable clock, mocked Firestore."""
    mocker.patch.object(snapshot_store, "_LOCAL_SNAPSHOTS_PATH", str(tmp_path / "snapshots.jsonl"))
    mocker.patch.object(fs_module, "_get_online_from_server", return_value=([], 2))
    mocker.patch.object(fs_module, "_ensure_firebase", return_value=True)
    clock = mocker.patch.object(fs_module, "datetime")
    clock.now.return_value = MINUTE_A
    client = mocker.patch("firebase_admin.firestore.client")
    db = client.return_value
    # Fresh leader state (as in a newly started process); restored afterwards.
    mocker.patch.object(fs_module, "_written_hashes", {})
    mocker.patch.object(fs_module, "_last_snapshot_minute", None)
    return {"clock": clock, "db": db, "batch": db.batch.return_value, "jsonl": tmp_path / "snapshots.jsonl"}


def _written_docs(db):
    """Firestore doc ids passed to db.collection(...).document(...) in call order."""
    return [c.args[0] for c in db.collection.return_value.document.call_args_list]


def test_sync_players_success(sync_env):
    """Ensure players are successfully batched and synced to Firestore."""
    players = [{"uuid": "123", "name": "Steve"}, {"uuid": "456", "name": "Alex"}]

    sync_players(players)

    assert sync_env["db"].batch.called
    # 2 player documents + 1 analytics snapshot
    assert sync_env["batch"].set.call_count == 3
    sync_env["batch"].commit.assert_called_once()


def test_sync_players_snapshot_doc_is_minute_keyed_ts_count(sync_env):
    """The analytics snapshot is {ts, count}, merged into snapshots/<UTC minute>."""
    sync_players([])
    assert _written_docs(sync_env["db"]) == ["2026-09-28T12:00"]
    args, kwargs = sync_env["batch"].set.call_args
    assert args[1] == {"ts": int(MINUTE_A.timestamp()), "count": 2}
    assert kwargs == {"merge": True}
    assert json.loads(sync_env["jsonl"].read_text()) == {"ts": int(MINUTE_A.timestamp()), "count": 2}


def test_sync_players_skips_unchanged_players_but_writes_snapshot(sync_env):
    """Next minute with identical players: only the snapshot is written (1 write, not N+1)."""
    players = [{"uuid": "123", "name": "Steve", "level": 3}, {"uuid": "456", "name": "Alex", "level": 9}]
    sync_players(players)
    sync_env["db"].collection.return_value.document.reset_mock()
    sync_env["batch"].set.reset_mock()

    sync_env["clock"].now.return_value = MINUTE_B
    sync_players([dict(p) for p in players])

    assert _written_docs(sync_env["db"]) == ["2026-09-28T12:01"]
    assert sync_env["batch"].set.call_count == 1
    assert len(sync_env["jsonl"].read_text().splitlines()) == 2


def test_sync_players_rewrites_only_changed_players(sync_env):
    """A player whose content changed is rewritten; the unchanged one is not."""
    sync_players([{"uuid": "123", "level": 3}, {"uuid": "456", "level": 9}])
    sync_env["db"].collection.return_value.document.reset_mock()

    sync_env["clock"].now.return_value = MINUTE_B
    sync_players([{"uuid": "123", "level": 4}, {"uuid": "456", "level": 9}])

    assert _written_docs(sync_env["db"]) == ["123", "2026-09-28T12:01"]


def test_sync_players_same_minute_writes_nothing_new(sync_env):
    """A second sync inside the same minute with no changes commits nothing and adds no JSONL line."""
    players = [{"uuid": "123", "level": 3}]
    sync_players(players)
    sync_env["db"].batch.reset_mock()

    sync_players(players)

    sync_env["db"].batch.assert_not_called()
    assert len(sync_env["jsonl"].read_text().splitlines()) == 1


def test_sync_players_same_minute_change_writes_player_only(sync_env):
    """A change inside the same minute writes the player doc but not a second snapshot."""
    sync_players([{"uuid": "123", "level": 3}])
    sync_env["db"].collection.return_value.document.reset_mock()

    sync_players([{"uuid": "123", "level": 5}])

    assert _written_docs(sync_env["db"]) == ["123"]


def test_sync_players_failed_commit_retries_players(sync_env):
    """If the batch commit fails, the same docs are written again on the next sync."""
    sync_env["batch"].commit.side_effect = [Exception("unavailable"), None]
    sync_players([{"uuid": "123", "level": 3}])
    sync_env["db"].collection.return_value.document.reset_mock()

    sync_env["clock"].now.return_value = MINUTE_B
    sync_players([{"uuid": "123", "level": 3}])

    assert _written_docs(sync_env["db"]) == ["123", "2026-09-28T12:01"]


def test_sync_players_first_sync_after_reset_writes_everything(sync_env, mocker):
    """With an empty hash map (fresh process / new leader) every player doc is written."""
    players = [{"uuid": "123", "level": 3}]
    sync_players(players)
    mocker.patch.object(fs_module, "_written_hashes", {})  # new leader process
    mocker.patch.object(fs_module, "_last_snapshot_minute", None)
    sync_env["db"].collection.return_value.document.reset_mock()

    sync_players(players)

    assert _written_docs(sync_env["db"]) == ["123", "2026-09-28T12:00"]


def test_doc_hash_ignores_key_order():
    """Two docs with the same content hash identically regardless of key order."""
    assert fs_module._doc_hash({"a": 1, "b": [1, 2]}) == fs_module._doc_hash({"b": [1, 2], "a": 1})
    assert fs_module._doc_hash({"a": 1}) != fs_module._doc_hash({"a": 2})


def test_sync_players_firebase_unavailable(sync_env, mocker):
    """Writes the local snapshot but skips Firestore when Firebase is not available."""
    mocker.patch.object(fs_module, "_ensure_firebase", return_value=False)
    mock_write = mocker.patch.object(fs_module, "_write_local_snapshot")

    sync_players([{"uuid": "123", "name": "Steve"}])

    mock_write.assert_called_once()
    sync_env["db"].batch.assert_not_called()


def test_sync_players_exception(sync_env, mocker):
    """Ensure the sync process handles exceptions gracefully without crashing."""
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("Firestore offline"))
    mock_logger = mocker.patch("api.firestore_sync.logger.warning")

    players = [{"uuid": "123", "name": "Steve"}]
    sync_players(players)

    mock_logger.assert_called_once()
    assert "Firestore player sync failed" in mock_logger.call_args[0][0]
    assert mock_logger.call_args.kwargs.get("exc_info") is True
