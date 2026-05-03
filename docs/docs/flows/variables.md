---
id: variables
title: Variables & Interpolation
sidebar_position: 6
---

# Variables & Interpolation

Variables are named values collected during a flow — a user's name, a date, a selection. They're declared at the top of the YAML, set by tool calls or UI events, and automatically interpolated into prompts and UI artifacts.

---

## Declaring Variables

```yaml
variables:
  first_name:
    type: string
    required: true
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
| `enum` | `string[]` | Allowed values (required when `type: enum`) |
| `required` | `bool` | Engine warns if the flow ends with this unset |
| `default` | any | Initial value (defaults to `null`) |

---

## Setting Variables

Variables are set in three ways:

### 1. Tool call arguments

When the LLM calls a tool, the engine stores every argument as a flow variable:

```yaml
tools:
  save_name:
    parameters:
      first_name: { type: string, required: true }
```

```
LLM calls save_name(first_name="Alex")
→ Engine sets first_name = "Alex"
```

### 2. UI events

When the frontend sends a `ui_event`, any data in the payload is stored:

```json
{
  "type": "ui_event",
  "action": "form_submit",
  "data": { "first_name": "Alex", "email": "alex@example.com" }
}
```

### 3. Transition side-effects

Transitions can set variables as a side-effect:

```yaml
transitions:
  on_tool_call:
    confirm:
      target: next_state
      set:
        confirmed: true
```

---

## Interpolation

Variables are interpolated into `agent.prompt` and `ui.prompt` using `{variable_name}` syntax:

```yaml
agent:
  prompt: |
    Welcome back, {first_name}! Your chosen color is {color}.
```

If a variable hasn't been set yet, the engine leaves the placeholder as-is (it won't crash). This is useful for prompts that reference variables from earlier states.

### Where interpolation works

| Location | Interpolated? |
|---|---|
| `agent.prompt` | ✅ Yes |
| `ui.prompt` | ✅ Yes |
| `ui.fields[].label` | ❌ No (static) |
| `tools[].description` | ❌ No (static) |
| `settings.base_system_prompt` | ❌ No (static) |

---

## Real-Time UI Updates

Whenever a variable is set, the engine emits two messages to the frontend:

### `flow_variable`

Sent for every variable change:

```json
{
  "type": "flow_variable",
  "flow_id": "onboarding",
  "key": "first_name",
  "value": "Alex"
}
```

Use this for analytics, debug panels, or custom UI updates.

### `field_update` (automatic)

If the current state has a `form` artifact with a field whose `id` matches the variable name, the engine **automatically** sends a `field_update`:

```json
{
  "type": "artifact",
  "artifact_type": "field_update",
  "field_id": "first_name",
  "value": "Alex"
}
```

This is the **voice-to-form autofill** mechanism. The user says their name, the LLM calls a tool, and the form field fills in visually — all without any frontend code beyond rendering the artifact.

### The contract

For auto-fill to work, the form field `id` must match the variable name:

```yaml
variables:
  first_name:           # ← variable name
    type: string

states:
  ask_name:
    ui:
      artifact_type: form
      fields:
        - id: first_name  # ← must match
          type: text
```

---

## Variable Lifetime

Variables persist for the entire flow session. Once `first_name` is set in state 1, it's available in state 5 for interpolation.

Variables are included in the `flow_end` message when the flow completes:

```json
{
  "type": "flow_end",
  "flow_id": "onboarding",
  "reason": "completed",
  "variables": { "first_name": "Alex", "color": "blue" }
}
```

If you're using the self-hosted engine with a `scoring_callback`, this dict is passed to your callback function.
