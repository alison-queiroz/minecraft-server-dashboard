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
    assert get_skin_url("Steve", "uuid-123") == "https://mc-heads.net/skin/Notch"
