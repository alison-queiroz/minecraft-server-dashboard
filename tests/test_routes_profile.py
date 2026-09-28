"""Tests for api/routes/profile.py: the route-guard /api/profile check, the
caller's homes with their visibility (listing and toggling, incl. the legacy
savedHomes fallback) and the public player card."""
import pytest

import api.ownership as ownership
from route_fakes import (
    ALEX_UUID,
    BEDROCK_UUID,
    VALID_UUID,
    _USERCACHE,
    _auth,
    _fake_firestore,
    _homes_of,
)

pytestmark = pytest.mark.usefixtures("route_state")


# ── /api/profile (route-guard access check) ──────────────────────────────────

def _mock_profile_firestore(mocker, minecraft_accounts):
    """Patch firebase_admin.firestore.client so users/{uid} returns the given
    minecraftAccounts dict (or None to simulate a missing profile doc)."""
    from unittest.mock import MagicMock
    snap = MagicMock()
    snap.exists = minecraft_accounts is not None
    snap.to_dict.return_value = (
        {"minecraftAccounts": minecraft_accounts} if minecraft_accounts is not None else None
    )
    db = MagicMock()
    db.collection.return_value.document.return_value.get.return_value = snap
    mocker.patch("firebase_admin.firestore.client", return_value=db)


def test_profile_endpoint_unauthorized(client, mocker):
    """Returns 401 when no token is provided."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    response = client.get("/api/profile")
    assert response.status_code == 401


def test_profile_endpoint_reports_linked_account(client, mocker):
    """A user with any linked account gets hasLinkedAccount=True."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user-1"})
    _mock_profile_firestore(mocker, {"java": "Steve", "bedrock": None, "admin": None})

    response = client.get("/api/profile", headers={"Authorization": "Bearer t"})

    assert response.status_code == 200
    assert response.json["hasLinkedAccount"] is True
    # Account names are NOT shipped here — the guard only needs the boolean.
    assert "minecraftAccounts" not in response.json


def test_profile_endpoint_reports_no_linked_account(client, mocker):
    """A user with no linked accounts gets hasLinkedAccount=False."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user-2"})
    _mock_profile_firestore(mocker, {"java": None, "bedrock": None, "admin": None})

    response = client.get("/api/profile", headers={"Authorization": "Bearer t"})

    assert response.status_code == 200
    assert response.json["hasLinkedAccount"] is False


def test_profile_endpoint_missing_doc_reports_no_linked_account(client, mocker):
    """A brand-new user with no profile doc yet gets hasLinkedAccount=False."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "new-user"})
    _mock_profile_firestore(mocker, None)

    response = client.get("/api/profile", headers={"Authorization": "Bearer t"})

    assert response.status_code == 200
    assert response.json["hasLinkedAccount"] is False


def test_profile_endpoint_firestore_error_returns_503(client, mocker):
    """A Firestore failure is surfaced as 503 (guard then fails closed → login)."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "user-3"})
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("no firestore"))

    response = client.get("/api/profile", headers={"Authorization": "Bearer t"})

    assert response.status_code == 503


# ── homes visibility: GET /api/profile/homes ─────────────────────────────────

def test_profile_homes_unauthorized(client, mocker):
    """No token → 401."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    assert client.get("/api/profile/homes").status_code == 401


def test_profile_homes_groups_by_linked_java_account(client, mocker):
    """Homes come grouped per linked java/admin account with their visibility;
    Bedrock accounts and names missing from usercache are skipped."""
    headers = _auth(mocker, "user-1")
    _fake_firestore(mocker, {"users/user-1": {
        "minecraftAccounts": {"java": "steve", "bedrock": ".Bedrocker", "admin": "Alex"},
        "publicHomes": {VALID_UUID: ["base"]},
    }}, usercache=_USERCACHE)
    read = mocker.patch("api.routes.profile.read_essentials_homes", side_effect=_homes_of("home", "base"))

    r = client.get("/api/profile/homes", headers=headers)

    assert r.status_code == 200
    accounts = r.json["accounts"]
    assert [(a["type"], a["name"], a["uuid"]) for a in accounts] == [
        ("java", "Steve", VALID_UUID), ("admin", "Alex", ALEX_UUID),
    ]
    assert [(h["name"], h["isPublic"]) for h in accounts[0]["homes"]] == [("home", False), ("base", True)]
    assert all(not h["isPublic"] for h in accounts[1]["homes"])
    assert BEDROCK_UUID not in [c.args[0] for c in read.call_args_list]


