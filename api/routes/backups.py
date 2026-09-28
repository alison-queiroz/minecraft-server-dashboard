"""Backups: GET /api/backups lists a Google Drive folder of world backups.

Only the DRIVE_FOLDER_ID root and folders proven to sit under it can be
listed. The service-account Drive client, the verified-folder set and the
folder listings are cached per worker.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Optional, Tuple

from flask import Blueprint, jsonify, request
from google.oauth2 import service_account
from googleapiclient.discovery import Resource, build
from googleapiclient.errors import HttpError
from googleapiclient.http import HttpRequest

from .. import auth
from ..auth import require_auth

logger = logging.getLogger(__name__)

bp = Blueprint("backups", __name__)


_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
# Drive ids are URL-safe tokens. Anything else is refused before it can reach
# the Drive query language (the id is interpolated into files.list's `q`).
_DRIVE_ID_RE = re.compile(r"[A-Za-z0-9_-]{10,128}")
_DRIVE_MAX_DEPTH = 10            # parent lookups allowed when proving a folder sits under the root
_DRIVE_KNOWN_FOLDER_TTL = 600.0  # seconds a folder stays verified as under the root
_DRIVE_LISTING_TTL = 60.0        # seconds a folder listing is served from memory

# The service-account credentials + Drive client are built once per process
# (the credentials cache their OAuth token, so requests stop paying a token
# round-trip). httplib2 under the client is not thread-safe, so building it and
# every Drive call are serialized; listings are cached, so contention is rare.
_drive_lock = threading.Lock()
_drive_client: Optional[Resource] = None

_drive_cache_lock = threading.Lock()
_drive_known_folders: dict[str, float] = {}  # folder id -> verified_at
_drive_listings: dict[str, Tuple[float, list]] = {}  # folder id -> (fetched_at, files)


def _drive_service() -> Resource:
    """The process-wide Drive v3 client, built on first use. A missing key
    file raises FileNotFoundError and is retried on the next call."""
    global _drive_client
    with _drive_lock:
        if _drive_client is None:
            creds_path = os.environ.get("DRIVE_SA_KEY", "/home/opc/minecraft/drive-service-account.json")
            creds = service_account.Credentials.from_service_account_file(creds_path, scopes=_DRIVE_SCOPES)
            _drive_client = build("drive", "v3", credentials=creds)
        return _drive_client


def _drive_execute(req: HttpRequest) -> dict:
    with _drive_lock:
        return req.execute()


def _drive_parents(folder_id: str) -> list:
    """Parent ids of a Drive item; [] when the service account cannot see it."""
    try:
        meta = _drive_execute(
            _drive_service().files().get(fileId=folder_id, fields="parents", supportsAllDrives=True)
        )
    except HttpError as exc:
        if getattr(exc.resp, "status", None) == 404:
            return []
        raise
    return list(meta.get("parents") or [])


def _is_known_folder(folder_id: str, now: float) -> bool:
    with _drive_cache_lock:
        verified_at = _drive_known_folders.get(folder_id)
    return verified_at is not None and now - verified_at < _DRIVE_KNOWN_FOLDER_TTL


def _folder_within_root(folder_id: str, root_id: str) -> bool:
    """True if folder_id is the backups root or one of its descendants.

    Walks up the parents (at most _DRIVE_MAX_DEPTH Drive lookups) until it
    reaches the root or a recently verified folder. Every folder on a
    successful path is remembered for _DRIVE_KNOWN_FOLDER_TTL, so browsing
    down the tree costs at most one lookup per level.
    """
    if folder_id == root_id:
        return True
    now = time.time()
    chain: list[str] = []
    current = folder_id
    while not _is_known_folder(current, now):
        if len(chain) >= _DRIVE_MAX_DEPTH:
            return False
        chain.append(current)
        parents = _drive_parents(current)
        if root_id in parents:
            break
        if not parents:
            return False
        current = parents[0]
    with _drive_cache_lock:
        for verified in chain:
            _drive_known_folders[verified] = now
    return True


def _list_drive_folder(folder_id: str) -> list:
    """Files in a Drive folder, served from memory for _DRIVE_LISTING_TTL."""
    now = time.time()
    with _drive_cache_lock:
        cached = _drive_listings.get(folder_id)
    if cached is not None and now - cached[0] < _DRIVE_LISTING_TTL:
        return cached[1]
    results = _drive_execute(_drive_service().files().list(
        q=f"'{folder_id}' in parents and trashed = false",
        fields="files(id, name, mimeType, createdTime, size, webContentLink)",
        orderBy="folder, createdTime desc",
    ))
    files = results.get("files", [])
    with _drive_cache_lock:
        _drive_listings[folder_id] = (now, files)
    return files


@bp.route("/api/backups", methods=["GET"])
@require_auth
def backups_endpoint():
    """List a Drive backups folder: the DRIVE_FOLDER_ID root by default, or
    ?folderId= when it is a well-formed id of a folder under that root."""
    root_folder_id = os.environ.get("DRIVE_FOLDER_ID", "YOUR_GOOGLE_DRIVE_FOLDER_ID")
    folder_id = request.args.get("folderId") or root_folder_id
    if folder_id != root_folder_id and not _DRIVE_ID_RE.fullmatch(folder_id):
        return jsonify({"error": "Invalid folderId"}), 400
    try:
        if not _folder_within_root(folder_id, root_folder_id):
            return jsonify({"error": "Folder is outside the backups root"}), 403
        return jsonify(_list_drive_folder(folder_id))

    except FileNotFoundError as exc:
        # In local/dev fallback mode (Firebase not initialized), missing Drive
        # credentials should not fail the dashboard health checks.
        if not auth._FIREBASE_INITIALIZED:
            logger.warning("Drive credentials missing in dev mode: %s", exc)
            return jsonify([])
        logger.error("Drive credentials missing in protected mode: %s", exc)
        return jsonify({"error": "Failed to fetch backups"}), 500
    except Exception as exc:
        logger.error("Failed to fetch backups from Google Drive: %s", exc)
        return jsonify({"error": "Failed to fetch backups"}), 500


def _reset_for_tests() -> None:
    """Test hook: forget the Drive client and caches so tests are order-independent."""
    global _drive_client
    with _drive_lock:
        _drive_client = None
    with _drive_cache_lock:
        _drive_known_folders.clear()
        _drive_listings.clear()
