"""Guard: keep the api/ package importable on production's Python 3.9.

Prod runs Python 3.9, where PEP 604 unions (`int | None`) written directly in
an annotation are evaluated at runtime and raise TypeError — which crashed the
gunicorn workers (a 502) when a module used the syntax without deferring
annotations. Local dev/CI runs a newer Python where the same code loads fine,
so that class of break slips through the test gate.

This test closes the gap on any interpreter: it fails unless every non-empty
api/*.py module starts (after an optional docstring) with
`from __future__ import annotations`, which makes all annotations lazy and the
modern syntax safe on 3.9.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

_API_DIR = Path(__file__).resolve().parent.parent / "api"


def _api_modules() -> list[Path]:
    # __init__.py is empty and imports nothing; skip empty files generally.
    return [p for p in sorted(_API_DIR.glob("*.py")) if p.read_text(encoding="utf-8").strip()]


def _defers_annotations(source: str) -> bool:
    """True if the module's first statement (past a docstring) is
    `from __future__ import annotations`."""
    tree = ast.parse(source)
    for node in tree.body:
        # A leading module docstring doesn't count as the first statement.
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        return (
            isinstance(node, ast.ImportFrom)
            and node.module == "__future__"
            and any(alias.name == "annotations" for alias in node.names)
        )
    return False


@pytest.mark.parametrize("module", _api_modules(), ids=lambda p: p.name)
def test_api_module_defers_annotations(module: Path):
    assert _defers_annotations(module.read_text(encoding="utf-8")), (
        f"{module.name} must start with `from __future__ import annotations` so PEP 604 "
        f"unions stay safe on production's Python 3.9 (see tests/test_python39_compat.py)."
    )
