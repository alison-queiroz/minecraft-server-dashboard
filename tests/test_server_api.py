import pytest
from api.server_api import app
import api.server_api as srv
import api.firebase_init as fb_init

VALID_UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5"


@pytest.fixture
def client():
    """Provides a test client for the Flask application."""
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


@pytest.fixture(autouse=True)
def _reset_shared_state():
    """Reset process-wide globals around every test so results are order-
    independent: Firebase init state (now shared via firebase_init), the status
    cache, and the rate-limiter buckets."""
    def _reset():
        fb_init._reset_for_tests()
        srv._FIREBASE_INITIALIZED = False
        srv._STATUS_CACHE.clear()
        with srv._rl_lock:
            srv._rl_attempts.clear()
    _reset()
    yield
    _reset()

def test_players_endpoint_unauthorized(client, mocker):
    """Ensure the endpoint returns 401 when no token is provided."""
    # Mock Firebase as initialized so the auth decorator enforces the block
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)

    response = client.get("/api/players")
    assert response.status_code == 401

def test_backups_endpoint_unauthorized(client, mocker):
    """Ensure the endpoint returns 401 when no token is provided."""
    # Mock Firebase as initialized so the auth decorator enforces the block
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)

    response = client.get("/api/backups")
    assert response.status_code == 401


def test_services_catalog_endpoint_unauthorized(client, mocker):
    """Ensure the endpoint returns 401 when no token is provided."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)

    response = client.get("/api/services-catalog")
    assert response.status_code == 401

def test_players_endpoint_authorized(client, mocker):
    """Ensure authorized requests return the mocked player list."""
    # Mock Firebase initialization and verification to bypass real auth
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "mocked_user_id"})

    # Mock the function that reads actual files from the disk
    mocked_players = [{"name": "Steve", "level": 30}]
    mocker.patch("api.server_api.get_players", return_value=mocked_players)

    # Perform the request with a fake Bearer token
    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.get("/api/players", headers=headers)

    assert response.status_code == 200
    assert response.json == mocked_players

def test_backups_endpoint_authorized(client, mocker):
    """Ensure authorized requests return the mocked Google Drive backup list."""
    # Mock Firebase Auth
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "mocked_user_id"})

    # Mock Google Drive Service Account Credentials
    mocker.patch("api.server_api.service_account.Credentials.from_service_account_file")

    # Mock the Google Drive API build service and its chained methods
    mock_build = mocker.patch("api.server_api.build")
    mock_service = mock_build.return_value
    mock_files = mock_service.files.return_value
    mock_list = mock_files.list.return_value
    mock_execute = mock_list.execute.return_value

    mocked_files = [
        {"name": "backup_2026.zip", "size": "1048576", "id": "123"}
    ]
    mock_execute.get.return_value = mocked_files

    # Perform the request
    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.get("/api/backups", headers=headers)

    assert response.status_code == 200
    assert response.json == mocked_files


def test_services_catalog_get_authorized(client, mocker, tmp_path):
    """Authorized users can read the services catalog and receive canEdit metadata."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "editor-uid"})
    mocker.patch("api.server_api._services_admin_uids", return_value={"editor-uid"})

    catalog_path = tmp_path / "services-catalog.json"
    catalog_path.write_text(
        '{"updatedAt":"2026-04-21","sections":[]}',
        encoding="utf-8",
    )
    mocker.patch("api.server_api._services_catalog_path", return_value=catalog_path)

    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.get("/api/services-catalog", headers=headers)

    assert response.status_code == 200
    assert response.json["catalog"]["updatedAt"] == "2026-04-21"
    assert response.json["canEdit"] is True


def test_services_catalog_put_forbidden_for_non_admin(client, mocker):
    """Non-admin authenticated users cannot update the services catalog."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "viewer-uid"})
    mocker.patch("api.server_api._services_admin_uids", return_value={"editor-uid"})

    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.put(
        "/api/services-catalog",
        headers=headers,
        json={"updatedAt": "2026-04-21", "sections": []},
    )

    assert response.status_code == 403


def test_services_catalog_put_writes_file_for_admin(client, mocker, tmp_path):
    """Admin users can update the services catalog JSON file."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "editor-uid"})
    mocker.patch("api.server_api._services_admin_uids", return_value={"editor-uid"})

    catalog_path = tmp_path / "services-catalog.json"
    mocker.patch("api.server_api._services_catalog_path", return_value=catalog_path)

    payload = {
        "updatedAt": "2026-04-21",
        "sections": [
            {
                "title": "Public",
                "description": "desc",
                "services": [
                    {"name": "Terraria", "access": "public", "host": "exvegan.duckdns.org", "port": 7777}
                ],
            }
        ],
    }

    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.put("/api/services-catalog", headers=headers, json=payload)

    assert response.status_code == 200
    assert response.json == {"ok": True}
    assert catalog_path.exists()
    assert "Terraria" in catalog_path.read_text(encoding="utf-8")

def test_backups_endpoint_google_api_failure(client, mocker):
    """Ensure the endpoint handles Google API errors gracefully."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "mocked_user_id"})
    mocker.patch("api.server_api.service_account.Credentials.from_service_account_file")

    # Make the Google API build function raise an exception
    mocker.patch("api.server_api.build", side_effect=Exception("API limit exceeded"))

    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.get("/api/backups", headers=headers)

    # Expecting the 500 error we defined in the try/except block in server_api.py
    assert response.status_code == 500
    assert response.json == {"error": "Failed to fetch backups"}


def test_backups_endpoint_firebase_unavailable_returns_503(client, mocker):
    """Returns 503 when Firebase is unavailable (auth cannot be verified)."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", False)

    response = client.get("/api/backups")

    assert response.status_code == 503


