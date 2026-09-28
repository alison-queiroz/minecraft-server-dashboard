"""Hardening tests across the API app (api/server_api.py) and its blueprints
(api/routes/): JSON error bodies, the request size cap, lazy Firebase init
behind optional auth, the atomic services-catalog write, force-resync admin
gating/cooldown, the internal-secret comparison, and /api/backups folder
confinement + Drive caching."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import pytest

import api.auth as auth
import api.firebase_init as fb_init
import api.server_api as srv
from api.routes import backups, catalog, players, status
from api.server_api import app

AUTH = {"Authorization": "Bearer t"}


@pytest.fixture
def client():
    """Provides a test client for the Flask application."""
    app.config["TESTING"] = True
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _reset_shared_state():
    """Reset Firebase init state and the status cache around every test."""
    def _reset() -> None:
        fb_init._reset_for_tests()
        auth._FIREBASE_INITIALIZED = False
        status._STATUS_CACHE.clear()
    _reset()
    yield
    _reset()


def _sign_in(mocker, uid: str = "user") -> None:
    """Treat every Bearer token as a valid Firebase token for `uid`."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": uid})


# ── JSON error bodies ────────────────────────────────────────────────────────

def test_unauthorized_returns_json_error(client, mocker):
    """A missing token yields a 401 with a JSON error body, not an HTML page."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    response = client.get("/api/players")
    assert response.status_code == 401
    assert response.is_json
    assert response.json == {"error": "Unauthorized"}


def test_firebase_unavailable_returns_json_error(client, mocker):
    """The 503 raised when Firebase cannot initialize is a JSON body too."""
    mocker.patch("api.auth.ensure_initialized", return_value=False)
    response = client.get("/api/players")
    assert response.status_code == 503
    assert response.json == {"error": "Service Unavailable"}


def test_bad_request_returns_json_error(client, mocker):
    """abort(400) from a handler is rendered as JSON."""
    _sign_in(mocker)
    response = client.get("/api/players/not-a-uuid/homes", headers=AUTH)
    assert response.status_code == 400
    assert response.json == {"error": "Bad Request"}


def test_forbidden_returns_json_error(client, mocker):
    """abort(403) from a handler is rendered as JSON."""
    _sign_in(mocker, "viewer")
    mocker.patch("api.auth._services_admin_uids", return_value={"editor"})
    response = client.put("/api/services-catalog", headers=AUTH, json={})
    assert response.status_code == 403
    assert response.json == {"error": "Forbidden"}


def test_unknown_route_returns_json_404(client):
    """Unknown API paths return a JSON 404."""
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json == {"error": "Not Found"}


def test_wrong_method_returns_json_405_and_keeps_allow_header(client):
    """A 405 is JSON and still advertises the allowed methods."""
    response = client.get("/api/players/force-resync")
    assert response.status_code == 405
    assert response.json == {"error": "Method Not Allowed"}
    assert "POST" in response.headers["Allow"]


def test_conflict_returns_json_error(client, mocker):
    """abort(409) from a handler is rendered as JSON."""
    _sign_in(mocker)
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    mocker.patch("api.routes.players.create_essentials_home", return_value=False)
    response = client.post(
        "/api/players/069a79f4-44e9-4726-a5be-fca90e38aaf5/homes",
        headers=AUTH,
        json={"name": "base", "x": 1, "y": 2, "z": 3, "world": "world"},
    )
    assert response.status_code == 409
    assert response.json == {"error": "Conflict"}


def test_existing_custom_json_error_bodies_are_unchanged(client, mocker):
    """Handlers that already return their own JSON error keep that body."""
    _sign_in(mocker)
    response = client.get("/api/advancements/not-a-uuid", headers=AUTH)
    assert response.status_code == 400
    assert response.json == {"error": "Invalid UUID"}


def test_unhandled_exception_returns_generic_json_500(client, mocker):
    """An unexpected exception becomes a JSON 500 that does not leak its message."""
    _sign_in(mocker)
    mocker.patch.dict(app.config, {"PROPAGATE_EXCEPTIONS": False})
    mocker.patch("api.routes.players.get_players", side_effect=RuntimeError("/home/opc/secret-path"))
    response = client.get("/api/players", headers=AUTH)
    assert response.status_code == 500
    assert response.json == {"error": "Internal Server Error"}
    assert b"secret-path" not in response.data


# ── Request size cap ─────────────────────────────────────────────────────────

def test_max_content_length_leaves_headroom_for_services_catalog():
    """The body cap is far above the size of the real services catalog."""
    catalog = Path(srv.__file__).resolve().parents[1] / "src" / "assets" / "services-catalog.json"
    assert app.config["MAX_CONTENT_LENGTH"] >= 50 * catalog.stat().st_size


def test_oversized_body_returns_json_413(client, mocker, tmp_path):
    """A body above MAX_CONTENT_LENGTH is rejected with a JSON 413 and nothing is written."""
    _sign_in(mocker, "editor")
    mocker.patch("api.auth._services_admin_uids", return_value={"editor"})
    catalog_path = tmp_path / "services-catalog.json"
    mocker.patch("api.routes.catalog._services_catalog_path", return_value=catalog_path)
    huge = "x" * (app.config["MAX_CONTENT_LENGTH"] + 1)
    response = client.put(
        "/api/services-catalog", headers=AUTH, json={"updatedAt": huge, "sections": []}
    )
    assert response.status_code == 413
    assert response.json == {"error": "Request Entity Too Large"}
    assert not catalog_path.exists()


# ── _optional_uid (public /api/status roster) ────────────────────────────────

_STATUS_WITH_ROSTER = {
    "online": True,
    "players": {"online": 1, "max": 20, "sample": [{"name": "Steve", "id": "abc"}]},
}


def _serve_status_with_roster(mocker) -> None:
    mocker.patch("api.routes.status._cached_status", side_effect=lambda key, fn: dict(_STATUS_WITH_ROSTER))


def test_optional_uid_anonymous_skips_firebase_init(client, mocker):
    """Anonymous callers never trigger Firebase init and get the roster stripped."""
    _serve_status_with_roster(mocker)
    init = mocker.patch("api.auth.ensure_initialized", return_value=True)
    response = client.get("/api/status")
    assert response.json["players"]["sample"] is None
    init.assert_not_called()


def test_optional_uid_strips_roster_when_firebase_unavailable(client, mocker):
    """A Bearer token cannot be verified while Firebase is down, so the roster is stripped."""
    _serve_status_with_roster(mocker)
    mocker.patch("api.auth.ensure_initialized", return_value=False)
    verify = mocker.patch("firebase_admin.auth.verify_id_token")
    response = client.get("/api/status", headers=AUTH)
    assert response.json["players"]["sample"] is None
    verify.assert_not_called()


def test_optional_uid_strips_roster_for_invalid_token(client, mocker):
    """An invalid token after a successful lazy init is treated as anonymous."""
    _serve_status_with_roster(mocker)
    mocker.patch("api.auth.ensure_initialized", return_value=True)
    mocker.patch("firebase_admin.auth.verify_id_token", side_effect=ValueError("bad token"))
    response = client.get("/api/status", headers=AUTH)
    assert response.json["players"]["sample"] is None
    assert auth._FIREBASE_INITIALIZED is True


# ── Atomic services-catalog write ────────────────────────────────────────────

_CATALOG = {"updatedAt": "2026-09-28", "sections": []}


def _as_catalog_admin(mocker, catalog_path) -> None:
    _sign_in(mocker, "editor")
    mocker.patch("api.auth._services_admin_uids", return_value={"editor"})
    mocker.patch("api.routes.catalog._services_catalog_path", return_value=catalog_path)


def test_catalog_put_replaces_file_atomically(client, mocker, tmp_path):
    """The PUT writes a sibling temp file, swaps it in with os.replace and leaves no temp behind."""
    catalog_path = tmp_path / "services-catalog.json"
    catalog_path.write_text('{"updatedAt": "old", "sections": []}\n', encoding="utf-8")
    _as_catalog_admin(mocker, catalog_path)
    replace = mocker.spy(catalog.os, "replace")

    response = client.put("/api/services-catalog", headers=AUTH, json=_CATALOG)

    assert response.status_code == 200
    src, dst = replace.call_args.args
    assert dst == catalog_path
    assert Path(src).parent == catalog_path.parent
    assert json.loads(catalog_path.read_text(encoding="utf-8")) == _CATALOG
    assert [p.name for p in tmp_path.iterdir()] == ["services-catalog.json"]


def test_catalog_put_failed_replace_keeps_original_and_cleans_temp(client, mocker, tmp_path):
    """If the swap fails the original catalog is untouched, the temp file is removed and a JSON 500 is returned."""
    catalog_path = tmp_path / "services-catalog.json"
    original = '{"updatedAt": "old", "sections": []}\n'
    catalog_path.write_text(original, encoding="utf-8")
    _as_catalog_admin(mocker, catalog_path)
    mocker.patch.object(catalog.os, "replace", side_effect=OSError("disk full"))

    response = client.put("/api/services-catalog", headers=AUTH, json=_CATALOG)

    assert response.status_code == 500
    assert response.json == {"error": "Failed to write services catalog"}
    assert catalog_path.read_text(encoding="utf-8") == original
    assert [p.name for p in tmp_path.iterdir()] == ["services-catalog.json"]


def test_write_json_atomic_serialization_error_keeps_original(tmp_path):
    """A payload that fails mid-serialization never truncates the target file."""
    target = tmp_path / "catalog.json"
    target.write_text("{}", encoding="utf-8")
    with pytest.raises(TypeError):
        catalog._write_json_atomic(target, {"ok": 1, "bad": object()})
    assert target.read_text(encoding="utf-8") == "{}"
    assert [p.name for p in tmp_path.iterdir()] == ["catalog.json"]


def test_write_json_atomic_preserves_existing_mode(mocker, tmp_path):
    """The replacement file gets the old file's permission bits (temp files start as 0600)."""
    import stat
    target = tmp_path / "catalog.json"
    target.write_text("{}", encoding="utf-8")
    expected = stat.S_IMODE(target.stat().st_mode)
    chmod = mocker.spy(catalog.os, "chmod")
    catalog._write_json_atomic(target, {"a": 1})
    assert chmod.call_args.args[1] == expected


