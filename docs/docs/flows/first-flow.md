---
id: first-flow
title: Your First Flow
sidebar_position: 1
---

# Your First Flow

This page walks you through writing a YAML flow from scratch. By the end you'll understand every building block — states, transitions, tools, variables, and artifacts.

---

## What We're Building

A voice assistant that:
1. Greets the user and asks their name
2. Shows a form field that fills in by voice
3. Asks them to pick a color from a list
4. Says goodbye using their name and chosen color

Four states, three transitions, two artifact types.

---

## Step 1: The Skeleton

Every flow starts with a header:

```yaml
id: color-picker
version: "1.0.0"
initial_state: ask_name
description: "Greet → collect name → pick color → done"
```

- **`id`** — unique identifier for this flow
- **`initial_state`** — which state the engine enters first
- **`version`** — semver, useful for tracking changes

---

## Step 2: Variables

Declare what data the flow collects:

```yaml
variables:
  first_name:
    type: string
    required: true
  color:
    type: enum
    enum: [blue, green, purple]
    required: true
```

Variables are interpolated into prompts with `{first_name}` syntax. The engine tracks them and emits `flow_variable` events to the frontend whenever they change.

---

## Step 3: Settings

Global config that applies to every state:

```yaml
settings:
  base_system_prompt: |
    You are a friendly onboarding guide.
    Keep every response to 1-2 sentences maximum.
    Use the user's name naturally once you know it.
```

This prompt is **prepended** to every state's `agent.prompt` — it's the persistent personality of the bot.

---

## Step 4: The First State — `ask_name`

```yaml
states:
  ask_name:
    ui:
      artifact_type: form
      fields:
        - id: first_name
          type: text
          label: "What's your name?"
          placeholder: "e.g. Alex"

    agent:
      prompt: |
        Greet the user warmly and ask their name.
        When they tell you, call `save_name`.
      tools:
        - save_name

    tools:
      save_name:
        description: "Save the user's first name."
        parameters:
          first_name:
            type: string
            description: "The user's first name as spoken."
            required: true

    transitions:
      on_tool_call:
        save_name: choose_color
      on_ui_event:
        form_submit: choose_color
```

Let's break this down:

### `ui` — What the User Sees

The engine pushes a `form` artifact to the frontend. The client renders a text input labelled "What's your name?".

Notice `id: first_name` matches the variable name — this is the **auto-fill contract**. When the LLM calls `save_name(first_name="Alex")`, the engine automatically sends a `field_update` to the frontend, and the form field fills in visually.

### `agent` — What the LLM Does

The LLM gets this prompt (combined with `base_system_prompt`). It can *only* call `save_name` — no other tools exist in this state.

### `tools` — The Tool Schema

The engine auto-generates an OpenAI function-calling schema from this definition. The LLM sees `save_name` as a callable function with one required string parameter.

### `transitions` — Where to Go Next

- **`on_tool_call: save_name → choose_color`** — when the LLM calls `save_name`, the engine transitions
- **`on_ui_event: form_submit → choose_color`** — if the user types and submits the form, same transition fires (no LLM needed)

This is the **deterministic fallback** principle — the flow works whether the user talks or types.

---

## Step 5: Second State — `choose_color`

```yaml
  choose_color:
    ui:
      artifact_type: options
      prompt: "Nice to meet you, {first_name}! Pick a theme color:"
      options:
        - { id: blue, label: "💙 Blue" }
        - { id: green, label: "💚 Green" }
        - { id: purple, label: "💜 Purple" }

    agent:
      prompt: |
        Nice to meet you, {first_name}! Ask them to pick a color —
        blue, green, or purple. When they say one, call `save_color`.
      tools:
        - save_color

    tools:
      save_color:
        description: "Save the chosen color."
        parameters:
          color:
            type: string
            enum: [blue, green, purple]
            required: true

    transitions:
      on_tool_call:
        save_color: done
      on_ui_event:
        option_select: done
```

Notice:
- **`{first_name}`** in the prompt and UI — the engine interpolates the variable automatically
- **`artifact_type: options`** — the frontend renders tappable buttons
- **`on_ui_event: option_select`** — tapping a button transitions directly, no LLM

---

## Step 6: Terminal State — `done`

```yaml
  done:
    ui:
      artifact_type: card
      prompt: |
        All set, {first_name}! 🎨

        Your color: {color}

    agent:
      prompt: |
        Tell {first_name} their profile is set up with {color} as their theme.
        Wish them a great day.
      tools: []

    transitions: {}
```

No tools, no transitions — this is a **terminal state**. The engine has nowhere to go, so the flow ends.

---

## The Complete Flow

```yaml
id: color-picker
version: "1.0.0"
initial_state: ask_name
description: "Greet → collect name → pick color → done"

variables:
  first_name:
    type: string
    required: true
  color:
    type: enum
    enum: [blue, green, purple]
    required: true

settings:
  base_system_prompt: |
    You are a friendly onboarding guide.
    Keep every response to 1-2 sentences maximum.
    Use the user's name naturally once you know it.

states:
  ask_name:
    ui:
      artifact_type: form
      fields:
        - id: first_name
          type: text
          label: "What's your name?"
          placeholder: "e.g. Alex"
    agent:
      prompt: |
        Greet the user warmly and ask their name.
        When they tell you, call `save_name`.
      tools: [save_name]
    tools:
      save_name:
        description: "Save the user's first name."
        parameters:
          first_name: { type: string, required: true }
    transitions:
      on_tool_call:
        save_name: choose_color
      on_ui_event:
        form_submit: choose_color

  choose_color:
    ui:
      artifact_type: options
      prompt: "Nice to meet you, {first_name}! Pick a theme color:"
      options:
        - { id: blue, label: "💙 Blue" }
        - { id: green, label: "💚 Green" }
        - { id: purple, label: "💜 Purple" }
    agent:
      prompt: |
        Ask {first_name} to pick a color. Call `save_color` when they choose.
      tools: [save_color]
    tools:
      save_color:
        description: "Save the chosen color."
        parameters:
          color: { type: string, enum: [blue, green, purple], required: true }
    transitions:
      on_tool_call:
        save_color: done
      on_ui_event:
        option_select: done

  done:
    ui:
      artifact_type: card
      prompt: "All set, {first_name}! 🎨 Your color: {color}"
    agent:
      prompt: |
        Tell {first_name} their profile is set up with {color}.
        Wish them a great day.
      tools: []
    transitions: {}
```

---

## Try It

Upload this flow to the cloud or point your self-hosted backend at it:

**Cloud:**
```bash
curl -X POST https://api.prepatu.io/v1/flows \
  -H "X-Prepatu-Key: pk_live_..." \
  -d '{"name": "Color Picker", "yaml_content": "..."}'
```

**Self-hosted:**
Save as `color-picker.yaml` in your `FLOWS_DIR` and connect with `mode=flow`.

---

## Next Steps

- **[YAML Reference](./yaml-reference)** — every field in the flow spec
- **[State Machine & Transitions](./state-machine)** — how transitions work in detail
- **[Confirmation Gates](./confirmation-gates)** — require user confirmation before advancing
- **[10 Questions Example](../examples/ten-questions)** — a more complex flow with game logic
