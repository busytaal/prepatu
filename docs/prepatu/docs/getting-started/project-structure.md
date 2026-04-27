---
id: project-structure
title: Project Structure
sidebar_position: 3
---

# Project Structure

```
prepatu/
├── packages/
│   └── vfdl/                   ← pip install vfdl (AGPL-3.0)
│       └── vfdl/
│           ├── agents/
│           │   ├── flow_engine.py      ← state machine runtime
│           │   ├── flow_agent.py       ← LLM-in-flow orchestration
│           │   ├── evaluator.py        ← scoring hook interface
│           │   └── control_observer.py ← tool-call event bus
│           ├── providers/
│           │   ├── llm/                ← OpenRouter, etc.
│           │   ├── stt/                ← Deepgram, etc.
│           │   ├── tts/                ← Deepgram, Cartesia, etc.
│           │   └── turn/               ← Cloudflare, static ICE
│           ├── pvp/                    ← Prepatu Voice Protocol messages
│           ├── store/                  ← SQLite session store
│           ├── bot.py                  ← Pipecat pipeline builder
│           └── api.py                  ← /health, /capabilities, /offer, /ws
│
├── apps/
│   └── ielts/
│       ├── backend/                    ← Reference FastAPI app (prepatu-ielts)
│       │   ├── main.py                 ← uvicorn entry point
│       │   ├── config.py               ← env + dotenv loader
│       │   └── ielts/
│       │       ├── api.py              ← app-specific routes
│       │       ├── agents/
│       │       │   └── flows/          ← *.yaml flow definitions
│       │       └── ielts_prompts.py    ← legacy system prompts
│       ├── frontend/                   ← Vite + TypeScript SDK demo
│       │   └── src/sdk/                ← VoiceAgent, transports, QoS
│       └── mobile/                     ← React Native example
│
├── docs/                               ← this Docusaurus site
├── spec/rfcs/                          ← VFDL specification RFCs
├── tests/                              ← pytest suite
└── pyproject.toml                      ← uv workspace root
```

## Key Design Boundary

**`packages/vfdl/` never imports from `apps/`.**  
App-specific logic (evaluator, flow path, scoring callback) is passed into the engine at runtime as parameters — not imported.

This is what keeps `vfdl` a generic, tenant-agnostic package you can `pip install` into *any* project.
