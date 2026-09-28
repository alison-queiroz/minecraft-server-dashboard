import pytest
import requests
import api.skin_resolver as sr
from api.skin_resolver import (
    _proxy_url,
    _resolve_skinsrestorer,
    _resolve_bedrock_skin,
    get_skin_url,
    _MCHEADS_STEVE
)

BEDROCK_UUID = "00000000-0000-0000-0009-000000000001"


@pytest.fixture(autouse=True)
def _clear_skin_caches():
    """Skin caches are module-global; isolate every test from the others."""
    sr.clear_skin_caches()
    yield
    sr.clear_skin_caches()


def _response(mocker, status=200, payload=None, json_error=False):
    """A requests.Response stand-in with the given status and JSON body."""
    resp = mocker.MagicMock(status_code=status)
    if json_error:
        resp.json.side_effect = ValueError("not json")
    else:
        resp.json.return_value = payload
    if status >= 400:
        resp.raise_for_status.side_effect = requests.HTTPError(f"{status}")
    return resp

def test_proxy_url():
    """Ensure the proxy URL encodes the target URL correctly."""
    target = "https://textures.minecraft.net/texture/123"
    result = _proxy_url(target)
    # Slashes must be encoded as %2F because safe="" is used in skin_resolver.py
    assert result == "https://wsrv.nl/?url=https%3A%2F%2Ftextures.minecraft.net%2Ftexture%2F123"

def test_resolve_skinsrestorer_missing_file(mocker):
    """Ensure it falls back to the default name if the file does not exist."""
    mocker.patch("os.path.exists", return_value=False)
    assert _resolve_skinsrestorer("uuid-123", "SteveFallback") == "SteveFallback"

def test_resolve_skinsrestorer_empty_identifier(mocker):
    """Ensure it falls back if the JSON identifier is empty."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data='{"skinIdentifier": {"identifier": ""}}'))
    assert _resolve_skinsrestorer("uuid-123", "SteveFallback") == "SteveFallback"

def test_resolve_skinsrestorer_http_identifier(mocker):
    """Ensure it returns the identifier directly if it is a URL."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data='{"skinIdentifier": {"identifier": "http://example.com/skin"}}'))
    assert _resolve_skinsrestorer("uuid-123", "SteveFallback") == "http://example.com/skin"

