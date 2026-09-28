"""Advancements: GET /api/advancements/<uuid> lists a Java player's completed
advancements and GET /api/advancements/description returns one
advancement's description (fetched lazily when a chip is hovered/focused).

The data comes from api/advancements.py (not this blueprint module), imported
lazily and explicitly as ``..advancements``.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..auth import _is_valid_uuid, require_auth

bp = Blueprint("advancements", __name__)


@bp.route("/api/advancements/<uuid>", methods=["GET"])
@require_auth
def advancements_endpoint(uuid: str):
    """Return completed advancements for a Java player UUID."""
    # Strict UUID validation to prevent path traversal (shared with homes routes).
    if not _is_valid_uuid(uuid):
        return jsonify({"error": "Invalid UUID"}), 400
    from ..advancements import get_advancements
    return jsonify(get_advancements(uuid))


@bp.route("/api/advancements/description", methods=["GET"])
@require_auth
def advancement_description_endpoint():
    """Return the description for a single advancement id (e.g. minecraft:story/mine_stone).
    Fetched lazily by the frontend only when the user hovers / focuses a chip."""
    adv_id = request.args.get("id", "").strip()
    if not adv_id:
        return jsonify({"error": "Missing id"}), 400
    from ..advancements import get_description
    return jsonify({"description": get_description(adv_id)})
