---
id: state-machine
title: State Machine & Transitions
sidebar_position: 3
---

# State Machine

The VFDL flow engine is a deterministic [Harel statechart](https://en.wikipedia.org/wiki/State_diagram#Harel_statechart) — a directed graph where nodes are states and edges are transitions. The LLM operates *inside* a state; it does not control the graph.

---

## State Entry Sequence

When the engine enters a new state it runs the following steps **in order**:

```
1. Execute on_enter hooks (set variables, emit analytics)
2. Push flow_state message to client (renders the UI artifact)
3. Update LLM context:
   a. New system prompt = base_prompt + state.agent.prompt (with {variables} interpolated)
   b. Register ONLY tools listed in state.agent.tools
4. Trigger LLM generation (agent speaks immediately)
5. Start timeout timer (if transitions.on_timeout defined)
6. Begin listening for transition events
```

---

## Transition Sources & Priority

Multiple events can fire simultaneously. The engine resolves by priority:

| Priority | Source | Trigger |
|---|---|---|
| 1 (highest) | `on_ui_event` | Client sends a `ui_event` JSON message |
| 2 | `on_tool_call` | LLM calls a registered tool |
| 3 | `on_utterance` | Regex matches the STT transcript |
| 4 (lowest) | `on_timeout` | Timer expires |

This means a user tapping a form button always wins over an LLM tool call.

---

## The LLM is Confined

At every state entry the engine:

1. **Replaces** the system prompt — the LLM forgets previous state objectives.
2. **Re-registers** tools — only tools from `state.agent.tools` are available. The LLM literally cannot call tools from other states.

If the LLM attempts to call a tool not in the current state's list, the engine rejects the call and logs a warning.

---

## Hallucination Prevention

For each LLM-driven transition there must be at least one deterministic backup. The engine supports two mechanisms:

### `on_utterance` — regex bypass

Before the LLM processes the transcript, the engine checks `on_utterance` patterns. A match skips the LLM entirely:

```yaml
transitions:
  on_utterance:
    - pattern: "(?:my name is|i'm|i am|call me)\\s+([A-Za-z]+)"
      capture_to: first_name
      target: next_state
```

### `on_timeout` — re-prompt

If the LLM never calls the expected tool, the timer fires and re-enters the same state (or advances to a fallback):

```yaml
transitions:
  on_timeout:
    seconds: 60
    target: ask_name    # re-enter this state
    max_retries: 2
    fallback: error_state
```

---

## Terminal State

`__end__` is the reserved terminal identifier. When any transition targets `__end__`, the engine:

1. Runs `on_exit` hooks for the current state.
2. Emits a `flow_end` message to the client with final variable values.
3. Tears down the session or returns to an idle assistant, depending on `mode`.

---

## Confirmation Gate

A built-in double-confirmation pattern. Declare it on any state:

```yaml
confirmation_gate:
  variables: [first_name, date_of_birth]
  on_confirm: next_state
  on_reject:
    action: clear
    target: collect_info
```

The engine auto-generates `confirm_<state>` and `reject_<state>` tools, exposes them to the LLM, and handles the branching — no transition boilerplate required.