def test_profile_homes_dedupes_same_player_in_two_slots(client, mocker):
    """The same player linked as java and admin appears once."""
    headers = _auth(mocker, "user-1")
    _fake_firestore(mocker, {"users/user-1": {"minecraftAccounts": {"java": "Steve", "admin": "Steve"}}},
                    usercache=_USERCACHE)
    mocker.patch("api.routes.profile.read_essentials_homes", side_effect=_homes_of("home"))
    r = client.get("/api/profile/homes", headers=headers)
    assert [a["uuid"] for a in r.json["accounts"]] == [VALID_UUID]


def test_profile_homes_without_links_is_empty(client, mocker):
    """A profile with no Java-resolvable account has no home groups."""
    headers = _auth(mocker, "user-1")
    _fake_firestore(mocker, {"users/user-1": {"minecraftAccounts": {"java": "Ghost"}}}, usercache=_USERCACHE)
    read = mocker.patch("api.routes.profile.read_essentials_homes")
    r = client.get("/api/profile/homes", headers=headers)
    assert r.json == {"accounts": []}
    read.assert_not_called()


def test_profile_homes_legacy_single_account_visibility(client, mocker):
    """Old browser-written savedHomes still decide visibility (single account:
    unprefixed names) until publicHomes is written."""
    headers = _auth(mocker, "user-1")
    _fake_firestore(mocker, {"users/user-1": {
        "minecraftAccounts": {"java": "Steve"},
        "savedHomes": [
            {"name": "home", "isPublic": True}, {"name": "base", "isPublic": False}, "junk",
        ],
    }}, usercache=_USERCACHE)
    mocker.patch("api.routes.profile.read_essentials_homes", side_effect=_homes_of("home", "base"))
    r = client.get("/api/profile/homes", headers=headers)
    assert [(h["name"], h["isPublic"]) for h in r.json["accounts"][0]["homes"]] == [
        ("home", True), ("base", False),
    ]


def test_profile_homes_legacy_prefixed_names_with_several_accounts(client, mocker):
    """With several accounts the old "Player:" prefixes map to each player and
    unprefixed legacy names stay private."""
    headers = _auth(mocker, "user-1")
    _fake_firestore(mocker, {"users/user-1": {
        "minecraftAccounts": {"java": "Steve", "admin": "Alex"},
        "savedHomes": [
            {"name": "Steve:home", "isPublic": True},
            {"name": "Alex:farm", "isPublic": True},
            {"name": "base", "isPublic": True},
        ],
    }}, usercache=_USERCACHE)
    mocker.patch("api.routes.profile.read_essentials_homes", side_effect=_homes_of("home", "farm", "base"))
    r = client.get("/api/profile/homes", headers=headers)
    steve, alex = r.json["accounts"]
    assert [h["name"] for h in steve["homes"] if h["isPublic"]] == ["home"]
    assert [h["name"] for h in alex["homes"] if h["isPublic"]] == ["farm"]


def test_profile_homes_firestore_failure_returns_503(client, mocker):
    """A Firestore failure is 503."""
    headers = _auth(mocker)
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("down"))
    assert client.get("/api/profile/homes", headers=headers).status_code == 503


# ── PUT /api/profile/homes/visibility ────────────────────────────────────────

def _visibility(client, headers, homes):
    return client.put("/api/profile/homes/visibility", headers=headers, json={"homes": homes})