def test_write_json_atomic_writes_through_symlink(tmp_path):
    """A symlinked catalog path keeps its link; the file it points to is replaced."""
    import os
    real = tmp_path / "real" / "catalog.json"
    real.parent.mkdir()
    real.write_text("{}", encoding="utf-8")
    link = tmp_path / "catalog-link.json"
    try:
        os.symlink(real, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not available on this platform/account")
    catalog._write_json_atomic(link, {"a": 1})
    assert link.is_symlink()
    assert json.loads(real.read_text(encoding="utf-8")) == {"a": 1}


def test_write_json_atomic_new_file_is_world_readable(mocker, tmp_path):
    """A brand-new file (in a directory created on demand) is written as 0644."""
    target = tmp_path / "nested" / "catalog.json"
    chmod = mocker.spy(catalog.os, "chmod")
    catalog._write_json_atomic(target, {"a": 1})
    assert chmod.call_args.args[1] == 0o644
    assert json.loads(target.read_text(encoding="utf-8")) == {"a": 1}


# ── /api/internal/force-resync secret comparison ─────────────────────────────

def test_internal_force_resync_non_ascii_secret_header_is_403(client, mocker):
    """A non-ASCII X-Internal-Secret is rejected with 403 instead of crashing compare_digest."""
    mocker.patch.dict("os.environ", {"INTERNAL_API_SECRET": "s3cret"})
    rescan = mocker.patch("api.routes.players.get_players")
    response = client.post("/api/internal/force-resync", headers={"X-Internal-Secret": "s3crét"})
    assert response.status_code == 403
    assert response.json == {"error": "Forbidden"}
    rescan.assert_not_called()


# ── /api/players/force-resync: admins only + cooldown ────────────────────────

def _stub_resync_body(mocker):
    """Stub the cache-invalidation + rescan the endpoint performs; returns the get_players mock."""
    mocker.patch("api.routes.players.invalidate_caches")
    return mocker.patch("api.routes.players.get_players", return_value=[{"name": "Steve"}])


def _fake_monotonic(mocker, start: float = 1000.0) -> list:
    clock = [start]
    mocker.patch("api.routes.players.time.monotonic", side_effect=lambda: clock[0])
    return clock


def test_force_resync_requires_auth(client, mocker):
    """Without a token the endpoint is a 401 before any admin/cooldown logic."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    rescan = _stub_resync_body(mocker)
    response = client.post("/api/players/force-resync")
    assert response.status_code == 401
    rescan.assert_not_called()


def test_force_resync_forbidden_for_non_admin(client, mocker):
    """A signed-in user who is not an admin gets a JSON 403 and no rescan runs."""
    _sign_in(mocker, "player")
    mocker.patch.dict("os.environ", {"ADMIN_UIDS": "admin-1"})
    rescan = _stub_resync_body(mocker)
    response = client.post("/api/players/force-resync", headers=AUTH)
    assert response.status_code == 403
    assert response.json == {"error": "Forbidden"}
    rescan.assert_not_called()


def test_force_resync_allows_admin_uids(client, mocker):
    """A uid listed in ADMIN_UIDS may resync."""
    _sign_in(mocker, "admin-2")
    mocker.patch.dict("os.environ", {"ADMIN_UIDS": "admin-1, admin-2"})
    _stub_resync_body(mocker)
    response = client.post("/api/players/force-resync", headers=AUTH)
    assert response.status_code == 200
    assert response.json == {"ok": True, "players": 1}


@pytest.mark.parametrize("admin_uids_env", [None, "", " , "])
def test_admin_uids_fall_back_to_services_catalog_admins(monkeypatch, admin_uids_env):
    """ADMIN_UIDS unset or blank falls back to SERVICES_CATALOG_ADMIN_UIDS."""
    monkeypatch.setenv("SERVICES_CATALOG_ADMIN_UIDS", "editor")
    if admin_uids_env is None:
        monkeypatch.delenv("ADMIN_UIDS", raising=False)
    else:
        monkeypatch.setenv("ADMIN_UIDS", admin_uids_env)
    assert auth._admin_uids() == {"editor"}


def test_admin_uids_take_precedence_over_services_catalog_admins(client, mocker):
    """When ADMIN_UIDS is set, catalog editors outside it cannot resync."""
    _sign_in(mocker, "editor")
    mocker.patch.dict("os.environ", {"ADMIN_UIDS": "admin-1", "SERVICES_CATALOG_ADMIN_UIDS": "editor"})
    rescan = _stub_resync_body(mocker)
    response = client.post("/api/players/force-resync", headers=AUTH)
    assert response.status_code == 403
    rescan.assert_not_called()


def test_services_catalog_edit_rights_ignore_admin_uids(client, mocker, tmp_path):
    """ADMIN_UIDS does not grant services-catalog edit rights (unchanged behaviour)."""
    _sign_in(mocker, "admin-1")
    mocker.patch.dict("os.environ", {"ADMIN_UIDS": "admin-1", "SERVICES_CATALOG_ADMIN_UIDS": "editor"})
    catalog_path = tmp_path / "services-catalog.json"
    catalog_path.write_text(json.dumps(_CATALOG), encoding="utf-8")
    mocker.patch("api.routes.catalog._services_catalog_path", return_value=catalog_path)
    assert client.get("/api/services-catalog", headers=AUTH).json["canEdit"] is False
    assert client.put("/api/services-catalog", headers=AUTH, json=_CATALOG).status_code == 403


def test_force_resync_cooldown_returns_429_with_retry_after(client, mocker):
    """A second resync inside the cooldown is a JSON 429 with Retry-After; the rescan runs once."""
    _sign_in(mocker, "admin-1")
    mocker.patch.dict("os.environ", {"ADMIN_UIDS": "admin-1"})
    rescan = _stub_resync_body(mocker)
    clock = _fake_monotonic(mocker)

    assert client.post("/api/players/force-resync", headers=AUTH).status_code == 200
    clock[0] += 15.5
    response = client.post("/api/players/force-resync", headers=AUTH)

    assert response.status_code == 429
    assert response.json == {"error": "Too Many Requests"}
    assert response.headers["Retry-After"] == "45"
    assert rescan.call_count == 1


def test_force_resync_allowed_again_after_cooldown(client, mocker):
    """Once the cooldown has elapsed the next resync runs."""
    _sign_in(mocker, "admin-1")
    mocker.patch.dict("os.environ", {"ADMIN_UIDS": "admin-1"})
    rescan = _stub_resync_body(mocker)
    clock = _fake_monotonic(mocker)

    assert client.post("/api/players/force-resync", headers=AUTH).status_code == 200
    clock[0] += players._RESYNC_COOLDOWN
    assert client.post("/api/players/force-resync", headers=AUTH).status_code == 200
    assert rescan.call_count == 2


def test_force_resync_rejected_callers_do_not_start_the_cooldown(client, mocker):
    """A non-admin's 403 does not consume the cooldown window for admins."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch.dict("os.environ", {"ADMIN_UIDS": "admin-1"})
    verify = mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "player"})
    _stub_resync_body(mocker)
    _fake_monotonic(mocker)

    assert client.post("/api/players/force-resync", headers=AUTH).status_code == 403
    verify.return_value = {"uid": "admin-1"}
    assert client.post("/api/players/force-resync", headers=AUTH).status_code == 200


