---
id: architecture
title: Architecture
sidebar_position: 1
---

# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Client (browser or mobile)                                 │
│                                                             │
│  VoiceAgent                                                 │
│    └── Transport  ──────────────────────────────┐          │
│         ├── WebSocketTransport  (PCM16 binary)  │          │
│         └── WebRTCTransport     (Opus media)    │          │
└─────────────────────────────────────────────────┼──────────┘
                                                  │
                                       TCP / UDP  │
┌─────────────────────────────────────────────────▼──────────┐
│  VFDL Engine  (FastAPI + Pipecat)                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Pipecat Pipeline                                    │  │
│  │  Transport In → STT → FlowAgent → LLM → TTS → Out   │  │
│  │                          │                           │  │
│  │                   FlowEngine (YAML)                  │  │
│  │                   ├── state machine                  │  │
│  │                   ├── LLM confinement                │  │
│  │                   └── artifact emission              │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Session Store (SQLite)                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### Client — `VoiceAgent`

- Captures microphone audio via `AudioWorklet` (browser) or `expo-av` (mobile).
- Sends raw PCM16 (WebSocket) or Opus media track (WebRTC) to the backend.
- Receives TTS audio and JSON control messages from the backend.
- Renders UI artifacts pushed by the flow engine (forms, option pickers, etc.).

### Transport Layer

| Transport | Protocol | Audio | Use Case |
|---|---|---|---|
| `WebSocketTransport` | WS | PCM16 binary frames | Low-latency, firewall-friendly |
| `WebRTCTransport` | WebRTC / DTLS | Opus | NAT traversal, hardware AEC |
| `TransportSwitcher` | Both | Both | Upgrade WS→WebRTC mid-session |

### VFDL Engine — `packages/vfdl/`

- **`bot.py`** — builds and runs the Pipecat pipeline for a single session.
- **`agents/flow_engine.py`** — `FlowConfig` Pydantic model + `VoiceFlowController`.
- **`agents/flow_agent.py`** — hooks into Pipecat's LLM processor; enforces per-state tool restrictions.
- **`providers/`** — pluggable STT / TTS / LLM / TURN implementations.
- **`pvp/`** — Prepatu Voice Protocol message schema + session router.
- **`store/sqlite.py`** — session persistence (transcript, variables).

### Reference App — `apps/ielts/backend/`

- Thin FastAPI app that mounts `vfdl.api.engine_router` and adds app-specific routes.
- Passes `flows_dir`, `scoring_callback`, and `vad_stop_secs` into `run_bot()` — no app code leaks into the engine.

---

## Key Design Principle — Hard Import Boundary

```
packages/vfdl/  MUST NOT import from  apps/
```

The engine is a library. Apps inject behaviour through:
- `flows_dir` — path to `.yaml` flow files
- `scoring_callback` — function called at flow end with collected variables
- `mode` — `"assistant"` or `"flow"` 

This keeps `vfdl` a generic, tenant-agnostic pip package.
