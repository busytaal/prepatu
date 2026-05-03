---
id: sending-events
title: Sending UI Events
sidebar_position: 3
---

# Sending UI Events

When the user interacts with your UI — submitting a form, tapping an option, clicking a button — you send a `ui_event` back to the engine. These events are the **deterministic fallback path**: they trigger transitions without LLM involvement.

---

## The `ui_event` Message

```typescript
agent.sendMessage({
  type: 'ui_event',
  flow_id: 'my-flow',       // The flow ID from your YAML
  action: 'form_submit',    // Matches a key in transitions.on_ui_event
  data: {                   // Key-value pairs stored as flow variables
    full_name: 'Jane Smith',
    email: 'jane@example.com',
  },
});
```

The engine:
1. Stores every key in `data` as a flow variable
2. Looks up `action` in the current state's `transitions.on_ui_event`
3. If found, transitions to the target state — **no LLM involved**

---

## Common Events

### Form Submit

When the user types into a form and clicks submit:

```typescript
function submitForm() {
  const data = {};
  for (const field of currentFields) {
    const input = document.getElementById(`field-${field.id}`);
    if (input) data[field.id] = input.value;
  }

  agent.sendMessage({
    type: 'ui_event',
    flow_id: currentFlowId,
    action: 'form_submit',
    data,
  });
}
```

Matching YAML:

```yaml
transitions:
  on_ui_event:
    form_submit: next_state
```

### Option Select

When the user taps a choice:

```typescript
function selectOption(optionId) {
  agent.sendMessage({
    type: 'ui_event',
    flow_id: currentFlowId,
    action: 'option_select',
    data: { selected_id: optionId },
  });
}
```

Matching YAML:

```yaml
transitions:
  on_ui_event:
    option_select: next_state
```

### Custom Actions

You can define any action name:

```typescript
agent.sendMessage({
  type: 'ui_event',
  flow_id: 'booking',
  action: 'confirm_booking',
  data: {},
});
```

```yaml
transitions:
  on_ui_event:
    confirm_booking: done
  on_action:
    confirm_booking: done   # on_action also works for custom events
```

---

## Priority: UI Events Always Win

If the LLM calls a tool and the user taps a button at the same time, the UI event wins:

| Priority | Source | Trigger |
|---|---|---|
| 1 (highest) | `on_ui_event` | User tapped / submitted |
| 2 | `on_tool_call` | LLM called a tool |
| 3 | `on_utterance` | Regex matched speech |
| 4 (lowest) | `on_timeout` | Timer expired |

This ensures the user is always in control. If they submit a form manually, it doesn't matter what the LLM is doing.

---

## UI Events Bypass Confirmation Gates

If a state has a `confirmation_gate`, UI events skip it entirely. The logic: if the user typed the data and hit submit, they've already confirmed it — no voice confirmation needed.

---

## Validation Errors

If the user submits a form with missing required fields, send a `form_validation_error` event:

```typescript
agent.sendMessage({
  type: 'ui_event',
  flow_id: currentFlowId,
  action: 'form_validation_error',
  data: { missing_fields: 'email' },
});
```

The engine injects a reminder into the LLM context, and the agent will naturally ask the user to provide the missing information.

---

## Next Steps

- **[VoiceAgent Reference](./voice-agent-reference)** — full API for `VoiceAgent`, transports, and QoS
- **[State Machine & Transitions](../flows/state-machine)** — how the engine resolves competing events
