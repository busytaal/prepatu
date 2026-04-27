"""
test_boundary.py — Architectural import boundary enforcement.

Rule: backend/engine/ must NEVER import from backend/app/.

These tests scan every .py source file in the engine package and fail
if any line contains a direct reference to the app layer.

Run any time you touch engine files.
"""
import re
from pathlib import Path

import pytest

from tests.conftest import ENGINE_DIR, VFDL_DIR

# Patterns that would constitute a violation in the engine / vfdl package.
_VIOLATIONS = [
    re.compile(r"from\s+backend\.app"),
    re.compile(r"import\s+backend\.app"),
    re.compile(r"from\s+ielts"),
    re.compile(r"import\s+ielts"),
]

def _vfdl_py_files():
    """Files in the new monorepo vfdl package."""
    return [
        p for p in VFDL_DIR.rglob("*.py")
        if "__pycache__" not in p.parts
    ]

def _engine_py_files():
    """Files in the legacy backend/engine/ tree (until it is deleted)."""
    return [
        p for p in ENGINE_DIR.rglob("*.py")
        if "__pycache__" not in p.parts
    ]

@pytest.mark.parametrize("py_file", _vfdl_py_files(), ids=lambda p: p.relative_to(VFDL_DIR).as_posix())
def test_vfdl_does_not_import_app(py_file: Path):
    """No vfdl package file may import from ielts.* or backend.app.*"""
    source = py_file.read_text(encoding="utf-8")
    for pattern in _VIOLATIONS:
        matches = pattern.findall(source)
        assert not matches, (
            f"{py_file.relative_to(VFDL_DIR)} contains a forbidden app import:\n"
            + "\n".join(matches)
        )

@pytest.mark.parametrize("py_file", _engine_py_files(), ids=lambda p: p.relative_to(ENGINE_DIR).as_posix())
def test_engine_does_not_import_app(py_file: Path):
    """No engine file may import from backend.app.*  (legacy tree check)"""
    source = py_file.read_text(encoding="utf-8")
    legacy_violations = [
        re.compile(r"from\s+backend\.app"),
        re.compile(r"import\s+backend\.app"),
    ]
    for pattern in legacy_violations:
        matches = pattern.findall(source)
        assert not matches, (
            f"{py_file.relative_to(ENGINE_DIR)} contains a forbidden app import:\n"
            + "\n".join(matches)
        )
