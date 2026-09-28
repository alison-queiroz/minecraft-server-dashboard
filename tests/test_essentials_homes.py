"""Tests for api/essentials_homes.py: reading homes from EssentialsX userdata
YAML (world-name vs world keys, malformed files) and creating, updating and
deleting them through the atomic YAML writer."""
import pytest


# ── read_essentials_homes ─────────────────────────────────────────────────────

def test_read_essentials_homes_missing_file(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns an empty list when the player YAML file does not exist."""
    from api.essentials_homes import read_essentials_homes
    mocker.patch("os.path.exists", return_value=False)
    assert read_essentials_homes("some-uuid") == []


def test_read_essentials_homes_yaml_unavailable(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns an empty list gracefully when PyYAML is not installed."""
    import api.essentials_homes as eh
    orig = eh._YAML_AVAILABLE
    eh._YAML_AVAILABLE = False
    try:
        assert eh.read_essentials_homes("some-uuid") == []
    finally:
        eh._YAML_AVAILABLE = orig


def test_read_essentials_homes_no_homes_section(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns an empty list when the YAML has no 'homes' key."""
    from api.essentials_homes import read_essentials_homes
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="teleportenabled: true\n"))
    assert read_essentials_homes("some-uuid") == []


def test_read_essentials_homes_uses_world_name_key(mocker: "pytest_mock.MockerFixture", tmp_path: "pytest.TempPathFactory") -> None:
    """Prefers the 'world-name' key over the 'world' UUID value."""
    from api.essentials_homes import read_essentials_homes, _ESSENTIALS_USERDATA_DIR
    yaml_text = (
        "homes:\n"
        "  casa:\n"
        "    world: ea0bedd7-d319-4848-959e-bdcdb6e8ce94\n"
        "    world-name: world\n"
        "    x: -122.334\n"
        "    y: 102.0\n"
        "    z: 41.345\n"
    )
    uid = "82657f6f-8a86-3af7-958b-f70b1d2b9c1b"
    yml_file = tmp_path / f"{uid}.yml"
    yml_file.write_text(yaml_text, encoding="utf-8")
    mocker.patch("api.essentials_homes._ESSENTIALS_USERDATA_DIR", str(tmp_path))
    homes = read_essentials_homes(uid)
    assert homes == [{"name": "casa", "world": "world", "x": -122.334, "y": 102.0, "z": 41.345}]


def test_read_essentials_homes_falls_back_to_world_uuid_when_no_world_name(
    mocker: "pytest_mock.MockerFixture",
    tmp_path: "pytest.TempPathFactory",
) -> None:
    """Falls back to the 'world' key when 'world-name' is absent."""
    from api.essentials_homes import read_essentials_homes
    yaml_text = (
        "homes:\n"
        "  base:\n"
        "    world: world_nether\n"
        "    x: 10.0\n"
        "    y: 50.0\n"
        "    z: -5.0\n"
    )
    uid = "some-uuid"
    (tmp_path / f"{uid}.yml").write_text(yaml_text, encoding="utf-8")
    mocker.patch("api.essentials_homes._ESSENTIALS_USERDATA_DIR", str(tmp_path))
    homes = read_essentials_homes(uid)
    assert homes[0]["world"] == "world_nether"


def test_read_essentials_homes_multiple_homes_multiple_worlds(
    mocker: "pytest_mock.MockerFixture",
    tmp_path: "pytest.TempPathFactory",
) -> None:
    """Parses multiple homes spanning different worlds correctly."""
    from api.essentials_homes import read_essentials_homes
    yaml_text = (
        "homes:\n"
        "  home:\n"
        "    world: ea0bedd7-uuid\n"
        "    world-name: world\n"
        "    x: 0.0\n"
        "    y: 64.0\n"
        "    z: 0.0\n"
        "  nether:\n"
        "    world: 9f80e0ae-uuid\n"
        "    world-name: world_nether\n"
        "    x: -100.0\n"
        "    y: 52.0\n"
        "    z: -337.0\n"
    )
    uid = "some-uuid"
    (tmp_path / f"{uid}.yml").write_text(yaml_text, encoding="utf-8")
    mocker.patch("api.essentials_homes._ESSENTIALS_USERDATA_DIR", str(tmp_path))
    homes = read_essentials_homes(uid)
    assert len(homes) == 2
    worlds = {h["name"]: h["world"] for h in homes}
    assert worlds["home"] == "world"
    assert worlds["nether"] == "world_nether"


def test_read_essentials_homes_corrupted_yaml(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns an empty list without raising when the YAML is malformed."""
    from api.essentials_homes import read_essentials_homes
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=": invalid: [yaml"))
    assert read_essentials_homes("some-uuid") == []


# ── read_essentials_homes extra branches ─────────────────────────────────────

