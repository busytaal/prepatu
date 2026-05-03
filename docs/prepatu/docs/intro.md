---
id: intro
title: Introduction
sidebar_position: 1
slug: /
---

# Prepatu

**Define voice agents in YAML. The state machine runs the show. The LLM does the talking.**

---

## The Problem

Every team building voice agents hits the same wall. You want the AI to follow a script — collect a name, confirm it, pick a date, review, done. But LLMs are probabilistic. They skip steps. They invent transitions. They hallucinate a confirmation the user never gave. They forget where they are in the flow.

Prompt engineering helps, but it doesn't *guarantee* anything. And when your voice agent is booking real appointments, running real interviews, or handling real onboarding — "usually works" isn't good enough.

## How Prepatu Solves This

Prepatu separates what LLMs are good at (understanding language) from what they're bad at (following a script). It introduces two core ideas:

### 1. The LLM is a Guest, Not the Host

The conversation flow is defined as a **YAML state machine**. The engine — not the LLM — controls which state you're in, what transitions are possible, and what the user sees on screen.

The LLM operates *inside* each state. It can talk naturally, understand what the user says, and call tools to capture data. But it **cannot**:
- Jump to a state not in the current state's `transitions`
- Call tools not listed in the current state's `agent.tools`
- Skip or reorder steps

### 2. Every Transition Has a Deterministic Fallback

What if the LLM never calls the expected tool? What if it hallucinates? Every LLM-driven transition has a backup path that doesn't require LLM cooperation:
- **`on_ui_event`** — user taps a button or submits a form
- **`on_utterance`** — regex matches the user's speech directly
- **`on_timeout`** — automatic advance after N seconds of silence

The flow completes no matter what the model does.

---

## What You Build With It

A Prepatu app is a **YAML flow file** + a **frontend that renders artifacts**.

Here's a real flow — a voice-powered appointment booking wizard:

```yaml
id: appointment-booking
version: "1.0.0"
initial_state: collect_contact

settings:
  base_system_prompt: |
    You are a warm, friendly booking assistant called Aria.
    Be concise. Never make up information the user hasn't provided.

states:
  collect_contact:
    ui:
      artifact_type: form
      prompt: "Let's start with your contact details."
      fields:
        - id: full_name
          label: Full Name
          type: text
        - id: email
          label: Email
          type: email

    agent:
      prompt: |
        Ask for the user's name and email.
        Call `save_contact` when you have both.
      tools: [save_contact]

    tools:
      save_contact:
        description: "Save name and email, move to appointment details."
        parameters:
          full_name: { type: string, required: true }
          email: { type: string, required: true }

    transitions:
      on_tool_call:
        save_contact: collect_appointment   # Engine advances here
      on_ui_event:
        form_submit: collect_appointment    # User can also type + submit

  collect_appointment:
    # ... next step
```

When the user says *"I'm Alice, alice@example.com"*, the LLM calls `save_contact`. The engine stores the variables, pushes a `field_update` artifact to the frontend (so the form fields fill in visually), and transitions to `collect_appointment`. If the user types into the form and hits submit instead, `on_ui_event` fires the same transition — no LLM involvement at all.

---

## Key Concepts

| Concept | What it means |
|---|---|
| **Flow** | A YAML file defining a complete conversation as a state machine |
| **State** | One step in the flow — has a UI artifact, an LLM prompt, allowed tools, and transitions |
| **Transition** | An edge between states — triggered by a tool call, UI event, utterance match, or timeout |
| **Artifact** | A UI instruction pushed to the client: forms, cards, option pickers, navigation |
| **Variable** | Data collected during the flow (e.g. `first_name`), interpolated into prompts via `{first_name}` |
| **Confirmation Gate** | A pattern where the engine blocks transitions until the user explicitly confirms captured data |

---

## Three Ways to Use Prepatu

| Path | Best for | Get started |
|---|---|---|
| ☁️ **Cloud Service** | Ship fast — no backend to deploy | [Cloud Quickstart →](./getting-started/cloud-quickstart) |
| 📦 **`pip install vfdl`** | Use the engine in your own Python backend | [Self-Hosted Quickstart →](./getting-started/self-hosted-quickstart) |
| 🍴 **Fork the monorepo** | Full starter kit with reference apps | [GitHub →](https://github.com/busytaal/prepatu) |

---

## What's in the Box

| Package | What it is |
|---|---|
| **`vfdl`** | Python flow engine — pip-installable, runs on Pipecat + FastAPI |
| **Voice SDK** | TypeScript browser SDK — WebSocket + WebRTC transports |
| **Cloud Service** | Managed backend — upload flows, get a WebSocket URL, pay per minute |

### Example Apps

| App | What it shows |
|---|---|
| [**10 Questions**](./examples/ten-questions) | Voice game — all card-based UI, no forms |
| [**Booking Wizard**](./examples/booking-wizard) | Multi-step form with voice-to-form autofill |
| [**IELTS Coach**](./examples/ielts-coach) | Complex multi-flow app with scoring callbacks |

---

## Next Steps

- **[Cloud Quickstart](./getting-started/cloud-quickstart)** — upload a flow and talk to it in 5 minutes
- **[Your First Flow](./flows/first-flow)** — write a YAML flow from scratch
- **[YAML Reference](./flows/yaml-reference)** — the full spec for flow files
