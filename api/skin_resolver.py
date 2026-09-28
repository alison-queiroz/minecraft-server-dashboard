from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import threading
import time
import urllib.parse
from collections import OrderedDict
from typing import Any, Callable, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

_MC_DIR = os.environ.get("MINECRAFT_DIR", ".")
_BEDROCK_UUID_PREFIX = "00000000-0000-0000-0009"
_SR_PLAYERS_DIR = os.path.join(_MC_DIR, "plugins", "SkinsRestorer", "players")
_SR_SKINS_DIR = os.path.join(_MC_DIR, "plugins", "SkinsRestorer", "skins")
_SR_RECOMMENDATION_PATTERN = re.compile(r"^sr-recommendation-(.+)$")

_WSRV_PROXY = "https://wsrv.nl/?url={}"
_GEYSER_API = "https://api.geysermc.org/v2/skin/{}"
_MINECRAFT_TEXTURE_URL = "https://textures.minecraft.net/texture/{}"
_MCHEADS_SKIN_URL = "https://mc-heads.net/skin/{}"
_MCHEADS_STEVE = "https://mc-heads.net/skin/MHF_Steve"
_MINESKIN_API_V2 = "https://api.mineskin.org/v2/skins/{}"
_MINESKIN_API_V1 = "https://api.mineskin.org/get/uuid/{}"

# Explicit (connect, read) timeouts so a slow third-party API cannot pin a
# player rescan for long.
_GEYSER_TIMEOUT = (3.05, 4.0)
_MINESKIN_TIMEOUT = (3.05, 5.0)

# A resolved texture URL never changes for a given identifier, so hits are kept
# for hours; misses (API down, unknown skin) are retried after a few minutes.
_POSITIVE_TTL = 6 * 3600.0
_NEGATIVE_TTL = 15 * 60.0
_CACHE_MAX_ENTRIES = 1024

# One pooled session: keep-alive to the few API hosts. urllib3's connection
# pool is thread-safe for these plain GETs.
_http = requests.Session()