def test_resolve_skinsrestorer_recommendation_pattern(mocker):
    """Ensure it strips the sr-recommendation prefix correctly."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data='{"skinIdentifier": {"identifier": "sr-recommendation-Notch"}}'))
    assert _resolve_skinsrestorer("uuid-123", "SteveFallback") == "Notch"

def test_resolve_skinsrestorer_exception(mocker):
    """Ensure it falls back if reading the JSON fails."""
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=Exception("Corrupted file"))
    assert _resolve_skinsrestorer("uuid-123", "SteveFallback") == "SteveFallback"

def test_resolve_bedrock_skin_success(mocker):
    """Ensure Bedrock UUIDs are converted to XUIDs and fetch the texture correctly."""
    get = mocker.patch.object(sr._http, "get", return_value=_response(mocker, payload={"texture_id": "abc123texture"}))
    result = _resolve_bedrock_skin(BEDROCK_UUID)
    assert "abc123texture" in result
    assert get.call_args.args[0] == sr._GEYSER_API.format(int("0009000000000001", 16))
    assert get.call_args.kwargs["timeout"] == sr._GEYSER_TIMEOUT

def test_resolve_bedrock_skin_no_texture(mocker):
    """Ensure it returns Steve if the Bedrock API responds but has no texture_id."""
    mocker.patch.object(sr._http, "get", return_value=_response(mocker, payload={"texture_id": None}))
    assert _resolve_bedrock_skin(BEDROCK_UUID) == _MCHEADS_STEVE

def test_resolve_bedrock_skin_exception(mocker):
    """Ensure it returns Steve if the Bedrock API fails or times out."""
    mocker.patch.object(sr._http, "get", side_effect=requests.Timeout("Timeout"))
    assert _resolve_bedrock_skin(BEDROCK_UUID) == _MCHEADS_STEVE

def test_resolve_bedrock_skin_http_error_falls_back_to_steve(mocker):
    """A non-2xx Geyser response is treated as a miss rather than parsed."""
    mocker.patch.object(sr._http, "get", return_value=_response(mocker, status=503))
    assert _resolve_bedrock_skin(BEDROCK_UUID) == _MCHEADS_STEVE


# ── Geyser TTL cache ──────────────────────────────────────────────────────────

def test_resolve_bedrock_skin_caches_hits(mocker):
    """A resolved Bedrock skin is served from cache on later refreshes (one HTTP call)."""
    get = mocker.patch.object(sr._http, "get", return_value=_response(mocker, payload={"texture_id": "tex"}))
    first = _resolve_bedrock_skin(BEDROCK_UUID)
    second = _resolve_bedrock_skin(BEDROCK_UUID)
    assert first == second and "tex" in first
    get.assert_called_once()


def test_resolve_bedrock_skin_caches_misses(mocker):
    """A failed lookup is negatively cached, so an outage costs one timeout per window."""
    get = mocker.patch.object(sr._http, "get", side_effect=requests.ConnectionError("down"))
    assert _resolve_bedrock_skin(BEDROCK_UUID) == _MCHEADS_STEVE
    assert _resolve_bedrock_skin(BEDROCK_UUID) == _MCHEADS_STEVE
    get.assert_called_once()


def test_geyser_cache_ttls_positive_longer_than_negative(mocker):
    """Hits are kept for the positive TTL, misses only for the shorter negative TTL."""
    now = [1000.0]
    mocker.patch.object(sr, "_geyser_cache", sr._TTLCache(16, clock=lambda: now[0]))
    get = mocker.patch.object(sr._http, "get", side_effect=requests.ConnectionError("down"))
    _resolve_bedrock_skin(BEDROCK_UUID)
    now[0] += sr._NEGATIVE_TTL + 1
    get.side_effect = None
    get.return_value = _response(mocker, payload={"texture_id": "tex"})
    assert "tex" in _resolve_bedrock_skin(BEDROCK_UUID)  # miss expired → re-fetched
    now[0] += sr._NEGATIVE_TTL + 1
    assert "tex" in _resolve_bedrock_skin(BEDROCK_UUID)  # hit still valid
    assert get.call_count == 2
    assert sr._POSITIVE_TTL > sr._NEGATIVE_TTL
    now[0] += sr._POSITIVE_TTL
    _resolve_bedrock_skin(BEDROCK_UUID)
    assert get.call_count == 3  # hit expired → re-fetched


# ── _TTLCache ─────────────────────────────────────────────────────────────────

def test_ttl_cache_distinguishes_cached_miss_from_absent():
    """A stored None is a hit (cached miss); an unknown key is not."""
    cache = sr._TTLCache(4)
    cache.set("miss", None, 60)
    assert cache.get("miss") == (True, None)
    assert cache.get("unknown") == (False, None)


def test_ttl_cache_is_bounded_lru():
    """Beyond max_entries the least recently used entry is evicted (no unbounded growth)."""
    cache = sr._TTLCache(2)
    cache.set("a", "1", 60)
    cache.set("b", "2", 60)
    cache.get("a")  # touch → "b" is now least recently used
    cache.set("c", "3", 60)
    assert len(cache) == 2
    assert cache.get("b") == (False, None)
    assert cache.get("a") == (True, "1")


def test_ttl_cache_expires_and_clears():
    """Expired entries are dropped on read, and clear() empties the cache."""
    now = [0.0]
    cache = sr._TTLCache(4, clock=lambda: now[0])
    cache.set("k", "v", 10)
    now[0] = 10.0
    assert cache.get("k") == (False, None)
    assert len(cache) == 0
    cache.set("k", "v", 10)
    cache.clear()
    assert len(cache) == 0


def test_clear_skin_caches_empties_url_and_geyser_caches():
    """clear_skin_caches() forgets URL resolutions and Bedrock lookups alike."""
    sr._url_resolution_cache.set("http://x", "tex", 60)
    sr._geyser_cache.set(BEDROCK_UUID, "url", 60)
    sr.clear_skin_caches()
    assert len(sr._url_resolution_cache) == 0
    assert len(sr._geyser_cache) == 0


def test_legacy_url_cache_names_still_clearable():
    """server_api's force-resync handlers clear both legacy names; both must keep working."""
    sr._url_resolution_cache.set("http://x", "tex", 60)
    sr._url_resolution_cache.clear()
    sr._url_resolved_at.clear()
    assert len(sr._url_resolution_cache) == 0

