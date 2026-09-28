"""Tests for api/snapshot_store.py: appending and pruning the local analytics
JSONL, and read_local_snapshots' per-worker index (incremental tail reads,
replaced/rewritten files, partial lines, concurrent readers and writer)."""
import json
import os
import time

import pytest

import api.snapshot_store as store

pytestmark = pytest.mark.usefixtures("reset_sync_state")


# ── _write_local_snapshot / read_local_snapshots ─────────────────────────────

def test_write_and_read_local_snapshots(tmp_path, mocker):
    """Writes a snapshot then reads it back via read_local_snapshots."""
    snap_file = tmp_path / "snapshots.jsonl"
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    ts = int(time.time())
    store._write_local_snapshot(ts, 2)

    results = store.read_local_snapshots(ts - 1)
    assert len(results) == 1
    assert results[0]["ts"] == ts
    assert results[0]["count"] == 2
    # 'online' is no longer persisted (it was never read back).
    assert "online" not in results[0]


def test_write_local_snapshot_prunes_old_entries(tmp_path, mocker):
    """Entries older than the cutoff are pruned on the scheduled prune pass."""
    snap_file = tmp_path / "snapshots.jsonl"
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))
    # Force a prune on the very next write instead of once per ~day.
    mocker.patch.object(store, "_PRUNE_EVERY", 1)
    mocker.patch.object(store, "_writes_since_prune", 0)

    old_ts = int(time.time()) - (store._LOCAL_SNAPSHOTS_MAX_DAYS + 1) * 86_400
    recent_ts = int(time.time())

    # Prime the file with an old entry
    snap_file.write_text(json.dumps({"ts": old_ts, "count": 0}) + "\n")

    # Write a new entry — the scheduled prune should drop the old one
    store._write_local_snapshot(recent_ts, 1)

    results = store.read_local_snapshots(0)
    assert all(r["ts"] >= (recent_ts - 1) for r in results)


def test_prune_drops_blank_and_corrupt_lines(tmp_path, mocker):
    """The scheduled prune keeps only parseable, in-window lines."""
    snap_file = tmp_path / "snapshots.jsonl"
    snap_file.write_text("\n" + "not-json\n" + json.dumps({"ts": 5000, "count": 1}) + "\n")
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))
    store._prune_local_snapshots(5000)
    assert snap_file.read_text() == json.dumps({"ts": 5000, "count": 1}) + "\n"


def test_prune_missing_file_is_a_noop(tmp_path, mocker):
    """Pruning a file that does not exist yet does nothing (and creates nothing)."""
    snap_file = tmp_path / "snapshots.jsonl"
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))
    store._prune_local_snapshots(5000)
    assert not snap_file.exists()


def test_read_local_snapshots_missing_file(tmp_path, mocker):
    """Returns an empty list when the snapshot file does not exist."""
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(tmp_path / "nope.jsonl"))
    assert store.read_local_snapshots(0) == []


def test_read_local_snapshots_skips_malformed_lines(tmp_path, mocker):
    """Skips lines that are not valid JSON and returns the valid ones."""
    snap_file = tmp_path / "snapshots.jsonl"
    snap_file.write_text("not-json\n" + json.dumps({"ts": 1000, "count": 1, "online": []}) + "\n")
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    results = store.read_local_snapshots(0)
    assert len(results) == 1
    assert results[0]["ts"] == 1000


def test_read_local_snapshots_filters_by_since(tmp_path, mocker):
    """Only returns snapshots at or after the `since` timestamp."""
    snap_file = tmp_path / "snapshots.jsonl"
    snap_file.write_text(
        json.dumps({"ts": 100, "count": 1, "online": []}) + "\n" +
        json.dumps({"ts": 500, "count": 2, "online": ["Steve"]}) + "\n"
    )
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    results = store.read_local_snapshots(300)
    assert len(results) == 1
    assert results[0]["ts"] == 500


# ── _write_local_snapshot edge cases ─────────────────────────────────────────

def test_write_snapshot_skips_empty_lines_in_existing_file(tmp_path, mocker):
    """Blank lines in the existing snapshot file are silently skipped during write."""
    snap_file = tmp_path / "snapshots.jsonl"
    ts = 5000
    # Write an entry followed by a blank line
    snap_file.write_text(json.dumps({"ts": ts - 10, "count": 0}) + "\n\n")
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    store._write_local_snapshot(ts, 1)

    results = store.read_local_snapshots(0)
    ts_values = [r["ts"] for r in results]
    assert ts in ts_values
    assert ts - 10 in ts_values