class _TTLCache:
    """Thread-safe, size-bounded (LRU) map whose entries expire after a per-entry TTL.

    A stored value of None is a cached miss, distinct from "not cached".
    """

    def __init__(self, max_entries: int, clock: Callable[[], float] = time.monotonic) -> None:
        self._max_entries = max_entries
        self._clock = clock
        self._entries: OrderedDict[str, Tuple[float, Optional[str]]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Tuple[bool, Optional[str]]:
        """Return (hit, value); an expired entry is dropped and counts as a miss."""
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return False, None
            if entry[0] <= self._clock():
                del self._entries[key]
                return False, None
            self._entries.move_to_end(key)
            return True, entry[1]

    def set(self, key: str, value: Optional[str], ttl: float) -> None:
        with self._lock:
            self._entries[key] = (self._clock() + ttl, value)
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


# SkinsRestorer URL identifier -> textures.minecraft.net URL (None = unresolved).
_url_resolution_cache = _TTLCache(_CACHE_MAX_ENTRIES)
# Legacy alias: server_api's force-resync handlers still clear both names.
# Drop it once they call player_data.invalidate_caches() instead.
_url_resolved_at = _url_resolution_cache
# Bedrock player UUID -> proxied skin URL (None = Steve until the miss expires).
_geyser_cache = _TTLCache(_CACHE_MAX_ENTRIES)


def clear_skin_caches() -> None:
    """Forget every resolved skin so the next lookup re-reads disk and re-queries the APIs."""
    _url_resolution_cache.clear()
    _geyser_cache.clear()


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
                    # Read the file once and try both known layouts.
                    with open(path, "r", encoding="utf-8") as fh:
                        raw = fh.read().strip()

                    # Strategy 1: JSON envelope — file contains {"value": "<b64>", ...}
                    # This is the common format for .customskin / .playerskin files.
                    try:
                        envelope = json.loads(raw)
                    except (json.JSONDecodeError, ValueError):
                        envelope = None
                    if isinstance(envelope, dict):
                        value = (
                            envelope.get("value")
                            or (envelope.get("texture") or {}).get("value")
                            or (envelope.get("skinData") or {}).get("value")
                            or (envelope.get("skinProps") or {}).get("value")
                        )
                        if value:
                            tex_url = _extract_texture_url(value)
                            if tex_url:
                                return tex_url

                    # Strategy 2: file content IS the raw base64 texture property.
                    # Some URL skin caches store the b64 JSON blob directly.
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


# v2: skin.texture.url.skin / skin.texture.data.value
# v1: data.texture.url / data.texture.value
_MINESKIN_URL_PATHS = (
    ("skin", "texture", "url", "skin"),   # v2 nested URL dict
    ("data", "texture", "url"),           # v1 direct string
)
_MINESKIN_VALUE_PATHS = (
    ("skin", "texture", "data", "value"),  # v2 base64 property
    ("data", "texture", "value"),          # v1 base64 property
)


def _dig(data: Any, path: Tuple[str, ...]) -> Any:
    """Follow a key path through nested dicts; None when any step is missing."""
    for key in path:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data


def _texture_from_mineskin(data: Any) -> str | None:
    """Extract a textures.minecraft.net URL from a MineSkin v1/v2 response body."""
    for path in _MINESKIN_URL_PATHS:
        obj = _dig(data, path)
        if isinstance(obj, str) and "textures.minecraft.net" in obj:
            return obj
    for path in _MINESKIN_VALUE_PATHS:
        obj = _dig(data, path)
        if isinstance(obj, str) and len(obj) > 100:
            decoded = _extract_texture_url(obj)
            if decoded:
                return decoded
    return None


def _resolve_mineskin_texture(short_id: str) -> str | None:
    """Calls the MineSkin API to resolve a skin ID to a textures.minecraft.net URL.

    Tries the v2 and v1 endpoints for the dashed and raw ID forms, but stops as
    soon as MineSkin is unreachable: every remaining attempt would hit the same
    host and only stack more timeouts onto the rescan.
    """
    raw_id = short_id.replace("-", "")
    uuid_id = _format_uuid(raw_id)
    tried: set[str] = set()
    for skin_id in (uuid_id, raw_id):
        for api_url in (_MINESKIN_API_V2.format(skin_id), _MINESKIN_API_V1.format(skin_id)):
            if api_url in tried:
                continue
            tried.add(api_url)
            try:
                resp = _http.get(
                    api_url,
                    headers={"User-Agent": "MinecraftDashboard/1.0"},
                    timeout=_MINESKIN_TIMEOUT,
                )
            except requests.RequestException as exc:
                logger.debug("MineSkin API unreachable (%s): %s", api_url, exc)
                return None
            if resp.status_code != 200:
                logger.debug("MineSkin API returned %s for %s", resp.status_code, api_url)
                continue
            try:
                data = resp.json()
            except ValueError:
                logger.debug("MineSkin API returned non-JSON for %s", api_url)
                continue
            found = _texture_from_mineskin(data)
            if found:
                return found
            logger.debug(
                "MineSkin API responded but no URL found. Keys: %s",
                list(data.keys()) if isinstance(data, dict) else type(data).__name__,
            )
    return None


def _resolve_url_skin(identifier: str) -> str:
    """
    Given a URL identifier from SkinsRestorer, resolves it to a
    textures.minecraft.net URL, going through:
      1. In-memory cache (hits and misses, so an unresolvable URL is not
         re-scanned and re-queried on every refresh)
      2. SkinsRestorer skins-cache directory
      3. MineSkin API (for minesk.in / mineskin.org short URLs)
    Falls back to the raw identifier if nothing works.
    """
    hit, cached = _url_resolution_cache.get(identifier)
    if hit:
        return cached or identifier

    resolved = _find_texture_from_sr_skins(identifier)
    if not resolved and (
        "minesk.in" in identifier or "mineskin.org" in identifier
    ):
        short_id = identifier.rstrip("/").split("/")[-1].split(".")[0]
        resolved = _resolve_mineskin_texture(short_id)

    _url_resolution_cache.set(identifier, resolved, _POSITIVE_TTL if resolved else _NEGATIVE_TTL)
    return resolved or identifier


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
        if identifier.startswith("http"):
            # Cache first: the skins-directory scan (and MineSkin) runs once per
            # TTL inside _resolve_url_skin, not on every refresh.
            return _resolve_url_skin(identifier)
        local_tex = _find_texture_from_sr_skins(identifier)
        if local_tex:
            return local_tex
        match = _SR_RECOMMENDATION_PATTERN.match(identifier)
        return match.group(1) if match else identifier
    except Exception:
        logger.warning("Failed to read SkinsRestorer file for UUID %s", uuid, exc_info=True)
        return fallback


def _resolve_bedrock_skin(uuid: str) -> str:
    """Skin for a Floodgate (Bedrock) player via the GeyserMC API, cached per player.

    Hits are kept for _POSITIVE_TTL. Failures and players without a texture fall
    back to Steve and are retried after _NEGATIVE_TTL, so a Geyser outage costs
    one timeout per player per window instead of one per refresh.
    """
    hit, cached = _geyser_cache.get(uuid)
    if hit:
        return cached or _MCHEADS_STEVE
    url: str | None = None
    try:
        xuid = int(uuid.replace("-", "")[16:], 16)
        resp = _http.get(
            _GEYSER_API.format(xuid),
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=_GEYSER_TIMEOUT,
        )
        resp.raise_for_status()
        texture_id = resp.json().get("texture_id")
        if texture_id:
            url = _proxy_url(_MINECRAFT_TEXTURE_URL.format(texture_id))
    except Exception as exc:
        logger.warning("Failed to fetch Bedrock skin for UUID %s: %s", uuid, exc)
    _geyser_cache.set(uuid, url, _POSITIVE_TTL if url else _NEGATIVE_TTL)
    return url or _MCHEADS_STEVE


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