def test_read_essentials_homes_non_dict_root_returns_empty(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns empty list when YAML root is not a mapping."""
    from api.essentials_homes import read_essentials_homes
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="- item"))
    assert read_essentials_homes("uuid") == []


def test_read_essentials_homes_skips_non_dict_home_entries(mocker: "pytest_mock.MockerFixture") -> None:
    """Skips malformed home entries that are not mappings."""
    from api.essentials_homes import read_essentials_homes
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch(
        "builtins.open",
        mocker.mock_open(read_data="homes:\n  home: 123\n  base:\n    world: world\n    x: 1\n    y: 2\n    z: 3\n"),
    )
    homes = read_essentials_homes("uuid")
    assert homes == [{"name": "base", "world": "world", "x": 1.0, "y": 2.0, "z": 3.0}]


# ── atomic YAML writer ────────────────────────────────────────────────────────

def test_write_essentials_yaml_atomic_writes_file(tmp_path: "pytest.TempPathFactory") -> None:
    """Writes YAML atomically via temp file replacement."""
    from api.essentials_homes import _write_essentials_yaml_atomic
    yml_path = tmp_path / "user.yml"
    _write_essentials_yaml_atomic(str(yml_path), {"homes": {"home": {"world": "world", "x": 1, "y": 2, "z": 3}}})
    content = yml_path.read_text(encoding="utf-8")
    assert "homes" in content
    assert "world" in content


# ── create/update/delete homes ────────────────────────────────────────────────

def test_create_essentials_home_yaml_unavailable_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when YAML backend is unavailable."""
    import api.essentials_homes as eh
    orig = eh._YAML_AVAILABLE
    eh._YAML_AVAILABLE = False
    try:
        assert eh.create_essentials_home("u", "home", 1, 2, 3, "world") is False
    finally:
        eh._YAML_AVAILABLE = orig


def test_create_essentials_home_existing_name_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when a home with the same name already exists."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="homes:\n  home:\n    world: world\n"))
    assert eh.create_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_create_essentials_home_success_creates_dirs_and_writes(mocker: "pytest_mock.MockerFixture", tmp_path: "pytest.TempPathFactory") -> None:
    """Creates home successfully and writes YAML atomically."""
    import api.essentials_homes as eh
    mocker.patch.object(eh, "_ESSENTIALS_USERDATA_DIR", str(tmp_path))
    mocker.patch("api.essentials_homes._write_essentials_yaml_atomic", return_value=None)

    assert eh.create_essentials_home("u1", "base", 1.0, 64.0, 2.0, "world") is True


def test_create_essentials_home_exception_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when file I/O raises (e.g. disk/permission error)."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=OSError("boom"))
    assert eh.create_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_create_essentials_home_existing_file_with_non_dict_data_is_handled(mocker: "pytest_mock.MockerFixture") -> None:
    """Executes non-dict YAML root handling branch even if subsequent write fails."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="- item"))
    mocker.patch("api.essentials_homes._write_essentials_yaml_atomic", return_value=None)
    assert eh.create_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_yaml_unavailable_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when YAML backend is unavailable."""
    import api.essentials_homes as eh
    orig = eh._YAML_AVAILABLE
    eh._YAML_AVAILABLE = False
    try:
        assert eh.update_essentials_home("u", "home", 1, 2, 3, "world") is False
    finally:
        eh._YAML_AVAILABLE = orig


def test_update_essentials_home_missing_file_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when player YAML does not exist."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=False)
    assert eh.update_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_non_dict_data_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when loaded YAML root is not a mapping."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="- bad"))
    assert eh.update_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_missing_target_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when target home does not exist."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="homes:\n  other:\n    world: world\n"))
    assert eh.update_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_success_rename_and_world_name(mocker: "pytest_mock.MockerFixture") -> None:
    """Updates coords and renames home while preserving world-name key style."""
    import api.essentials_homes as eh
    yaml_data = "homes:\n  home:\n    world-name: world\n    x: 0\n    y: 64\n    z: 0\n"
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=yaml_data))
    write_spy = mocker.patch("api.essentials_homes._write_essentials_yaml_atomic", return_value=None)

    assert eh.update_essentials_home("u", "home", 1, 2, 3, "world_nether", new_name="base") is True
    assert write_spy.called


def test_update_essentials_home_exception_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when update path hits file I/O error."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=OSError("boom"))
    assert eh.update_essentials_home("u", "home", 1, 2, 3, "world") is False


def test_update_essentials_home_updates_world_key_when_world_name_absent(mocker: "pytest_mock.MockerFixture") -> None:
    """Uses the world key path when world-name is not present in entry."""
    import api.essentials_homes as eh
    yaml_data = "homes:\n  home:\n    world: world\n    x: 0\n    y: 64\n    z: 0\n"
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data=yaml_data))
    write_spy = mocker.patch("api.essentials_homes._write_essentials_yaml_atomic", return_value=None)
    assert eh.update_essentials_home("u", "home", 7, 8, 9, "world_the_end") is True
    assert write_spy.called


def test_delete_essentials_home_yaml_unavailable_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when YAML backend is unavailable."""
    import api.essentials_homes as eh
    orig = eh._YAML_AVAILABLE
    eh._YAML_AVAILABLE = False
    try:
        assert eh.delete_essentials_home("u", "home") is False
    finally:
        eh._YAML_AVAILABLE = orig


def test_delete_essentials_home_missing_file_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when player YAML does not exist."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=False)
    assert eh.delete_essentials_home("u", "home") is False


def test_delete_essentials_home_non_dict_or_missing_home_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when YAML is malformed or target home is absent."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="homes:\n  other:\n    world: world\n"))
    assert eh.delete_essentials_home("u", "home") is False


def test_delete_essentials_home_success(mocker: "pytest_mock.MockerFixture") -> None:
    """Deletes existing home and writes updated YAML."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="homes:\n  home:\n    world: world\n"))
    write_spy = mocker.patch("api.essentials_homes._write_essentials_yaml_atomic", return_value=None)
    assert eh.delete_essentials_home("u", "home") is True
    assert write_spy.called


def test_delete_essentials_home_exception_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when delete path hits file I/O error."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", side_effect=OSError("boom"))
    assert eh.delete_essentials_home("u", "home") is False


def test_delete_essentials_home_non_dict_root_returns_false(mocker: "pytest_mock.MockerFixture") -> None:
    """Returns False when delete reads malformed non-dict YAML root."""
    import api.essentials_homes as eh
    mocker.patch("os.path.exists", return_value=True)
    mocker.patch("builtins.open", mocker.mock_open(read_data="- bad"))
    assert eh.delete_essentials_home("u", "home") is False
