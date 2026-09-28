"""Services catalog: GET /api/services-catalog for any signed-in user and
PUT /api/services-catalog for SERVICES_CATALOG_ADMIN_UIDS only.

The catalog is a JSON file (SERVICES_CATALOG_PATH, default
src/assets/services-catalog.json) that a PUT validates and then replaces
atomically.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Tuple

from flask import Blueprint, abort, g, jsonify, request

from ..auth import _is_services_admin, require_auth

logger = logging.getLogger(__name__)

bp = Blueprint("catalog", __name__)


def _services_catalog_path() -> Path:
    default_path = Path(__file__).resolve().parents[2] / "src" / "assets" / "services-catalog.json"
    return Path(os.environ.get("SERVICES_CATALOG_PATH", str(default_path)))


def _load_services_catalog() -> dict:
    path = _services_catalog_path()
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json_atomic(path: Path, payload: dict) -> None:
    """Write JSON via a temp file in the same directory + os.replace, so a
    crash or concurrent reader never sees a truncated file. Keeps the
    existing file's permissions (temp files are created 0600) and writes
    through a symlinked path instead of replacing the link."""
    import stat
    import tempfile

    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
    tmp = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp", delete=False
    )
    try:
        with tmp:
            json.dump(payload, tmp, ensure_ascii=False, indent=2)
            tmp.write("\n")
            tmp.flush()
            os.fsync(tmp.fileno())
        os.chmod(tmp.name, mode)
        os.replace(tmp.name, path)
    except BaseException:
        os.unlink(tmp.name)
        raise


def _validate_services_catalog(payload: dict) -> Tuple[bool, str]:
    updated_at = payload.get("updatedAt")
    sections = payload.get("sections")

    if not isinstance(updated_at, str) or not updated_at.strip():
        return False, "updatedAt must be a non-empty string"
    if not isinstance(sections, list):
        return False, "sections must be an array"

    for section in sections:
        if not isinstance(section, dict):
            return False, "each section must be an object"
        if not isinstance(section.get("title"), str) or not section["title"].strip():
            return False, "section.title must be a non-empty string"
        if not isinstance(section.get("description"), str):
            return False, "section.description must be a string"
        services = section.get("services")
        if not isinstance(services, list):
            return False, "section.services must be an array"

        for service in services:
            if not isinstance(service, dict):
                return False, "each service must be an object"
            if not isinstance(service.get("name"), str) or not service["name"].strip():
                return False, "service.name must be a non-empty string"
            if not isinstance(service.get("access"), str) or not service["access"].strip():
                return False, "service.access must be a non-empty string"
            host = service.get("host")
            if host is not None and not isinstance(host, str):
                return False, "service.host must be a string when provided"
            port = service.get("port")
            if port is not None and (not isinstance(port, int) or port <= 0):
                return False, "service.port must be a positive integer when provided"

    return True, ""


@bp.route("/api/services-catalog", methods=["GET"])
@require_auth
def services_catalog_get_endpoint():
    try:
        catalog = _load_services_catalog()
    except FileNotFoundError:
        return jsonify({"error": "Services catalog file not found"}), 500
    except Exception as exc:
        logger.error("Failed to read services catalog: %s", exc)
        return jsonify({"error": "Failed to read services catalog"}), 500

    uid = getattr(g, "auth_uid", None)
    return jsonify({"catalog": catalog, "canEdit": _is_services_admin(uid)})


@bp.route("/api/services-catalog", methods=["PUT"])
@require_auth
def services_catalog_put_endpoint():
    uid = getattr(g, "auth_uid", None)
    if not _is_services_admin(uid):
        abort(403)

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400

    valid, error = _validate_services_catalog(body)
    if not valid:
        return jsonify({"error": error}), 400

    try:
        _write_json_atomic(_services_catalog_path(), body)
    except Exception as exc:
        logger.error("Failed to write services catalog: %s", exc)
        return jsonify({"error": "Failed to write services catalog"}), 500

    return jsonify({"ok": True})
