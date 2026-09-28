"""Tests for api/routes/players.py: the roster and ops lists, a player's
EssentialsX homes (owner-only CRUD, input validation, visibility carried along
on delete/rename) and the Firebase-admin / shared-secret force-resync
endpoints."""
import pytest

from route_fakes import (
    VALID_UUID,
    _USERCACHE,
    _fake_firestore,
    _owner_headers,
)

pytestmark = pytest.mark.usefixtures("route_state")


def test_players_endpoint_unauthorized(client, mocker):
    """Ensure the endpoint returns 401 when no token is provided."""
    # Mock Firebase as initialized so the auth decorator enforces the block
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)

    response = client.get("/api/players")
    assert response.status_code == 401


def test_players_endpoint_authorized(client, mocker):
    """Ensure authorized requests return the mocked player list."""
    # Mock Firebase initialization and verification to bypass real auth
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "mocked_user_id"})

    # Mock the function that reads actual files from the disk
    mocked_players = [{"name": "Steve", "level": 30}]
    mocker.patch("api.routes.players.get_players", return_value=mocked_players)

    # Perform the request with a fake Bearer token
    headers = {"Authorization": "Bearer fake_test_token"}
    response = client.get("/api/players", headers=headers)

    assert response.status_code == 200
    assert response.json == mocked_players


# ── /api/players/force-resync ─────────────────────────────────────────────────

def test_force_resync_endpoint(client, mocker):
    """POST /api/players/force-resync invalidates cache and returns player count."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch.dict("os.environ", {"ADMIN_UIDS": "admin"})
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "admin"})

    fresh_players = [{"name": "Steve"}, {"name": "Alex"}, {"name": "Herobrine"}]
    mocker.patch("api.routes.players.get_players", return_value=fresh_players)

    invalidate = mocker.patch("api.routes.players.invalidate_caches")

    headers = {"Authorization": "Bearer fake_token"}
    response = client.post("/api/players/force-resync", headers=headers)

    assert response.status_code == 200
    data = response.json
    assert data["ok"] is True
    assert data["players"] == 3
    invalidate.assert_called_once_with()


# ── homes / ops / internal-resync endpoints ─────────────────────────────────

def test_player_homes_endpoint_returns_homes(client, mocker):
    """Returns homes for a player UUID through the dedicated homes endpoint."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    mocker.patch(
        "api.routes.players.read_essentials_homes",
        return_value=[{"name": "home", "world": "world", "x": 1.0, "y": 64.0, "z": 2.0}],
    )

    headers = {"Authorization": "Bearer token"}
    response = client.get(f"/api/players/{VALID_UUID}/homes", headers=headers)
    assert response.status_code == 200
    assert response.json[0]["name"] == "home"


def test_create_player_home_endpoint_validates_body(client, mocker):
    """Returns 400 when create home payload is missing required fields."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)

    headers = {"Authorization": "Bearer token"}
    response = client.post(f"/api/players/{VALID_UUID}/homes", headers=headers, json={"name": "home"})
    assert response.status_code == 400


def test_create_player_home_endpoint_conflict(client, mocker):
    """Returns 409 when create_essentials_home reports existing home."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    mocker.patch("api.routes.players.create_essentials_home", return_value=False)

    headers = {"Authorization": "Bearer token"}
    response = client.post(
        f"/api/players/{VALID_UUID}/homes",
        headers=headers,
        json={"name": "home", "x": 1, "y": 64, "z": 2, "world": "world"},
    )
    assert response.status_code == 409


def test_create_player_home_endpoint_success(client, mocker):
    """Creates a home and returns 201 with ok=true."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    mocker.patch("api.routes.players.create_essentials_home", return_value=True)

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
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)

    headers = {"Authorization": "Bearer token"}
    response = client.put(f"/api/players/{VALID_UUID}/homes/home", headers=headers, json={"x": 1})
    assert response.status_code == 400


def test_update_player_home_endpoint_not_found(client, mocker):
    """Returns 404 when update_essentials_home fails to find the target."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    mocker.patch("api.routes.players.update_essentials_home", return_value=False)

    headers = {"Authorization": "Bearer token"}
    response = client.put(
        f"/api/players/{VALID_UUID}/homes/home",
        headers=headers,
        json={"x": 1, "y": 64, "z": 2, "world": "world", "new_name": "new-home"},
    )
    assert response.status_code == 404


