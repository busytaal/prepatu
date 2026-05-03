---
id: ielts-coach
title: "Case Study: IELTS Coach"
sidebar_position: 3
---

# Case Study: IELTS Speaking Coach

The IELTS Coach is the most complex reference app in the Prepatu monorepo. It's a full language practice application with multiple flows, a scoring callback, a React Native mobile app, and a Vite web frontend.

This page explains the interesting architectural patterns — not a step-by-step tutorial, but a tour of how a production voice app uses VFDL.

---

## Architecture

```
apps/ielts/
  backend/
    main.py              ← FastAPI app, mounts vfdl engine
    ielts/
      api.py             ← App-specific routes (programs, scoring)
      ielts_prompts.py   ← IELTS-specific system prompts
      agents/flows/      ← YAML flow files
      remote_config.py   ← Dynamic config (programs, features)
  frontend/              ← Vite browser SDK demo + debug panel
  mobile/                ← React Native app (Expo)
```

The app follows the **hard import boundary** principle:

```
packages/vfdl/  MUST NOT import from  apps/ielts/
```

The engine is a generic library. The app injects behaviour through:
- `flows_dir` — path to YAML flow files
- `scoring_callback` — function called at flow end
- `mode` — `"assistant"`, `"onboarding"`, or `"program"`

---

## Multi-Flow Orchestration

The IELTS app runs different flows depending on the session mode:

| Mode | Flow | What it does |
|---|---|---|
| `onboarding` | `onboarding.yaml` | First-run: collect name + DOB, position orb |
| `program` | Looked up from `programs.yaml` | Practice sessions (Part 1/2/3, Full) |
| `assistant` | No flow | Open-ended conversation with tools |

The app's `api.py` determines which mode to use based on the request, then passes `mode` and `program_id` to `run_bot()`. The engine handles the rest.

### Programs Registry

```yaml
# programs.yaml
programs:
  - id: ielts-part1
    flow: ielts_part1
    scoring: band_score
  - id: ielts-full
    flow: ielts_full
    scoring: band_score
```

This registry decouples flow selection from the API layer. Adding a new practice mode is just a new YAML file + one line in `programs.yaml`.

---

## Scoring Callback

The engine knows nothing about IELTS band scores. When a flow reaches its end state, the engine calls:

```python
scoring_callback(session_id, messages)
```

The app's callback extracts scores from the LLM conversation history:

```python
async def score_session(session_id: str, messages: list[dict]):
    # Use the conversation transcript to generate scores
    band_score = await evaluate_with_llm(messages)
    await store.save_session_result(session_id, band_score)
```

This pattern — **engine calls a function pointer at flow end** — keeps domain logic out of the engine. You can score exams, send emails, update a CRM, or trigger a webhook.

---

## Onboarding Flow Highlights

The onboarding flow demonstrates:

1. **Form + voice autofill** — name and DOB fields fill in as the user speaks
2. **Confirmation gate on name** — the engine blocks until the user confirms
3. **Orb repositioning** — an `orb_layout` artifact moves the voice UI element
4. **Navigation** — a `navigate` artifact sends the user to the home screen

```
intro → collect_info (form + confirmation) → position_orb → done (navigate home)
```

---

## Transport Layer

The IELTS app supports three connection modes:

- **WebSocket** — raw PCM16, lowest latency on fast networks
- **WebRTC** — Opus codec via media tracks, NAT traversal
- **Transport Switcher** — starts on WebSocket, upgrades to WebRTC mid-conversation

The debug panel at `http://localhost:5173` lets you test all three modes with live QoS monitoring.

---

## Mobile App

`apps/ielts/mobile/` is a React Native (Expo) app that connects to the same backend. It uses `expo-av` for microphone capture and renders flow artifacts as native components.

---

## Lessons for Your App

| Pattern | What the IELTS app does | Take-away |
|---|---|---|
| Multi-flow | Different YAMLs for onboarding vs. practice | Keep flows focused — one per user journey |
| Programs registry | `programs.yaml` maps IDs to flows | Decouple flow selection from API code |
| Scoring callback | Function pointer at flow end | Keep domain logic out of the engine |
| Mode switching | `assistant` vs `flow` modes | Not everything needs a state machine |
| Transport flexibility | WS + WebRTC + switcher | Start simple (WS), upgrade later |

---

## Source Code

- [Backend](https://github.com/busytaal/prepatu/tree/main/apps/ielts/backend)
- [Frontend](https://github.com/busytaal/prepatu/tree/main/apps/ielts/frontend)
- [Mobile](https://github.com/busytaal/prepatu/tree/main/apps/ielts/mobile)