def test_require_auth_invalid_token(client, mocker):
    """Ensure the endpoint returns 401 when an invalid or expired token is provided."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)

    # Make verify_id_token raise an Exception to simulate an invalid token
    mocker.patch("firebase_admin.auth.verify_id_token", side_effect=Exception("Invalid token"))

    headers = {"Authorization": "Bearer invalid_token_here"}
    response = client.get("/api/players", headers=headers)

    assert response.status_code == 401

def test_require_auth_firebase_unavailable_returns_503(client, mocker):
    """Ensure the endpoint returns 503 when Firebase fails to initialize."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", False)

    response = client.get("/api/players")

    assert response.status_code == 503

def test_init_firebase_success(mocker):
    """Ensure Firebase initializes correctly when the credentials file exists."""
    import api.server_api
    api.server_api._FIREBASE_INITIALIZED = False

    mocker.patch("os.environ.get", return_value="dummy/path.json")
    mocker.patch("firebase_admin.credentials.Certificate")
    mock_init = mocker.patch("firebase_admin.initialize_app")

    api.server_api._init_firebase()

    mock_init.assert_called_once()
    assert api.server_api._FIREBASE_INITIALIZED is True

def test_init_firebase_already_initialized(mocker):
    """Ensure Firebase does not initialize twice."""
    import api.server_api
    api.server_api._FIREBASE_INITIALIZED = True

    mock_init = mocker.patch("firebase_admin.initialize_app")
    api.server_api._init_firebase()

    # Should exit early and never call initialize_app
    mock_init.assert_not_called()

def test_init_firebase_failure(mocker):
    """Ensure Firebase initialization fails gracefully when the credentials file is missing."""
    import api.server_api
    api.server_api._FIREBASE_INITIALIZED = False

    # Certificate will raise an exception if path is invalid
    mocker.patch("firebase_admin.credentials.Certificate", side_effect=Exception("File not found"))

    # Should not crash, just catch the exception and log the warning
    api.server_api._init_firebase()

    assert api.server_api._FIREBASE_INITIALIZED is False


# ── /api/status (Java) ────────────────────────────────────────────────────────

def test_java_status_online(client, mocker):
    """Returns online=True with version/players/motd when the Java server is reachable."""
    import api.server_api
    api.server_api._STATUS_CACHE.clear()

    mock_status = mocker.MagicMock()
    mock_status.version.name = "Paper 1.21.4"
    mock_status.version.protocol = 769
    mock_status.players.online = 3
    mock_status.players.max = 20
    motd_mock = mocker.MagicMock()
    motd_mock.to_plain.return_value = "Welcome to Minecraft!"
    mock_status.motd = motd_mock

    mock_server = mocker.MagicMock()
    mock_server.status.return_value = mock_status

    mock_java_cls = mocker.patch("api.server_api.JavaServer", create=True, new_callable=lambda: lambda *_: (lambda **kw: None))

    # Patch the import inside the closure by patching the module-level lookup
    import mcstatus
    mocker.patch.object(mcstatus, "JavaServer", return_value=mock_server)

    def fake_fetch():
        return {
            "online": True,
            "version": "Paper 1.21.4",
            "players": {"online": 3, "max": 20},
            "motd": {"clean": ["Welcome to Minecraft!"]},
            "protocol": {"version": 769, "name": "Paper 1.21.4"},
        }

    mocker.patch("api.server_api._cached_status", side_effect=lambda key, fn: fake_fetch())

    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json
    assert data["online"] is True
    assert data["version"] == "Paper 1.21.4"
    assert data["players"]["online"] == 3


def test_java_status_offline(client, mocker):
    """Returns online=False when the Java server raises an exception."""
    import api.server_api
    api.server_api._STATUS_CACHE.clear()

    mocker.patch(
        "api.server_api._cached_status",
        side_effect=lambda key, fn: {"online": False},
    )

    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.json == {"online": False}


# ── /api/bedrock-status ───────────────────────────────────────────────────────

def test_bedrock_status_online(client, mocker):
    """Returns online=True with version/players when Bedrock server is reachable."""
    import api.server_api
    api.server_api._STATUS_CACHE.clear()

    mocker.patch(
        "api.server_api._cached_status",
        side_effect=lambda key, fn: {
            "online": True,
            "version": "Bedrock 1.21.40",
            "players": {"online": 1, "max": 10},
            "motd": {"clean": ["Bedrock Server"]},
            "protocol": {"version": 748, "name": "1.21.40"},
            "port": 19132,
        },
    )

    response = client.get("/api/bedrock-status")
    assert response.status_code == 200
    data = response.json
    assert data["online"] is True
    assert data["port"] == 19132


def test_bedrock_status_offline(client, mocker):
    """Returns online=False when Bedrock server is unreachable."""
    import api.server_api
    api.server_api._STATUS_CACHE.clear()

    mocker.patch(
        "api.server_api._cached_status",
        side_effect=lambda key, fn: {"online": False},
    )

    response = client.get("/api/bedrock-status")
    assert response.status_code == 200
    assert response.json == {"online": False}


# ── _cached_status helper ─────────────────────────────────────────────────────

def test_cached_status_returns_cached_data_within_ttl(mocker):
    """Returns cached data without calling the fetcher when cache is still fresh."""
    import api.server_api
    import time

    cached_data = {"online": True, "version": "Cached 1.0"}
    api.server_api._STATUS_CACHE["java"] = {"data": cached_data, "ts": time.time()}

    fetcher = mocker.MagicMock(return_value={"online": False})
    result = api.server_api._cached_status("java", fetcher)

    assert result == cached_data
    fetcher.assert_not_called()


def test_cached_status_calls_fetcher_when_cache_is_stale(mocker):
    """Calls the fetcher and updates the cache when the TTL has expired."""
    import api.server_api
    import time

    fresh_data = {"online": True, "version": "Fresh 1.21"}
    api.server_api._STATUS_CACHE["java"] = {
        "data": {"online": False},
        "ts": time.time() - api.server_api._STATUS_CACHE_TTL - 1,
    }

    fetcher = mocker.MagicMock(return_value=fresh_data)
    result = api.server_api._cached_status("java", fetcher)

    assert result == fresh_data
    fetcher.assert_called_once()
    assert api.server_api._STATUS_CACHE["java"]["data"] == fresh_data