def test_update_player_home_endpoint_success(client, mocker):
    """Updates an existing home and returns ok=true."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    mocker.patch("api.routes.players.update_essentials_home", return_value=True)

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
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    mocker.patch("api.routes.players.delete_essentials_home", return_value=False)

    headers = {"Authorization": "Bearer token"}
    response = client.delete(f"/api/players/{VALID_UUID}/homes/home", headers=headers)
    assert response.status_code == 404


def test_delete_player_home_endpoint_success(client, mocker):
    """Deletes a home and returns ok=true."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    mocker.patch("api.routes.players.delete_essentials_home", return_value=True)
    mocker.patch("api.routes.players._carry_home_visibility")

    headers = {"Authorization": "Bearer token"}
    response = client.delete(f"/api/players/{VALID_UUID}/homes/home", headers=headers)
    assert response.status_code == 200
    assert response.json == {"ok": True}


def test_ops_endpoint_returns_names(client, mocker):
    """Returns OP player names from ops.json helper."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user"})
    mocker.patch("api.routes.players.get_op_names", return_value=["Steve", "Alex"])

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
    mocker.patch.dict("os.environ", {"INTERNAL_API_SECRET": "s3cret"})
    mocker.patch("api.routes.players.get_players", return_value=[{"name": "Steve"}, {"name": "Alex"}])
    invalidate = mocker.patch("api.routes.players.invalidate_caches")

    response = client.post(
        "/api/internal/force-resync",
        headers={"X-Internal-Secret": "s3cret"},
    )
    assert response.status_code == 200
    assert response.json == {"ok": True, "players": 2}
    invalidate.assert_called_once_with()


# ── visibility follows dashboard deletes / renames ───────────────────────────

def test_home_delete_drops_its_visibility(client, mocker):
    """Deleting a public home forgets its flag (a re-created home starts private)."""
    headers = _owner_headers(mocker)
    mocker.patch("api.routes.players.delete_essentials_home", return_value=True)
    store = _fake_firestore(mocker, {"users/u": {
        "minecraftAccounts": {"java": "Steve"}, "publicHomes": {VALID_UUID: ["base", "home"]},
    }}, usercache=_USERCACHE)
    r = client.delete(f"/api/players/{VALID_UUID}/homes/home", headers=headers)
    assert r.status_code == 200
    assert store.docs["users/u"]["publicHomes"][VALID_UUID] == ["base"]


def test_home_rename_keeps_its_visibility(client, mocker):
    """Renaming a public home moves the flag to the new name."""
    headers = _owner_headers(mocker)
    mocker.patch("api.routes.players.update_essentials_home", return_value=True)
    store = _fake_firestore(mocker, {"users/u": {
        "minecraftAccounts": {"java": "Steve"}, "publicHomes": {VALID_UUID: ["home"]},
    }}, usercache=_USERCACHE)
    r = client.put(f"/api/players/{VALID_UUID}/homes/home", headers=headers,
                   json={"x": 1, "y": 2, "z": 3, "world": "world", "new_name": "casa"})
    assert r.status_code == 200
    assert store.docs["users/u"]["publicHomes"][VALID_UUID] == ["casa"]


def test_private_home_delete_writes_nothing(client, mocker):
    """Deleting a private home doesn't touch the profile doc."""
    headers = _owner_headers(mocker)
    mocker.patch("api.routes.players.delete_essentials_home", return_value=True)
    store = _fake_firestore(mocker, {"users/u": {"minecraftAccounts": {"java": "Steve"}}}, usercache=_USERCACHE)
    before = dict(store.docs)
    assert client.delete(f"/api/players/{VALID_UUID}/homes/home", headers=headers).status_code == 200
    assert store.docs == before


def test_home_delete_succeeds_even_if_visibility_cleanup_fails(client, mocker):
    """The cleanup is best-effort: a Firestore error is logged, not returned."""
    headers = _owner_headers(mocker)
    mocker.patch("api.routes.players.delete_essentials_home", return_value=True)
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("down"))
    warn = mocker.patch("api.home_visibility.logger.warning")
    assert client.delete(f"/api/players/{VALID_UUID}/homes/home", headers=headers).status_code == 200
    warn.assert_called_once()


# ── homes ownership / validation (IDOR fix) ──────────────────────────────────

def test_homes_get_rejects_invalid_uuid(client, mocker):
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    r = client.get("/api/players/not-a-uuid/homes", headers={"Authorization": "Bearer t"})
    assert r.status_code == 400


