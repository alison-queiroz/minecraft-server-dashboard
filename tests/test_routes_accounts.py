"""Tests for api/routes/accounts.py: the AuthMe password check (bcrypt and
legacy SHA hashes, timing-equalised misses, read-only DB), the shared SQLite
rate limiter, and linking/unlinking accounts with their reverse lookups."""
import os
from pathlib import Path

import pytest

import api.ownership as ownership
from api.routes import accounts
from route_fakes import VALID_UUID, _auth, _fake_firestore

pytestmark = pytest.mark.usefixtures("route_state")


# ── account linking: shared fakes ────────────────────────────────────────────

def _bcrypt_hash(password, prefix="$2b$"):
    import bcrypt
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(4)).decode("utf-8")
    return prefix + hashed[4:]


def _sha_hash(password, salt="pepper"):
    import hashlib
    inner = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return f"$SHA${salt}${hashlib.sha256((inner + salt).encode('utf-8')).hexdigest()}"


@pytest.fixture
def authme(tmp_path, monkeypatch):
    """A real AuthMe-shaped SQLite DB (lowercase ``username`` column, as the
    plugin writes it); returns add(username, stored_hash)."""
    import sqlite3
    path = tmp_path / "authme.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE authme (id INTEGER PRIMARY KEY, username VARCHAR(255) NOT NULL UNIQUE,"
        " realname VARCHAR(255) NOT NULL, password VARCHAR(255) NOT NULL)"
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(accounts, "_AUTHME_DB_PATH", str(path))

    def add(username, stored):
        c = sqlite3.connect(path)
        c.execute("INSERT INTO authme (username, realname, password) VALUES (?, ?, ?)",
                  (username.lower(), username, stored))
        c.commit()
        c.close()
    return add


def _link(client, headers, account_type="java", username="Steve", password="secret"):
    return client.post("/api/profile/accounts", headers=headers,
                       json={"type": account_type, "username": username, "password": password})


# ── AuthMe password check ────────────────────────────────────────────────────

def test_authme_bcrypt_password_matches(authme):
    """A correct password matches a bcrypt hash; a wrong one does not."""
    authme("Steve", _bcrypt_hash("secret"))
    assert accounts._authme_password_matches("Steve", "secret") is True
    assert accounts._authme_password_matches("Steve", "nope") is False


def test_authme_bcrypt_long_password_is_truncated_like_authme(authme):
    """Passwords over bcrypt's 72-byte limit are checked on their first 72 bytes
    (as AuthMe's jBCrypt does) instead of raising ValueError under bcrypt>=5."""
    authme("Steve", _bcrypt_hash("a" * 72))
    assert accounts._authme_password_matches("Steve", "a" * 72 + "ignored-tail") is True
    assert accounts._authme_password_matches("Steve", "b" * 100) is False
    assert accounts._authme_password_matches("Nobody", "c" * 200) is False


@pytest.mark.parametrize("prefix", ["$2a$", "$2y$"])
def test_authme_bcrypt_legacy_prefixes_are_normalised(authme, prefix):
    """$2a$/$2y$ hashes (as written by AuthMe/PHP) verify via the $2b$ spelling."""
    authme("Steve", _bcrypt_hash("secret", prefix))
    assert accounts._authme_password_matches("Steve", "secret") is True


def test_authme_sha_legacy_hash(authme):
    """The $SHA$<salt>$<hash> legacy format verifies right and wrong passwords."""
    authme("Steve", _sha_hash("secret"))
    assert accounts._authme_password_matches("Steve", "secret") is True
    assert accounts._authme_password_matches("Steve", "WRONG") is False


def test_authme_lookup_uses_lowercased_name(authme):
    """The query compares the stored lowercase name to a lowercased parameter
    (no LOWER() on the column, so its index is usable)."""
    authme("Steve", _bcrypt_hash("secret"))
    assert accounts._authme_password_matches("STEVE", "secret") is True