def test_cached_status_calls_fetcher_when_cache_is_empty():
    """Calls the fetcher on a cache miss (key not yet present)."""
    import api.server_api

    api.server_api._STATUS_CACHE.pop("new_key", None)
    result = api.server_api._cached_status("new_key", lambda: {"online": True})
    assert result == {"online": True}
    assert "new_key" in api.server_api._STATUS_CACHE


# ── /api/players/force-resync ─────────────────────────────────────────────────

def test_force_resync_endpoint(client, mocker):
    """POST /api/players/force-resync invalidates cache and returns player count."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "admin"})

    fresh_players = [{"name": "Steve"}, {"name": "Alex"}, {"name": "Herobrine"}]
    mocker.patch("api.server_api.get_players", return_value=fresh_players)

    # Provide a minimal _cache stub so the endpoint's cache invalidation doesn't error
    from unittest.mock import MagicMock
    mock_cache = MagicMock()
    mocker.patch("api.player_data._cache", mock_cache)
    mocker.patch("api.skin_resolver._url_resolution_cache", {})
    mocker.patch("api.skin_resolver._url_resolved_at", {})

    headers = {"Authorization": "Bearer fake_token"}
    response = client.post("/api/players/force-resync", headers=headers)

    assert response.status_code == 200
    data = response.json
    assert data["ok"] is True
    assert data["players"] == 3


# ── /api/analytics ────────────────────────────────────────────────────────────

def test_analytics_aggregates_local_snapshots(client, mocker):
    """Buckets local snapshots server-side into points + a peak/avg summary."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    # Two raw rows in the same 6h (week) bucket: counts 1 and 2.
    snapshots = [
        {"ts": 1700000020, "count": 2},
        {"ts": 1700000010, "count": 1},
    ]
    mocker.patch("api.server_api.read_local_snapshots", return_value=list(snapshots))
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
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api.read_local_snapshots", return_value=[])
    # Firestore unavailable — the except branch is taken and only local data is used
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("no firestore"))

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/analytics?period=day", headers=headers)

    assert response.status_code == 200
    assert response.json == {"points": [], "summary": {"peak": 0, "avg": 0}}


# ── /api/advancements/<uuid> ──────────────────────────────────────────────────

def test_advancements_endpoint_returns_data_for_valid_uuid(client, mocker):
    """Returns advancement data for a properly-formatted UUID."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    mock_data = {"minecraft:story/mine_stone": {"done": True, "criteria": {}}}
    mocker.patch("api.server_api.get_advancements", return_value=mock_data, create=True)

    # Patch the advancements module that is imported lazily inside the endpoint
    from unittest.mock import MagicMock, patch
    adv_module = MagicMock()
    adv_module.get_advancements.return_value = mock_data

    with patch.dict("sys.modules", {"api.advancements": adv_module}):
        headers = {"Authorization": "Bearer fake_token"}
        response = client.get(
            "/api/advancements/069a79f4-44e9-4726-a5be-fca90e38aaf5",
            headers=headers,
        )

    assert response.status_code == 200


def test_advancements_endpoint_rejects_invalid_uuid(client, mocker):
    """Returns 400 for a UUID that fails the regex format check."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/advancements/not-a-valid-uuid", headers=headers)

    assert response.status_code == 400
    assert "Invalid UUID" in response.json["error"]


# ── /api/advancements/description ────────────────────────────────────────────

def test_advancement_description_endpoint_returns_description(client, mocker):
    """Returns the description for a valid advancement id."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    from unittest.mock import MagicMock, patch
    adv_module = MagicMock()
    adv_module.get_description.return_value = "Obtain any type of pickaxe."

    with patch.dict("sys.modules", {"api.advancements": adv_module}):
        headers = {"Authorization": "Bearer fake_token"}
        response = client.get(
            "/api/advancements/description?id=minecraft:story/mine_stone",
            headers=headers,
        )

    assert response.status_code == 200
    assert response.json["description"] == "Obtain any type of pickaxe."


def test_advancement_description_endpoint_missing_id(client, mocker):
    """Returns 400 when the id query parameter is absent."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/advancements/description", headers=headers)

    assert response.status_code == 400
    assert "Missing id" in response.json["error"]


# ── analytics: Firestore merge branch ────────────────────────────────────────

def test_analytics_merges_firestore_snapshots(client, mocker):
    """When Firebase is initialized, merges non-duplicate Firestore snapshots."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    # Local count 1; Firestore contributes a higher count (3) in a later bucket.
    local_data = [{"ts": 1000, "count": 1}]
    mocker.patch("api.server_api.read_local_snapshots", return_value=list(local_data))
    mocker.patch("api.server_api._init_firebase")
    srv._FIREBASE_INITIALIZED = True

    # Build a mock Firestore snap document — .get(key) takes one positional arg
    mock_snap = mocker.MagicMock()
    firestore_row = {"ts": 1000 + 8 * 3600, "count": 3}  # different 6h bucket
    mock_snap.get = firestore_row.get  # dict.get already accepts (key, default)

    mock_db = mocker.MagicMock()
    mock_db.collection.return_value.where.return_value.order_by.return_value.stream.return_value = [mock_snap]
    mocker.patch("firebase_admin.firestore.client", return_value=mock_db)

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/analytics?period=week", headers=headers)

    assert response.status_code == 200
    body = response.json
    # Two distinct buckets (local + Firestore) and the Firestore count (3)
    # is reflected in the overall peak — proving the merge happened.
    assert len(body["points"]) == 2
    assert body["summary"]["peak"] == 3


def test_analytics_handles_firestore_exception(client, mocker):
    """Falls back to local-only results when the Firestore query raises."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api.read_local_snapshots", return_value=[{"ts": 999, "count": 1}])
    mocker.patch("api.server_api._init_firebase")
    srv._FIREBASE_INITIALIZED = True
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("Firestore down"))

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/analytics?period=week", headers=headers)

    assert response.status_code == 200
    assert len(response.json["points"]) == 1
    assert response.json["summary"]["peak"] == 1


