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
