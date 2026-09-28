"""Tests for api/auth.py: Firebase ID-token checks (require_auth and the lazy
Firebase init), the admin allow-lists and the strict UUID check."""
import pytest

import api.auth as auth

pytestmark = pytest.mark.usefixtures("route_state")


def test_require_auth_invalid_token(client, mocker):
    """Ensure the endpoint returns 401 when an invalid or expired token is provided."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)

    # Make verify_id_token raise an Exception to simulate an invalid token
    mocker.patch("firebase_admin.auth.verify_id_token", side_effect=Exception("Invalid token"))

    headers = {"Authorization": "Bearer invalid_token_here"}
    response = client.get("/api/players", headers=headers)

    assert response.status_code == 401


def test_require_auth_firebase_unavailable_returns_503(client, mocker):
    """Ensure the endpoint returns 503 when Firebase fails to initialize."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", False)

    response = client.get("/api/players")

    assert response.status_code == 503


def test_init_firebase_success(mocker):
    """Ensure Firebase initializes correctly when the credentials file exists."""
    import api.auth
    api.auth._FIREBASE_INITIALIZED = False

    mocker.patch("os.environ.get", return_value="dummy/path.json")
    mocker.patch("firebase_admin.credentials.Certificate")
    mock_init = mocker.patch("firebase_admin.initialize_app")

    api.auth._init_firebase()

    mock_init.assert_called_once()
    assert api.auth._FIREBASE_INITIALIZED is True


def test_init_firebase_already_initialized(mocker):
    """Ensure Firebase does not initialize twice."""
    import api.auth
    api.auth._FIREBASE_INITIALIZED = True

    mock_init = mocker.patch("firebase_admin.initialize_app")
    api.auth._init_firebase()

    # Should exit early and never call initialize_app
    mock_init.assert_not_called()


def test_init_firebase_failure(mocker):
    """Ensure Firebase initialization fails gracefully when the credentials file is missing."""
    import api.auth
    api.auth._FIREBASE_INITIALIZED = False

    # Certificate will raise an exception if path is invalid
    mocker.patch("firebase_admin.credentials.Certificate", side_effect=Exception("File not found"))

    # Should not crash, just catch the exception and log the warning
    api.auth._init_firebase()

    assert api.auth._FIREBASE_INITIALIZED is False


def test_services_admin_uids_parsing(mocker):
    mocker.patch.dict("os.environ", {"SERVICES_CATALOG_ADMIN_UIDS": " a , b ,, c "})
    assert auth._services_admin_uids() == {"a", "b", "c"}


# ── Anchoring: Python's "$" also matches before a trailing newline ───────────

def test_uuid_check_rejects_trailing_newline():
    """A valid UUID followed by "\n" must not pass the strict check."""
    good = "069a79f4-44e9-4726-a5be-fca90e38aaf5"
    assert auth._is_valid_uuid(good) is True
    assert auth._is_valid_uuid(good + "\n") is False


# ── One Firebase flag for every blueprint ────────────────────────────────────

# A protected route of each blueprint that guards with require_auth.
_PROTECTED_ROUTES = [
    ("get", "/api/services-catalog"),
    ("get", "/api/profile"),
    ("get", "/api/players"),
    ("get", "/api/backups"),
    ("get", "/api/analytics"),
    ("post", "/api/profile/accounts"),
    ("get", "/api/advancements/069a79f4-44e9-4726-a5be-fca90e38aaf5"),
]


def test_firebase_flag_has_a_single_definition():
    """Only api.auth defines _FIREBASE_INITIALIZED; everything else reads auth._FIREBASE_INITIALIZED at call time."""
    import importlib
    import pkgutil

    import api
    import api.routes
    names = [m.name for pkg in (api, api.routes) for m in pkgutil.iter_modules(pkg.__path__, pkg.__name__ + ".")]
    holders = [n for n in names if "_FIREBASE_INITIALIZED" in vars(importlib.import_module(n))]
    assert holders == ["api.auth"]


def test_firebase_flag_gates_every_blueprint(client, mocker):
    """Patching api.auth._FIREBASE_INITIALIZED alone flips every blueprint between 503 (unavailable) and 401 (no token)."""
    mocker.patch("api.auth.ensure_initialized", return_value=False)
    for flag, expected in ((False, 503), (True, 401)):
        mocker.patch("api.auth._FIREBASE_INITIALIZED", flag)
        for method, path in _PROTECTED_ROUTES:
            assert getattr(client, method)(path).status_code == expected, (flag, method, path)


def test_firebase_flag_drives_the_public_status_roster(client, mocker):
    """/api/status (optional auth) follows the same flag: the roster is only sent once Firebase is up."""
    roster = [{"name": "Steve", "id": "abc"}]
    mocker.patch(
        "api.routes.status._cached_status",
        side_effect=lambda key, fn: {"online": True, "players": {"online": 1, "max": 20, "sample": roster}},
    )
    mocker.patch("api.auth.ensure_initialized", return_value=False)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    headers = {"Authorization": "Bearer t"}
    mocker.patch("api.auth._FIREBASE_INITIALIZED", False)
    assert client.get("/api/status", headers=headers).json["players"]["sample"] is None
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    assert client.get("/api/status", headers=headers).json["players"]["sample"] == roster


def test_firebase_flag_drives_the_backups_dev_fallback(mocker):
    """The backups blueprint reads the same flag at call time: missing Drive credentials are [] only while it is False."""
    from api.routes import backups
    from api.server_api import app
    mocker.patch(
        "api.routes.backups.service_account.Credentials.from_service_account_file",
        side_effect=FileNotFoundError("no key"),
    )
    view = backups.backups_endpoint.__wrapped__
    for flag, status, body in ((False, 200, []), (True, 500, {"error": "Failed to fetch backups"})):
        mocker.patch("api.auth._FIREBASE_INITIALIZED", flag)
        with app.test_request_context("/api/backups"):
            response = app.make_response(view())
        assert (response.status_code, response.json) == (status, body)