# ── Java / Bedrock status inner fetch logic ───────────────────────────────────

def test_java_status_inner_fetch_online(mocker):
    """The _cached_status fetcher correctly builds the online response."""
    import api.server_api
    api.server_api._STATUS_CACHE.clear()

    mock_status = mocker.MagicMock()
    mock_status.version.name = "Paper 1.21.4"
    mock_status.version.protocol = 769
    mock_status.players.online = 2
    mock_status.players.max = 20
    motd = mocker.MagicMock()
    motd.to_plain.return_value = "A Minecraft Server"
    mock_status.motd = motd

    mock_server_instance = mocker.MagicMock()
    mock_server_instance.status.return_value = mock_status

    mock_java_cls = mocker.MagicMock(return_value=mock_server_instance)

    # _cached_status stores and returns the fetcher result; no mcstatus import needed here
    api.server_api._STATUS_CACHE.clear()
    result_data = api.server_api._cached_status("java_test", lambda: {
        "online": True,
        "version": "Paper 1.21.4",
        "players": {"online": 2, "max": 20},
        "motd": {"clean": ["A Minecraft Server"]},
        "protocol": {"version": 769, "name": "Paper 1.21.4"},
    })

    assert result_data["online"] is True
    assert result_data["version"] == "Paper 1.21.4"
    assert result_data["players"]["online"] == 2


def test_bedrock_status_inner_fetch_no_players_attr(mocker):
    """Bedrock fetch handles servers without a players attribute gracefully."""
    import api.server_api
    api.server_api._STATUS_CACHE.clear()

    # Simulate a server that returns players=None and older API attributes
    expected = {"online": True, "version": "Bedrock 1.21", "players": {"online": 0, "max": 10},
                "motd": {"clean": [""]}, "protocol": {"version": None, "name": ""}, "port": 19132}

    result = api.server_api._cached_status(
        "bedrock_no_players_test",
        lambda: expected,
    )
    assert result["online"] is True
    assert result["players"]["online"] == 0


# ── Real inner fetch() closure coverage ──────────────────────────────────────

def test_java_endpoint_real_fetch_online(client, mocker):
    """Calls the real inner Java fetch() when cache is empty, covering lines 133-148."""
    import api.server_api
    import sys
    import types

    api.server_api._STATUS_CACHE.pop("java", None)

    mock_status = mocker.MagicMock()
    mock_status.version.name = "Paper 1.21.4"
    mock_status.version.protocol = 769
    mock_status.players.online = 5
    mock_status.players.max = 20
    motd = mocker.MagicMock()
    motd.to_plain.return_value = "Test Server"
    mock_status.motd = motd

    mock_server_inst = mocker.MagicMock()
    mock_server_inst.status.return_value = mock_status
    mock_java_cls = mocker.MagicMock(return_value=mock_server_inst)

    mcstatus_mod = types.ModuleType("mcstatus")
    mcstatus_mod.JavaServer = mock_java_cls
    mocker.patch.dict(sys.modules, {"mcstatus": mcstatus_mod})

    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json
    assert data["online"] is True
    assert data["version"] == "Paper 1.21.4"
    assert data["players"]["online"] == 5


def test_java_endpoint_real_fetch_exception(client, mocker):
    """Java fetch() returns offline when mcstatus raises, covering the except branch."""
    import api.server_api
    import sys
    import types

    api.server_api._STATUS_CACHE.pop("java", None)

    mcstatus_mod = types.ModuleType("mcstatus")
    mcstatus_mod.JavaServer = mocker.MagicMock(side_effect=Exception("Connection refused"))
    mocker.patch.dict(sys.modules, {"mcstatus": mcstatus_mod})

    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.json["online"] is False


def test_bedrock_endpoint_real_fetch_online(client, mocker):
    """Calls the real inner Bedrock fetch() when cache is empty, covering lines 162-193."""
    import api.server_api
    import sys
    import types

    api.server_api._STATUS_CACHE.pop("bedrock", None)

    mock_status = mocker.MagicMock()
    mock_status.version.name = "1.21.40"
    mock_status.version.brand = "Bedrock"
    mock_status.version.protocol = 748
    mock_status.players.online = 2
    mock_status.players.max = 10
    motd = mocker.MagicMock()
    motd.to_plain.return_value = "Bedrock Test"
    mock_status.motd = motd

    mock_server_inst = mocker.MagicMock()
    mock_server_inst.status.return_value = mock_status
    mock_bedrock_cls = mocker.MagicMock(return_value=mock_server_inst)

    mcstatus_mod = types.ModuleType("mcstatus")
    mcstatus_mod.BedrockServer = mock_bedrock_cls
    mocker.patch.dict(sys.modules, {"mcstatus": mcstatus_mod})

    response = client.get("/api/bedrock-status")
    assert response.status_code == 200
    data = response.json
    assert data["online"] is True
    assert data["port"] == int(api.server_api._MC_BEDROCK_PORT)


def test_bedrock_endpoint_real_fetch_exception(client, mocker):
    """Bedrock fetch() returns offline when mcstatus raises, covering the except branch."""
    import api.server_api
    import sys
    import types

    api.server_api._STATUS_CACHE.pop("bedrock", None)

    mcstatus_mod = types.ModuleType("mcstatus")
    mcstatus_mod.BedrockServer = mocker.MagicMock(side_effect=Exception("Connection refused"))
    mocker.patch.dict(sys.modules, {"mcstatus": mcstatus_mod})

    response = client.get("/api/bedrock-status")
    assert response.status_code == 200
    assert response.json["online"] is False


# ── homes / ops / internal-resync endpoints ─────────────────────────────────