@pytest.mark.parametrize("stored", ["plain-text-hash", "$SHA$onlysalt"])
def test_authme_unrecognised_hash_is_rejected_after_dummy_check(authme, mocker, stored):
    """Unverifiable hashes are rejected, still paying one bcrypt check."""
    import bcrypt
    authme("Steve", stored)
    spy = mocker.spy(bcrypt, "checkpw")
    assert accounts._authme_password_matches("Steve", "secret") is False
    assert spy.call_args.args[1] == accounts._DUMMY_BCRYPT_HASH


def test_authme_unknown_user_runs_dummy_bcrypt(authme, mocker):
    """An unknown username costs a bcrypt check against the dummy hash, so its
    timing matches a wrong password."""
    import bcrypt
    spy = mocker.spy(bcrypt, "checkpw")
    assert accounts._authme_password_matches("Nobody", "secret") is False
    assert spy.call_count == 1
    assert spy.call_args.args[1] == accounts._DUMMY_BCRYPT_HASH


def test_dummy_bcrypt_hash_is_a_valid_hash():
    """The timing-equaliser hash is well-formed (checkpw would raise otherwise)."""
    import bcrypt
    assert bcrypt.checkpw(b"anything", accounts._DUMMY_BCRYPT_HASH) is False


def test_authme_db_is_opened_read_only(authme, mocker):
    """The AuthMe DB is opened through a mode=ro URI."""
    import sqlite3
    authme("Steve", _bcrypt_hash("secret"))
    spy = mocker.spy(sqlite3, "connect")
    accounts._authme_password_matches("Steve", "secret")
    target, = spy.call_args.args
    assert target.startswith("file:") and target.endswith("?mode=ro")
    assert spy.call_args.kwargs == {"uri": True}


def test_authme_missing_db_raises_unavailable(tmp_path, monkeypatch):
    """A missing DB file surfaces as _AuthMeUnavailable (read-only mode never
    creates an empty DB in its place)."""
    missing = tmp_path / "nope" / "authme.db"
    monkeypatch.setattr(accounts, "_AUTHME_DB_PATH", str(missing))
    with pytest.raises(accounts._AuthMeUnavailable):
        accounts._authme_password_matches("Steve", "secret")
    assert not missing.exists()


# ── password-attempt rate limiter (SQLite, shared across workers) ────────────

def test_rate_limit_per_uid_blocks_after_max():
    """One uid gets _RL_UID_MAX attempts per window, across any usernames."""
    for i in range(accounts._RL_UID_MAX):
        assert accounts._consume_verify_attempt("uid-a", f"player{i}") is True
    assert accounts._consume_verify_attempt("uid-a", "another") is False


def test_rate_limit_per_username_blocks_across_uids():
    """A target username gets _RL_USERNAME_MAX attempts per window no matter
    how many Google accounts try it."""
    for i in range(accounts._RL_USERNAME_MAX):
        assert accounts._consume_verify_attempt(f"uid-{i}", "Steve") is True
    assert accounts._consume_verify_attempt("uid-fresh", "steve") is False
    assert accounts._consume_verify_attempt("uid-fresh", "Alex") is True


def test_rate_limit_windows_expire(mocker):
    """Budgets refill once their window has passed."""
    now = [1_000_000.0]
    mocker.patch("api.routes.accounts.time.time", side_effect=lambda: now[0])
    for i in range(accounts._RL_USERNAME_MAX):
        assert accounts._consume_verify_attempt(f"uid-{i}", "Steve") is True
    assert accounts._consume_verify_attempt("uid-x", "Steve") is False
    now[0] += accounts._RL_USERNAME_WINDOW + 1
    assert accounts._consume_verify_attempt("uid-x", "Steve") is True


def test_rate_limit_rejections_are_not_recorded(mocker):
    """A rejected attempt does not extend the lockout."""
    now = [1_000_000.0]
    mocker.patch("api.routes.accounts.time.time", side_effect=lambda: now[0])
    for i in range(accounts._RL_UID_MAX):
        assert accounts._consume_verify_attempt("uid-a", f"player{i}") is True
    now[0] += 30
    assert accounts._consume_verify_attempt("uid-a", "x") is False
    now[0] += accounts._RL_UID_WINDOW - 29
    assert accounts._consume_verify_attempt("uid-a", "x") is True