def test_write_snapshot_handles_corrupt_json_in_existing_file(tmp_path, mocker):
    """Corrupt JSON lines in the existing file are skipped and not retained."""
    snap_file = tmp_path / "snapshots.jsonl"
    ts = 6000
    snap_file.write_text("this is not valid json\n")
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    store._write_local_snapshot(ts, 0)

    results = store.read_local_snapshots(0)
    assert len(results) == 1
    assert results[0]["ts"] == ts


def test_write_snapshot_exception_is_caught(tmp_path, mocker):
    """An OS-level write failure (non-existent parent dir) is caught silently."""
    bad_path = tmp_path / "nonexistent_subdir" / "snap.jsonl"
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(bad_path))
    warning = mocker.patch.object(store.logger, "warning")
    # Should not raise — the outer except catches any OSError
    store._write_local_snapshot(9999, 0)
    assert warning.call_args.kwargs.get("exc_info") is True


# ── read_local_snapshots edge cases ──────────────────────────────────────────

def test_read_snapshots_skips_empty_lines(tmp_path, mocker):
    """Blank lines in the snapshot file are silently skipped."""
    snap_file = tmp_path / "snapshots.jsonl"
    snap_file.write_text("\n" + json.dumps({"ts": 100, "count": 0, "online": []}) + "\n\n")
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))

    results = store.read_local_snapshots(0)
    assert len(results) == 1
    assert results[0]["ts"] == 100


def test_read_snapshots_exception_is_caught(tmp_path, mocker):
    """An OS-level read failure is caught and returns an empty list."""
    snap_file = tmp_path / "snapshots.jsonl"
    snap_file.write_text("{}\n")
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(snap_file))
    mocker.patch("builtins.open", side_effect=OSError("permission denied"))
    warning = mocker.patch.object(store.logger, "warning")

    result = store.read_local_snapshots(0)
    assert result == []
    assert warning.call_args.kwargs.get("exc_info") is True


# ── read_local_snapshots: per-worker cache + incremental tail read ───────────

def _old_read_local_snapshots(path, since):
    """Reference: the previous full re-read implementation, projected to {ts, count}."""
    results = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                snap = json.loads(line)
            except json.JSONDecodeError:
                continue
            if snap.get("ts", 0) >= since:
                results.append(snap)
    ordered = sorted(results, key=lambda s: s.get("ts", 0))
    return [{"ts": s["ts"], "count": s.get("count", 0)} for s in ordered]


@pytest.fixture
def snap_path(tmp_path, mocker):
    """Point the module at a temp JSONL file and return its path."""
    path = tmp_path / "snapshots.jsonl"
    mocker.patch.object(store, "_LOCAL_SNAPSHOTS_PATH", str(path))
    return path


def _lines(*rows):
    return "".join(json.dumps(r) + "\n" for r in rows)


def test_read_local_snapshots_matches_previous_implementation(snap_path):
    """Returns exactly what the old full re-read returned (order, ties, since filter)."""
    rows = [
        {"ts": 300, "count": 3}, {"ts": 100, "count": 1, "online": ["Steve"]},
        {"ts": 200, "count": 2}, {"ts": 200, "count": 9}, {"ts": 50, "count": 0},
    ]
    snap_path.write_text(_lines(*rows) + "garbage\n\n")
    for since in (0, 100, 200, 250, 301):
        assert store.read_local_snapshots(since) == _old_read_local_snapshots(snap_path, since)


def test_read_local_snapshots_caches_parsed_file(snap_path, mocker):
    """An unchanged file is served from memory without re-parsing any line."""
    snap_path.write_text(_lines({"ts": 1, "count": 1}, {"ts": 2, "count": 2}))
    assert len(store.read_local_snapshots(0)) == 2
    parse = mocker.spy(store, "_parse_snapshot_line")
    assert len(store.read_local_snapshots(0)) == 2
    assert len(store.read_local_snapshots(2)) == 1
    parse.assert_not_called()


def test_read_local_snapshots_reads_only_appended_lines(snap_path, mocker):
    """After an append, only the new line is parsed and the result includes it."""
    snap_path.write_text(_lines({"ts": 10, "count": 1}, {"ts": 20, "count": 2}))
    store.read_local_snapshots(0)
    store._write_local_snapshot(30, 3)
    parse = mocker.spy(store, "_parse_snapshot_line")
    assert store.read_local_snapshots(0) == [
        {"ts": 10, "count": 1}, {"ts": 20, "count": 2}, {"ts": 30, "count": 3},
    ]
    assert parse.call_count == 1