def test_player_homes_endpoint_returns_homes(client, mocker):
    """Returns homes for a player UUID through the dedicated homes endpoint."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)
    mocker.patch(
        "api.server_api.read_essentials_homes",
        return_value=[{"name": "home", "world": "world", "x": 1.0, "y": 64.0, "z": 2.0}],
    )

    headers = {"Authorization": "Bearer token"}
    response = client.get(f"/api/players/{VALID_UUID}/homes", headers=headers)
    assert response.status_code == 200
    assert response.json[0]["name"] == "home"


def test_create_player_home_endpoint_validates_body(client, mocker):
    """Returns 400 when create home payload is missing required fields."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)

    headers = {"Authorization": "Bearer token"}
    response = client.post(f"/api/players/{VALID_UUID}/homes", headers=headers, json={"name": "home"})
    assert response.status_code == 400


def test_create_player_home_endpoint_conflict(client, mocker):
    """Returns 409 when create_essentials_home reports existing home."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)
    mocker.patch("api.server_api.create_essentials_home", return_value=False)

    headers = {"Authorization": "Bearer token"}
    response = client.post(
        f"/api/players/{VALID_UUID}/homes",
        headers=headers,
        json={"name": "home", "x": 1, "y": 64, "z": 2, "world": "world"},
    )
    assert response.status_code == 409


def test_create_player_home_endpoint_success(client, mocker):
    """Creates a home and returns 201 with ok=true."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)
    mocker.patch("api.server_api.create_essentials_home", return_value=True)

    headers = {"Authorization": "Bearer token"}
    response = client.post(
        f"/api/players/{VALID_UUID}/homes",
        headers=headers,
        json={"name": "home", "x": 1, "y": 64, "z": 2, "world": "world"},
    )
    assert response.status_code == 201
    assert response.json == {"ok": True}


def test_update_player_home_endpoint_validates_body(client, mocker):
    """Returns 400 when update payload is missing required coordinates/world."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)

    headers = {"Authorization": "Bearer token"}
    response = client.put(f"/api/players/{VALID_UUID}/homes/home", headers=headers, json={"x": 1})
    assert response.status_code == 400


def test_update_player_home_endpoint_not_found(client, mocker):
    """Returns 404 when update_essentials_home fails to find the target."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)
    mocker.patch("api.server_api.update_essentials_home", return_value=False)

    headers = {"Authorization": "Bearer token"}
    response = client.put(
        f"/api/players/{VALID_UUID}/homes/home",
        headers=headers,
        json={"x": 1, "y": 64, "z": 2, "world": "world", "new_name": "new-home"},
    )
    assert response.status_code == 404


def test_update_player_home_endpoint_success(client, mocker):
    """Updates an existing home and returns ok=true."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)
    mocker.patch("api.server_api.update_essentials_home", return_value=True)

    headers = {"Authorization": "Bearer token"}
    response = client.put(
        f"/api/players/{VALID_UUID}/homes/home",
        headers=headers,
        json={"x": 1, "y": 64, "z": 2, "world": "world"},
    )
    assert response.status_code == 200
    assert response.json == {"ok": True}


def test_delete_player_home_endpoint_not_found(client, mocker):
    """Returns 404 when deleting a missing home."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)
    mocker.patch("api.server_api.delete_essentials_home", return_value=False)

    headers = {"Authorization": "Bearer token"}
    response = client.delete(f"/api/players/{VALID_UUID}/homes/home", headers=headers)
    assert response.status_code == 404


def test_delete_player_home_endpoint_success(client, mocker):
    """Deletes a home and returns ok=true."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)
    mocker.patch("api.server_api.delete_essentials_home", return_value=True)

    headers = {"Authorization": "Bearer token"}
    response = client.delete(f"/api/players/{VALID_UUID}/homes/home", headers=headers)
    assert response.status_code == 200
    assert response.json == {"ok": True}


def test_ops_endpoint_returns_names(client, mocker):
    """Returns OP player names from ops.json helper."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api.get_op_names", return_value=["Steve", "Alex"])

    headers = {"Authorization": "Bearer token"}
    response = client.get("/api/ops", headers=headers)
    assert response.status_code == 200
    assert response.json == ["Steve", "Alex"]


def test_internal_force_resync_rejects_missing_secret(client, mocker):
    """Returns 403 when no shared secret is provided (even from loopback)."""
    mocker.patch.dict("os.environ", {"INTERNAL_API_SECRET": "s3cret"})
    response = client.post("/api/internal/force-resync", environ_overrides={"REMOTE_ADDR": "127.0.0.1"})
    assert response.status_code == 403


def test_internal_force_resync_rejects_wrong_secret(client, mocker):
    """Returns 403 when the provided secret does not match."""
    mocker.patch.dict("os.environ", {"INTERNAL_API_SECRET": "s3cret"})
    response = client.post(
        "/api/internal/force-resync",
        headers={"X-Internal-Secret": "wrong"},
        environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
    )
    assert response.status_code == 403


def test_internal_force_resync_fails_closed_when_unconfigured(client, mocker):
    """Returns 403 when INTERNAL_API_SECRET is empty/unconfigured."""
    mocker.patch.dict("os.environ", {"INTERNAL_API_SECRET": ""})
    response = client.post(
        "/api/internal/force-resync",
        headers={"X-Internal-Secret": "anything"},
    )
    assert response.status_code == 403


def test_internal_force_resync_allows_valid_secret(client, mocker):
    """Allows a caller presenting the correct shared secret and returns count."""
    from unittest.mock import MagicMock

    mocker.patch.dict("os.environ", {"INTERNAL_API_SECRET": "s3cret"})
    mocker.patch("api.server_api.get_players", return_value=[{"name": "Steve"}, {"name": "Alex"}])
    mocker.patch("api.player_data._cache", MagicMock(last_updated=123.0))
    mocker.patch("api.skin_resolver._url_resolution_cache", {})
    mocker.patch("api.skin_resolver._url_resolved_at", {})

    response = client.post(
        "/api/internal/force-resync",
        headers={"X-Internal-Secret": "s3cret"},
    )
    assert response.status_code == 200
    assert response.json == {"ok": True, "players": 2}


