---
id: flow-yaml
title: Flow YAML Reference
sidebar_position: 2
---

# Flow YAML Reference

A flow is a single YAML file that describes a deterministic voice conversation as a state machine. The engine reads it once on startup; no server restart is needed to reload (when `FLOWS_DIR` is watched).

---

## Top-Level Structure

```yaml
id: my_flow                   # Unique identifier
version: "1.0.0"              # Semver — used for changelog & version control
initial_state: first_state    # Entry state name
description: "Human note"     # Optional

settings:                     # Global defaults
  base_system_prompt: |
    You are a concise assistant.
  max_duration_secs: 300
  on_timeout: timeout_state
  on_error: error_state

variables:                    # Flow-scoped data collected during the run
  first_name:
    type: string
    required: true

states:                       # State definitions (see below)
  first_state:
    ...
```

---

## Variables

Variables are collected during the flow and interpolated into agent prompts via `{variable_name}`.

```yaml
variables:
  color:
    type: enum
    enum: [blue, green, purple]
    required: true
  score:
    type: number
    required: false
```

| Field | Type | Description |
|---|---|---|
| `type` | `string \| number \| boolean \| enum` | Value type |
| `enum` | `string[]` | Required when `type: enum` |
| `required` | `bool` | Engine warns if flow ends with this unset |
| `default` | any | Initial value (defaults to `null`) |

---

## State

```yaml
states:
  ask_name:
    ui:          # What the client renders
      ...
    agent:       # LLM configuration for this state
      ...
    tools:       # Tool schemas available in this state
      ...
    transitions: # Edges to other states
      ...
    on_enter:    # Hooks run on state entry
      ...
    on_exit:     # Hooks run on state exit
      ...
```

### `ui` — Artifact pushed to the client

```yaml
ui:
  artifact_type: form     # form | options | card | orb_layout | navigate | custom
  fields:
    - id: first_name
      type: text
      label: "Your name"
      placeholder: "e.g. Alex"
      required: true
```

See [Artifact Types](./artifacts) for full payload reference per type.

### `agent` — LLM confinement

```yaml
agent:
  prompt: |
    Ask the user their name. When they say it, call `save_name`.
  tools:
    - save_name        # ONLY these tools are exposed to the LLM in this state
```

The state's `prompt` is **appended** to `settings.base_system_prompt`. The combined prompt is re-injected into the LLM context on every state entry.

:::warning LLM confinement
Tools listed in `agent.tools` that are **not** defined in the state's `tools:` section will be silently ignored. The LLM can only call tools you explicitly allow per state.
:::

### `tools` — Tool schemas

```yaml
tools:
  save_name:
    description: "Save the user's first name."
    parameters:
      first_name:
        type: string
        description: "User's first name as spoken."
        required: true
```

The engine auto-generates the OpenAI function-calling schema from this definition.

### `transitions` — Edges

```yaml
transitions:
  on_tool_call:          # LLM calls a registered tool
    save_name: next_state

  on_ui_event:           # Client sends a ui_event message
    form_submit: next_state
    option_select: next_state

  on_action:             # Internal action emitted by the engine
    confirm: next_state

  on_timeout:            # Auto-advance after silence
    seconds: 60
    target: ask_name
    max_retries: 2
    fallback: error_state
```

#### Transition with side-effects

```yaml
transitions:
  on_tool_call:
    save_name:
      target: next_state
      set:
        greeted: true     # Set a flow variable on transition
```

#### Transition priority (highest → lowest)

1. `on_ui_event` — user explicitly acted
2. `on_tool_call` — LLM called a tool
3. `on_utterance` — regex matched transcript
4. `on_timeout` — timed fallback

### `on_enter` / `on_exit` hooks

```yaml
on_enter:
  - set: { greeted: true }   # Set a flow variable
  - emit: state_entered       # Emit a named analytics event
on_exit:
  - emit: state_exited
```

---

## Guards

Any `on_tool_call` transition can have a guard that must pass before the transition fires:

```yaml
transitions:
  on_tool_call:
    save_color:
      target: confirm_step
      guard:
        all:
          - variable: color
            operator: in
            value: [blue, green, purple]
          - variable: first_name
            operator: not_empty
```

Guard operators: `eq`, `neq`, `in`, `not_in`, `not_empty`, `empty`, `gt`, `lt`, `gte`, `lte`, `matches`.

---

## Reserved State Names

| Name | Meaning |
|---|---|
| `__end__` | Terminal state — flow is complete |
| `__error__` | Engine enters this on unrecoverable error (if `on_error` is unset) |

---

## Versioning Your Flows

Because flow files are plain YAML, **they live in git**. Use the `version` field with semver:

- Bump **patch** for prompt tweaks.
- Bump **minor** for new states or variables.
- Bump **major** for breaking schema changes (rename states, remove transitions).

The engine logs the flow `id` and `version` at session start — visible in structured logs and the `/health` endpoint.
