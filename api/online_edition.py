"""Detect how many currently-online players connected via Bedrock (Geyser).

Once Floodgate account-linking / offline-mode is in play, a Bedrock player logs
into the Java server as their Java identity (same name and UUID) — so the SLP
ping, the GS4 query and the UUID are all indistinguishable from a Java login.
The one authoritative signal for the *transport* is the server log: Geyser/
Floodgate emit a line when a Bedrock player connects, e.g.

    [floodgate] Floodgate player logged in as Ex_Vegano joined (UUID: ...)
    Ex_Vegano joined the game            # a pure-Java join has NO Floodgate line

We tail `logs/latest.log` (which Minecraft resets each server start, so it holds
exactly the current session) and keep a live map of online player -> transport.
Read-only; safe to run per worker.
"""
# The production server runs Python 3.9, where `int | None` in an annotation is
# evaluated at runtime and raises. Defer all annotations so modern syntax is safe.
from __future__ import annotations

import os
import re
import threading

_MC_DIR = os.environ.get("MINECRAFT_DIR", ".")
_LOG_PATH = os.path.join(_MC_DIR, "logs", "latest.log")

_FLOODGATE_JOIN = re.compile(r"Floodgate player logged in as (\S+) joined")
_JOIN = re.compile(r"\]: (\S+) joined the game")
_LEAVE = re.compile(r"\]: (\S+) left the game")

_lock = threading.Lock()
_offset = 0
_online: dict[str, str] = {}      # player name -> "bedrock" | "java"
_pending_bedrock: set[str] = set()  # saw a Floodgate line, awaiting the join line


def _reset() -> None:
    global _offset, _online, _pending_bedrock
    _offset = 0
    _online = {}
    _pending_bedrock = set()


def _process_line(line: str) -> None:
    m = _FLOODGATE_JOIN.search(line)
    if m:
        _pending_bedrock.add(m.group(1))
        return
    m = _JOIN.search(line)
    if m:
        name = m.group(1)
        _online[name] = "bedrock" if name in _pending_bedrock else "java"
        _pending_bedrock.discard(name)
        return
    m = _LEAVE.search(line)
    if m:
        _online.pop(m.group(1), None)


def _ingest() -> None:
    """Read any new lines appended since the last call (incremental tail)."""
    global _offset
    try:
        size = os.path.getsize(_LOG_PATH)
    except OSError:
        _reset()
        return
    if size < _offset:
        # File shrank → the server restarted and rotated latest.log. Start over
        # so stale players from the previous session don't linger.
        _reset()
    try:
        with open(_LOG_PATH, "r", encoding="utf-8", errors="replace") as fh:
            fh.seek(_offset)
            for line in fh:
                _process_line(line)
            _offset = fh.tell()
    except OSError:
        pass


def bedrock_online_count() -> int | None:
    """Currently-online players connected via Bedrock, or None if the log is
    unreadable (callers then omit the count rather than show a wrong 0)."""
    if not os.path.exists(_LOG_PATH):
        return None
    with _lock:
        _ingest()
        return sum(1 for transport in _online.values() if transport == "bedrock")