def test_get_skin_url_from_url(mocker):
    """Ensure a direct HTTP identifier is proxied."""
    mocker.patch("api.skin_resolver._resolve_skinsrestorer", return_value="http://texture.com/123")
    # Slashes must be encoded as %2F because safe="" is used in skin_resolver.py
    assert get_skin_url("Steve", "uuid") == "https://wsrv.nl/?url=http%3A%2F%2Ftexture.com%2F123"

def test_get_skin_url_bedrock(mocker):
    """Ensure a bedrock fallback triggers the bedrock resolution."""
    mocker.patch("api.skin_resolver._resolve_skinsrestorer", return_value="PlayerName")
    mock_bedrock = mocker.patch("api.skin_resolver._resolve_bedrock_skin", return_value="bedrock_url")
    result = get_skin_url("PlayerName", "00000000-0000-0000-0009-1234")
    mock_bedrock.assert_called_once()
    assert result == "bedrock_url"

def test_get_skin_url_java(mocker):
    """Ensure standard Java names go through mc-heads."""
    mocker.patch("api.skin_resolver._resolve_skinsrestorer", return_value="Notch")
    assert get_skin_url("Steve", "uuid-123") == "https://wsrv.nl/?url=https%3A%2F%2Fmc-heads.net%2Fskin%2FNotch"


# ── _extract_texture_url ──────────────────────────────────────────────────────

def test_extract_texture_url_valid():
    """Decodes a valid base64 Minecraft texture property and returns the SKIN url."""
    import base64, json as _json
    payload = {"textures": {"SKIN": {"url": "https://textures.minecraft.net/texture/abc"}}}
    b64 = base64.b64encode(_json.dumps(payload).encode()).decode()
    from api.skin_resolver import _extract_texture_url
    assert _extract_texture_url(b64) == "https://textures.minecraft.net/texture/abc"


def test_extract_texture_url_missing_skin_key():
    """Returns None when the SKIN key is absent."""
    import base64, json as _json
    payload = {"textures": {}}
    b64 = base64.b64encode(_json.dumps(payload).encode()).decode()
    from api.skin_resolver import _extract_texture_url
    assert _extract_texture_url(b64) is None


def test_extract_texture_url_invalid_base64():
    """Returns None on decode/parse failure."""
    from api.skin_resolver import _extract_texture_url
    assert _extract_texture_url("!!!not-valid-base64!!!") is None


# ── _sr_filename_candidates ───────────────────────────────────────────────────

def test_sr_filename_candidates_simple():
    """Returns sha256, sha1, and sanitised variants for a simple identifier."""
    from api.skin_resolver import _sr_filename_candidates
    results = _sr_filename_candidates("Steve")
    assert len(results) >= 3
    # All entries must be strings
    assert all(isinstance(r, str) for r in results)


def test_sr_filename_candidates_url_with_path():
    """Appends last-path-segment candidates when identifier contains a slash."""
    from api.skin_resolver import _sr_filename_candidates
    results = _sr_filename_candidates("https://example.com/skins/abc123")
    # Should include 'abc123' and 'abc123' (lowercased) variants
    assert any("abc123" in r for r in results)


# ── _find_texture_from_sr_skins ───────────────────────────────────────────────

def test_find_texture_from_sr_skins_no_directory(mocker):
    """Returns None immediately when the skins directory does not exist."""
    mocker.patch("os.path.isdir", return_value=False)
    from api.skin_resolver import _find_texture_from_sr_skins
    assert _find_texture_from_sr_skins("Steve") is None


