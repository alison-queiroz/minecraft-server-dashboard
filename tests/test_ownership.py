"""Tests for api/ownership.py: resolving a player UUID to the caller's linked
accounts, the per-worker owner cache (TTL, aged-miss recheck, stale-on-error)
and failing closed when Firestore is unavailable."""
import pytest

import api.ownership as ownership
from api.server_api import app
from route_fakes import VALID_UUID

pytestmark = pytest.mark.usefixtures("route_state")


def test_user_owns_player_matches_linked_name(mocker):
    mocker.patch("api.ownership.get_uuid_to_name", return_value={VALID_UUID: "Steve"})
    mock_doc = mocker.MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {"minecraftAccounts": {"java": "Steve", "bedrock": None, "admin": None}}
    mock_db = mocker.MagicMock()
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    mocker.patch("firebase_admin.firestore.client", return_value=mock_db)
    with app.test_request_context():
        from flask import g
        g.auth_uid = "uid-1"
        assert ownership._user_owns_player(VALID_UUID) is True


def test_user_owns_player_rejects_foreign_uuid(mocker):
    mocker.patch("api.ownership.get_uuid_to_name", return_value={VALID_UUID: "Mallory"})
    mock_doc = mocker.MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {"minecraftAccounts": {"java": "Steve", "bedrock": None, "admin": None}}
    mock_db = mocker.MagicMock()
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    mocker.patch("firebase_admin.firestore.client", return_value=mock_db)
    with app.test_request_context():
        from flask import g
        g.auth_uid = "uid-1"
        assert ownership._user_owns_player(VALID_UUID) is False


def test_user_owns_player_raises_when_ownership_unknown(mocker):
    """With Firestore down and no cache, the check raises instead of allowing."""
    mocker.patch("api.ownership.get_uuid_to_name", return_value={VALID_UUID: "Steve"})
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("down"))
    with app.test_request_context():
        from flask import g
        g.auth_uid = "uid-1"
        with pytest.raises(ownership._OwnershipUnavailable):
            ownership._user_owns_player(VALID_UUID)


def test_user_owns_player_false_without_uid_or_known_name(mocker):
    """No authenticated uid, or a UUID missing from usercache, is never owned."""
    mocker.patch("api.ownership.get_uuid_to_name", return_value={})
    with app.test_request_context():
        from flask import g
        assert ownership._user_owns_player(VALID_UUID) is False
        g.auth_uid = "uid-1"
        assert ownership._user_owns_player(VALID_UUID) is False


def test_user_owns_player_rechecks_an_aged_cached_miss(mocker):
    """A cached miss older than the recheck age is re-read once, so a link made
    through another worker is honoured without waiting for the cache TTL."""
    mocker.patch("api.ownership.get_uuid_to_name", return_value={VALID_UUID: "Steve"})
    ownership._owner_cache["uid-1"] = (ownership.time.time() - 60, set())
    mock_doc = mocker.MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {"minecraftAccounts": {"java": "Steve"}}
    mock_db = mocker.MagicMock()
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    mocker.patch("firebase_admin.firestore.client", return_value=mock_db)
    with app.test_request_context():
        from flask import g
        g.auth_uid = "uid-1"
        assert ownership._user_owns_player(VALID_UUID) is True


def test_user_owns_player_miss_on_fresh_lookup_reads_firestore_once(mocker):
    """A miss right after a fresh read does not trigger a second Firestore read."""
    mocker.patch("api.ownership.get_uuid_to_name", return_value={VALID_UUID: "Mallory"})
    mock_doc = mocker.MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {"minecraftAccounts": {"java": "Steve"}}
    mock_db = mocker.MagicMock()
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    client_factory = mocker.patch("firebase_admin.firestore.client", return_value=mock_db)
    with app.test_request_context():
        from flask import g
        g.auth_uid = "uid-1"
        assert ownership._user_owns_player(VALID_UUID) is False
    assert client_factory.call_count == 1


def test_invalidate_owner_cache_drops_entry():
    """Invalidation removes only the given uid's cached names."""
    ownership._owner_cache["a"] = (ownership.time.time(), {"steve"})
    ownership._owner_cache["b"] = (ownership.time.time(), {"alex"})
    ownership._invalidate_owner_cache("a")
    ownership._invalidate_owner_cache("missing")
    assert "a" not in ownership._owner_cache
    assert "b" in ownership._owner_cache


def test_owner_lookup_serves_stale_cache_on_error(mocker):
    """A transient Firestore error returns the last cached names, not empty."""
    ownership._owner_cache.clear()
    ownership._owner_cache["uid-x"] = (0.0, {"steve"})  # stale (ts=0) so a refresh is attempted
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("boom"))
    assert ownership._linked_minecraft_names("uid-x") == {"steve"}


def test_linked_names_empty_for_missing_uid():
    """No uid means no linked names (and no Firestore read)."""
    assert ownership._linked_minecraft_names(None) == set()
