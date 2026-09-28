"""Tests for the read-only account-link audit (api/audit_links.py)."""
import json
from unittest.mock import MagicMock

from api import audit_links
from api.audit_links import find_suspicious_links


def _reasons(findings):
    return [f["reason"] for f in findings]


def test_clean_links_produce_no_findings():
    users = {"u1": {"minecraftAccounts": {"java": "Steve", "bedrock": None, "admin": None}}}
    usernames = {"Steve": {"uid": "u1", "type": "java"}}
    assert find_suspicious_links(users, usernames, [], ["Steve"]) == []


def test_name_linked_by_two_users_is_flagged_first():
    users = {
        "victim": {"minecraftAccounts": {"java": "Steve"}},
        "forger": {"minecraftAccounts": {"java": "steve"}},
    }
    usernames = {"Steve": {"uid": "victim"}}
    findings = find_suspicious_links(users, usernames, [], ["Steve"])
    assert findings[0] == {"reason": "linked_by_multiple_users", "name": "steve", "uids": ["forger", "victim"]}
    assert {"reason": "reverse_lookup_mismatch", "lookup_uid": "victim", "uid": "forger",
            "type": "java", "name": "steve"} in findings


def test_admin_link_for_a_non_operator_is_flagged():
    users = {"u1": {"minecraftAccounts": {"admin": "Alex"}}}
    usernames = {"alex": {"uid": "u1"}}
    assert _reasons(find_suspicious_links(users, usernames, ["Steve"], ["Alex"])) == ["admin_not_op"]
    assert find_suspicious_links(users, usernames, ["ALEX"], ["Alex"]) == []


def test_never_joined_and_missing_lookup_are_flagged():
    users = {"u1": {"minecraftAccounts": {"java": "Ghost"}}}
    assert _reasons(find_suspicious_links(users, {}, [], ["Steve"])) == [
        "never_joined_server",
        "missing_reverse_lookup",
    ]


def test_unknown_usercache_skips_the_never_joined_check():
    users = {"u1": {"minecraftAccounts": {"java": "Ghost"}}}
    usernames = {"Ghost": {"uid": "u1"}}
    assert find_suspicious_links(users, usernames, [], []) == []


def test_malformed_and_empty_profiles_are_ignored():
    users = {"a": None, "b": {}, "c": {"minecraftAccounts": "Steve"}, "d": {"minecraftAccounts": {"java": ""}}}
    assert find_suspicious_links(users, {}, [], ["Steve"]) == []


def _fake_db(collections):
    db = MagicMock()

    def collection(name):
        docs = []
        for doc_id, data in collections.get(name, {}).items():
            snap = MagicMock()
            snap.id = doc_id
            snap.to_dict.return_value = data
            docs.append(snap)
        ref = MagicMock()
        ref.stream.return_value = docs
        return ref

    db.collection.side_effect = collection
    return db


def test_main_prints_a_report_and_never_writes(mocker, capsys):
    db = _fake_db({
        "users": {"u1": {"minecraftAccounts": {"java": "Steve"}}, "u2": {"minecraftAccounts": {"java": "Steve"}}},
        "usernames": {"Steve": {"uid": "u1"}},
    })
    mocker.patch("api.audit_links.ensure_initialized", return_value=True)
    mocker.patch("firebase_admin.firestore.client", return_value=db)
    mocker.patch("api.audit_links.get_op_names", return_value=[])
    mocker.patch("api.audit_links.get_uuid_to_name", return_value={"id": "Steve"})

    assert audit_links.main([]) == 0
    out = capsys.readouterr().out
    assert "Audited 2 user profile(s)" in out
    assert "[linked_by_multiple_users]" in out
    db.batch.assert_not_called()
    for call in db.collection.call_args_list:
        assert call.args[0] in ("users", "usernames")


def test_main_json_mode_emits_one_object_per_finding(mocker, capsys):
    db = _fake_db({"users": {"u1": {"minecraftAccounts": {"admin": "Alex"}}}, "usernames": {"Alex": {"uid": "u1"}}})
    mocker.patch("api.audit_links.ensure_initialized", return_value=True)
    mocker.patch("firebase_admin.firestore.client", return_value=db)
    mocker.patch("api.audit_links.get_op_names", return_value=[])
    mocker.patch("api.audit_links.get_uuid_to_name", return_value={})

    assert audit_links.main(["--json"]) == 0
    lines = capsys.readouterr().out.strip().splitlines()
    assert [json.loads(line)["reason"] for line in lines] == ["admin_not_op"]


def test_main_exits_2_without_firebase(mocker, capsys):
    mocker.patch("api.audit_links.ensure_initialized", return_value=False)
    assert audit_links.main([]) == 2
    assert "not initialized" in capsys.readouterr().err


def test_importing_the_audit_never_starts_the_sync_thread():
    """The audit only reads: importing it must not start player_data's
    background sync (which could take the leader lock and write Firestore)."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    env = {k: v for k, v in os.environ.items() if k != "AUTO_START_BG_SYNC"}
    code = (
        "import threading, api.audit_links\n"
        "print(any(t.name == 'player-bg-sync' for t in threading.enumerate()))\n"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=str(Path(__file__).resolve().parents[1]),
        env=env, capture_output=True, text=True, timeout=120, check=True,
    ).stdout.strip().splitlines()
    assert out[-1] == "False"
