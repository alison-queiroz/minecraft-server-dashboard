import pytest
import api.firestore_sync as fs_module
from api.firestore_sync import _to_native, sync_players

def test_to_native_conversion():
    """Ensure complex and nested types are correctly converted to plain Python types."""
    class DummyNBTType:
        def __str__(self):
            return "dummy_string"

    mock_data = {
        "is_admin": True,
        "level": 30.0,
        "health": 20,
        "name": "Steve",
        "inventory": ["sword", {"count": 64}],
        "custom_tag": DummyNBTType(),
        "empty_val": None
    }

    result = _to_native(mock_data)

    assert result["is_admin"] is True
    assert result["level"] == 30.0
    assert result["health"] == 20
    assert result["name"] == "Steve"
    assert result["inventory"] == ["sword", {"count": 64}]
    assert result["custom_tag"] == "dummy_string"
    assert result["empty_val"] is None

def test_sync_players_success(mocker):
    """Ensure players are successfully batched and synced to Firestore."""
    mocker.patch.object(fs_module, "_ensure_firebase", return_value=True)
    mock_client = mocker.patch("firebase_admin.firestore.client")
    mock_db = mock_client.return_value
    mock_batch = mock_db.batch.return_value
    mock_ref = mock_db.collection.return_value.document.return_value

    players = [{"uuid": "123", "name": "Steve"}, {"uuid": "456", "name": "Alex"}]

    sync_players(players)

    assert mock_db.batch.called
    # 2 player documents + 1 analytics snapshot
    assert mock_batch.set.call_count == 3
    mock_batch.commit.assert_called_once()

def test_sync_players_exception(mocker):
    """Ensure the sync process handles exceptions gracefully without crashing."""
    mocker.patch.object(fs_module, "_ensure_firebase", return_value=True)
    mock_client = mocker.patch("firebase_admin.firestore.client", side_effect=Exception("Firestore offline"))
    mock_logger = mocker.patch("api.firestore_sync.logger.warning")

    players = [{"uuid": "123", "name": "Steve"}]
    sync_players(players)

    mock_logger.assert_called_once()
    assert "Firestore player sync failed" in mock_logger.call_args[0][0]