# ── /api/backups: folderId validation + confinement to the Drive root ───────

ROOT = "ROOT_folder_0001"


def _http_error(status: int):
    import httplib2
    from googleapiclient.errors import HttpError
    return HttpError(httplib2.Response({"status": status}), b"drive error")


class _FakeDrive:
    """Stand-in for the Drive v3 client: a parent map plus per-folder listings.
    Ids missing from `parents` answer files.get with a 404, like Drive does for
    items the service account cannot see; `errors` forces other statuses."""

    def __init__(self, parents: dict, listings: dict):
        from types import SimpleNamespace
        self._request = lambda fn: SimpleNamespace(execute=fn)
        self.parents = parents
        self.listings = listings
        self.errors: dict = {}
        self.get_calls: list = []
        self.list_queries: list = []

    def files(self) -> "_FakeDrive":
        return self

    def get(self, fileId: str, fields: str, supportsAllDrives: bool):
        assert fields == "parents"
        self.get_calls.append(fileId)

        def execute() -> dict:
            if fileId in self.errors:
                raise _http_error(self.errors[fileId])
            if fileId not in self.parents:
                raise _http_error(404)
            return {"parents": self.parents[fileId]}
        return self._request(execute)

    def list(self, q: str, fields: str, orderBy: str):
        self.list_queries.append(q)
        folder = q.split("'")[1]
        return self._request(lambda: {"files": self.listings.get(folder, [])})


