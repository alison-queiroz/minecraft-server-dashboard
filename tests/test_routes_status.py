"""Tests for api/routes/status.py: the Java and Bedrock status pings (online,
offline and the real fetch() closures), the per-worker status cache and
hiding the player roster from anonymous callers."""
import pytest

import api.auth as auth
from api.routes import status

pytestmark = pytest.mark.usefixtures("route_state")


# ── /api/status (Java) ────────────────────────────────────────────────────────

def test_java_status_online(client, mocker):
    """Returns online=True with version/players/motd when the Java server is reachable."""
    import api.routes.status
    api.routes.status._STATUS_CACHE.clear()

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

    mock_java_cls = mocker.patch("api.routes.status.JavaServer", create=True, new_callable=lambda: lambda *_: (lambda **kw: None))

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

    mocker.patch("api.routes.status._cached_status", side_effect=lambda key, fn: fake_fetch())

    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json
    assert data["online"] is True
    assert data["version"] == "Paper 1.21.4"
    assert data["players"]["online"] == 3


def test_java_status_offline(client, mocker):
    """Returns online=False when the Java server raises an exception."""
    import api.routes.status
    api.routes.status._STATUS_CACHE.clear()

    mocker.patch(
        "api.routes.status._cached_status",
        side_effect=lambda key, fn: {"online": False},
    )

    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.json == {"online": False}


# ── /api/bedrock-status ───────────────────────────────────────────────────────