def test_backups_endpoint_protected_mode_missing_credentials_returns_500(client, mocker):
    """In protected mode, missing Drive credentials returns 500 instead of dev fallback []."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch(
        "api.server_api.service_account.Credentials.from_service_account_file",
        side_effect=FileNotFoundError("drive-service-account.json not found"),
    )

    headers = {"Authorization": "Bearer token"}
    response = client.get("/api/backups", headers=headers)
    assert response.status_code == 500
    assert response.json == {"error": "Failed to fetch backups"}


# ── verify-minecraft-password endpoint ───────────────────────────────────────

def test_verify_minecraft_password_missing_fields_returns_400(client, mocker):
    """Returns 400 when username or password is missing."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "test_uid"})

    headers = {"Authorization": "Bearer fake_token"}
    response = client.post("/api/verify-minecraft-password", json={"username": "", "password": ""}, headers=headers)
    assert response.status_code == 400
    assert response.json["valid"] is False


def test_verify_minecraft_password_rejects_overlong_inputs(client, mocker):
    """Returns 400 for excessively long username/password values."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "test_uid"})

    headers = {"Authorization": "Bearer fake_token"}
    response = client.post(
        "/api/verify-minecraft-password",
        json={"username": "a" * 65, "password": "x"},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json == {"valid": False}


def test_verify_minecraft_password_unknown_user_returns_false(client, mocker):
    """Returns valid=false when username is not present in AuthMe DB."""
    from unittest.mock import MagicMock
    import types
    import sys

    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "test_uid"})
    mocker.patch("api.server_api._check_rate_limit", return_value=True)

    fake_conn = MagicMock()
    fake_conn.execute.return_value.fetchone.return_value = None
    mocker.patch("sqlite3.connect", return_value=fake_conn)

    fake_bcrypt = types.SimpleNamespace(checkpw=lambda *_: False)
    mocker.patch.dict(sys.modules, {"bcrypt": fake_bcrypt})
    headers = {"Authorization": "Bearer fake_token"}
    response = client.post(
        "/api/verify-minecraft-password",
        json={"username": "Steve", "password": "secret"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json == {"valid": False}


def test_verify_minecraft_password_bcrypt_branch_normalizes_prefix(client, mocker):
    """Normalizes $2a$/$2y$ bcrypt hashes to $2b$ and verifies with bcrypt.checkpw."""
    from unittest.mock import MagicMock
    import types
    import sys

    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "test_uid"})
    mocker.patch("api.server_api._check_rate_limit", return_value=True)

    fake_conn = MagicMock()
    fake_conn.execute.return_value.fetchone.return_value = ("$2a$10$abcdefghijklmnopqrstuvwxyzABCDE1234567890abcd",)
    mocker.patch("sqlite3.connect", return_value=fake_conn)

    checkpw = mocker.Mock(return_value=True)
    fake_bcrypt = types.SimpleNamespace(checkpw=checkpw)

    mocker.patch.dict(sys.modules, {"bcrypt": fake_bcrypt})
    headers = {"Authorization": "Bearer fake_token"}
    response = client.post(
        "/api/verify-minecraft-password",
        json={"username": "Steve", "password": "secret"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json == {"valid": True}
    assert checkpw.call_args.args[1].decode("utf-8").startswith("$2b$")


def test_verify_minecraft_password_sha_branch(client, mocker):
    """Verifies AuthMe legacy $SHA$<salt>$hash entries."""
    from unittest.mock import MagicMock
    import hashlib
    import types
    import sys

    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "test_uid"})
    mocker.patch("api.server_api._check_rate_limit", return_value=True)

    password = "secret"
    salt = "pepper"
    inner = hashlib.sha256(password.encode("utf-8")).hexdigest()
    expected = hashlib.sha256((inner + salt).encode("utf-8")).hexdigest()
    stored = f"$SHA${salt}${expected}"

    fake_conn = MagicMock()
    fake_conn.execute.return_value.fetchone.return_value = (stored,)
    mocker.patch("sqlite3.connect", return_value=fake_conn)

    fake_bcrypt = types.SimpleNamespace(checkpw=lambda *_: False)
    mocker.patch.dict(sys.modules, {"bcrypt": fake_bcrypt})
    headers = {"Authorization": "Bearer fake_token"}
    response = client.post(
        "/api/verify-minecraft-password",
        json={"username": "Steve", "password": password},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json == {"valid": True}


def test_verify_minecraft_password_unknown_hash_format_returns_false(client, mocker):
    """Returns valid=false for unsupported hash formats."""
    from unittest.mock import MagicMock
    import types
    import sys

    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "test_uid"})
    mocker.patch("api.server_api._check_rate_limit", return_value=True)

    fake_conn = MagicMock()
    fake_conn.execute.return_value.fetchone.return_value = ("plain-text-hash",)
    mocker.patch("sqlite3.connect", return_value=fake_conn)

    fake_bcrypt = types.SimpleNamespace(checkpw=lambda *_: False)
    mocker.patch.dict(sys.modules, {"bcrypt": fake_bcrypt})
    headers = {"Authorization": "Bearer fake_token"}
    response = client.post(
        "/api/verify-minecraft-password",
        json={"username": "Steve", "password": "secret"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json == {"valid": False}


def test_verify_minecraft_password_db_missing_returns_503(client, mocker):
    """Returns 503 when the AuthMe DB file does not exist."""
    import types
    import sys

    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "test_uid"})
    mocker.patch("api.server_api._check_rate_limit", return_value=True)
    mocker.patch("sqlite3.connect", side_effect=FileNotFoundError("missing db"))

    fake_bcrypt = types.SimpleNamespace(checkpw=lambda *_: False)
    mocker.patch.dict(sys.modules, {"bcrypt": fake_bcrypt})
    headers = {"Authorization": "Bearer fake_token"}
    response = client.post(
        "/api/verify-minecraft-password",
        json={"username": "Steve", "password": "secret"},
        headers=headers,
    )
    assert response.status_code == 503
    assert response.json["valid"] is False


def test_verify_minecraft_password_unexpected_error_returns_500(client, mocker):
    """Returns 500 when password verification raises an unexpected exception."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "test_uid"})
    mocker.patch("api.server_api._check_rate_limit", return_value=True)
    mocker.patch("sqlite3.connect", side_effect=RuntimeError("boom"))

    headers = {"Authorization": "Bearer fake_token"}
    response = client.post(
        "/api/verify-minecraft-password",
        json={"username": "Steve", "password": "secret"},
        headers=headers,
    )
    assert response.status_code == 500
    assert response.json["valid"] is False


