"""Tests for api/routes/backups.py: GET /api/backups auth, the Drive listing,
and error handling for Drive failures and missing credentials. Folder
confinement and the Drive caches are covered in test_server_api_hardening.py."""
import pytest

pytestmark = pytest.mark.usefixtures("route_state")


def test_backups_endpoint_unauthorized(client, mocker):
    """Ensure the endpoint returns 401 when no token is provided."""
    # Mock Firebase as initialized so the auth decorator enforces the block
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)

    response = client.get("/api/backups")
    assert response.status_code == 401


def test_backups_endpoint_authorized(client, mocker):
    """Ensure authorized requests return the mocked Google Drive backup list."""
    # Mock Firebase Auth
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "mocked_user_id"})

    # Mock Google Drive Service Account Credentials
    mocker.patch("api.routes.backups.service_account.Credentials.from_service_account_file")

    # Mock the Google Drive API build service and its chained methods
    mock_build = mocker.patch("api.routes.backups.build")
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
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "mocked_user_id"})
    mocker.patch("api.routes.backups.service_account.Credentials.from_service_account_file")

    # Make the Google API build function raise an exception
    mocker.patch("api.routes.backups.build", side_effect=Exception("API limit exceeded"))

    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.get("/api/backups", headers=headers)

    # Expecting the 500 error we defined in the try/except block in api/routes/backups.py
    assert response.status_code == 500
    assert response.json == {"error": "Failed to fetch backups"}


def test_backups_endpoint_firebase_unavailable_returns_503(client, mocker):
    """Returns 503 when Firebase is unavailable (auth cannot be verified)."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", False)

    response = client.get("/api/backups")

    assert response.status_code == 503


def test_backups_endpoint_protected_mode_missing_credentials_returns_500(client, mocker):
    """In protected mode, missing Drive credentials returns 500 instead of dev fallback []."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch(
        "api.routes.backups.service_account.Credentials.from_service_account_file",
        side_effect=FileNotFoundError("drive-service-account.json not found"),
    )

    headers = {"Authorization": "Bearer token"}
    response = client.get("/api/backups", headers=headers)
    assert response.status_code == 500
    assert response.json == {"error": "Failed to fetch backups"}
