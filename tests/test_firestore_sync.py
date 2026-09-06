import pytest
import json
import time
import api.firestore_sync as fs_module
import api.firebase_init as fb_init
from api.firestore_sync import _to_native, sync_players


@pytest.fixture(autouse=True)
def _reset_firebase_init():
    """Firebase init state is now a shared module-global; reset it around every
    test so init-path assertions are deterministic regardless of order."""
    fb_init._reset_for_tests()
    fs_module._firebase_initialized = False
    yield
    fb_init._reset_for_tests()
    fs_module._firebase_initialized = False


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
    assert fs_module._firebase_initialized is True


def test_ensure_firebase_failure(mocker):
    """Returns False and leaves the flag unset when initialization fails."""
    mocker.patch("firebase_admin._apps", [])
    mocker.patch("firebase_admin.credentials.Certificate", side_effect=Exception("file not found"))
    result = fs_module._ensure_firebase()
    assert result is False
    assert fs_module._firebase_initialized is False


def test_ensure_firebase_skip_init_when_apps_already_exist(mocker):
    """Does not call initialize_app when firebase_admin._apps is non-empty."""
    mocker.patch("firebase_admin._apps", ["existing_app"])
    mocker.patch("firebase_admin.credentials.Certificate")
    mock_init = mocker.patch("firebase_admin.initialize_app")
    fs_module._ensure_firebase()
    mock_init.assert_not_called()


# ── _write_local_snapshot / read_local_snapshots ─────────────────────────────

def test_write_and_read_local_snapshots(tmp_path, mocker):
    """Writes a snapshot then reads it back via read_local_snapshots."""
    snap_file = tmp_path / "snapshots.jsonl"
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    ts = int(time.time())
    fs_module._write_local_snapshot(ts, 2)

    results = fs_module.read_local_snapshots(ts - 1)
    assert len(results) == 1
    assert results[0]["ts"] == ts
    assert results[0]["count"] == 2
    # 'online' is no longer persisted (it was never read back).
    assert "online" not in results[0]


def test_write_local_snapshot_prunes_old_entries(tmp_path, mocker):
    """Entries older than the cutoff are pruned on the scheduled prune pass."""
    snap_file = tmp_path / "snapshots.jsonl"
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))
    # Force a prune on the very next write instead of once per ~day.
    mocker.patch.object(fs_module, "_PRUNE_EVERY", 1)
    mocker.patch.object(fs_module, "_writes_since_prune", 0)

    old_ts = int(time.time()) - (fs_module._LOCAL_SNAPSHOTS_MAX_DAYS + 1) * 86_400
    recent_ts = int(time.time())

    # Prime the file with an old entry
    snap_file.write_text(json.dumps({"ts": old_ts, "count": 0}) + "\n")

    # Write a new entry — the scheduled prune should drop the old one
    fs_module._write_local_snapshot(recent_ts, 1)

    results = fs_module.read_local_snapshots(0)
    assert all(r["ts"] >= (recent_ts - 1) for r in results)


def test_read_local_snapshots_missing_file(tmp_path, mocker):
    """Returns an empty list when the snapshot file does not exist."""
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(tmp_path / "nope.jsonl"))
    assert fs_module.read_local_snapshots(0) == []


def test_read_local_snapshots_skips_malformed_lines(tmp_path, mocker):
    """Skips lines that are not valid JSON and returns the valid ones."""
    snap_file = tmp_path / "snapshots.jsonl"
    snap_file.write_text("not-json\n" + json.dumps({"ts": 1000, "count": 1, "online": []}) + "\n")
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    results = fs_module.read_local_snapshots(0)
    assert len(results) == 1
    assert results[0]["ts"] == 1000


def test_read_local_snapshots_filters_by_since(tmp_path, mocker):
    """Only returns snapshots at or after the `since` timestamp."""
    snap_file = tmp_path / "snapshots.jsonl"
    snap_file.write_text(
        json.dumps({"ts": 100, "count": 1, "online": []}) + "\n" +
        json.dumps({"ts": 500, "count": 2, "online": ["Steve"]}) + "\n"
    )
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    results = fs_module.read_local_snapshots(300)
    assert len(results) == 1
    assert results[0]["ts"] == 500


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

