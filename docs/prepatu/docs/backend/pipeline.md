---
id: pipeline
title: Pipeline
sidebar_position: 1
---

# Voice Pipeline

The VFDL engine wraps a [Pipecat](https://github.com/pipecat-ai/pipecat) pipeline. Pipecat handles the low-level audio frame routing; VFDL adds the flow engine and LLM confinement layer on top.

---

## Pipeline Graph

```
Transport In (PCM/Opus)
    └── SileroVADAnalyzer      ← end-of-utterance detection
            └── STT (Deepgram)
                    └── FlowAgent / LLM Context Aggregator
                            └── LLM (OpenRouter via OpenAI adapter)
                                    └── TTS (Deepgram / Cartesia)
                                            └── Transport Out
```

---

## Session Lifecycle

```python
# Simplified from vfdl/bot.py
await run_bot(
    connection=webrtc_connection,
    system_prompt="...",          # overridden by flow YAML when mode=flow
    mode="flow",
    program_id="onboarding",
    flows_dir="./ielts/agents/flows/",
    scoring_callback=my_callback, # called with final variables at flow_end
    vad_stop_secs=0.8,
)
```

The function blocks until the session ends (WebRTC peer disconnects or flow reaches `__end__`).

---

## VAD Settings

Silence detection is tuned via `vad_stop_secs` (default `0.8` s). Increase for slower speakers; decrease for more responsive turn-taking.

---

## Context Continuity on Transport Switch

When a client upgrades from WebSocket to WebRTC mid-session, `create_pipeline_services()` accepts `prior_messages` so the LLM retains conversation history:

```python
stt, llm, tts, user_agg, asst_agg = create_pipeline_services(
    system_prompt=prompt,
    prior_messages=extract_context_messages(previous_aggregator),
)
```