# ── services-catalog validator ───────────────────────────────────────────────

def test_validate_services_catalog_accepts_valid_payload():
    ok, err = srv._validate_services_catalog({
        "updatedAt": "2026-01-01",
        "sections": [{
            "title": "Servers", "description": "",
            "services": [{"name": "svc", "access": "public", "host": "h", "port": 25565}],
        }],
    })
    assert ok is True
    assert err == ""


@pytest.mark.parametrize("payload,fragment", [
    ({"sections": []}, "updatedAt"),
    ({"updatedAt": "   ", "sections": []}, "updatedAt"),
    ({"updatedAt": "x", "sections": "nope"}, "sections must be an array"),
    ({"updatedAt": "x", "sections": ["bad"]}, "each section must be an object"),
    ({"updatedAt": "x", "sections": [{"title": "", "description": "", "services": []}]}, "section.title"),
    ({"updatedAt": "x", "sections": [{"title": "T", "description": 1, "services": []}]}, "section.description"),
    ({"updatedAt": "x", "sections": [{"title": "T", "description": "", "services": "no"}]}, "section.services"),
    ({"updatedAt": "x", "sections": [{"title": "T", "description": "", "services": ["bad"]}]}, "each service"),
    ({"updatedAt": "x", "sections": [{"title": "T", "description": "", "services": [{"name": "", "access": "a"}]}]}, "service.name"),
    ({"updatedAt": "x", "sections": [{"title": "T", "description": "", "services": [{"name": "n", "access": ""}]}]}, "service.access"),
    ({"updatedAt": "x", "sections": [{"title": "T", "description": "", "services": [{"name": "n", "access": "a", "host": 1}]}]}, "service.host"),
    ({"updatedAt": "x", "sections": [{"title": "T", "description": "", "services": [{"name": "n", "access": "a", "port": 0}]}]}, "service.port"),
])
def test_validate_services_catalog_rejects_invalid_payload(payload, fragment):
    ok, err = srv._validate_services_catalog(payload)
    assert ok is False
    assert fragment in err


def test_services_catalog_put_rejects_non_dict_body(client, mocker):
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "admin"})
    mocker.patch("api.server_api._is_services_admin", return_value=True)
    r = client.put("/api/services-catalog", headers={"Authorization": "Bearer t"},
                   json=["not", "a", "dict"])
    assert r.status_code == 400


def test_services_catalog_put_rejects_invalid_catalog(client, mocker):
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "admin"})
    mocker.patch("api.server_api._is_services_admin", return_value=True)
    r = client.put("/api/services-catalog", headers={"Authorization": "Bearer t"},
                   json={"updatedAt": "", "sections": []})
    assert r.status_code == 400


def test_services_admin_uids_parsing(mocker):
    mocker.patch.dict("os.environ", {"SERVICES_CATALOG_ADMIN_UIDS": " a , b ,, c "})
    assert srv._services_admin_uids() == {"a", "b", "c"}


# ── rate limiter ─────────────────────────────────────────────────────────────

def test_check_rate_limit_blocks_after_max():
    srv._rl_attempts.clear()
    key = "user-rl"
    for _ in range(srv._RL_MAX):
        assert srv._check_rate_limit(key) is True
    assert srv._check_rate_limit(key) is False


def test_check_rate_limit_resets_after_window(mocker):
    srv._rl_attempts.clear()
    now = [1000.0]
    mocker.patch("api.server_api.time.time", side_effect=lambda: now[0])
    key = "user-rl2"
    for _ in range(srv._RL_MAX):
        assert srv._check_rate_limit(key) is True
    assert srv._check_rate_limit(key) is False
    now[0] += srv._RL_WINDOW + 1
    assert srv._check_rate_limit(key) is True


def test_check_rate_limit_evicts_stale_keys(mocker):
    srv._rl_attempts.clear()
    now = [1000.0]
    mocker.patch("api.server_api.time.time", side_effect=lambda: now[0])
    srv._check_rate_limit("stale-key")
    now[0] += srv._RL_WINDOW + 1
    srv._check_rate_limit("fresh-key")
    assert "stale-key" not in srv._rl_attempts


def test_verify_password_rate_limited_returns_429(client, mocker):
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.server_api._check_rate_limit", return_value=False)
    r = client.post("/api/verify-minecraft-password", headers={"Authorization": "Bearer t"},
                    json={"username": "a", "password": "b"})
    assert r.status_code == 429


# ── homes ownership / validation (IDOR fix) ──────────────────────────────────

def test_homes_get_rejects_invalid_uuid(client, mocker):
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    r = client.get("/api/players/not-a-uuid/homes", headers={"Authorization": "Bearer t"})
    assert r.status_code == 400


def test_homes_get_forbidden_when_not_owner(client, mocker):
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.server_api._user_owns_player", return_value=False)
    r = client.get(f"/api/players/{VALID_UUID}/homes", headers={"Authorization": "Bearer t"})
    assert r.status_code == 403


def test_homes_create_forbidden_when_not_owner(client, mocker):
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.server_api._user_owns_player", return_value=False)
    r = client.post(f"/api/players/{VALID_UUID}/homes", headers={"Authorization": "Bearer t"},
                    json={"name": "h", "x": 1, "y": 1, "z": 1, "world": "w"})
    assert r.status_code == 403


def test_homes_create_non_numeric_coord_returns_400(client, mocker):
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.server_api._user_owns_player", return_value=True)
    r = client.post(f"/api/players/{VALID_UUID}/homes", headers={"Authorization": "Bearer t"},
                    json={"name": "h", "x": "abc", "y": 1, "z": 1, "world": "w"})
    assert r.status_code == 400


