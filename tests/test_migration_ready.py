"""
test_migration_ready.py — Monorepo restructure readiness tests.

These tests are EXPECTED TO FAIL until the monorepo migration is complete
(i.e. backend/engine/ → packages/vfdl/vfdl/).

After migration:
  1. `pip install -e packages/vfdl` (or uv add)
  2. Run this file — all tests should pass
  3. Remove the xfail markers

The tests also serve as the import contract for the `vfdl` package:
they document exactly what must be importable after the restructure.
"""
import pytest


# ── Package availability ───────────────────────────────────────────────────────

def test_vfdl_package_is_importable():
    import vfdl  # noqa: F401


# ── Core engine imports ────────────────────────────────────────────────────────

def test_vfdl_flow_engine_imports():
    from vfdl.flow_engine import (  # noqa: F401
        FlowConfig,
        load_flow,
        validate_flow,
        build_tool_schemas,
        VoiceFlowController,
    )


def test_vfdl_flow_agent_imports():
    from vfdl.agents.flow_agent import FlowAgent  # noqa: F401


def test_vfdl_artifacts_imports():
    from vfdl.agents.artifacts import (  # noqa: F401
        SEND_ARTIFACT_SCHEMA,
        make_send_artifact_handler,
    )


def test_vfdl_control_observer_imports():
    from vfdl.agents.control_observer import ControlObserver  # noqa: F401


def test_vfdl_bot_imports():
    from vfdl.bot import run_bot, create_pipeline_services  # noqa: F401


def test_vfdl_store_imports():
    from vfdl.store.interface import SessionStore  # noqa: F401
    from vfdl.store.sqlite import SqliteSessionStore  # noqa: F401


def test_vfdl_pvp_imports():
    from vfdl.pvp.session import BaseVoiceSession, SessionContext  # noqa: F401


# ── Behaviour contract: load_flow must work from installed package ─────────────

def test_vfdl_load_flow_works(tmp_path):
    """After migration, load_flow must still parse a minimal valid YAML."""
    from vfdl.flow_engine import FlowConfig, load_flow

    yaml_content = """
id: test_flow
version: "1.0.0"
initial_state: start
settings:
  base_system_prompt: "You are a test assistant."
states:
  start:
    agent:
      prompt: "Begin the test."
      tools: []
    transitions:
      on_tool_call: {}
      on_ui_event: {}
      on_action: {}
"""
    flow_file = tmp_path / "test_flow.yaml"
    flow_file.write_text(yaml_content)

    flow = load_flow(flow_file)
    assert isinstance(flow, FlowConfig)
    assert flow.id == "test_flow"
    assert flow.initial_state == "start"
