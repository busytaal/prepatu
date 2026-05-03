---
id: artifacts
title: Artifacts & Server-Driven UI
sidebar_position: 5
---

# Artifact Types

Artifacts are UI instructions the flow engine pushes to the client via `flow_state` and `artifact` messages. The client is a "dumb terminal" — it renders whatever the server says.

---

## `form`

Renders a collection of text input fields. Voice populates fields via `field_update` artifacts automatically when a flow variable with a matching `id` is set.

```yaml
ui:
  artifact_type: form
  fields:
    - id: first_name          # Must match the flow variable name for auto-fill
      type: text
      label: "First name"
      placeholder: "e.g. Alex"
      required: true
    - id: date_of_birth
      type: text
      label: "Date of birth"
      placeholder: "e.g. 15 March 1995"
```

**Client receives:**
```json
{
  "type": "flow_state",
  "artifact": {
    "artifact_type": "form",
    "fields": [...]
  }
}
```

**Auto-fill** — when the engine sets `first_name = "Alex"`, it emits:
```json
{"type": "artifact", "artifact_type": "field_update", "field_id": "first_name", "value": "Alex"}
```

---

## `options`

Tappable choice list. Client sends `ui_event` with `action: option_select` when the user taps.

```yaml
ui:
  artifact_type: options
  prompt: "Which part would you like to practise?"
  options:
    - id: part1
      label: "Part 1 — Interview"
      description: "Personal topics, 4–5 min"
    - id: part2
      label: "Part 2 — Cue card"
    - id: full
      label: "Full session"
```

---

## `card`

Read-only display. Use for feedback summaries, scores, or instructions.

```yaml
ui:
  artifact_type: card
  card_type: feedback        # App-defined string
  title: "Session complete"
  content:
    band_score: 7.0
    feedback: "Strong fluency. Work on complex grammar."
```

---

## `orb_layout`

Repositions the voice orb on screen.

```yaml
ui:
  artifact_type: orb_layout
  position: bottom_right     # center | bottom | bottom_right | top_right
```

---

## `navigate`

Triggers a screen/route transition on the client.

```yaml
ui:
  artifact_type: navigate
  screen: home               # App-defined screen identifier
  params:
    session_id: "abc-123"
```

---

## `dismiss`

Removes a previously shown artifact.

```yaml
ui:
  artifact_type: dismiss
  target_id: null            # null = dismiss all current artifacts
```

---

## `custom`

App-defined artifact — pass any props to a named component.

```yaml
ui:
  artifact_type: custom
  component: ScoreGauge
  props:
    score: 7.5
    max: 9.0
```

---

## Wire Messages

All artifacts arrive as part of a `flow_state` message (on state entry) or as a standalone `artifact` message (mid-state updates like `field_update`).

See [Wire Protocol](../reference/wire-protocol) for the full message schema.
