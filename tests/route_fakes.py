"""Shared constants, fakes and request helpers for the per-area route tests
(tests/test_routes_*.py, test_auth.py, test_ownership.py). Not a test module."""
from __future__ import annotations

VALID_UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5"
ALEX_UUID = "ec561538-f3fd-461d-aff5-086b22154bce"
BEDROCK_UUID = "00000000-0000-0000-0009-01f2c3d4e5f6"
_USERCACHE = {VALID_UUID: "Steve", ALEX_UUID: "Alex", BEDROCK_UUID: ".Bedrocker"}

# Every module that resolves UUIDs through usercache (get_uuid_to_name), so a
# fake usercache reaches all of them like the single server_api lookup did.
USERCACHE_LOOKUPS = (
    "api.ownership.get_uuid_to_name",
    "api.home_visibility.get_uuid_to_name",
    "api.routes.accounts.get_uuid_to_name",
    "api.routes.profile.get_uuid_to_name",
)


# ── In-memory Firestore (Admin SDK stand-in) ─────────────────────────────────

def _deep_merge(target: dict, data: dict) -> dict:
    merged = dict(target)
    for key, value in data.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


class _FakeSnap:
    def __init__(self, data):
        self.exists = data is not None
        self._data = data

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class _FakeDocRef:
    def __init__(self, store, path):
        self._store = store
        self.path = path

    def get(self):
        return _FakeSnap(self._store.docs.get(self.path))

    def set(self, data, merge=False):
        self._store.apply_set(self.path, data, merge)


class _FakeCollection:
    def __init__(self, store, name):
        self._store = store
        self._name = name

    def document(self, doc_id):
        return _FakeDocRef(self._store, f"{self._name}/{doc_id}")


class _FakeBatch:
    def __init__(self, store):
        self._store = store
        self._ops = []

    def set(self, ref, data, merge=False):
        self._ops.append(("set", ref.path, data, merge))

    def delete(self, ref):
        self._ops.append(("delete", ref.path, None, False))

    def commit(self):
        for op, path, data, merge in self._ops:
            if op == "delete":
                self._store.docs.pop(path, None)
            else:
                self._store.apply_set(path, data, merge)


class _FakeFirestore:
    """In-memory stand-in for the Admin SDK client: documents keyed by
    "collection/id", merge-aware set, and batches applied on commit."""

    def __init__(self, docs=None):
        self.docs = dict(docs or {})

    def collection(self, name):
        return _FakeCollection(self, name)

    def batch(self):
        return _FakeBatch(self)

    def apply_set(self, path, data, merge):
        current = self.docs.get(path) if merge else None
        self.docs[path] = _deep_merge(current or {}, data)


# ── Request helpers ──────────────────────────────────────────────────────────

def _auth(mocker, uid="user-1"):
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": uid})
    return {"Authorization": "Bearer t"}


def _fake_firestore(mocker, docs=None, usercache=None):
    """Install a _FakeFirestore (and a hermetic usercache) for the request."""
    store = _FakeFirestore(docs)
    mocker.patch("firebase_admin.firestore.client", return_value=store)
    for target in USERCACHE_LOOKUPS:
        mocker.patch(target, return_value=dict(usercache or {}))
    return store


def _homes_of(*names):
    return lambda uuid: [
        {"name": n, "world": "world", "x": 1.0, "y": 64.0, "z": 2.0} for n in names
    ]


def _owner_headers(mocker):
    mocker.patch("api.auth._FIREBASE_INITIALIZED", True)
    mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u"})
    mocker.patch("api.ownership._user_owns_player", return_value=True)
    return {"Authorization": "Bearer t"}