def test_rate_limit_state_lives_in_the_shared_file():
    """Attempts are persisted to the SQLite file (visible to other workers and
    after a restart), and expired rows are pruned."""
    import sqlite3
    accounts._consume_verify_attempt("uid-a", "Steve")
    conn = sqlite3.connect(accounts._VERIFY_RATE_LIMIT_DB)
    try:
        rows = sorted(r[0] for r in conn.execute("SELECT key FROM attempts"))
        conn.execute("INSERT INTO attempts (key, ts) VALUES ('uid:old', 0)")
        conn.commit()
    finally:
        conn.close()
    assert rows == ["uid:uid-a", "user:steve"]
    accounts._consume_verify_attempt("uid-b", "Alex")
    conn = sqlite3.connect(accounts._VERIFY_RATE_LIMIT_DB)
    try:
        keys = {r[0] for r in conn.execute("SELECT key FROM attempts")}
    finally:
        conn.close()
    assert "uid:old" not in keys


def test_rate_limit_store_errors_propagate(tmp_path, monkeypatch):
    """An unusable store raises (so the endpoint can fail closed)."""
    import sqlite3
    monkeypatch.setattr(accounts, "_VERIFY_RATE_LIMIT_DB", str(tmp_path / "missing-dir" / "rl.sqlite3"))
    with pytest.raises(sqlite3.Error):
        accounts._consume_verify_attempt("uid-a", "Steve")


def test_rate_limit_rolls_back_on_query_error(mocker):
    """A failure inside the transaction rolls back and re-raises."""
    import sqlite3
    real_connect = sqlite3.connect

    class _Conn:
        def __init__(self, *args, **kwargs):
            self._conn = real_connect(*args, **kwargs)
            self.statements = []

        def execute(self, sql, *params):
            self.statements.append(sql)
            if sql.startswith("SELECT COUNT"):
                raise sqlite3.OperationalError("disk I/O error")
            return self._conn.execute(sql, *params)

        def close(self):
            self._conn.close()

    conns = []
    mocker.patch("sqlite3.connect", side_effect=lambda *a, **k: conns.append(_Conn(*a, **k)) or conns[-1])
    with pytest.raises(sqlite3.OperationalError):
        accounts._consume_verify_attempt("uid-a", "Steve")
    assert conns[0].statements[-1] == "ROLLBACK"


def test_rate_limit_db_defaults_to_the_repo_root():
    """Without VERIFY_RATE_LIMIT_DB the attempt store is <repo>/verify_rate_limit.sqlite3,
    the same file (and path string) it was before the module moved into api/routes/."""
    import subprocess
    import sys
    repo = Path(__file__).resolve().parents[1]
    env = {k: v for k, v in os.environ.items() if k != "VERIFY_RATE_LIMIT_DB"}
    env["AUTO_START_BG_SYNC"] = "0"
    result = subprocess.run(
        [sys.executable, "-c", "import api.routes.accounts as a; print(a._VERIFY_RATE_LIMIT_DB)"],
        cwd=repo, env=env, capture_output=True, text=True, check=True,
    )
    default = result.stdout.strip()
    assert Path(default).resolve() == repo / "verify_rate_limit.sqlite3"
    assert default.replace("\\", "/").endswith("/api/../verify_rate_limit.sqlite3")


# ── POST /api/profile/accounts ───────────────────────────────────────────────

