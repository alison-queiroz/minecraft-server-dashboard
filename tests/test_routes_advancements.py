"""Tests for api/routes/advancements.py: a player's advancements (strict UUID
check) and a single advancement's description, both read lazily from
api/advancements.py."""
import pytest

pytestmark = pytest.mark.usefixtures("route_state")


# ── /api/advancements/<uuid> ──────────────────────────────────────────────────

def test_advancements_endpoint_returns_data_for_valid_uuid(client, mocker):
    """Returns advancement data for a properly-formatted UUID."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    mock_data = {"minecraft:story/mine_stone": {"done": True, "criteria": {}}}
    mocker.patch("api.routes.advancements.get_advancements", return_value=mock_data, create=True)

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
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/advancements/not-a-valid-uuid", headers=headers)

    assert response.status_code == 400
    assert "Invalid UUID" in response.json["error"]


# ── /api/advancements/description ────────────────────────────────────────────

def test_advancement_description_endpoint_returns_description(client, mocker):
    """Returns the description for a valid advancement id."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
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
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})

    headers = {"Authorization": "Bearer fake_token"}
    response = client.get("/api/advancements/description", headers=headers)

    assert response.status_code == 400
    assert "Missing id" in response.json["error"]