def test_find_texture_from_sr_skins_found(mocker, tmp_path):
    """Finds a cached texture URL by scanning the skins directory."""
    import base64, json as _json
    payload = {"textures": {"SKIN": {"url": "https://textures.minecraft.net/texture/found123"}}}
    b64 = base64.b64encode(_json.dumps(payload).encode()).decode()

    import hashlib
    stem = hashlib.sha256("Steve".encode()).hexdigest()
    skin_file = tmp_path / (stem + ".json")
    skin_file.write_text(_json.dumps({"value": b64}))

    import api.skin_resolver as sr
    mocker.patch.object(sr, "_SR_SKINS_DIR", str(tmp_path))
    mocker.patch("os.path.isdir", side_effect=lambda p: p == str(tmp_path))

    result = sr._find_texture_from_sr_skins("Steve")
    assert result == "https://textures.minecraft.net/texture/found123"


def test_find_texture_from_sr_skins_no_valid_texture(mocker, tmp_path):
    """Returns None (line 101) when files exist but none yields a valid texture URL."""
    import hashlib
    import api.skin_resolver as sr

    stem = hashlib.sha256("Steve".encode()).hexdigest()
    # Write a file with no recognisable value keys → no texture can be extracted
    skin_file = tmp_path / (stem + ".json")
    skin_file.write_text("{}")

    mocker.patch.object(sr, "_SR_SKINS_DIR", str(tmp_path))
    mocker.patch("os.path.isdir", side_effect=lambda p: p == str(tmp_path))

    result = sr._find_texture_from_sr_skins("Steve")
    assert result is None


def test_find_texture_from_sr_skins_reads_raw_base64_blob(mocker, tmp_path):
    """Parses files where the entire content is the raw base64 texture payload."""
    import base64
    import hashlib
    import json as _json
    import api.skin_resolver as sr

    payload = {"textures": {"SKIN": {"url": "https://textures.minecraft.net/texture/rawblob"}}}
    raw_b64 = base64.b64encode(_json.dumps(payload).encode()).decode()

    stem = hashlib.sha256("raw-identifier".encode()).hexdigest()
    skin_file = tmp_path / (stem + ".json")
    # Ensure strategy 1 yields no value key, forcing strategy 2 parsing.
    skin_file.write_text(raw_b64, encoding="utf-8")

    mocker.patch.object(sr, "_SR_SKINS_DIR", str(tmp_path))
    mocker.patch("os.path.isdir", side_effect=lambda p: p == str(tmp_path))

    assert sr._find_texture_from_sr_skins("raw-identifier") == "https://textures.minecraft.net/texture/rawblob"


# ── _format_uuid ──────────────────────────────────────────────────────────────

def test_format_uuid_inserts_dashes():
    from api.skin_resolver import _format_uuid
    # Provide a clean 32-char hex string (no dashes)
    raw = "069a79f444e947261a5befca90e38aaf"
    assert len(raw) == 32
    result = _format_uuid(raw)
    assert result.count("-") == 4


def test_format_uuid_passthrough_if_not_32_chars():
    from api.skin_resolver import _format_uuid
    assert _format_uuid("short") == "short"


# ── _resolve_mineskin_texture ─────────────────────────────────────────────────

def test_resolve_mineskin_texture_v2_url_path(mocker):
    """Resolves a direct URL from the v2 API response."""
    resp_data = {
        "skin": {
            "texture": {
                "url": {"skin": "https://textures.minecraft.net/texture/mineskin123"},
                "data": {}
            }
        }
    }
    get = mocker.patch.object(sr._http, "get", return_value=_response(mocker, payload=resp_data))
    result = sr._resolve_mineskin_texture("abc123")
    assert result == "https://textures.minecraft.net/texture/mineskin123"
    assert get.call_args.kwargs["timeout"] == sr._MINESKIN_TIMEOUT


def test_resolve_mineskin_texture_v2_base64_path(mocker):
    """Resolves via the base64 value path when direct URL is absent."""
    import base64, json as _json
    payload = {"textures": {"SKIN": {"url": "https://textures.minecraft.net/texture/frombase64"}}}
    b64 = base64.b64encode(_json.dumps(payload).encode()).decode()
    resp_data = {"skin": {"texture": {"data": {"value": b64}}}}
    mocker.patch.object(sr._http, "get", return_value=_response(mocker, payload=resp_data))
    assert sr._resolve_mineskin_texture("abc123") == "https://textures.minecraft.net/texture/frombase64"


