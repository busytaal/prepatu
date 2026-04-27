---
id: intro
title: Introduction
sidebar_position: 1
slug: /
---

# Prepatu — Voice Flow Engine & SDK

Prepatu is an open-source, transport-agnostic voice pipeline runtime built on [Pipecat](https://github.com/pipecat-ai/pipecat) + FastAPI. It ships two independently usable pieces:

| Package | Install | Description |
|---|---|---|
| **VFDL** | `pip install vfdl` | Python voice-flow engine — run declarative YAML flows over voice |
| **Voice SDK** | *(in repo)* | TypeScript browser SDK — WebSocket + WebRTC transports |

---

## Why Prepatu?

Building a voice agent that *reliably follows a script* — without hallucinating, skipping steps, or inventing transitions — is harder than it looks. LLMs are probabilistic. Prepatu solves this with:

- **Declarative state machines in YAML** — the LLM is confined to the current state; it cannot jump ahead or invent routes.
- **Deterministic fallbacks** — every LLM-driven transition has a regex or UI-event backup so flows complete even when the model misbehaves.
- **Server-driven UI** — the backend pushes UI artifacts (forms, option pickers, cards) to a "dumb terminal" client. The client renders whatever the flow says.

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│  Client (browser / mobile)                              │
│  VoiceAgent  →  Transport (WS | WebRTC)                 │
└────────────────────────┬────────────────────────────────┘
                         │  PCM audio  +  JSON control
┌────────────────────────▼────────────────────────────────┐
│  VFDL Engine  (FastAPI + Pipecat)                        │
│                                                         │
│  STT  →  FlowEngine  →  LLM (confined)  →  TTS         │
│              │                                          │
│         artifacts, flow_state, flow_variable            │
└─────────────────────────────────────────────────────────┘
```

---

## Repository Layout

```
packages/
  vfdl/               ← pip install vfdl  (AGPL-3.0)
apps/
  ielts/
    backend/          ← reference FastAPI app
    frontend/         ← Vite browser SDK demo
    mobile/           ← React Native example
docs/                 ← this site
spec/rfcs/            ← VFDL specification
```

---

## Quick Links

- [Installation](./getting-started/installation) — get running in 5 minutes
- [Flow YAML reference](./concepts/flow-yaml) — the core declarative format
- [Tutorial](../tutorial/intro) — build an IELTS speaking coach step by step
- [API Reference](./backend/api-reference) — backend HTTP + WebSocket endpoints