def test_link_account_unauthorized(client, mocker):
    """No token → 401."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    assert client.post("/api/profile/accounts", json={}).status_code == 401


@pytest.mark.parametrize("body", [
    {"type": "wizard", "username": "Steve", "password": "x"},
    {"type": ["java"], "username": "Steve", "password": "x"},
    {"type": "java", "username": "", "password": "x"},
    {"type": "java", "username": "Steve", "password": ""},
    {"type": "java", "username": "a/b", "password": "x"},
    {"type": "java", "username": "has space", "password": "x"},
    {"type": "java", "username": "a" * 65, "password": "x"},
    {"type": "java", "username": "Steve", "password": "x" * 257},
])
def test_link_account_rejects_invalid_input(client, mocker, body):
    """Unknown types, empty/overlong fields and names that aren't valid
    Minecraft names (or Firestore ids) are rejected with invalid_request."""
    headers = _auth(mocker)
    store = _fake_firestore(mocker)
    r = client.post("/api/profile/accounts", headers=headers, json=body)
    assert r.status_code == 400
    assert r.json["code"] == "invalid_request"
    assert store.docs == {}


def test_link_account_non_object_body(client, mocker):
    """A JSON array body is a 400 invalid_request, not a 500."""
    headers = _auth(mocker)
    r = client.post("/api/profile/accounts", headers=headers, json=["java"])
    assert r.status_code == 400


def test_link_account_success_writes_link_and_reverse_lookup(client, mocker, authme):
    """A correct password links the usercache spelling of the name and writes
    the usernames/{name} reverse lookup server-side."""
    headers = _auth(mocker, "user-1")
    authme("Steve", _bcrypt_hash("secret"))
    store = _fake_firestore(mocker, usercache={VALID_UUID: "Steve"})

    r = _link(client, headers, username="steve")

    assert r.status_code == 200
    assert r.json == {"minecraftAccounts": {"java": "Steve", "bedrock": None, "admin": None}}
    assert store.docs["users/user-1"]["minecraftAccounts"]["java"] == "Steve"
    assert store.docs["usernames/Steve"] == {"uid": "user-1", "type": "java"}


def test_link_account_keeps_other_profile_fields(client, mocker, authme):
    """Linking merges into users/{uid}; saved locations survive."""
    headers = _auth(mocker, "user-1")
    authme("Alex", _bcrypt_hash("pw"))
    store = _fake_firestore(mocker, {"users/user-1": {
        "minecraftAccounts": {"java": "Steve", "bedrock": None, "admin": None},
        "savedLocations": [{"id": "l1"}],
    }})
    r = _link(client, headers, account_type="bedrock", username="Alex", password="pw")
    assert r.status_code == 200
    assert r.json["minecraftAccounts"] == {"java": "Steve", "bedrock": "Alex", "admin": None}
    assert store.docs["users/user-1"]["savedLocations"] == [{"id": "l1"}]


def test_link_account_wrong_password_writes_nothing(client, mocker, authme):
    """A wrong password is 403 invalid_credentials and nothing is linked."""
    headers = _auth(mocker)
    authme("Steve", _bcrypt_hash("secret"))
    store = _fake_firestore(mocker)
    r = _link(client, headers, password="WRONG")
    assert r.status_code == 403
    assert r.json["code"] == "invalid_credentials"
    assert store.docs == {}


def test_link_account_unknown_username_is_invalid_credentials(client, mocker, authme):
    """An unregistered name looks exactly like a wrong password."""
    headers = _auth(mocker)
    store = _fake_firestore(mocker)
    r = _link(client, headers, username="Nobody")
    assert r.status_code == 403
    assert r.json["code"] == "invalid_credentials"
    assert store.docs == {}


def test_link_account_replaces_previous_reverse_lookup(client, mocker, authme):
    """Switching the java account drops the old usernames doc that points at
    this uid, but keeps one owned by someone else."""
    headers = _auth(mocker, "user-1")
    authme("NewSteve", _bcrypt_hash("pw"))
    store = _fake_firestore(mocker, {
        "users/user-1": {"minecraftAccounts": {"java": "OldSteve", "bedrock": "Other", "admin": None}},
        "usernames/OldSteve": {"uid": "user-1", "type": "java"},
    })
    r = _link(client, headers, username="NewSteve", password="pw")
    assert r.status_code == 200
    assert "usernames/OldSteve" not in store.docs
    assert store.docs["usernames/NewSteve"]["uid"] == "user-1"


@pytest.mark.parametrize("previous_doc,kept", [
    ({"uid": "someone-else", "type": "java"}, True),
    ({"type": "java"}, False),
])
def test_link_account_previous_lookup_ownership(client, mocker, authme, previous_doc, kept):
    """The previous reverse lookup is only deleted when it belongs to the caller
    (or is a legacy entry without a uid)."""
    headers = _auth(mocker, "user-1")
    authme("NewSteve", _bcrypt_hash("pw"))
    store = _fake_firestore(mocker, {
        "users/user-1": {"minecraftAccounts": {"java": "OldSteve"}},
        "usernames/OldSteve": previous_doc,
    })
    assert _link(client, headers, username="NewSteve", password="pw").status_code == 200
    assert ("usernames/OldSteve" in store.docs) is kept


def test_link_account_keeps_lookup_still_used_by_another_type(client, mocker, authme):
    """Replacing the admin account keeps the reverse lookup of a name the java
    slot still links."""
    headers = _auth(mocker, "user-1")
    mocker.patch("api.routes.accounts.get_op_names", return_value=["Alex"])
    authme("Alex", _bcrypt_hash("pw"))
    store = _fake_firestore(mocker, {
        "users/user-1": {"minecraftAccounts": {"java": "Steve", "admin": "Steve"}},
        "usernames/Steve": {"uid": "user-1", "type": "java"},
    })
    assert _link(client, headers, account_type="admin", username="Alex", password="pw").status_code == 200
    assert "usernames/Steve" in store.docs


def test_link_account_admin_requires_operator(client, mocker, authme):
    """Admin links are limited to ops.json players (403 not_operator), checked
    before any password attempt is spent."""
    headers = _auth(mocker)
    mocker.patch("api.routes.accounts.get_op_names", return_value=["Notch"])
    consume = mocker.spy(accounts, "_consume_verify_attempt")
    store = _fake_firestore(mocker)
    r = _link(client, headers, account_type="admin", username="Steve")
    assert r.status_code == 403
    assert r.json["code"] == "not_operator"
    consume.assert_not_called()
    assert store.docs == {}


def test_link_account_admin_operator_succeeds(client, mocker, authme):
    """An op (matched case-insensitively) can be linked as the admin account."""
    headers = _auth(mocker, "user-1")
    mocker.patch("api.routes.accounts.get_op_names", return_value=["Steve"])
    authme("Steve", _bcrypt_hash("secret"))
    store = _fake_firestore(mocker)
    r = _link(client, headers, account_type="admin", username="steve")
    assert r.status_code == 200
    assert r.json["minecraftAccounts"]["admin"] == "steve"
    assert store.docs["usernames/steve"] == {"uid": "user-1", "type": "admin"}


def test_link_account_invalidates_owner_cache(client, mocker, authme):
    """A new link is honoured by the ownership check straight away."""
    headers = _auth(mocker, "user-1")
    authme("Steve", _bcrypt_hash("secret"))
    _fake_firestore(mocker)
    ownership._owner_cache["user-1"] = (ownership.time.time(), set())
    assert _link(client, headers).status_code == 200
    assert "user-1" not in ownership._owner_cache


def test_link_account_rate_limited_per_username(client, mocker, authme):
    """Guessing one player's password from many Google accounts hits the
    per-username budget (429 rate_limited) without checking the password."""
    authme("Steve", _bcrypt_hash("secret"))
    _fake_firestore(mocker)
    for i in range(accounts._RL_USERNAME_MAX):
        assert _link(client, _auth(mocker, f"attacker-{i}"), password="guess").status_code == 403
    checker = mocker.spy(accounts, "_authme_password_matches")
    r = _link(client, _auth(mocker, "attacker-99"), password="secret")
    assert r.status_code == 429
    assert r.json["code"] == "rate_limited"
    checker.assert_not_called()


def test_link_account_rate_limited_per_uid(client, mocker, authme):
    """One uid spraying many usernames hits the per-uid budget."""
    headers = _auth(mocker, "sprayer")
    _fake_firestore(mocker)
    for i in range(accounts._RL_UID_MAX):
        assert _link(client, headers, username=f"player{i}").status_code == 403
    assert _link(client, headers, username="another").status_code == 429


def test_link_account_rate_limiter_unavailable_fails_closed(client, mocker, tmp_path, monkeypatch, authme):
    """If the attempt store can't be used, no password is checked (503)."""
    headers = _auth(mocker)
    monkeypatch.setattr(accounts, "_VERIFY_RATE_LIMIT_DB", str(tmp_path / "missing-dir" / "rl.sqlite3"))
    checker = mocker.spy(accounts, "_authme_password_matches")
    r = _link(client, headers)
    assert r.status_code == 503
    assert r.json["code"] == "unavailable"
    checker.assert_not_called()