def _drive(mocker, parents: Optional[dict] = None, listings: Optional[dict] = None) -> _FakeDrive:
    """Sign in, point DRIVE_FOLDER_ID at ROOT and serve Drive calls from a fake."""
    _sign_in(mocker)
    mocker.patch.dict("os.environ", {"DRIVE_FOLDER_ID": ROOT, "DRIVE_SA_KEY": "/nonexistent/sa.json"})
    mocker.patch("api.routes.backups.service_account.Credentials.from_service_account_file")
    fake = _FakeDrive(parents or {}, listings or {})
    mocker.patch("api.routes.backups.build", return_value=fake)
    return fake


def _backups(client, folder_id=None):
    query = {} if folder_id is None else {"folderId": folder_id}
    return client.get("/api/backups", headers=AUTH, query_string=query)


@pytest.mark.parametrize("folder_id", [None, "", ROOT])
def test_backups_root_listing_needs_no_ancestry_lookup(client, mocker, folder_id):
    """No folderId, an empty one or the root id itself list the root without any files.get call."""
    fake = _drive(mocker, listings={ROOT: [{"id": "f1", "name": "world.zip"}]})
    response = _backups(client, folder_id)
    assert response.status_code == 200
    assert response.json == [{"id": "f1", "name": "world.zip"}]
    assert fake.get_calls == []
    assert fake.list_queries == [f"'{ROOT}' in parents and trashed = false"]


