import pytest
from api.server_api import app

@pytest.fixture
def client():
    """Provides a test client for the Flask application."""
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client

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


def test_backups_endpoint_dev_mode_missing_drive_credentials_returns_empty_list(client, mocker):
    """In dev fallback mode, missing Drive SA key should return [] instead of 500."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", False)
    mocker.patch(
        "api.server_api.service_account.Credentials.from_service_account_file",
        side_effect=FileNotFoundError("drive-service-account.json not found"),
    )

    response = client.get("/api/backups")

    assert response.status_code == 200
    assert response.json == []


def test_require_auth_invalid_token(client, mocker):
    """Ensure the endpoint returns 401 when an invalid or expired token is provided."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)

    # Make verify_id_token raise an Exception to simulate an invalid token
    mocker.patch("firebase_admin.auth.verify_id_token", side_effect=Exception("Invalid token"))

    headers = {"Authorization": "Bearer invalid_token_here"}
    response = client.get("/api/players", headers=headers)

    assert response.status_code == 401

def test_require_auth_dev_fallback(client, mocker):
    """Ensure the endpoint allows access without a token if Firebase fails to initialize (dev mode)."""
    # Force _FIREBASE_INITIALIZED to False
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", False)

    # Mock get_players so we don't try to read actual NBT files during the test
    mocked_players = [{"name": "DevSteve", "level": 10}]
    mocker.patch("api.server_api.get_players", return_value=mocked_players)

    # Request WITHOUT headers
    response = client.get("/api/players")

    assert response.status_code == 200
    assert response.json == mocked_players

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

def test_analytics_returns_sorted_local_snapshots(client, mocker):
    """Returns snapshots from the local store, sorted by ts ascending."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    snapshots = [
        {"ts": 1700000020, "count": 2, "online": ["Alex"]},
        {"ts": 1700000010, "count": 1, "online": ["Steve"]},
    ]
    mocker.patch("api.server_api.read_local_snapshots", return_value=list(snapshots))

    # Firestore unavailable — skip the remote merge
    mocker.patch("api.server_api._init_firebase")
    import api.server_api as srv
    srv._FIREBASE_INITIALIZED = False  # disable Firestore merge branch

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/analytics?period=week", headers=headers)

    assert response.status_code == 200
    result = response.json
    assert len(result) == 2
    # Must be sorted ascending by ts
    assert result[0]["ts"] < result[1]["ts"]


def test_analytics_returns_empty_list_when_no_snapshots(client, mocker):
    """Returns an empty list when no local snapshots exist."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api.read_local_snapshots", return_value=[])
    mocker.patch("api.server_api._init_firebase")
    import api.server_api as srv
    srv._FIREBASE_INITIALIZED = False

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/analytics?period=day", headers=headers)

    assert response.status_code == 200
    assert response.json == []


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

    local_data = [{"ts": 1000, "count": 1, "online": ["Steve"]}]
    mocker.patch("api.server_api.read_local_snapshots", return_value=list(local_data))
    mocker.patch("api.server_api._init_firebase")

    import api.server_api as srv
    srv._FIREBASE_INITIALIZED = True

    # Build a mock Firestore snap document — .get(key) takes one positional arg
    mock_snap = mocker.MagicMock()
    firestore_row = {"ts": 2000, "count": 3, "online": ["Alex"]}
    mock_snap.get = firestore_row.get  # dict.get already accepts (key, default)

    mock_db = mocker.MagicMock()
    mock_db.collection.return_value.where.return_value.order_by.return_value.stream.return_value = [mock_snap]
    mocker.patch("firebase_admin.firestore.client", return_value=mock_db)

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/analytics?period=week", headers=headers)

    assert response.status_code == 200
    result = response.json
    ts_values = [r["ts"] for r in result]
    assert 1000 in ts_values
    assert 2000 in ts_values


def test_analytics_handles_firestore_exception(client, mocker):
    """Falls back to local-only results when the Firestore query raises."""
    mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.server_api.read_local_snapshots", return_value=[{"ts": 999, "count": 1, "online": []}])
    mocker.patch("api.server_api._init_firebase")

    import api.server_api as srv
    srv._FIREBASE_INITIALIZED = True
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("Firestore down"))

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/analytics?period=week", headers=headers)

    assert response.status_code == 200
    assert len(response.json) == 1


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
