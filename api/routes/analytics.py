"""Analytics: GET /api/analytics returns player-count history for a period.

Raw {ts, count} snapshots come from the local JSONL store and are bucketed
server-side, so the browser receives a few dozen points plus a {peak, avg}
summary instead of every minute-level row.
"""
from __future__ import annotations

import time

from flask import Blueprint, jsonify, request

from ..auth import require_auth
from ..snapshot_store import read_local_snapshots

bp = Blueprint("analytics", __name__)


_PERIOD_SECONDS: dict = {
    "day":   86_400,
    "week":  7 * 86_400,
    "month": 30 * 86_400,
    "year":  365 * 86_400,
}

# Server-side bucket width per period, chosen so each period returns only a few
# dozen points regardless of how many raw minute snapshots exist.
_PERIOD_BUCKET_SECONDS: dict = {
    "day":   900,          # 15-minute buckets → ≤96 points
    "week":  6 * 3600,     # 6-hour buckets    → ≤28 points
    "month": 86_400,       # 1-day buckets     → ≤30 points
    "year":  7 * 86_400,   # 7-day buckets     → ≤52 points
}


def _aggregate_snapshots(rows: list, period: str) -> dict:
    """Bucket raw {ts, count} snapshots into a compact server-side series.

    Returns { "points": [{t, avg, peak}, ...], "summary": {peak, avg} }.
    Replaces the old behaviour of shipping every raw minute row for the browser
    to aggregate — this is the heavy lifting moved to the backend.
    """
    bucket = _PERIOD_BUCKET_SECONDS.get(period, _PERIOD_BUCKET_SECONDS["week"])
    acc: dict = {}  # bucket_start_ts -> [sum, n, max]
    peak = 0
    total = 0
    n = 0
    for row in rows:
        ts = row.get("ts")
        if ts is None:
            continue
        count = int(row.get("count", 0) or 0)
        key = (int(ts) // bucket) * bucket
        entry = acc.get(key)
        if entry is None:
            acc[key] = [count, 1, count]
        else:
            entry[0] += count
            entry[1] += 1
            if count > entry[2]:
                entry[2] = count
        if count > peak:
            peak = count
        total += count
        n += 1
    points = [
        {"t": key, "avg": round(acc[key][0] / acc[key][1]), "peak": acc[key][2]}
        for key in sorted(acc)
    ]
    summary = {"peak": peak, "avg": (round(total / n) if n else 0)}
    return {"points": points, "summary": summary}


@bp.route("/api/analytics", methods=["GET"])
@require_auth
def analytics_endpoint():
    """Return pre-aggregated player-count buckets for the requested period.

    Reads raw {ts, count} snapshots from the local JSONL file (written on every
    sync) and merges Firestore history, then buckets/averages server-side so the
    browser receives only a few dozen points plus a {peak, avg} summary instead
    of every raw minute-level row.
    """
    period = request.args.get("period", "week")
    seconds_back = _PERIOD_SECONDS.get(period, _PERIOD_SECONDS["week"])
    since = int(time.time()) - seconds_back

    # Aggregate from the local JSONL only. We deliberately do NOT stream the
    # Firestore `snapshots` collection here: for long periods that was tens of
    # thousands of per-request document reads (multiplied by the 60s client
    # auto-refresh), which exhausted the Firestore free-tier read quota. The
    # local file is written on every sync and retained for a year, so it is the
    # complete, authoritative source.
    snapshots = read_local_snapshots(since)
    return jsonify(_aggregate_snapshots(snapshots, period))