@pytest.mark.parametrize("folder_id", [
    "abc' in parents or name contains '",
    "x' or trashed = true or 'y",
    "short",
    "valid_looking_id\n",
    "has space in_it",
    "a" * 129,
])
def test_backups_rejects_malformed_folder_id(client, mocker, folder_id):
    """A folderId that is not a plain Drive id is a JSON 400 and never reaches Drive."""
    fake = _drive(mocker)
    response = _backups(client, folder_id)
    assert response.status_code == 400
    assert response.json == {"error": "Invalid folderId"}
    assert fake.get_calls == [] and fake.list_queries == []


def test_backups_lists_nested_descendant_of_root(client, mocker):
    """A folder two levels under the root is verified by walking its parents, then listed."""
    fake = _drive(
        mocker,
        parents={"childFolder_01": ["midFolder_001"], "midFolder_001": [ROOT]},
        listings={"childFolder_01": [{"id": "b1", "name": "backup.zip"}]},
    )
    response = _backups(client, "childFolder_01")
    assert response.status_code == 200
    assert response.json == [{"id": "b1", "name": "backup.zip"}]
    assert fake.get_calls == ["childFolder_01", "midFolder_001"]


def test_backups_accepts_any_parent_being_the_root(client, mocker):
    """A legacy multi-parent folder is accepted when the root is any of its parents."""
    fake = _drive(mocker, parents={"multiParent_01": ["elsewhere_0001", ROOT]})
    assert _backups(client, "multiParent_01").status_code == 200
    assert fake.get_calls == ["multiParent_01"]


