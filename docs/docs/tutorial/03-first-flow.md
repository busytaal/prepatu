---
id: 03-first-flow
title: "Step 3: First Flow — Onboarding"
sidebar_position: 4
---

# Step 3: First Flow — Onboarding

Open `apps/ielts/backend/ielts/agents/flows/onboarding.yaml`. This is the first thing a new user hears.

## Header

```yaml
id: onboarding
version: "2.0.0"
initial_state: intro
description: "First-run experience: warm welcome → collect name + DOB → position orb."
```

`version` is semver. Bump it in git when you change the flow so you can track which version ran for each session.

## Settings

```yaml
settings:
  base_system_prompt: |
    You are a warm, concise onboarding guide for Prepatu.
    Keep every spoken response to 1–2 sentences maximum.
    Use the user's name naturally once you know it.
    Never mention that you are an AI.
```

This prompt is **prepended** to every state's `agent.prompt` — it's the persistent personality of the bot throughout this flow.

## Variables

```yaml
variables:
  first_name:
    type: string
    required: true
  date_of_birth:
    type: string
    required: true
```

Marking `required: true` means the engine will warn if the flow ends without these set.

## States walkthrough

### `intro` — greeting

```yaml
states:
  intro:
    agent:
      prompt: |
        Greet the user with a single warm, friendly sentence.
        Then immediately call `begin_setup`.
      tools:
        - begin_setup
    tools:
      begin_setup:
        description: "Advance to personal data collection after the greeting."
        parameters: {}
    transitions:
      on_tool_call:
        begin_setup: collect_info
```

The agent has **one job** in this state: say hello and call `begin_setup`. It can't navigate anywhere else — `begin_setup` is the only tool registered here.

### `collect_info` — form + voice fill

```yaml
  collect_info:
    ui:
      artifact_type: form
      fields:
        - id: first_name        # ← matches variable name → auto-fill via field_update
          type: text
          label: "First name"
        - id: date_of_birth
          type: text
          label: "Date of birth"
    agent:
      prompt: |
        Ask for first name. When they say it, call `save_name`.
        Ask for DOB. When they say it, call `save_dob`.
        Confirm both, then call `finish_setup`.
      tools:
        - save_name
        - save_dob
        - finish_setup
```

Notice the `ui.fields[].id` values match the `variables` keys. This is the contract for **voice-to-form autofill** — when `save_name` is called with `first_name: "Alex"`, the engine automatically emits:

```json
{"type": "artifact", "artifact_type": "field_update", "field_id": "first_name", "value": "Alex"}
```

The client updates the form field without any extra code.

### `position_orb` and `done`

After data collection the flow repositions the voice orb and navigates to the home screen — a pure `navigate` artifact with no LLM involvement.

## Running this flow

```
POST /offer?mode=flow&program_id=onboarding
```

Or via WebSocket:
```
WS /ws?mode=flow&program_id=onboarding
```

---

[Next: Connect the frontend →](./04-connect-frontend)