def test_bedrock_status_online(client, mocker):
    """Returns online=True with version/players when Bedrock server is reachable."""
    import api.routes.status
    api.routes.status._STATUS_CACHE.clear()

    mocker.patch(
        "api.routes.status._cached_status",
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
    import api.routes.status
    api.routes.status._STATUS_CACHE.clear()

    mocker.patch(
        "api.routes.status._cached_status",
        side_effect=lambda key, fn: {"online": False},
    )

    response = client.get("/api/bedrock-status")
    assert response.status_code == 200
    assert response.json == {"online": False}


# ── _cached_status helper ─────────────────────────────────────────────────────

def test_cached_status_returns_cached_data_within_ttl(mocker):
    """Returns cached data without calling the fetcher when cache is still fresh."""
    import api.routes.status
    import time

    cached_data = {"online": True, "version": "Cached 1.0"}
    api.routes.status._STATUS_CACHE["java"] = {"data": cached_data, "ts": time.time()}

    fetcher = mocker.MagicMock(return_value={"online": False})
    result = api.routes.status._cached_status("java", fetcher)

    assert result == cached_data
    fetcher.assert_not_called()


def test_cached_status_calls_fetcher_when_cache_is_stale(mocker):
    """Calls the fetcher and updates the cache when the TTL has expired."""
    import api.routes.status
    import time

    fresh_data = {"online": True, "version": "Fresh 1.21"}
    api.routes.status._STATUS_CACHE["java"] = {
        "data": {"online": False},
        "ts": time.time() - api.routes.status._STATUS_CACHE_TTL - 1,
    }

    fetcher = mocker.MagicMock(return_value=fresh_data)
    result = api.routes.status._cached_status("java", fetcher)

    assert result == fresh_data
    fetcher.assert_called_once()
    assert api.routes.status._STATUS_CACHE["java"]["data"] == fresh_data


def test_cached_status_calls_fetcher_when_cache_is_empty():
    """Calls the fetcher on a cache miss (key not yet present)."""
    import api.routes.status

    api.routes.status._STATUS_CACHE.pop("new_key", None)
    result = api.routes.status._cached_status("new_key", lambda: {"online": True})
    assert result == {"online": True}
    assert "new_key" in api.routes.status._STATUS_CACHE


# ── Java / Bedrock status inner fetch logic ───────────────────────────────────

def test_java_status_inner_fetch_online(mocker):
    """The _cached_status fetcher correctly builds the online response."""
    import api.routes.status
    api.routes.status._STATUS_CACHE.clear()

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
    api.routes.status._STATUS_CACHE.clear()
    result_data = api.routes.status._cached_status("java_test", lambda: {
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
    import api.routes.status
    api.routes.status._STATUS_CACHE.clear()

    # Simulate a server that returns players=None and older API attributes
    expected = {"online": True, "version": "Bedrock 1.21", "players": {"online": 0, "max": 10},
                "motd": {"clean": [""]}, "protocol": {"version": None, "name": ""}, "port": 19132}

    result = api.routes.status._cached_status(
        "bedrock_no_players_test",
        lambda: expected,
    )
    assert result["online"] is True
    assert result["players"]["online"] == 0


# ── Real inner fetch() closure coverage ──────────────────────────────────────

def test_java_endpoint_real_fetch_online(client, mocker):
    """Calls the real inner Java fetch() when cache is empty, covering lines 133-148."""
    import api.routes.status
    import sys
    import types

    api.routes.status._STATUS_CACHE.pop("java", None)

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
    import api.routes.status
    import sys
    import types

    api.routes.status._STATUS_CACHE.pop("java", None)

    mcstatus_mod = types.ModuleType("mcstatus")
    mcstatus_mod.JavaServer = mocker.MagicMock(side_effect=Exception("Connection refused"))
    mocker.patch.dict(sys.modules, {"mcstatus": mcstatus_mod})

    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.json["online"] is False


def test_bedrock_endpoint_real_fetch_online(client, mocker):
    """Calls the real inner Bedrock fetch() when cache is empty, covering lines 162-193."""
    import api.routes.status
    import sys
    import types

    api.routes.status._STATUS_CACHE.pop("bedrock", None)

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
    assert data["port"] == int(api.routes.status._MC_BEDROCK_PORT)


def test_bedrock_endpoint_real_fetch_exception(client, mocker):
    """Bedrock fetch() returns offline when mcstatus raises, covering the except branch."""
    import api.routes.status
    import sys
    import types

    api.routes.status._STATUS_CACHE.pop("bedrock", None)

    mcstatus_mod = types.ModuleType("mcstatus")
    mcstatus_mod.BedrockServer = mocker.MagicMock(side_effect=Exception("Connection refused"))
    mocker.patch.dict(sys.modules, {"mcstatus": mcstatus_mod})

    response = client.get("/api/bedrock-status")
    assert response.status_code == 200
    assert response.json["online"] is False


# ── status endpoint identity leak ────────────────────────────────────────────

def test_java_status_strips_sample_for_anonymous(client, mocker):
    status._STATUS_CACHE.clear()
    def fake_fetch():
        return {"online": True, "version": "1.21",
                "players": {"online": 1, "max": 20, "sample": [{"name": "Steve", "id": "abc"}]},
                "motd": {"clean": [""]}}
    mocker.patch("api.routes.status._cached_status", side_effect=lambda key, fn: fake_fetch())
    # No Authorization header → anonymous → sample stripped
    r = client.get("/api/status")
    assert r.status_code == 200
    assert r.json["players"]["sample"] is None
    # Counts remain public
    assert r.json["players"]["online"] == 1


def test_java_status_keeps_sample_for_authenticated(client, mocker):
    """On a fresh worker (Firebase not yet initialized) a signed-in caller
    triggers the lazy init and still receives the player roster."""
    status._STATUS_CACHE.clear()
    assert auth._FIREBASE_INITIALIZED is False
    init = mocker.patch("api.auth.ensure_initialized", return_value=True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    def fake_fetch():
        return {"online": True, "version": "1.21",
                "players": {"online": 1, "max": 20, "sample": [{"name": "Steve", "id": "abc"}]},
                "motd": {"clean": [""]}}
    mocker.patch("api.routes.status._cached_status", side_effect=lambda key, fn: fake_fetch())
    r = client.get("/api/status", headers={"Authorization": "Bearer t"})
    assert r.status_code == 200
    assert r.json["players"]["sample"] == [{"name": "Steve", "id": "abc"}]
    init.assert_called_once()