def test_link_account_authme_missing_returns_503(client, mocker, tmp_path, monkeypatch):
    """A missing AuthMe DB is 503 unavailable."""
    headers = _auth(mocker)
    monkeypatch.setattr(accounts, "_AUTHME_DB_PATH", str(tmp_path / "nope" / "authme.db"))
    r = _link(client, headers)
    assert r.status_code == 503
    assert r.json["code"] == "unavailable"


def test_link_account_unexpected_verification_error_returns_500(client, mocker):
    """Any other verification error is 500 failed."""
    headers = _auth(mocker)
    mocker.patch("api.routes.accounts._authme_password_matches", side_effect=RuntimeError("boom"))
    r = _link(client, headers)
    assert r.status_code == 500
    assert r.json["code"] == "failed"


def test_link_account_firestore_failure_returns_503(client, mocker, authme):
    """A failed Firestore write is 503 unavailable and the cache is kept."""
    headers = _auth(mocker, "user-1")
    authme("Steve", _bcrypt_hash("secret"))
    mocker.patch("api.routes.accounts.get_uuid_to_name", return_value={})
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("quota"))
    ownership._owner_cache["user-1"] = (ownership.time.time(), {"alex"})
    r = _link(client, headers)
    assert r.status_code == 503
    assert r.json["code"] == "unavailable"
    assert "user-1" in ownership._owner_cache


