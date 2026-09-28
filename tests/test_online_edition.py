"""Tests for the server-log-based Bedrock-vs-Java online split."""
import pytest
import api.online_edition as oe


@pytest.fixture(autouse=True)
def _reset_state(tmp_path, monkeypatch):
    """Point the module at a temp log and reset its tail state around each test."""
    log = tmp_path / "latest.log"
    log.write_text("", encoding="utf-8")
    monkeypatch.setattr(oe, "_LOG_PATH", str(log))
    oe._reset()
    yield log
    oe._reset()


FLOODGATE = "[17:57:55 INFO]: [floodgate] Floodgate player logged in as {name} joined (UUID: x)\n"
JOIN = "[17:57:55 INFO]: {name} joined the game\n"
LEAVE = "[18:10:00 INFO]: {name} left the game\n"


def test_counts_floodgate_join_as_bedrock(_reset_state):
    log = _reset_state
    log.write_text(
        FLOODGATE.format(name="Ex_Vegano") + JOIN.format(name="Ex_Vegano") + JOIN.format(name="Steve"),
        encoding="utf-8",
    )
    # Ex_Vegano joined via Floodgate (Bedrock); Steve is a plain Java join.
    assert oe.bedrock_online_count() == 1


def test_leave_removes_player(_reset_state):
    log = _reset_state
    log.write_text(FLOODGATE.format(name="Ex_Vegano") + JOIN.format(name="Ex_Vegano"), encoding="utf-8")
    assert oe.bedrock_online_count() == 1
    # Append a leave and re-read incrementally.
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(LEAVE.format(name="Ex_Vegano"))
    assert oe.bedrock_online_count() == 0


def test_pure_java_join_is_not_bedrock(_reset_state):
    log = _reset_state
    log.write_text(JOIN.format(name="Steve"), encoding="utf-8")
    assert oe.bedrock_online_count() == 0


def test_returns_none_when_log_missing(monkeypatch):
    monkeypatch.setattr(oe, "_LOG_PATH", "/no/such/latest.log")
    oe._reset()
    assert oe.bedrock_online_count() is None


def test_rotation_to_a_larger_file_resets_state(_reset_state, tmp_path):
    """A replaced latest.log is detected by inode even when it already outgrew the old offset."""
    import os
    log = _reset_state
    log.write_text(FLOODGATE.format(name="Ex_Vegano") + JOIN.format(name="Ex_Vegano"), encoding="utf-8")
    assert oe.bedrock_online_count() == 1
    # New session: Minecraft moves latest.log away and starts a new file that
    # grows past the previous offset before the next poll.
    fresh = tmp_path / "latest.new"
    fresh.write_text(JOIN.format(name="Steve") * 20, encoding="utf-8")
    os.replace(fresh, log)
    assert oe.bedrock_online_count() == 0


def test_log_vanishing_between_exists_and_stat_resets_state(_reset_state, mocker):
    """If latest.log disappears mid-rotation, state is cleared instead of kept stale."""
    log = _reset_state
    log.write_text(FLOODGATE.format(name="Ex_Vegano") + JOIN.format(name="Ex_Vegano"), encoding="utf-8")
    assert oe.bedrock_online_count() == 1
    # exists() is pinned because on POSIX it is itself built on os.stat.
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("os.stat", side_effect=FileNotFoundError("rotating"))
    assert oe.bedrock_online_count() == 0


def test_unreadable_log_is_logged_not_raised(_reset_state, mocker):
    """An OSError while tailing is logged at debug level and the count degrades to 0."""
    log = _reset_state
    log.write_text(JOIN.format(name="Steve"), encoding="utf-8")
    mocker.patch("builtins.open", side_effect=OSError("permission denied"))
    debug = mocker.patch.object(oe.logger, "debug")
    assert oe.bedrock_online_count() == 0
    assert debug.call_args.kwargs.get("exc_info") is True


def test_log_rotation_resets_state(_reset_state):
    log = _reset_state
    log.write_text(FLOODGATE.format(name="Ex_Vegano") + JOIN.format(name="Ex_Vegano"), encoding="utf-8")
    assert oe.bedrock_online_count() == 1
    # Simulate a server restart: latest.log is replaced by a smaller, fresh file.
    log.write_text(JOIN.format(name="Steve"), encoding="utf-8")
    assert oe.bedrock_online_count() == 0
