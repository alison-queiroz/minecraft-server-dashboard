"""Tests for GET /api/healthz, the liveness probe polled by
config/remote-deploy.sh after every backend restart (and used to decide
whether to roll back)."""
from __future__ import annotations

from typing import Iterator

import pytest
from flask.testing import FlaskClient
from pytest_mock import MockerFixture

from api.server_api import app


@pytest.fixture
def client() -> Iterator[FlaskClient]:
    """Provides a test client for the Flask application."""
    app.config["TESTING"] = True
    with app.test_client() as test_client:
        yield test_client


def test_healthz_without_token_returns_ok(client: FlaskClient, mocker: MockerFixture) -> None:
    """Asserts the probe answers 200 {"ok": true} with no Authorization header even when auth is enforced."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)

    response = client.get("/api/healthz")

    assert response.status_code == 200
    assert response.is_json
    assert response.get_json() == {"ok": True}


def test_protected_route_still_rejects_same_request(client: FlaskClient, mocker: MockerFixture) -> None:
    """Asserts the tokenless request that healthz accepts is still 401 on a protected route (healthz is the only exemption)."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)

    assert client.get("/api/players").status_code == 401


def test_healthz_is_never_cached(client: FlaskClient) -> None:
    """Asserts the probe sets Cache-Control: no-store so no proxy or browser can answer it from cache."""
    response = client.get("/api/healthz")

    assert response.headers["Cache-Control"] == "no-store"


def test_healthz_makes_no_external_calls(client: FlaskClient, mocker: MockerFixture) -> None:
    """Asserts the probe touches neither Firebase, player data, snapshots nor the Minecraft server."""
    init_firebase = mocker.patch("api.auth._init_firebase")
    get_players = mocker.patch("api.routes.players.get_players")
    read_snapshots = mocker.patch("api.routes.analytics.read_local_snapshots")
    cached_status = mocker.patch("api.routes.status._cached_status")
    java_server = mocker.patch("mcstatus.JavaServer")

    response = client.get("/api/healthz")

    assert response.status_code == 200
    init_firebase.assert_not_called()
    get_players.assert_not_called()
    read_snapshots.assert_not_called()
    cached_status.assert_not_called()
    java_server.assert_not_called()


def test_healthz_ok_when_firebase_unavailable(client: FlaskClient, mocker: MockerFixture) -> None:
    """Asserts a Firebase outage (which makes protected routes 503) does not fail the probe or trigger a rollback."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", False)
    mocker.patch("api.auth._init_firebase")

    assert client.get("/api/profile").status_code == 503
    assert client.get("/api/healthz").status_code == 200


def test_healthz_rejects_post(client: FlaskClient) -> None:
    """Asserts the probe is GET-only (POST returns 405)."""
    assert client.post("/api/healthz").status_code == 405