# ── DELETE /api/profile/accounts/<type> ──────────────────────────────────────

def test_unlink_account_unauthorized(client, mocker):
    """No token → 401."""
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    assert client.delete("/api/profile/accounts/java").status_code == 401


def test_unlink_account_rejects_unknown_type(client, mocker):
    """Unknown account types are 400."""
    headers = _auth(mocker)
    r = client.delete("/api/profile/accounts/wizard", headers=headers)
    assert r.status_code == 400
    assert r.json["code"] == "invalid_request"


def test_unlink_account_clears_link_and_reverse_lookup(client, mocker):
    """Unlinking nulls the slot, drops the caller's reverse lookup and
    invalidates the ownership cache."""
    headers = _auth(mocker, "user-1")
    store = _fake_firestore(mocker, {
        "users/user-1": {"minecraftAccounts": {"java": "Steve", "bedrock": "Alex", "admin": None}},
        "usernames/Steve": {"uid": "user-1", "type": "java"},
    })
    ownership._owner_cache["user-1"] = (ownership.time.time(), {"steve", "alex"})
    r = client.delete("/api/profile/accounts/java", headers=headers)
    assert r.status_code == 200
    assert r.json == {"minecraftAccounts": {"java": None, "bedrock": "Alex", "admin": None}}
    assert "usernames/Steve" not in store.docs
    assert store.docs["users/user-1"]["minecraftAccounts"]["java"] is None
    assert "user-1" not in ownership._owner_cache


def test_unlink_account_without_profile_doc(client, mocker):
    """Unlinking with no profile yet still succeeds (nothing to drop)."""
    headers = _auth(mocker, "user-1")
    _fake_firestore(mocker)
    r = client.delete("/api/profile/accounts/admin", headers=headers)
    assert r.status_code == 200
    assert r.json["minecraftAccounts"] == {"java": None, "bedrock": None, "admin": None}


def test_unlink_account_firestore_failure_returns_503(client, mocker):
    """A Firestore failure is 503 unavailable."""
    headers = _auth(mocker)
    mocker.patch("firebase_admin.firestore.client", side_effect=Exception("down"))
    r = client.delete("/api/profile/accounts/java", headers=headers)
    assert r.status_code == 503
    assert r.json["code"] == "unavailable"


def test_standalone_password_verify_endpoint_is_gone(client, mocker):
    """Passwords are only checked as part of linking; the old verify-then-
    write-from-the-browser endpoint no longer exists."""
    headers = _auth(mocker)
    r = client.post("/api/verify-minecraft-password", headers=headers,
                    json={"username": "Steve", "password": "x"})
    assert r.status_code == 404