def test_read_local_snapshots_merges_out_of_order_append(snap_path):
    """An appended line older than the cached tail is merged into sorted position."""
    snap_path.write_text(_lines({"ts": 10, "count": 1}, {"ts": 30, "count": 3}))
    store.read_local_snapshots(0)
    with open(snap_path, "a") as f:
        f.write(_lines({"ts": 20, "count": 2}, {"ts": 10, "count": 7}))
    assert store.read_local_snapshots(0) == _old_read_local_snapshots(snap_path, 0)
    assert [r["ts"] for r in store.read_local_snapshots(0)] == [10, 10, 20, 30]


def test_read_local_snapshots_reloads_after_prune_replaces_file(snap_path):
    """A prune (os.replace with a new, smaller file) invalidates the cache."""
    snap_path.write_text(_lines({"ts": 1, "count": 1}, {"ts": 2, "count": 2}, {"ts": 3, "count": 3}))
    assert len(store.read_local_snapshots(0)) == 3
    tmp = snap_path.with_suffix(".tmp")
    tmp.write_text(_lines({"ts": 3, "count": 3}))
    os.replace(tmp, snap_path)
    assert store.read_local_snapshots(0) == [{"ts": 3, "count": 3}]


def test_read_local_snapshots_detects_in_place_rewrite(snap_path):
    """A same-inode rewrite that grows the file is re-read in full, not tail-appended."""
    snap_path.write_text(_lines({"ts": 1, "count": 1}))
    store.read_local_snapshots(0)
    snap_path.write_text(_lines({"ts": 5, "count": 5}, {"ts": 6, "count": 6}))
    assert store.read_local_snapshots(0) == [{"ts": 5, "count": 5}, {"ts": 6, "count": 6}]


def test_read_local_snapshots_waits_for_partial_last_line(snap_path):
    """A half-written last line is skipped until the writer finishes it."""
    snap_path.write_text(_lines({"ts": 1, "count": 1}) + '{"ts": 2, "co')
    assert store.read_local_snapshots(0) == [{"ts": 1, "count": 1}]
    with open(snap_path, "a") as f:
        f.write('unt": 2}\n')
    assert store.read_local_snapshots(0) == [{"ts": 1, "count": 1}, {"ts": 2, "count": 2}]


def test_read_local_snapshots_accepts_complete_unterminated_line(snap_path):
    """A valid final line without a trailing newline is still returned (as before)."""
    snap_path.write_text(json.dumps({"ts": 7, "count": 1}))
    assert store.read_local_snapshots(0) == [{"ts": 7, "count": 1}]


def test_read_local_snapshots_skips_rows_without_usable_ts_or_count(snap_path):
    """Rows the aggregator could not bucket (no/odd ts, bad count, non-object) are skipped."""
    snap_path.write_text(
        _lines({"count": 1}, {"ts": None, "count": 1}, {"ts": "x"}, {"ts": True},
               {"ts": 5, "count": "abc"}, [1, 2], {"ts": 2 ** 70}, {"ts": 9.9, "count": None})
        + '{"ts": 1, "count": 1}{"ts": 2, "count": 2}\n'  # two records glued together
    )
    assert store.read_local_snapshots(0) == [{"ts": 9, "count": 0}]


def test_read_local_snapshots_missing_file_resets_cache(snap_path):
    """If the file disappears, the cached rows are dropped and [] is returned."""
    snap_path.write_text(_lines({"ts": 1, "count": 1}))
    store.read_local_snapshots(0)
    snap_path.unlink()
    assert store.read_local_snapshots(0) == []
    assert len(store._snapshot_index.ts) == 0


def test_read_local_snapshots_concurrent_readers_and_writer(snap_path):
    """Concurrent readers see sorted, complete-line results while the leader appends."""
    import threading
    errors = []

    def reader():
        try:
            for _ in range(50):
                ts = [r["ts"] for r in store.read_local_snapshots(0)]
                assert ts == sorted(ts)
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=reader) for _ in range(4)]
    for t in threads:
        t.start()
    for ts in range(200):
        store._write_local_snapshot(ts, 1)
    for t in threads:
        t.join()
    assert not errors
    assert [r["ts"] for r in store.read_local_snapshots(0)] == list(range(200))