def test_resolve_mineskin_texture_stops_when_unreachable(mocker):
    """A connection error/timeout aborts at once instead of stacking four timeouts."""
    get = mocker.patch.object(sr._http, "get", side_effect=requests.ConnectionError("network error"))
    assert sr._resolve_mineskin_texture("069a79f444e947261a5befca90e38aaf") is None
    get.assert_called_once()


def test_resolve_mineskin_texture_tries_next_variant_after_http_error(mocker):
    """A 404 or a non-JSON body moves on to the next endpoint/ID form."""
    ok = {"data": {"texture": {"url": "https://textures.minecraft.net/texture/v1"}}}
    get = mocker.patch.object(sr._http, "get", side_effect=[
        _response(mocker, status=404),
        _response(mocker, json_error=True),
        _response(mocker, payload=ok),
    ])
    assert sr._resolve_mineskin_texture("069a79f444e947261a5befca90e38aaf") == "https://textures.minecraft.net/texture/v1"
    assert get.call_count == 3


def test_resolve_mineskin_texture_returns_none_when_no_url_in_response(mocker):
    """Returns None when the API responds but contains no recognisable URL."""
    get = mocker.patch.object(sr._http, "get", return_value=_response(mocker, payload={"unexpected": "shape"}))
    assert sr._resolve_mineskin_texture("abc123") is None
    # Non-32-hex IDs have a single form → v2 + v1 only.
    assert get.call_count == 2


def test_resolve_mineskin_texture_non_dict_body_is_a_miss(mocker):
    """A JSON body that is not an object is treated as 'no URL found'."""
    mocker.patch.object(sr._http, "get", return_value=_response(mocker, payload=["not", "a", "dict"]))
    assert sr._resolve_mineskin_texture("abc123") is None


# ── _resolve_url_skin ─────────────────────────────────────────────────────────

def test_resolve_url_skin_uses_cache(mocker):
    """Returns the cached result without hitting the network."""
    sr._url_resolution_cache.set("http://cached.com/skin", "https://textures.minecraft.net/texture/cached", 60)
    mocker.patch.object(sr, "_find_texture_from_sr_skins", side_effect=AssertionError("should not be called"))
    result = sr._resolve_url_skin("http://cached.com/skin")
    assert result == "https://textures.minecraft.net/texture/cached"


def test_resolve_url_skin_calls_mineskin_for_mineskin_urls(mocker):
    """Triggers MineSkin resolution for minesk.in / mineskin.org URLs."""
    mocker.patch.object(sr, "_find_texture_from_sr_skins", return_value=None)
    mock_mineskin = mocker.patch.object(
        sr, "_resolve_mineskin_texture",
        return_value="https://textures.minecraft.net/texture/x"
    )
    result = sr._resolve_url_skin("https://minesk.in/abc")
    mock_mineskin.assert_called_once()
    assert result == "https://textures.minecraft.net/texture/x"


def test_resolve_url_skin_falls_back_to_raw_identifier(mocker):
    """Returns the raw identifier when resolution fails."""
    mocker.patch.object(sr, "_find_texture_from_sr_skins", return_value=None)
    result = sr._resolve_url_skin("http://unknown.com/skin.png")
    assert result == "http://unknown.com/skin.png"


def test_resolve_url_skin_caches_hits(mocker):
    """A resolved URL skin is not re-scanned or re-queried on the next refresh."""
    scan = mocker.patch.object(sr, "_find_texture_from_sr_skins", return_value="https://textures.minecraft.net/texture/hit")
    assert sr._resolve_url_skin("http://a/skin") == "https://textures.minecraft.net/texture/hit"
    assert sr._resolve_url_skin("http://a/skin") == "https://textures.minecraft.net/texture/hit"
    scan.assert_called_once()


