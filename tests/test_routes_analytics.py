"""Tests for api/routes/analytics.py: GET /api/analytics buckets the local
snapshots server-side (never reading Firestore) and _aggregate_snapshots'
bucketing and summary."""
import pytest

from api.routes import analytics

pytestmark = pytest.mark.usefixtures("route_state")


# ── /api/analytics ────────────────────────────────────────────────────────────

def test_analytics_aggregates_local_snapshots(client, mocker):
    """Buckets local snapshots server-side into points + a peak/avg summary."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    # Two raw rows in the same 6h (week) bucket: counts 1 and 2.
    snapshots = [
        {"ts": 1700000020, "count": 2},
        {"ts": 1700000010, "count": 1},
    ]
    mocker.patch("api.routes.analytics.read_local_snapshots", return_value=list(snapshots))
    # Firestore unavailable — the except branch is taken and only local data is used
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("no firestore"))

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/analytics?period=week", headers=headers)

    assert response.status_code == 200
    body = response.json
    assert set(body) == {"points", "summary"}
    # Peak across the raw counts is 2; mean of {1,2} rounds to 2.
    assert body["summary"] == {"peak": 2, "avg": 2}
    # Points are sorted ascending by bucket start and each carries avg + peak.
    ts_values = [p["t"] for p in body["points"]]
    assert ts_values == sorted(ts_values)
    assert all("avg" in p and "peak" in p for p in body["points"])
    assert max(p["peak"] for p in body["points"]) == 2


def test_analytics_returns_empty_series_when_no_snapshots(client, mocker):
    """Returns empty points + a zeroed summary when no snapshots exist."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.routes.analytics.read_local_snapshots", return_value=[])
    # Firestore unavailable — the except branch is taken and only local data is used
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("no firestore"))

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/analytics?period=day", headers=headers)

    assert response.status_code == 200
    assert response.json == {"points": [], "summary": {"peak": 0, "avg": 0}}


# ── analytics: local-only, never reads Firestore ─────────────────────────────

def test_analytics_does_not_read_firestore(client, mocker):
    """Analytics must aggregate from the local JSONL only and never stream the
    Firestore snapshots collection — that per-request read (tens of thousands of
    docs for long periods) previously exhausted the free-tier read quota."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.routes.analytics.read_local_snapshots", return_value=[{"ts": 1000, "count": 2}])
    fs_client = mocker.patch("firebase_admin.firestore.client")

    response = client.get("/api/analytics?period=week", headers={"Authorization": "Bearer t"})

    assert response.status_code == 200
    assert response.json["summary"]["peak"] == 2
    fs_client.assert_not_called()


# ── analytics aggregation ────────────────────────────────────────────────────

def test_aggregate_snapshots_buckets_and_summary():
    rows = [{"ts": 0, "count": 1}, {"ts": 100, "count": 3}]  # same 15-min (day) bucket
    out = analytics._aggregate_snapshots(rows, "day")
    assert out["points"] == [{"t": 0, "avg": 2, "peak": 3}]
    assert out["summary"] == {"peak": 3, "avg": 2}


def test_aggregate_snapshots_skips_none_ts():
    rows = [{"ts": None, "count": 99}, {"ts": 10, "count": 2}]
    out = analytics._aggregate_snapshots(rows, "day")
    assert out["summary"]["peak"] == 2  # the ts=None row is ignored
    assert len(out["points"]) == 1
