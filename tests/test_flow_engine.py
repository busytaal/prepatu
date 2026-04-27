"""
test_flow_engine.py — VFDL engine unit tests.

Tests the core VFDL runtime (load_flow, validate_flow, build_tool_schemas)
against the real flow YAML files.  No network, no audio, no LLM calls.

These tests must pass on the current codebase AND after the monorepo
restructure (imports will change to `from vfdl.flow_engine import ...`).
"""
import pytest
from pathlib import Path

from tests.conftest import FLOWS_DIR, FLOW_YAML_NAMES
from vfdl.agents.flow_engine import (
    FlowConfig,
    load_flow,
    validate_flow,
    build_tool_schemas,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _flow_path(name: str) -> Path:
    return FLOWS_DIR / f"{name}.yaml"


# ── Load tests ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("flow_name", FLOW_YAML_NAMES)
def test_load_flow_returns_flow_config(flow_name: str):
    """Every YAML loads without error and returns a FlowConfig."""
    flow = load_flow(_flow_path(flow_name))
    assert isinstance(flow, FlowConfig)


@pytest.mark.parametrize("flow_name", FLOW_YAML_NAMES)
def test_flow_has_required_fields(flow_name: str):
    """Every flow has an id, a non-empty initial_state, and at least one state."""
    flow = load_flow(_flow_path(flow_name))
    assert flow.id, f"{flow_name}: missing id"
    assert flow.initial_state, f"{flow_name}: missing initial_state"
    assert flow.states, f"{flow_name}: states dict is empty"


@pytest.mark.parametrize("flow_name", FLOW_YAML_NAMES)
def test_initial_state_exists_in_states(flow_name: str):
    """initial_state must be a key in the states dict."""
    flow = load_flow(_flow_path(flow_name))
    assert flow.initial_state in flow.states, (
        f"{flow_name}: initial_state '{flow.initial_state}' not found in states: {list(flow.states)}"
    )


# ── Validation tests ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("flow_name", FLOW_YAML_NAMES)
def test_validate_flow_no_errors(flow_name: str):
    """validate_flow() must return zero errors for all shipped flows."""
    flow = load_flow(_flow_path(flow_name))
    errors = validate_flow(flow, registered_backend_tools=set())
    assert errors == [], (
        f"{flow_name} has validation errors:\n" + "\n".join(errors)
    )


# ── Tool schema tests ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("flow_name", FLOW_YAML_NAMES)
def test_build_tool_schemas_returns_list(flow_name: str):
    """build_tool_schemas() returns a list (possibly empty for flows with no tools)."""
    flow = load_flow(_flow_path(flow_name))
    schemas = build_tool_schemas(flow)
    assert isinstance(schemas, list)


def test_build_tool_schemas_names_are_strings():
    """Every generated schema has a non-empty string name."""
    flow = load_flow(_flow_path("onboarding"))
    schemas = build_tool_schemas(flow)
    for s in schemas:
        assert isinstance(s.name, str) and s.name, f"Tool schema has invalid name: {s!r}"


def test_tool_names_match_agent_tool_refs():
    """All tools referenced in agent.tools across states appear in the schema list."""
    flow = load_flow(_flow_path("onboarding"))
    schemas = build_tool_schemas(flow)
    schema_names = {s.name for s in schemas}

    referenced = set()
    for state in flow.states.values():
        referenced.update(state.agent.tools)

    missing = referenced - schema_names
    assert not missing, f"Tools referenced in YAML but missing from schemas: {missing}"


# ── Settings tests ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("flow_name", FLOW_YAML_NAMES)
def test_base_system_prompt_is_non_empty(flow_name: str):
    """Every flow must declare a base_system_prompt in settings."""
    flow = load_flow(_flow_path(flow_name))
    prompt = (flow.settings.base_system_prompt or "").strip()
    assert prompt, f"{flow_name}: base_system_prompt is empty"