def test_sync_players_success(mocker):
    """Ensure players are successfully batched and synced to Firestore."""
    mocker.patch.object(fs_module, "_ensure_firebase", return_value=True)
    mock_client = mocker.patch("firebase_admin.firestore.client")
    mock_db = mock_client.return_value
    mock_batch = mock_db.batch.return_value
    mock_ref = mock_db.collection.return_value.document.return_value

    players = [{"uuid": "123", "name": "Steve"}, {"uuid": "456", "name": "Alex"}]

    sync_players(players)

    assert mock_db.batch.called
    # 2 player documents + 1 analytics snapshot
    assert mock_batch.set.call_count == 3
    mock_batch.commit.assert_called_once()


def test_sync_players_firebase_unavailable(mocker):
    """Writes the local snapshot but skips Firestore when Firebase is not available."""
    mocker.patch.object(fs_module, "_ensure_firebase", return_value=False)
    mock_write = mocker.patch.object(fs_module, "_write_local_snapshot")
    mocker.patch.object(fs_module, "_get_online_from_server", return_value=([], 0))

    sync_players([{"uuid": "123", "name": "Steve"}])

    mock_write.assert_called_once()


def test_sync_players_exception(mocker):
    """Ensure the sync process handles exceptions gracefully without crashing."""
    mocker.patch.object(fs_module, "_ensure_firebase", return_value=True)
    mock_client = mocker.patch("firebase_admin.firestore.client", side_effect=Exception("Firestore offline"))
    mock_logger = mocker.patch("api.firestore_sync.logger.warning")

    players = [{"uuid": "123", "name": "Steve"}]
    sync_players(players)

    mock_logger.assert_called_once()
    assert "Firestore player sync failed" in mock_logger.call_args[0][0]


# ── _write_local_snapshot edge cases ─────────────────────────────────────────

def test_write_snapshot_skips_empty_lines_in_existing_file(tmp_path, mocker):
    """Blank lines in the existing snapshot file are silently skipped during write."""
    snap_file = tmp_path / "snapshots.jsonl"
    ts = 5000
    # Write an entry followed by a blank line
    snap_file.write_text(json.dumps({"ts": ts - 10, "count": 0}) + "\n\n")
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    fs_module._write_local_snapshot(ts, 1)

    results = fs_module.read_local_snapshots(0)
    ts_values = [r["ts"] for r in results]
    assert ts in ts_values
    assert ts - 10 in ts_values


def test_write_snapshot_handles_corrupt_json_in_existing_file(tmp_path, mocker):
    """Corrupt JSON lines in the existing file are skipped and not retained."""
    snap_file = tmp_path / "snapshots.jsonl"
    ts = 6000
    snap_file.write_text("this is not valid json\n")
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    fs_module._write_local_snapshot(ts, 0)

    results = fs_module.read_local_snapshots(0)
    assert len(results) == 1
    assert results[0]["ts"] == ts


def test_write_snapshot_exception_is_caught(tmp_path, mocker):
    """An OS-level write failure (non-existent parent dir) is caught silently."""
    bad_path = tmp_path / "nonexistent_subdir" / "snap.jsonl"
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(bad_path))
    # Should not raise — the outer except catches any OSError
    fs_module._write_local_snapshot(9999, 0)


# ── read_local_snapshots edge cases ──────────────────────────────────────────

def test_read_snapshots_skips_empty_lines(tmp_path, mocker):
    """Blank lines in the snapshot file are silently skipped."""
    snap_file = tmp_path / "snapshots.jsonl"
    snap_file.write_text("\n" + json.dumps({"ts": 100, "count": 0, "online": []}) + "\n\n")
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    results = fs_module.read_local_snapshots(0)
    assert len(results) == 1
    assert results[0]["ts"] == 100


def test_read_snapshots_exception_is_caught(tmp_path, mocker):
    """An OS-level read failure is caught and returns an empty list."""
    snap_file = tmp_path / "snapshots.jsonl"
    snap_file.write_text("{}\n")
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))
    mocker.patch("builtins.open", side_effect=OSError("permission denied"))

    result = fs_module.read_local_snapshots(0)
    assert result == []
