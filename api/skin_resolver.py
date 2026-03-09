from __future__ import annotations

import json
import logging
import os
import re
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

_BEDROCK_UUID_PREFIX = "00000000-0000-0000-0009"
_SR_PLAYERS_DIR = os.path.join("plugins", "SkinsRestorer", "players")
_SR_RECOMMENDATION_PATTERN = re.compile(r"^sr-recommendation-(.+)$")

_WSRV_PROXY = "https://wsrv.nl/?url={}"
_GEYSER_API = "https://api.geysermc.org/v2/skin/{}"
_MINECRAFT_TEXTURE_URL = "https://textures.minecraft.net/texture/{}"
_MCHEADS_SKIN_URL = "https://mc-heads.net/skin/{}"
_MCHEADS_STEVE = "https://mc-heads.net/skin/MHF_Steve"


def _proxy_url(raw_url: str) -> str:
    return _WSRV_PROXY.format(urllib.parse.quote(raw_url, safe=""))


def _resolve_skinsrestorer(uuid: str, fallback: str) -> str:
    sr_file = os.path.join(_SR_PLAYERS_DIR, f"{uuid}.player")
    if not os.path.exists(sr_file):
        return fallback
    try:
        with open(sr_file, "r") as f:
            data = json.load(f)
        identifier = data.get("skinIdentifier", {}).get("identifier", "")
        if not identifier:
            return fallback
        if identifier.startswith("http"):
            return identifier
        match = _SR_RECOMMENDATION_PATTERN.match(identifier)
        return match.group(1) if match else identifier
    except Exception:
        logger.warning("Failed to read SkinsRestorer file for UUID %s", uuid)
        return fallback


def _resolve_bedrock_skin(uuid: str) -> str:
    try:
        xuid = int(uuid.replace("-", "")[16:], 16)
        req = urllib.request.Request(
            _GEYSER_API.format(xuid),
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=4) as response:
            data = json.loads(response.read().decode("utf-8"))
        texture_id = data.get("texture_id")
        if texture_id:
            return _proxy_url(_MINECRAFT_TEXTURE_URL.format(texture_id))
    except Exception:
        logger.warning("Failed to fetch Bedrock skin for UUID %s", uuid)
    return _MCHEADS_STEVE


def get_skin_url(name: str, uuid: str) -> str:
    identifier = _resolve_skinsrestorer(uuid, name)
    if identifier.startswith("http"):
        return _proxy_url(identifier)
    if identifier == name and uuid.startswith(_BEDROCK_UUID_PREFIX):
        return _resolve_bedrock_skin(uuid)
    return _MCHEADS_SKIN_URL.format(identifier)
