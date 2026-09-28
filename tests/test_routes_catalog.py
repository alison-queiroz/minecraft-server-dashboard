"""Tests for api/routes/catalog.py: reading the services catalog (with its
canEdit flag), admin-only writes, the payload validator and the default file
location."""
from pathlib import Path

import pytest

from api.routes import catalog

pytestmark = pytest.mark.usefixtures("route_state")


def test_services_catalog_endpoint_unauthorized(client, mocker):
    """Ensure the endpoint returns 401 when no token is provided."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)

    response = client.get("/api/services-catalog")
    assert response.status_code == 401


def test_services_catalog_get_authorized(client, mocker, tmp_path):
    """Authorized users can read the services catalog and receive canEdit metadata."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "editor-uid"})
    mocker.patch("api.auth._services_admin_uids", return_value={"editor-uid"})

    catalog_path = tmp_path / "services-catalog.json"
    catalog_path.write_text(
        '{"updatedAt":"2026-04-21","sections":[]}',
        encoding="utf-8",
    )
    mocker.patch("api.routes.catalog._services_catalog_path", return_value=catalog_path)

    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.get("/api/services-catalog", headers=headers)

    assert response.status_code == 200
    assert response.json["catalog"]["updatedAt"] == "2026-04-21"
    assert response.json["canEdit"] is True


def test_services_catalog_put_forbidden_for_non_admin(client, mocker):
    """Non-admin authenticated users cannot update the services catalog."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "viewer-uid"})
    mocker.patch("api.auth._services_admin_uids", return_value={"editor-uid"})

    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.put(
        "/api/services-catalog",
        headers=headers,
        json={"updatedAt": "2026-04-21", "sections": []},
    )

    assert response.status_code == 403


def test_services_catalog_put_writes_file_for_admin(client, mocker, tmp_path):
    """Admin users can update the services catalog JSON file."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "editor-uid"})
    mocker.patch("api.auth._services_admin_uids", return_value={"editor-uid"})

    catalog_path = tmp_path / "services-catalog.json"
    mocker.patch("api.routes.catalog._services_catalog_path", return_value=catalog_path)

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


# ── services-catalog validator ───────────────────────────────────────────────

def test_validate_services_catalog_accepts_valid_payload():
    ok, err = catalog._validate_services_catalog({
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
    ok, err = catalog._validate_services_catalog(payload)
    assert ok is False
    assert fragment in err


def test_services_catalog_put_rejects_non_dict_body(client, mocker):
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "admin"})
    mocker.patch("api.routes.catalog._is_services_admin", return_value=True)
    r = client.put("/api/services-catalog", headers={"Authorization": "Bearer t"},
                   json=["not", "a", "dict"])
    assert r.status_code == 400


def test_services_catalog_put_rejects_invalid_catalog(client, mocker):
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "admin"})
    mocker.patch("api.routes.catalog._is_services_admin", return_value=True)
    r = client.put("/api/services-catalog", headers={"Authorization": "Bearer t"},
                   json={"updatedAt": "", "sections": []})
    assert r.status_code == 400


def test_services_catalog_default_path_is_the_frontend_asset(monkeypatch):
    """Without SERVICES_CATALOG_PATH the catalog is the repo's src/assets/services-catalog.json."""
    monkeypatch.delenv("SERVICES_CATALOG_PATH", raising=False)
    expected = Path(__file__).resolve().parents[1] / "src" / "assets" / "services-catalog.json"
    assert catalog._services_catalog_path() == expected
    assert expected.is_file()
