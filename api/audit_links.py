"""Read-only audit of the Minecraft account links stored in Firestore.

Until the server-side linking fix, the browser wrote ``users/{uid}.minecraftAccounts``
and ``usernames/{name}`` itself, so a link could be created without the AuthMe
password. This lists links that look forged or inconsistent so the owner can
review them by hand. It never writes anything.

Run it where the API's Firebase credentials live (the server)::

    python3 -m api.audit_links          # human-readable report
    python3 -m api.audit_links --json   # one JSON object per finding
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, Iterable, List, Mapping, Optional

# Importing player_data auto-starts the background sync thread, which could win
# the sync-leader lock (e.g. while the API is stopped) and write to Firestore.
# This script must only read, so switch that off before the import below.
os.environ["AUTO_START_BG_SYNC"] = "0"

from .firebase_init import ensure_initialized  # noqa: E402
from .player_data import get_op_names, get_uuid_to_name  # noqa: E402

Finding = Dict[str, Any]


def find_suspicious_links(
    users: Mapping[str, Optional[Mapping[str, Any]]],
    usernames: Mapping[str, Optional[Mapping[str, Any]]],
    op_names: Iterable[str],
    known_names: Iterable[str],
) -> List[Finding]:
    """Return one finding per suspicious link, most severe reasons first.

    ``users`` / ``usernames`` map document ids to document data. Names compare
    case-insensitively (the old client stored them as typed, the server stores
    the usercache spelling). ``known_names`` empty means "unknown" and skips the
    never-joined check rather than flagging everyone.
    """
    ops = {name.lower() for name in op_names}
    known = {name.lower() for name in known_names}
    lookups = {doc_id.lower(): data or {} for doc_id, data in usernames.items()}

    findings: List[Finding] = []
    owners: Dict[str, set] = {}
    for uid, data in users.items():
        accounts = (data or {}).get("minecraftAccounts") or {}
        if not isinstance(accounts, dict):
            continue
        for account_type, name in accounts.items():
            if not name:
                continue
            key = str(name).lower()
            owners.setdefault(key, set()).add(uid)
            base = {"uid": uid, "type": account_type, "name": str(name)}
            if account_type == "admin" and key not in ops:
                findings.append({"reason": "admin_not_op", **base})
            if known and key not in known:
                findings.append({"reason": "never_joined_server", **base})
            lookup = lookups.get(key)
            if lookup is None:
                findings.append({"reason": "missing_reverse_lookup", **base})
            elif lookup.get("uid") != uid:
                findings.append({"reason": "reverse_lookup_mismatch", "lookup_uid": lookup.get("uid"), **base})

    for key, uids in sorted(owners.items()):
        if len(uids) > 1:
            findings.append({"reason": "linked_by_multiple_users", "name": key, "uids": sorted(uids)})

    order = {
        "linked_by_multiple_users": 0,
        "admin_not_op": 1,
        "reverse_lookup_mismatch": 2,
        "never_joined_server": 3,
        "missing_reverse_lookup": 4,
    }
    findings.sort(key=lambda f: (order[f["reason"]], f.get("name", "")))
    return findings


def _read_collection(db: Any, name: str) -> Dict[str, Optional[Dict[str, Any]]]:
    return {doc.id: doc.to_dict() for doc in db.collection(name).stream()}


def main(argv: Optional[List[str]] = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if not ensure_initialized():
        print("Firebase is not initialized (missing credentials?) - nothing audited.", file=sys.stderr)
        return 2

    from firebase_admin import firestore as admin_firestore  # lazy, like the API

    db = admin_firestore.client()
    users = _read_collection(db, "users")
    findings = find_suspicious_links(
        users,
        _read_collection(db, "usernames"),
        get_op_names(),
        get_uuid_to_name().values(),
    )

    if "--json" in args:
        for finding in findings:
            print(json.dumps(finding, sort_keys=True))
    else:
        print("Audited {} user profile(s): {} finding(s).".format(len(users), len(findings)))
        for finding in findings:
            details = ", ".join("{}={}".format(k, v) for k, v in sorted(finding.items()) if k != "reason")
            print("  [{}] {}".format(finding["reason"], details))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
