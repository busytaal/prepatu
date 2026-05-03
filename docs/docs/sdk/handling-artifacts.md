---
id: handling-artifacts
title: Handling Artifacts
sidebar_position: 2
---

# Handling Artifacts

When the flow engine enters a new state, it pushes a **`flow_state`** message to the client with the state's UI artifact. Your frontend renders whatever the server says — this is the **server-driven UI** pattern.

---

## Receiving Artifacts

All artifacts arrive through the `onMessage` callback:

```typescript
const agent = VoiceAgent.withWebSocket(
  { url: wsUrl },
  {
    onMessage: msg => {
      switch (msg.type) {
        case 'flow_state':
          // New state entered — render the artifact
          renderArtifact(msg.artifact);
          break;

        case 'artifact':
          // Mid-state update (e.g. field_update)
          handleArtifactUpdate(msg);
          break;

        case 'flow_variable':
          // A variable was set — update debug panel, analytics, etc.
          console.log(`${msg.key} = ${msg.value}`);
          break;

        case 'flow_end':
          // Flow completed — show summary
          showSummary(msg.variables);
          break;
      }
    },
  }
);
```

---

## Artifact Types

### `form` — Input Fields

The engine pushes a form when it needs to collect data. Fields can be filled by voice (via `field_update`) or by typing.

```json
{
  "type": "flow_state",
  "artifact": {
    "artifact_type": "form",
    "prompt": "Let's start with your contact details.",
    "fields": [
      { "id": "full_name", "type": "text", "label": "Full Name", "placeholder": "e.g. Jane Smith" },
      { "id": "email", "type": "email", "label": "Email", "placeholder": "jane@example.com" }
    ]
  }
}
```

**Rendering:**

```typescript
function renderForm(artifact) {
  const container = document.getElementById('ui');
  container.innerHTML = `<h3>${artifact.prompt}</h3>`;

  for (const field of artifact.fields) {
    container.innerHTML += `
      <label>${field.label}</label>
      <input id="field-${field.id}" type="${field.type}"
             placeholder="${field.placeholder || ''}" />
    `;
  }

  container.innerHTML += `<button onclick="submitForm()">Submit</button>`;
}
```

### `field_update` — Voice-to-Form Autofill

When the LLM captures a value via a tool call, the engine sends a `field_update`. Update the matching form field:

```json
{
  "type": "artifact",
  "artifact_type": "field_update",
  "field_id": "full_name",
  "value": "Jane Smith"
}
```

```typescript
function handleFieldUpdate(msg) {
  const input = document.getElementById(`field-${msg.field_id}`);
  if (input) input.value = msg.value;
}
```

This is the core of the **voice-to-form** experience — the user speaks, the form fills in live.

### `options` — Tappable Choices

```json
{
  "artifact_type": "options",
  "prompt": "Which part would you like to practise?",
  "options": [
    { "id": "part1", "label": "Part 1 — Interview" },
    { "id": "part2", "label": "Part 2 — Cue card" },
    { "id": "full", "label": "Full session" }
  ]
}
```

**Rendering:**

```typescript
function renderOptions(artifact) {
  const container = document.getElementById('ui');
  container.innerHTML = `<h3>${artifact.prompt}</h3>`;

  for (const opt of artifact.options) {
    container.innerHTML += `
      <button onclick="selectOption('${opt.id}')">${opt.label}</button>
    `;
  }
}
```

### `card` — Read-Only Display

Used for feedback, summaries, scores, or game state:

```json
{
  "artifact_type": "card",
  "prompt": "🎉 You got it!\n\nIt was: a flamingo\nQuestions used: 7 / 10"
}
```

### `navigate` — Screen Transition

Triggers a route change on the client:

```json
{
  "artifact_type": "navigate",
  "screen": "home",
  "params": { "session_id": "abc-123" }
}
```

### `orb_layout` — Reposition Voice Orb

```json
{
  "artifact_type": "orb_layout",
  "position": "bottom_right"
}
```

---

## A Complete Artifact Router

```typescript
function handleMessage(msg) {
  if (msg.type === 'flow_state') {
    const a = msg.artifact;
    switch (a.artifact_type) {
      case 'form':       renderForm(a); break;
      case 'options':    renderOptions(a); break;
      case 'card':       renderCard(a); break;
      case 'navigate':   router.push(a.screen, a.params); break;
      case 'orb_layout': moveOrb(a.position); break;
    }
  }

  if (msg.type === 'artifact') {
    if (msg.artifact_type === 'field_update') {
      handleFieldUpdate(msg);
    }
  }

  if (msg.type === 'flow_end') {
    showSummary(msg.variables);
  }
}
```

---

## Next Steps

- **[Sending UI Events](./sending-events)** — how form submissions and button taps go back to the engine
- **[Artifacts Reference](../flows/artifacts)** — full YAML reference for all artifact types