def test_home_visibility_unauthorized(client, mocker):
    """No token → 401."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    assert client.put("/api/profile/homes/visibility", json={}).status_code == 401


@pytest.mark.parametrize("body", [
    {},
    {"homes": "home"},
    {"homes": []},
    {"homes": [{"uuid": VALID_UUID, "name": "h", "isPublic": True}] * 201},
    {"homes": ["h"]},
    {"homes": [{"uuid": 5, "name": "h", "isPublic": True}]},
    {"homes": [{"uuid": VALID_UUID, "name": "", "isPublic": True}]},
    {"homes": [{"uuid": VALID_UUID, "name": "h" * 65, "isPublic": True}]},
    {"homes": [{"uuid": VALID_UUID, "name": "h", "isPublic": "yes"}]},
    {"homes": [{"uuid": "not-a-uuid", "name": "h", "isPublic": True}]},
])
def test_home_visibility_rejects_invalid_body(client, mocker, body):
    """Malformed change lists are 400 and nothing is written."""
    headers = _auth(mocker, "user-1")
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    store = _fake_firestore(mocker)
    r = client.put("/api/profile/homes/visibility", headers=headers, json=body)
    assert r.status_code == 400
    assert store.docs == {}


def test_home_visibility_forbidden_for_foreign_player(client, mocker):
    """Every uuid must be the caller's own player (403, nothing written)."""
    headers = _auth(mocker, "user-1")
    mocker.patch("api.ownership._user_owns_player", side_effect=lambda u: u == VALID_UUID)
    store = _fake_firestore(mocker)
    r = _visibility(client, headers, [
        {"uuid": VALID_UUID, "name": "home", "isPublic": True},
        {"uuid": ALEX_UUID, "name": "farm", "isPublic": True},
    ])
    assert r.status_code == 403
    assert store.docs == {}


def test_home_visibility_fails_closed_when_ownership_unknown(client, mocker):
    """Ownership lookups that can't complete answer 503."""
    headers = _auth(mocker, "user-1")
    mocker.patch("api.ownership._user_owns_player", side_effect=ownership._OwnershipUnavailable("u"))
    r = _visibility(client, headers, [{"uuid": VALID_UUID, "name": "home", "isPublic": True}])
    assert r.status_code == 503


def test_home_visibility_updates_public_set(client, mocker):
    """Changes are applied on top of the effective set (seeded from legacy
    savedHomes) and stored per player UUID; other players are untouched."""
    headers = _auth(mocker, "user-1")
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    store = _fake_firestore(mocker, {"users/user-1": {
        "minecraftAccounts": {"java": "Steve", "admin": "Alex"},
        "savedHomes": [{"name": "Steve:home", "isPublic": True}, {"name": "Steve:old", "isPublic": True}],
        "publicHomes": {ALEX_UUID: ["farm"]},
    }}, usercache=_USERCACHE)
    r = _visibility(client, headers, [
        {"uuid": VALID_UUID, "name": "base", "isPublic": True},
        {"uuid": VALID_UUID, "name": "old", "isPublic": False},
    ])
    assert r.status_code == 200
    assert r.json == {"ok": True}
    assert store.docs["users/user-1"]["publicHomes"] == {VALID_UUID: ["base", "home"], ALEX_UUID: ["farm"]}


def test_home_visibility_firestore_failure_returns_503(client, mocker):
    """A failed read/write is 503."""
    headers = _auth(mocker, "user-1")
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("quota"))
    r = _visibility(client, headers, [{"uuid": VALID_UUID, "name": "home", "isPublic": True}])
    assert r.status_code == 503


# ── GET /api/players/<uuid>/public-profile ───────────────────────────────────

def _public(client, headers, uuid=VALID_UUID):
    return client.get(f"/api/players/{uuid}/public-profile", headers=headers)


_OWNER_DOC = {
    "minecraftAccounts": {"java": "Steve", "bedrock": ".Bedrocker"},
    "savedLocations": [
        {"id": "l1", "name": "Spawn", "mapHash": "#world:0:64:0", "description": "", "isPublic": True},
        {"id": "l2", "name": "Secret base", "mapHash": "#world:9:9:9", "description": "x", "isPublic": False},
        "junk",
    ],
    "publicHomes": {VALID_UUID: ["base"]},
    "email": "owner@example.com",
}


