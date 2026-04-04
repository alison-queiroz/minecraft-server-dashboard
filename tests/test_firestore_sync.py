import pytest
import json
import time
import api.firestore_sync as fs_module
from api.firestore_sync import _to_native, sync_players


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
    fs_module._firebase_initialized = True
    mock_init = mocker.patch("firebase_admin.initialize_app")
    result = fs_module._ensure_firebase()
    assert result is True
    mock_init.assert_not_called()
    # reset
    fs_module._firebase_initialized = False


def test_ensure_firebase_success(mocker):
    """Initializes Firebase and sets the flag on success."""
    fs_module._firebase_initialized = False
    mocker.patch("firebase_admin._apps", [])
    mocker.patch("firebase_admin.credentials.Certificate")
    mocker.patch("firebase_admin.initialize_app")
    result = fs_module._ensure_firebase()
    assert result is True
    assert fs_module._firebase_initialized is True
    fs_module._firebase_initialized = False


def test_ensure_firebase_failure(mocker):
    """Returns False and leaves the flag unset when initialization fails."""
    fs_module._firebase_initialized = False
    mocker.patch("firebase_admin.credentials.Certificate", side_effect=Exception("file not found"))
    result = fs_module._ensure_firebase()
    assert result is False
    assert fs_module._firebase_initialized is False


def test_ensure_firebase_skip_init_when_apps_already_exist(mocker):
    """Does not call initialize_app when firebase_admin._apps is non-empty."""
    fs_module._firebase_initialized = False
    mocker.patch("firebase_admin._apps", ["existing_app"])
    mocker.patch("firebase_admin.credentials.Certificate")
    mock_init = mocker.patch("firebase_admin.initialize_app")
    fs_module._ensure_firebase()
    mock_init.assert_not_called()
    fs_module._firebase_initialized = False


# ── _write_local_snapshot / read_local_snapshots ─────────────────────────────

def test_write_and_read_local_snapshots(tmp_path, mocker):
    """Writes a snapshot then reads it back via read_local_snapshots."""
    snap_file = tmp_path / "snapshots.jsonl"
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    ts = int(time.time())
    fs_module._write_local_snapshot(ts, ["Steve", "Alex"], 2)

    results = fs_module.read_local_snapshots(ts - 1)
    assert len(results) == 1
    assert results[0]["ts"] == ts
    assert results[0]["count"] == 2
    assert "Steve" in results[0]["online"]


def test_write_local_snapshot_prunes_old_entries(tmp_path, mocker):
    """Entries older than the cutoff are pruned when a new snapshot is written."""
    snap_file = tmp_path / "snapshots.jsonl"
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    old_ts = int(time.time()) - (fs_module._LOCAL_SNAPSHOTS_MAX_DAYS + 1) * 86_400
    recent_ts = int(time.time())

    # Prime the file with an old entry
    snap_file.write_text(json.dumps({"ts": old_ts, "online": [], "count": 0}) + "\n")

    # Write a new entry — this should prune the old one
    fs_module._write_local_snapshot(recent_ts, ["Steve"], 1)

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

def test_get_online_from_server_no_log_file(mocker):
    """Returns empty lists when the log file does not exist."""
    mocker.patch("os.path.exists", return_value=False)
    names, count = fs_module._get_online_from_server()
    assert names == []
    assert count == 0


def test_get_online_from_server_parses_join_leave(tmp_path, mocker):
    """Tracks join and leave events correctly."""
    log = tmp_path / "latest.log"
    log.write_text(
        "[12:00:00] [Server thread/INFO]: Steve joined the game\n"
        "[12:01:00] [Server thread/INFO]: Alex joined the game\n"
        "[12:02:00] [Server thread/INFO]: Steve left the game\n"
    )
    mocker.patch.object(fs_module, "_LOG_FILE", str(log))

    names, count = fs_module._get_online_from_server()
    assert names == ["Alex"]
    assert count == 1


def test_get_online_from_server_read_error(mocker):
    """Returns empty lists when the log file cannot be read."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=OSError("permission denied"))
    names, count = fs_module._get_online_from_server()
    assert names == []
    assert count == 0


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
    snap_file.write_text(json.dumps({"ts": ts - 10, "online": [], "count": 0}) + "\n\n")
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    fs_module._write_local_snapshot(ts, ["Steve"], 1)

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

    fs_module._write_local_snapshot(ts, [], 0)

    results = fs_module.read_local_snapshots(0)
    assert len(results) == 1
    assert results[0]["ts"] == ts


def test_write_snapshot_exception_is_caught(tmp_path, mocker):
    """An OS-level write failure (non-existent parent dir) is caught silently."""
    bad_path = tmp_path / "nonexistent_subdir" / "snap.jsonl"
    mocker.patch.object(fs_module, "_LOCAL_SNAPSHOTS_PATH", str(bad_path))
    # Should not raise — the outer except catches any OSError
    fs_module._write_local_snapshot(9999, [], 0)


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
