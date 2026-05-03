---
id: flow-engine
title: Flow Engine
sidebar_position: 2
---

# Flow Engine

`VoiceFlowController` is the runtime that executes a `FlowConfig` state machine inside a Pipecat session.

---

## Loading a Flow

```python
from vfdl.flow_engine import load_flow, validate_flow

flow = load_flow("./flows/onboarding.yaml")
# returns a FlowConfig Pydantic model — validated at load time
```

`validate_flow(flow)` performs additional consistency checks:
- All `initial_state` and transition targets exist in `states`.
- Tools referenced in `agent.tools` have schemas in `tools:`.
- Required variables are reachable before `__end__`.

---

## FlowConfig Model

```python
class FlowConfig(BaseModel):
    id: str
    version: str
    initial_state: str
    description: str
    variables: dict[str, VariableDef]
    settings: FlowSettings
    states: dict[str, StateConfig]
```

---

## Building Tool Schemas

```python
from vfdl.flow_engine import build_tool_schemas

schemas = build_tool_schemas(flow)
# returns List[FunctionSchema] — passed directly to LLMContext(tools=schemas)
```

The function:
1. Collects tool definitions from every state's `tools:` section (first definition wins).
2. Auto-generates stubs for `confirm_X` / `reject_X` confirmation-gate tools.
3. Generates zero-arg stubs for tools listed in `agent.tools` but missing a `tools:` definition.

---

## VoiceFlowController

The controller is instantiated once per session and wired into the Pipecat pipeline:

```python
controller = VoiceFlowController(
    flow=flow,
    send_artifact=websocket_send,   # coroutine that pushes JSON to client
    store=session_store,            # optional SQLite store
    scoring_callback=my_fn,         # called at flow_end with final variables
)

await controller.start()            # enters initial_state
await controller.handle_tool_call("save_name", {"first_name": "Alex"})
await controller.handle_ui_event("form_submit", {"first_name": "Alex"})
```

### Key methods

| Method | Description |
|---|---|
| `start()` | Enter `initial_state`, push first artifact |
| `handle_tool_call(name, args)` | Process an LLM tool call, evaluate transitions |
| `handle_ui_event(action, data)` | Process a client `ui_event`, evaluate transitions |
| `get_current_prompt()` | Returns interpolated system prompt for current state |
| `get_current_tools()` | Returns tool names allowed in current state |