def test_resolve_url_skin_caches_misses(mocker):
    """An unresolvable MineSkin URL costs one scan + one API round per negative TTL, not per refresh."""
    scan = mocker.patch.object(sr, "_find_texture_from_sr_skins", return_value=None)
    mineskin = mocker.patch.object(sr, "_resolve_mineskin_texture", return_value=None)
    assert sr._resolve_url_skin("https://minesk.in/bad") == "https://minesk.in/bad"
    assert sr._resolve_url_skin("https://minesk.in/bad") == "https://minesk.in/bad"
    scan.assert_called_once()
    mineskin.assert_called_once()


def test_resolve_skinsrestorer_url_identifier_scans_skins_dir_once(mocker):
    """URL identifiers consult the cache first and scan the skins dir once (it used to scan twice)."""
    import json as _json
    player_json = _json.dumps({"skinIdentifier": {"identifier": "https://minesk.in/abc"}})
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=player_json))
    scan = mocker.patch.object(sr, "_find_texture_from_sr_skins", return_value=None)
    mocker.patch.object(sr, "_resolve_mineskin_texture", return_value="https://textures.minecraft.net/texture/m")
    assert _resolve_skinsrestorer("uuid-1", "fallback") == "https://textures.minecraft.net/texture/m"
    assert _resolve_skinsrestorer("uuid-1", "fallback") == "https://textures.minecraft.net/texture/m"
    scan.assert_called_once()


# ── _is_non_image_url ─────────────────────────────────────────────────────────

def test_is_non_image_url_detects_known_hosts():
    from api.skin_resolver import _is_non_image_url
    assert _is_non_image_url("https://minesk.in/abc123") is True
    assert _is_non_image_url("https://mineskin.org/abc") is True
    assert _is_non_image_url("https://namemc.com/profile/Steve") is True


def test_is_non_image_url_returns_false_for_texture_url():
    from api.skin_resolver import _is_non_image_url
    assert _is_non_image_url("https://textures.minecraft.net/texture/abc") is False


# ── get_skin_url non-image-URL branch ────────────────────────────────────────

def test_get_skin_url_non_image_url_falls_back_to_mcheads(mocker):
    """Falls back to mc-heads when the resolved URL points to a web/JSON endpoint."""
    mocker.patch("api.skin_resolver._resolve_skinsrestorer", return_value="https://minesk.in/abc")
    result = get_skin_url("Steve", "uuid-java")
    assert result == "https://mc-heads.net/skin/Steve"


# ── _resolve_skinsrestorer: skinData.value branch ────────────────────────────

def test_resolve_skinsrestorer_skin_data_value(mocker):
    """Returns a texture URL when skinData.value is already in the player file."""
    import base64, json as _json
    payload = {"textures": {"SKIN": {"url": "https://textures.minecraft.net/texture/direct"}}}
    b64 = base64.b64encode(_json.dumps(payload).encode()).decode()

    player_json = _json.dumps({"skinData": {"value": b64}})
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=player_json))
    assert _resolve_skinsrestorer("uuid-123", "fallback") == "https://textures.minecraft.net/texture/direct"


# ── _resolve_skinsrestorer: URL with minesk.in → _resolve_url_skin ───────────

def test_resolve_skinsrestorer_url_identifier_calls_resolve_url_skin(mocker):
    """When identifier starts with 'http', delegates to _resolve_url_skin."""
    import json as _json
    player_json = _json.dumps({"skinIdentifier": {"identifier": "http://minesk.in/abc"}})
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=player_json))

    mock_resolve = mocker.patch("api.skin_resolver._resolve_url_skin", return_value="https://textures.minecraft.net/texture/resolved")
    result = _resolve_skinsrestorer("uuid-123", "fallback")
    mock_resolve.assert_called_once_with("http://minesk.in/abc")
    assert result == "https://textures.minecraft.net/texture/resolved"


def test_resolve_skinsrestorer_returns_local_texture_when_available(mocker):
    """Prefers a local SkinsRestorer texture hit before URL/recommendation logic."""
    import json as _json

    player_json = _json.dumps({"skinIdentifier": {"identifier": "sr-recommendation-Notch"}})
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=player_json))
    mocker.patch(
        "api.skin_resolver._find_texture_from_sr_skins",
        return_value="https://textures.minecraft.net/texture/local-hit",
    )

    assert _resolve_skinsrestorer("uuid-local", "fallback") == "https://textures.minecraft.net/texture/local-hit"