def test_backups_forbids_folder_outside_root(client, mocker):
    """A folder whose ancestry never reaches the root is a JSON 403 and is not listed."""
    fake = _drive(mocker, parents={"foreignFolder1": ["otherRoot_0001"], "otherRoot_0001": []})
    response = _backups(client, "foreignFolder1")
    assert response.status_code == 403
    assert response.json == {"error": "Folder is outside the backups root"}
    assert fake.list_queries == []


def test_backups_forbids_folder_unknown_to_service_account(client, mocker):
    """A folder Drive answers with 404 for is treated as outside the root (403)."""
    fake = _drive(mocker)
    response = _backups(client, "missingFolder1")
    assert response.status_code == 403
    assert fake.get_calls == ["missingFolder1"]
    assert fake.list_queries == []


def test_backups_ancestry_walk_is_depth_bounded(client, mocker):
    """A parent chain deeper than _DRIVE_MAX_DEPTH is refused after exactly that many lookups."""
    depth = backups._DRIVE_MAX_DEPTH
    chain = [f"deepFolder_{i:04d}" for i in range(depth + 1)]
    parents = {chain[i]: [chain[i + 1]] for i in range(depth)}
    parents[chain[-1]] = [ROOT]
    fake = _drive(mocker, parents=parents)
    response = _backups(client, chain[0])
    assert response.status_code == 403
    assert fake.get_calls == chain[:depth]


def test_backups_known_folder_skips_ancestry_lookups(client, mocker):
    """Once verified, a folder (and its path) is trusted without new files.get calls."""
    fake = _drive(mocker, parents={
        "childFolder_01": ["midFolder_001"],
        "midFolder_001": [ROOT],
        "grandchild_001": ["childFolder_01"],
    })
    assert _backups(client, "childFolder_01").status_code == 200
    fake.get_calls.clear()

    assert _backups(client, "midFolder_001").status_code == 200
    assert fake.get_calls == []
    assert _backups(client, "grandchild_001").status_code == 200
    assert fake.get_calls == ["grandchild_001"]


def test_backups_known_folder_expires(client, mocker):
    """A verified folder is re-checked against Drive after _DRIVE_KNOWN_FOLDER_TTL."""
    fake = _drive(mocker, parents={"childFolder_01": [ROOT]})
    clock = [5000.0]
    mocker.patch("api.routes.backups.time.time", side_effect=lambda: clock[0])
    assert _backups(client, "childFolder_01").status_code == 200
    clock[0] += backups._DRIVE_KNOWN_FOLDER_TTL
    assert _backups(client, "childFolder_01").status_code == 200
    assert fake.get_calls == ["childFolder_01", "childFolder_01"]


