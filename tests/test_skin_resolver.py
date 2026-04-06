import pytest
from api.skin_resolver import (
    _proxy_url,
    _resolve_skinsrestorer,
    _resolve_bedrock_skin,
    get_skin_url,
    _MCHEADS_STEVE
)

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
    class MockResponse:
        def read(self):
            return b'{"texture_id": "abc123texture"}'
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    mocker.patch("urllib.request.urlopen", return_value=MockResponse())
    result = _resolve_bedrock_skin("00000000-0000-0000-0009-000000000001")
    assert "abc123texture" in result

def test_resolve_bedrock_skin_no_texture(mocker):
    """Ensure it returns Steve if the Bedrock API responds but has no texture_id."""
    class MockResponse:
        def read(self):
            return b'{"texture_id": null}'
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    mocker.patch("urllib.request.urlopen", return_value=MockResponse())
    assert _resolve_bedrock_skin("00000000-0000-0000-0009-000000000001") == _MCHEADS_STEVE

def test_resolve_bedrock_skin_exception(mocker):
    """Ensure it returns Steve if the Bedrock API fails or times out."""
    mocker.patch("urllib.request.urlopen", side_effect=Exception("Timeout"))
    assert _resolve_bedrock_skin("00000000-0000-0000-0009-000000000001") == _MCHEADS_STEVE

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


# ── _read_skin_value_from_file ────────────────────────────────────────────────

def test_read_skin_value_from_file_value_key(mocker, tmp_path):
    """Reads the 'value' key from a skin JSON file."""
    import json as _json
    f = tmp_path / "skin.json"
    f.write_text(_json.dumps({"value": "base64datahere"}))
    from api.skin_resolver import _read_skin_value_from_file
    assert _read_skin_value_from_file(str(f)) == "base64datahere"


def test_read_skin_value_from_file_nested_texture(mocker, tmp_path):
    """Reads the nested texture.value key."""
    import json as _json
    f = tmp_path / "skin.json"
    f.write_text(_json.dumps({"texture": {"value": "nestedvalue"}}))
    from api.skin_resolver import _read_skin_value_from_file
    assert _read_skin_value_from_file(str(f)) == "nestedvalue"


def test_read_skin_value_from_file_exception(mocker):
    """Returns None when the file cannot be read."""
    from api.skin_resolver import _read_skin_value_from_file
    assert _read_skin_value_from_file("/nonexistent/path.json") is None


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
    # Write a file with no recognisable value keys → _read_skin_value_from_file returns None
    skin_file = tmp_path / (stem + ".json")
    skin_file.write_text("{}")

    mocker.patch.object(sr, "_SR_SKINS_DIR", str(tmp_path))
    mocker.patch("os.path.isdir", side_effect=lambda p: p == str(tmp_path))

    result = sr._find_texture_from_sr_skins("Steve")
    assert result is None


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
    import json as _json
    resp_data = {
        "skin": {
            "texture": {
                "url": {"skin": "https://textures.minecraft.net/texture/mineskin123"},
                "data": {}
            }
        }
    }

    class MockResp:
        def read(self): return _json.dumps(resp_data).encode()
        def __enter__(self): return self
        def __exit__(self, *_): pass

    mocker.patch("urllib.request.urlopen", return_value=MockResp())
    from api.skin_resolver import _resolve_mineskin_texture
    result = _resolve_mineskin_texture("abc123")
    assert result == "https://textures.minecraft.net/texture/mineskin123"


def test_resolve_mineskin_texture_v2_base64_path(mocker):
    """Resolves via the base64 value path when direct URL is absent."""
    import base64, json as _json
    payload = {"textures": {"SKIN": {"url": "https://textures.minecraft.net/texture/frombase64"}}}
    b64 = base64.b64encode(_json.dumps(payload).encode()).decode()

    resp_data = {"skin": {"texture": {"data": {"value": b64}}}}

    class MockResp:
        def read(self): return _json.dumps(resp_data).encode()
        def __enter__(self): return self
        def __exit__(self, *_): pass

    mocker.patch("urllib.request.urlopen", return_value=MockResp())
    from api.skin_resolver import _resolve_mineskin_texture
    result = _resolve_mineskin_texture("abc123")
    assert result == "https://textures.minecraft.net/texture/frombase64"


def test_resolve_mineskin_texture_returns_none_on_failure(mocker):
    """Returns None when all API calls fail."""
    mocker.patch("urllib.request.urlopen", side_effect=Exception("network error"))
    from api.skin_resolver import _resolve_mineskin_texture
    assert _resolve_mineskin_texture("bad-id") is None


def test_resolve_mineskin_texture_returns_none_when_no_url_in_response(mocker):
    """Returns None when the API responds but contains no recognisable URL."""
    import json as _json

    class MockResp:
        def read(self): return _json.dumps({"unexpected": "shape"}).encode()
        def __enter__(self): return self
        def __exit__(self, *_): pass

    mocker.patch("urllib.request.urlopen", return_value=MockResp())
    from api.skin_resolver import _resolve_mineskin_texture
    assert _resolve_mineskin_texture("abc123") is None


# ── _resolve_url_skin ─────────────────────────────────────────────────────────

def test_resolve_url_skin_uses_cache(mocker):
    """Returns the cached result without hitting the network."""
    import time
    import api.skin_resolver as sr
    sr._url_resolution_cache["http://cached.com/skin"] = "https://textures.minecraft.net/texture/cached"
    sr._url_resolved_at["http://cached.com/skin"] = time.time()

    mocker.patch.object(sr, "_find_texture_from_sr_skins", side_effect=AssertionError("should not be called"))
    result = sr._resolve_url_skin("http://cached.com/skin")
    assert result == "https://textures.minecraft.net/texture/cached"

    # cleanup
    del sr._url_resolution_cache["http://cached.com/skin"]
    del sr._url_resolved_at["http://cached.com/skin"]


def test_resolve_url_skin_calls_mineskin_for_mineskin_urls(mocker):
    """Triggers MineSkin resolution for minesk.in / mineskin.org URLs."""
    import api.skin_resolver as sr
    sr._url_resolution_cache.pop("https://minesk.in/abc", None)

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
    import api.skin_resolver as sr
    mocker.patch.object(sr, "_find_texture_from_sr_skins", return_value=None)
    result = sr._resolve_url_skin("http://unknown.com/skin.png")
    assert result == "http://unknown.com/skin.png"


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