def test_public_profile_unauthorized(client, mocker):
    """No token → 401."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    assert client.get(f"/api/players/{VALID_UUID}/public-profile").status_code == 401


def test_public_profile_rejects_invalid_uuid(client, mocker):
    """Malformed UUIDs are 400."""
    headers = _auth(mocker)
    assert _public(client, headers, "not-a-uuid").status_code == 400


def test_public_profile_returns_only_public_entries(client, mocker):
    """Only public locations (without owner-only fields) and this player's
    public homes are returned — private ones never leave the server."""
    headers = _auth(mocker, "viewer")
    _fake_firestore(mocker, {
        "usernames/Steve": {"uid": "owner", "type": "java"},
        "users/owner": _OWNER_DOC,
    }, usercache=_USERCACHE)
    mocker.patch("api.routes.profile.read_essentials_homes", side_effect=_homes_of("home", "base"))
    r = _public(client, headers)
    assert r.status_code == 200
    assert r.json == {
        "locations": [{"id": "l1", "name": "Spawn", "mapHash": "#world:0:64:0", "description": ""}],
        "homes": [{"name": "base", "world": "world", "x": 1.0, "y": 64.0, "z": 2.0}],
    }


def test_public_profile_skips_homes_when_none_are_public(client, mocker):
    """No public homes → EssentialsX data isn't even read."""
    headers = _auth(mocker)
    _fake_firestore(mocker, {
        "usernames/Steve": {"uid": "owner"},
        "users/owner": {"minecraftAccounts": {"java": "Steve"}, "savedLocations": "garbage"},
    }, usercache=_USERCACHE)
    read = mocker.patch("api.routes.profile.read_essentials_homes")
    r = _public(client, headers)
    assert r.json == {"locations": [], "homes": []}
    read.assert_not_called()


def test_public_profile_bedrock_player_has_locations_but_no_homes(client, mocker):
    """Bedrock players have no EssentialsX homes; their owner's public
    locations are still shown."""
    headers = _auth(mocker)
    _fake_firestore(mocker, {
        "usernames/.Bedrocker": {"uid": "owner"}, "users/owner": _OWNER_DOC,
    }, usercache=_USERCACHE)
    read = mocker.patch("api.routes.profile.read_essentials_homes")
    r = _public(client, headers, BEDROCK_UUID)
    assert [loc["id"] for loc in r.json["locations"]] == ["l1"]
    assert r.json["homes"] == []
    read.assert_not_called()


@pytest.mark.parametrize("docs", [
    {},
    {"usernames/Steve": {"type": "java"}},
    {"usernames/Steve": {"uid": "owner"}, "users/owner": {"minecraftAccounts": {"java": "Alex"}}},
    {"usernames/Steve": {"uid": "owner"}},
])
def test_public_profile_empty_without_a_genuine_link(client, mocker, docs):
    """No reverse lookup, one without a uid, or one whose user no longer links
    the name (stale/forged) → nothing is shown."""
    headers = _auth(mocker)
    _fake_firestore(mocker, docs, usercache=_USERCACHE)
    r = _public(client, headers)
    assert r.json == {"locations": [], "homes": []}


def test_public_profile_unknown_uuid_is_empty(client, mocker):
    """A UUID absent from usercache has nothing public (no Firestore read)."""
    headers = _auth(mocker)
    mocker.patch("api.routes.profile.get_uuid_to_name", return_value={})
    factory = mocker.patch("firebase_admin.firestore.client")
    assert _public(client, headers).json == {"locations": [], "homes": []}
    factory.assert_not_called()


def test_public_profile_firestore_failure_returns_503(client, mocker):
    """A Firestore failure is 503 (the card then shows nothing)."""
    headers = _auth(mocker)
    mocker.patch("api.routes.profile.get_uuid_to_name", return_value=_USERCACHE)
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("down"))
    assert _public(client, headers).status_code == 503