def test_backups_drive_error_during_ancestry_check_is_500(client, mocker):
    """A non-404 Drive failure while checking ancestry is a generic JSON 500, not a 403."""
    fake = _drive(mocker)
    fake.errors["childFolder_01"] = 503
    response = _backups(client, "childFolder_01")
    assert response.status_code == 500
    assert response.json == {"error": "Failed to fetch backups"}


# ── /api/backups: cached Drive client + listings ─────────────────────────────

def test_backups_builds_credentials_and_client_once(client, mocker):
    """Credentials and the Drive client are built on the first request and then reused."""
    _drive(mocker, parents={"childFolder_01": [ROOT]})
    for folder in (None, "childFolder_01", None):
        assert _backups(client, folder).status_code == 200
    assert backups.service_account.Credentials.from_service_account_file.call_count == 1
    assert backups.build.call_count == 1


def test_backups_listing_cache_hit_skips_drive(client, mocker):
    """A second request for the same folder inside the TTL is served from memory."""
    fake = _drive(mocker, listings={ROOT: [{"id": "f1"}]})
    first = _backups(client)
    fake.listings[ROOT] = [{"id": "changed"}]
    second = _backups(client)
    assert first.json == second.json == [{"id": "f1"}]
    assert len(fake.list_queries) == 1


def test_backups_listing_cache_is_per_folder_and_expires(client, mocker):
    """Listings are cached per folder id and refetched once _DRIVE_LISTING_TTL has passed."""
    fake = _drive(mocker, parents={"childFolder_01": [ROOT]}, listings={ROOT: [{"id": "r"}]})
    clock = [5000.0]
    mocker.patch("api.routes.backups.time.time", side_effect=lambda: clock[0])
    _backups(client)
    _backups(client, "childFolder_01")
    assert len(fake.list_queries) == 2

    clock[0] += backups._DRIVE_LISTING_TTL - 1
    _backups(client)
    assert len(fake.list_queries) == 2
    clock[0] += 1
    fake.listings[ROOT] = [{"id": "new"}]
    assert _backups(client).json == [{"id": "new"}]
    assert len(fake.list_queries) == 3


def test_backups_missing_credentials_are_retried(client, mocker):
    """A missing key file is not cached: once it appears the next request succeeds."""
    fake = _drive(mocker, listings={ROOT: [{"id": "f1"}]})
    creds = backups.service_account.Credentials.from_service_account_file
    creds.side_effect = FileNotFoundError("no key yet")
    assert _backups(client).status_code == 500
    creds.side_effect = None
    response = _backups(client)
    assert response.status_code == 200
    assert response.json == [{"id": "f1"}]
    assert len(fake.list_queries) == 1


def test_drive_service_lazy_init_is_thread_safe(mocker):
    """Concurrent first calls build exactly one Drive client and all share it."""
    import threading
    import time as real_time

    mocker.patch("api.routes.backups.service_account.Credentials.from_service_account_file")
    client_obj = object()

    def slow_build(*_args, **_kwargs):
        real_time.sleep(0.05)
        return client_obj
    build = mocker.patch("api.routes.backups.build", side_effect=slow_build)

    results: list = []
    barrier = threading.Barrier(4)

    def worker() -> None:
        barrier.wait()
        results.append(backups._drive_service())
    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert build.call_count == 1
    assert results == [client_obj] * 4


def test_backups_dev_mode_missing_credentials_returns_empty_list(mocker):
    """With Firebase uninitialized (dev mode) missing Drive credentials still yield []."""
    mocker.patch(
        "api.routes.backups.service_account.Credentials.from_service_account_file",
        side_effect=FileNotFoundError("no key"),
    )
    view = backups.backups_endpoint.__wrapped__
    with app.test_request_context("/api/backups"):
        response = view()
    assert response.status_code == 200
    assert response.json == []
