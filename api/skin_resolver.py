from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import time
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

_BEDROCK_UUID_PREFIX = "00000000-0000-0000-0009"
_SR_PLAYERS_DIR = os.path.join("plugins", "SkinsRestorer", "players")
_SR_SKINS_DIR = os.path.join("plugins", "SkinsRestorer", "skins")
_SR_RECOMMENDATION_PATTERN = re.compile(r"^sr-recommendation-(.+)$")

_WSRV_PROXY = "https://wsrv.nl/?url={}"
_GEYSER_API = "https://api.geysermc.org/v2/skin/{}"
_MINECRAFT_TEXTURE_URL = "https://textures.minecraft.net/texture/{}"
_MCHEADS_SKIN_URL = "https://mc-heads.net/skin/{}"
_MCHEADS_STEVE = "https://mc-heads.net/skin/MHF_Steve"
_MINESKIN_API_V2 = "https://api.mineskin.org/v2/skins/{}"
_MINESKIN_API_V1 = "https://api.mineskin.org/get/uuid/{}"

# Cache resolved URLs so repeated 15-second refreshes avoid network round-trips.
# Only successful resolutions are stored; failures are retried next cycle.
_url_resolution_cache: dict[str, str] = {}
_url_resolved_at: dict[str, float] = {}
_URL_CACHE_TTL = 300  # 5 minutes


def _proxy_url(raw_url: str) -> str:
    return _WSRV_PROXY.format(urllib.parse.quote(raw_url, safe=""))



def _extract_texture_url(b64_value: str) -> str | None:
    """Decodes a Minecraft texture property (base64 JSON) and returns the SKIN url."""
    try:
        decoded = base64.b64decode(b64_value + "===").decode("utf-8")
        data = json.loads(decoded)
        url = data.get("textures", {}).get("SKIN", {}).get("url", "")
        return url if url else None
    except Exception:
        return None



def _sr_filename_candidates(identifier: str) -> list[str]:
    candidates = [
        hashlib.sha256(identifier.encode()).hexdigest(),
        hashlib.sha1(identifier.encode()).hexdigest(),
        re.sub(r"[:/\\?&#%]", "_", identifier).lower(),
        re.sub(r"[:/\\?&#%]", "_", identifier),
    ]
    if "/" in identifier:
        last = identifier.rstrip("/").split("/")[-1]
        candidates += [last.lower(), last]
    return candidates


def _read_skin_value_from_file(path: str) -> str | None:
    try:
        with open(path) as fh:
            data = json.load(fh)
        return (
            data.get("value")
            or (data.get("texture") or {}).get("value")
            or (data.get("skinData") or {}).get("value")
            or (data.get("skinProps") or {}).get("value")
        )
    except Exception:
        return None


def _find_texture_from_sr_skins(identifier: str) -> str | None:
    """Scans the SkinsRestorer skins directory for a cached texture URL."""
    if not os.path.isdir(_SR_SKINS_DIR):
        return None
    candidates = _sr_filename_candidates(identifier)
    _SR_EXTENSIONS = [".customskin", ".playerskin", ".urlskin", ".skin", ".json", ""]
    search_dirs = [_SR_SKINS_DIR] + [
        os.path.join(_SR_SKINS_DIR, sub)
        for sub in ("url", "custom", "player", "legacy", "minecraft")
        if os.path.isdir(os.path.join(_SR_SKINS_DIR, sub))
    ]
    for directory in search_dirs:
        for stem in candidates:
            for ext in _SR_EXTENSIONS:
                path = os.path.join(directory, stem + ext)
                if not os.path.exists(path):
                    continue
                try:
                    # Strategy 1: JSON envelope — file contains {"value": "<b64>", ...}
                    # This is the common format for .customskin / .playerskin files.
                    value = _read_skin_value_from_file(path)
                    if value:
                        tex_url = _extract_texture_url(value)
                        if tex_url:
                            return tex_url

                    # Strategy 2: file content IS the raw base64 texture property.
                    # Some URL skin caches store the b64 JSON blob directly.
                    with open(path, "r", encoding="utf-8") as fh:
                        raw = fh.read().strip()
                    decoded = base64.b64decode(raw + "===").decode("utf-8")
                    data = json.loads(decoded)
                    url = data.get("textures", {}).get("SKIN", {}).get("url", "")
                    if url:
                        return url
                except Exception:
                    logger.warning("Failed to parse SkinsRestorer skin file %s", path)
    return None



def _format_uuid(raw: str) -> str:
    """Returns a UUID with dashes from a 32-char hex string."""
    h = raw.replace("-", "")
    if len(h) == 32:
        return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"
    return raw