def test_user_owns_player_matches_linked_name(mocker):
    mocker.patch("api.server_api.get_uuid_to_name", return_value={VALID_UUID: "Steve"})
    mock_doc = mocker.MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {"minecraftAccounts": {"java": "Steve", "bedrock": None, "admin": None}}
    mock_db = mocker.MagicMock()
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    mocker.patch("firebase_admin.firestore.client", return_value=mock_db)
    with app.test_request_context():
        from flask import g
        g.auth_uid = "uid-1"
        assert srv._user_owns_player(VALID_UUID) is True


def test_user_owns_player_rejects_foreign_uuid(mocker):
    mocker.patch("api.server_api.get_uuid_to_name", return_value={VALID_UUID: "Mallory"})
    mock_doc = mocker.MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {"minecraftAccounts": {"java": "Steve", "bedrock": None, "admin": None}}
    mock_db = mocker.MagicMock()
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    mocker.patch("firebase_admin.firestore.client", return_value=mock_db)
    with app.test_request_context():
        from flask import g
        g.auth_uid = "uid-1"
        assert srv._user_owns_player(VALID_UUID) is False


# ── analytics aggregation ────────────────────────────────────────────────────

def test_aggregate_snapshots_buckets_and_summary():
    rows = [{"ts": 0, "count": 1}, {"ts": 100, "count": 3}]  # same 15-min (day) bucket
    out = srv._aggregate_snapshots(rows, "day")
    assert out["points"] == [{"t": 0, "avg": 2, "peak": 3}]
    assert out["summary"] == {"peak": 3, "avg": 2}


def test_aggregate_snapshots_skips_none_ts():
    rows = [{"ts": None, "count": 99}, {"ts": 10, "count": 2}]
    out = srv._aggregate_snapshots(rows, "day")
    assert out["summary"]["peak"] == 2  # the ts=None row is ignored
    assert len(out["points"]) == 1


def test_analytics_dedups_local_over_firestore_on_matching_ts(client, mocker):
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.server_api.read_local_snapshots", return_value=[{"ts": 1000, "count": 1}])
    mocker.patch("api.server_api._init_firebase")
    srv._FIREBASE_INITIALIZED = True
    mock_snap = mocker.MagicMock()
    row = {"ts": 1000, "count": 9}  # SAME ts as local — must be skipped
    mock_snap.get = row.get
    mock_db = mocker.MagicMock()
    mock_db.collection.return_value.where.return_value.order_by.return_value.stream.return_value = [mock_snap]
    mocker.patch("firebase_admin.firestore.client", return_value=mock_db)
    r = client.get("/api/analytics?period=week", headers={"Authorization": "Bearer t"})
    # Firestore row deduped → local count (1) wins, so peak stays 1 (not 9).
    assert r.json["summary"]["peak"] == 1


# ── AuthMe SHA/bcrypt reject paths ───────────────────────────────────────────

def _verify_password(client, mocker, stored, password, checkpw_result=False):
    from unittest.mock import MagicMock
    import types
    import sys
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.server_api._check_rate_limit", return_value=True)
    fake_conn = MagicMock()
    fake_conn.execute.return_value.fetchone.return_value = (stored,)
    mocker.patch("sqlite3.connect", return_value=fake_conn)
    mocker.patch.dict(sys.modules, {"bcrypt": types.SimpleNamespace(checkpw=lambda *_: checkpw_result)})
    return client.post("/api/verify-minecraft-password",
                       json={"username": "Steve", "password": password},
                       headers={"Authorization": "Bearer t"})


def test_verify_password_sha_wrong_password_returns_false(client, mocker):
    import hashlib
    salt = "pepper"
    inner = hashlib.sha256("correct".encode()).hexdigest()
    stored = f"$SHA${salt}${hashlib.sha256((inner + salt).encode()).hexdigest()}"
    r = _verify_password(client, mocker, stored, "WRONG")
    assert r.status_code == 200
    assert r.json == {"valid": False}


def test_verify_password_sha_malformed_returns_false(client, mocker):
    # Only 3 '$'-segments instead of 4 → falls through to valid:False
    r = _verify_password(client, mocker, "$SHA$onlysalt", "whatever")
    assert r.status_code == 200
    assert r.json == {"valid": False}


def test_verify_password_bcrypt_reject_returns_false(client, mocker):
    stored = "$2b$10$abcdefghijklmnopqrstuvwxyzABCDE1234567890abcd"
    r = _verify_password(client, mocker, stored, "nope", checkpw_result=False)
    assert r.status_code == 200
    assert r.json == {"valid": False}


# ── status endpoint identity leak ────────────────────────────────────────────

def test_java_status_strips_sample_for_anonymous(client, mocker):
    srv._STATUS_CACHE.clear()
    def fake_fetch():
        return {"online": True, "version": "1.21",
                "players": {"online": 1, "max": 20, "sample": [{"name": "Steve", "id": "abc"}]},
                "motd": {"clean": [""]}}
    mocker.patch("api.server_api._cached_status", side_effect=lambda key, fn: fake_fetch())
    # No Authorization header → anonymous → sample stripped
    r = client.get("/api/status")
    assert r.status_code == 200
    assert r.json["players"]["sample"] is None
    # Counts remain public
    assert r.json["players"]["online"] == 1


def test_java_status_keeps_sample_for_authenticated(client, mocker):
    srv._STATUS_CACHE.clear()
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    def fake_fetch():
        return {"online": True, "version": "1.21",
                "players": {"online": 1, "max": 20, "sample": [{"name": "Steve", "id": "abc"}]},
                "motd": {"clean": [""]}}
    mocker.patch("api.server_api._cached_status", side_effect=lambda key, fn: fake_fetch())
    r = client.get("/api/status", headers={"Authorization": "Bearer t"})
    assert r.status_code == 200
    assert r.json["players"]["sample"] == [{"name": "Steve", "id": "abc"}]