def test_homes_get_forbidden_when_not_owner(client, mocker):
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.ownership._user_owns_player", return_value=False)
    r = client.get(f"/api/players/{VALID_UUID}/homes", headers={"Authorization": "Bearer t"})
    assert r.status_code == 403


def test_homes_create_forbidden_when_not_owner(client, mocker):
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.ownership._user_owns_player", return_value=False)
    r = client.post(f"/api/players/{VALID_UUID}/homes", headers={"Authorization": "Bearer t"},
                    json={"name": "h", "x": 1, "y": 1, "z": 1, "world": "w"})
    assert r.status_code == 403


def test_homes_create_non_numeric_coord_returns_400(client, mocker):
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    r = client.post(f"/api/players/{VALID_UUID}/homes", headers={"Authorization": "Bearer t"},
                    json={"name": "h", "x": "abc", "y": 1, "z": 1, "world": "w"})
    assert r.status_code == 400


@pytest.mark.parametrize("method,path,body", [
    ("get", f"/api/players/{VALID_UUID}/homes", None),
    ("post", f"/api/players/{VALID_UUID}/homes", {"name": "h", "x": 1, "y": 1, "z": 1, "world": "w"}),
    ("put", f"/api/players/{VALID_UUID}/homes/h", {"x": 1, "y": 1, "z": 1, "world": "w"}),
    ("delete", f"/api/players/{VALID_UUID}/homes/h", None),
])
def test_homes_fail_closed_when_firestore_unavailable(client, mocker, method, path, body):
    """Every ownership-gated homes route answers 503 JSON (never allows) when
    the ownership lookup fails and nothing is cached."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.ownership.get_uuid_to_name", return_value={VALID_UUID: "Steve"})
    # Firestore read raises (e.g. 429 quota) and the owner cache is empty.
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("429 Quota exceeded"))
    read = mocker.patch("api.routes.players.read_essentials_homes", return_value=[])
    create = mocker.patch("api.routes.players.create_essentials_home", return_value=True)
    update = mocker.patch("api.routes.players.update_essentials_home", return_value=True)
    delete = mocker.patch("api.routes.players.delete_essentials_home", return_value=True)

    r = getattr(client, method)(path, headers={"Authorization": "Bearer t"}, json=body)

    assert r.status_code == 503
    assert "error" in r.json
    for fn in (read, create, update, delete):
        fn.assert_not_called()


# ── homes input validation ───────────────────────────────────────────────────

_BAD_COORDS = [
    {"x": float("nan")},
    {"x": float("inf")},
    {"y": float("-inf")},
    {"z": "nan"},
    {"x": "Infinity"},
    {"x": 30_000_001},
    {"z": True},
    {"y": [1]},
]


@pytest.mark.parametrize("override", _BAD_COORDS)
def test_homes_create_rejects_non_finite_or_out_of_range_coords(client, mocker, override):
    """POST rejects NaN/Infinity (incl. JSON NaN literals), booleans and
    coordinates past the world border before touching EssentialsX."""
    headers = _owner_headers(mocker)
    create = mocker.patch("api.routes.players.create_essentials_home", return_value=True)
    body = {"name": "h", "x": 1, "y": 64, "z": 1, "world": "world", **override}
    r = client.post(f"/api/players/{VALID_UUID}/homes", headers=headers, json=body)
    assert r.status_code == 400
    create.assert_not_called()


@pytest.mark.parametrize("override", _BAD_COORDS)
def test_homes_update_rejects_non_finite_or_out_of_range_coords(client, mocker, override):
    """PUT applies the same coordinate validation as POST."""
    headers = _owner_headers(mocker)
    update = mocker.patch("api.routes.players.update_essentials_home", return_value=True)
    body = {"x": 1, "y": 64, "z": 1, "world": "world", **override}
    r = client.put(f"/api/players/{VALID_UUID}/homes/home", headers=headers, json=body)
    assert r.status_code == 400
    update.assert_not_called()


@pytest.mark.parametrize("body", [
    {"name": "h" * 65, "x": 1, "y": 1, "z": 1, "world": "world"},
    {"name": "   ", "x": 1, "y": 1, "z": 1, "world": "world"},
    {"name": 42, "x": 1, "y": 1, "z": 1, "world": "world"},
    {"name": "h", "x": 1, "y": 1, "z": 1, "world": "w" * 65},
    {"name": "h", "x": 1, "y": 1, "z": 1, "world": 7},
])
def test_homes_create_rejects_bad_name_or_world(client, mocker, body):
    """POST bounds the home name and world (non-empty strings, <= 64 chars)."""
    headers = _owner_headers(mocker)
    create = mocker.patch("api.routes.players.create_essentials_home", return_value=True)
    r = client.post(f"/api/players/{VALID_UUID}/homes", headers=headers, json=body)
    assert r.status_code == 400
    create.assert_not_called()


def test_homes_create_rejects_non_object_body(client, mocker):
    """A JSON array body is a 400, not a 500."""
    headers = _owner_headers(mocker)
    r = client.post(f"/api/players/{VALID_UUID}/homes", headers=headers, json=["h", 1, 2, 3])
    assert r.status_code == 400


def test_homes_create_strips_name_and_accepts_numeric_strings(client, mocker):
    """Valid input is normalised: trimmed name, float coordinates."""
    headers = _owner_headers(mocker)
    create = mocker.patch("api.routes.players.create_essentials_home", return_value=True)
    r = client.post(f"/api/players/{VALID_UUID}/homes", headers=headers,
                    json={"name": "  base ", "x": "1.5", "y": 64, "z": -2, "world": "world"})
    assert r.status_code == 201
    create.assert_called_once_with(VALID_UUID, "base", 1.5, 64.0, -2.0, "world")


@pytest.mark.parametrize("body", [
    {"x": 1, "y": 1, "z": 1, "world": "world", "new_name": "n" * 65},
    {"x": 1, "y": 1, "z": 1, "world": "world", "new_name": 5},
])
def test_homes_update_rejects_bad_new_name(client, mocker, body):
    """PUT bounds the optional new_name like a home name."""
    headers = _owner_headers(mocker)
    update = mocker.patch("api.routes.players.update_essentials_home", return_value=True)
    r = client.put(f"/api/players/{VALID_UUID}/homes/home", headers=headers, json=body)
    assert r.status_code == 400
    update.assert_not_called()


def test_homes_update_and_delete_reject_overlong_path_name(client, mocker):
    """The home name in the URL is length-bounded too."""
    headers = _owner_headers(mocker)
    update = mocker.patch("api.routes.players.update_essentials_home", return_value=True)
    delete = mocker.patch("api.routes.players.delete_essentials_home", return_value=True)
    long_name = "n" * 65
    r = client.put(f"/api/players/{VALID_UUID}/homes/{long_name}", headers=headers,
                   json={"x": 1, "y": 1, "z": 1, "world": "world"})
    assert r.status_code == 400
    r = client.delete(f"/api/players/{VALID_UUID}/homes/{long_name}", headers=headers)
    assert r.status_code == 400
    update.assert_not_called()
    delete.assert_not_called()


def test_homes_update_passes_stripped_new_name(client, mocker):
    """A rename forwards the trimmed new name to EssentialsX."""
    headers = _owner_headers(mocker)
    update = mocker.patch("api.routes.players.update_essentials_home", return_value=True)
    r = client.put(f"/api/players/{VALID_UUID}/homes/home", headers=headers,
                   json={"x": 1, "y": 2, "z": 3, "world": "world", "new_name": " casa "})
    assert r.status_code == 200
    update.assert_called_once_with(VALID_UUID, "home", 1.0, 2.0, 3.0, "world", "casa")


@pytest.mark.parametrize("method", ["put", "delete"])
def test_homes_mutations_forbidden_when_not_owner(client, mocker, method):
    """PUT and DELETE are ownership-gated like GET and POST (403)."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.ownership._user_owns_player", return_value=False)
    r = getattr(client, method)(f"/api/players/{VALID_UUID}/homes/h", headers={"Authorization": "Bearer t"},
                                json={"x": 1, "y": 1, "z": 1, "world": "w"})
    assert r.status_code == 403


@pytest.mark.parametrize("method", ["post", "put", "delete"])
def test_homes_mutations_reject_invalid_uuid(client, mocker, method):
    """Malformed UUIDs are rejected (400) before any ownership lookup."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    owns = mocker.patch("api.ownership._user_owns_player", return_value=True)
    path = "/api/players/not-a-uuid/homes" + ("" if method == "post" else "/h")
    r = getattr(client, method)(path, headers={"Authorization": "Bearer t"},
                                json={"name": "h", "x": 1, "y": 1, "z": 1, "world": "w"})
    assert r.status_code == 400
    owns.assert_not_called()