def _resolve_mineskin_texture(short_id: str) -> str | None:
    """Calls the MineSkin API to resolve a skin ID to a textures.minecraft.net URL."""
    raw_id = short_id.replace("-", "")
    uuid_id = _format_uuid(raw_id)
    tried: set[str] = set()
    for skin_id in (uuid_id, raw_id):
        for api_url in (_MINESKIN_API_V2.format(skin_id), _MINESKIN_API_V1.format(skin_id)):
            if api_url in tried:
                continue
            tried.add(api_url)
            try:
                req = urllib.request.Request(
                    api_url,
                    headers={"User-Agent": "MinecraftDashboard/1.0"},
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    data = json.loads(resp.read().decode())
                # v2: skin.texture.url.skin / skin.texture.data.value
                # v1: data.texture.url / data.texture.value
                URL_PATHS = [
                    ["skin", "texture", "url", "skin"],   # v2 nested URL dict
                    ["data", "texture", "url"],           # v1 direct string
                ]
                VALUE_PATHS = [
                    ["skin", "texture", "data", "value"],  # v2 base64 property
                    ["data", "texture", "value"],          # v1 base64 property
                ]
                for path in URL_PATHS:
                    try:
                        obj = data
                        for key in path:
                            obj = obj[key]  # type: ignore[index]
                        if isinstance(obj, str) and "textures.minecraft.net" in obj:
                            return obj
                    except (KeyError, TypeError):
                        pass
                for path in VALUE_PATHS:
                    try:
                        obj = data
                        for key in path:
                            obj = obj[key]  # type: ignore[index]
                        if isinstance(obj, str) and len(obj) > 100:
                            decoded = _extract_texture_url(obj)
                            if decoded:
                                return decoded
                    except (KeyError, TypeError):
                        pass
                logger.debug("MineSkin API responded but no URL found. Keys: %s", list(data.keys()))
            except Exception as exc:
                logger.debug("MineSkin API call failed for %s: %s", api_url, exc)
    return None



def _resolve_url_skin(identifier: str) -> str:
    """
    Given a URL identifier from SkinsRestorer, resolves it to a
    textures.minecraft.net URL, going through:
      1. In-memory cache
      2. SkinsRestorer skins-cache directory
      3. MineSkin API (for minesk.in / mineskin.org short URLs)
    Falls back to the raw identifier if nothing works.
    """
    now = time.time()
    if identifier in _url_resolution_cache:
        if now - _url_resolved_at.get(identifier, 0) < _URL_CACHE_TTL:
            return _url_resolution_cache[identifier]

    resolved: str | None = None

    resolved = _find_texture_from_sr_skins(identifier)

    if not resolved and (
        "minesk.in" in identifier or "mineskin.org" in identifier
    ):
        short_id = identifier.rstrip("/").split("/")[-1].split(".")[0]
        resolved = _resolve_mineskin_texture(short_id)

    final = resolved if resolved else identifier
    if resolved:  # only cache successes so failures are retried
        _url_resolution_cache[identifier] = final
        _url_resolved_at[identifier] = now
    return final



def _resolve_skinsrestorer(uuid: str, fallback: str) -> str:
    sr_file = os.path.join(_SR_PLAYERS_DIR, f"{uuid}.player")
    if not os.path.exists(sr_file):
        return fallback
    try:
        with open(sr_file, "r") as f:
            data = json.load(f)

        # Priority 1: SkinsRestorer already resolved + stored the texture in the
        # player file (happens when /skin url ... is used in-game). Decode it
        # directly without any network calls.
        skin_data = data.get("skinData") or {}
        if skin_data.get("value"):
            tex_url = _extract_texture_url(skin_data["value"])
            if tex_url:
                return tex_url

        identifier = data.get("skinIdentifier", {}).get("identifier", "")
        if not identifier:
            return fallback
        local_tex = _find_texture_from_sr_skins(identifier)
        if local_tex:
            return local_tex
        if identifier.startswith("http"):
            return _resolve_url_skin(identifier)
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



_NON_IMAGE_HOSTS = (
    "minesk.in",
    "mineskin.org",
    "namemc.com",
)

def _is_non_image_url(url: str) -> bool:
    """Returns True if the URL is a known web/JSON endpoint, not a direct image."""
    return any(host in url for host in _NON_IMAGE_HOSTS)


def get_skin_url(name: str, uuid: str) -> str:
    identifier = _resolve_skinsrestorer(uuid, name)
    if identifier.startswith("http"):
        # Reject known JSON/web URLs that would cause wsrv.nl to return 404.
        # This can happen if MineSkin resolution fails; fall back to mc-heads.
        if _is_non_image_url(identifier):
            logger.warning(
                "Skin URL for %s (%s) is a non-image URL: %s — falling back to mc-heads",
                name, uuid, identifier,
            )
            return _MCHEADS_SKIN_URL.format(name)
        return _proxy_url(identifier)
    # For bedrock players, always use the GeyserMC API when SR didn't return
    # a direct texture URL.  The SR recommendation name (e.g. "ExVegano4795")
    # won't match the Floodgate-prefixed server name (".ExVegano4795"), so the
    # old `identifier == name` guard was silently bypassing GeyserMC resolution.
    if uuid.startswith(_BEDROCK_UUID_PREFIX):
        return _resolve_bedrock_skin(uuid)
    return _proxy_url(_MCHEADS_SKIN_URL.format(identifier))

