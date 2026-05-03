"""
Shared fixtures for the test suite.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

# apps/ielts/backend on path so `main` and `ielts.*` resolve from tests.
IELTS_BACKEND = ROOT / "apps" / "ielts" / "backend"

# Repo root — needed so `backend.*` still resolves (legacy, pre-deletion).
# Insert ROOT first, then IELTS_BACKEND so IELTS_BACKEND wins over root's main.py.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Always insert at 0 so it takes priority over root main.py.
sys.path.insert(0, str(IELTS_BACKEND))

# ── Test constants ────────────────────────────────────────────────────────────

# New locations (monorepo)
VFDL_DIR  = ROOT / "packages" / "vfdl" / "vfdl"
FLOWS_DIR = IELTS_BACKEND / "ielts" / "agents" / "flows"

# Legacy aliases (used by test_boundary — kept until old tree is deleted)
ENGINE_DIR = ROOT / "backend" / "engine"
APP_DIR    = ROOT / "backend" / "app"

# Flow YAMLs that are proper VFDL flows (exclude programs.yaml — it's a catalog).
FLOW_YAML_NAMES = ["onboarding", "ielts_practice", "ielts_exam", "free_conversation"]
