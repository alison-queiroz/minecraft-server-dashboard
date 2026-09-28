"""Local analytics snapshot store: one {ts, count} JSON line per minute.

The sync leader appends to the JSONL file (LOCAL_SNAPSHOTS_PATH) on every
sync, so analytics works even without Firestore; stale lines are pruned on a
schedule. read_local_snapshots serves /api/analytics from a per-worker,
ts-sorted index that only re-reads newly appended lines.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from array import array
from bisect import bisect_left
from typing import Any, Optional, Tuple

logger = logging.getLogger(__name__)

# Local fallback file for analytics snapshots (one JSON object per line).
# Written on every sync so analytics works even when Firestore is unavailable.
_LOCAL_SNAPSHOTS_PATH = os.environ.get(
    "LOCAL_SNAPSHOTS_PATH",
    os.path.join(os.path.dirname(__file__), "..", "analytics_snapshots.jsonl"),
)
_LOCAL_SNAPSHOTS_MAX_DAYS = 365

# Serializes appends so concurrent sync threads can't interleave and corrupt
# the JSONL file (the old full read-rewrite had no lock).
_snapshot_write_lock = threading.Lock()
_writes_since_prune = 0
_PRUNE_EVERY = 1440  # prune stale lines once per ~day of minute snapshots

_INT64_MIN, _INT64_MAX = -(2 ** 63), 2 ** 63 - 1
_TAIL_CHECK_BYTES = 64
# Exactly what _write_local_snapshot emits; other shapes go through json.
_SNAPSHOT_LINE = re.compile(rb'\{"ts": (\d{1,18}), "count": (\d{1,18})\}')
_json_decoder = json.JSONDecoder()


class _SnapshotIndex:
    """Per-worker, ts-sorted copy of the local JSONL, extended as lines are appended.

    Tied to the file's identity (path + inode): a growing file is read from the
    last consumed offset only, while a replaced (pruned) or rewritten file is
    re-read in full. Rows live in two int64 arrays (~16 B per snapshot).
    """

    def __init__(self) -> None:
        self.reset(None)

    def reset(self, path: Optional[str]) -> None:
        self.path = path
        self.ino = -1
        self.size = -1
        self.mtime_ns = -1
        self.offset = 0
        self.tail = b""  # bytes just before `offset`, to detect in-place rewrites
        self.ts = array("q")
        self.counts = array("q")


_snapshot_index = _SnapshotIndex()
_snapshot_read_lock = threading.Lock()


def _prune_local_snapshots(now_ts: int) -> None:
    """Drop snapshot lines older than the retention window (single rewrite).

    Called from _write_local_snapshot on a schedule (not every write) while the
    snapshot write lock is held.
    """
    path = os.path.abspath(_LOCAL_SNAPSHOTS_PATH)
    if not os.path.exists(path):
        return
    cutoff = now_ts - _LOCAL_SNAPSHOTS_MAX_DAYS * 86_400
    kept: list[str] = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                if json.loads(line).get("ts", 0) >= cutoff:
                    kept.append(line)
            except json.JSONDecodeError:
                pass
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write("\n".join(kept) + ("\n" if kept else ""))
    os.replace(tmp, path)


def _write_local_snapshot(ts: int, count: int) -> None:
    """Append one analytics snapshot line to the local JSONL file.

    O(1) append under a lock (concurrent writers previously could interleave a
    full read-rewrite and truncate/duplicate the file). Stale entries are pruned
    on a schedule via _prune_local_snapshots rather than on every write. Only
    {ts, count} is stored: the online-name roster is never read back and was
    pure storage/wire waste.
    """
    global _writes_since_prune
    try:
        path = os.path.abspath(_LOCAL_SNAPSHOTS_PATH)
        entry = json.dumps({"ts": ts, "count": count})
        with _snapshot_write_lock:
            with open(path, "a") as f:
                f.write(entry + "\n")
            _writes_since_prune += 1
            if _writes_since_prune >= _PRUNE_EVERY:
                _writes_since_prune = 0
                _prune_local_snapshots(ts)
    except Exception:
        # Loud on purpose: this file is the only analytics source, so a
        # persistent failure here silently loses history.
        logger.warning("Could not write local snapshot to %s", _LOCAL_SNAPSHOTS_PATH, exc_info=True)


def _parse_snapshot_line(raw: bytes) -> Optional[Tuple[int, int]]:
    """(ts, count) for one JSONL line, or None for a blank or malformed line."""
    line = raw.strip()
    fast = _SNAPSHOT_LINE.fullmatch(line)
    if fast:
        return int(fast.group(1)), int(fast.group(2))
    if not line:
        return None
    try:
        text = line.decode("utf-8")
        snap, end = _json_decoder.raw_decode(text)
        if end != len(text):
            return None
        ts = snap["ts"]
        if isinstance(ts, bool) or not isinstance(ts, (int, float)):
            return None
        ts = int(ts)
        count = int(snap.get("count", 0) or 0)
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return None
    if not (_INT64_MIN <= ts <= _INT64_MAX and _INT64_MIN <= count <= _INT64_MAX):
        return None
    return ts, count


def _append_rows(idx: _SnapshotIndex, new_ts: array, new_counts: array) -> None:
    """Append rows read in file order, keeping idx sorted by ts (ties keep file order)."""
    in_order = all(new_ts[i] <= new_ts[i + 1] for i in range(len(new_ts) - 1))
    if in_order and (not idx.ts or not new_ts or new_ts[0] >= idx.ts[-1]):
        idx.ts.extend(new_ts)
        idx.counts.extend(new_counts)
        return
    # Rare (clock step, or legacy lines from concurrent writers): a stable sort
    # of the whole file, exactly like the previous full re-read did.
    all_ts = idx.ts + new_ts
    all_counts = idx.counts + new_counts
    order = sorted(range(len(all_ts)), key=all_ts.__getitem__)
    idx.ts = array("q", (all_ts[i] for i in order))
    idx.counts = array("q", (all_counts[i] for i in order))


def _refresh_snapshot_index(path: str) -> None:
    """Bring _snapshot_index up to date with the file at path (caller holds the lock)."""
    idx = _snapshot_index
    st = os.stat(path)
    same_file = idx.path == path and idx.ino == st.st_ino
    if same_file and idx.size == st.st_size and idx.mtime_ns == st.st_mtime_ns:
        return
    with open(path, "rb") as fh:
        appended = same_file and st.st_size >= idx.offset
        if appended and idx.tail:
            fh.seek(idx.offset - len(idx.tail))
            appended = fh.read(len(idx.tail)) == idx.tail
        if not appended:
            idx.reset(path)
        fh.seek(idx.offset)
        consumed = idx.offset
        new_ts = array("q")
        new_counts = array("q")
        for raw in fh:
            row = _parse_snapshot_line(raw)
            if row is None and not raw.endswith(b"\n"):
                break  # unterminated last line: the writer may be mid-append
            consumed += len(raw)
            if row is not None:
                new_ts.append(row[0])
                new_counts.append(row[1])
        tail_start = max(0, consumed - _TAIL_CHECK_BYTES)
        fh.seek(tail_start)
        idx.tail = fh.read(consumed - tail_start)
    idx.offset = consumed
    idx.ino, idx.size, idx.mtime_ns = st.st_ino, st.st_size, st.st_mtime_ns
    _append_rows(idx, new_ts, new_counts)


def read_local_snapshots(since: int) -> list[dict[str, Any]]:
    """Snapshots with ts >= since from the local JSONL fallback, oldest first.

    Rows are {ts, count} (legacy keys such as the old "online" roster are not
    returned; nothing reads them). The parsed file is cached per worker and
    later calls only read newly appended lines, so an analytics request no
    longer re-parses up to a year of minute snapshots. Thread-safe.
    """
    path = os.path.abspath(_LOCAL_SNAPSHOTS_PATH)
    with _snapshot_read_lock:
        try:
            _refresh_snapshot_index(path)
        except FileNotFoundError:
            _snapshot_index.reset(None)
            return []
        except OSError:
            logger.warning("Could not read local snapshots from %s", path, exc_info=True)
            _snapshot_index.reset(None)
            return []
        start = bisect_left(_snapshot_index.ts, since)
        ts = _snapshot_index.ts[start:]
        counts = _snapshot_index.counts[start:]
    return [{"ts": t, "count": c} for t, c in zip(ts, counts)]
