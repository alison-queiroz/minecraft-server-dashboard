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


def test_log_rotation_resets_state(_reset_state):
    log = _reset_state
    log.write_text(FLOODGATE.format(name="Ex_Vegano") + JOIN.format(name="Ex_Vegano"), encoding="utf-8")
    assert oe.bedrock_online_count() == 1
    # Simulate a server restart: latest.log is replaced by a smaller, fresh file.
    log.write_text(JOIN.format(name="Steve"), encoding="utf-8")
    assert oe.bedrock_online_count() == 0
