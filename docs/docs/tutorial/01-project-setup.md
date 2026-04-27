---
id: 01-project-setup
title: "Step 1: Project Setup"
sidebar_position: 2
---

# Step 1: Project Setup

## Clone and install

```bash
git clone https://github.com/busytaal/prepatu.git
cd prepatu
uv sync --all-packages
cp .env.example .env   # fill in API keys
```

## Monorepo layout

The IELTS app lives entirely in `apps/ielts/`. The engine it imports lives in `packages/vfdl/`.

```
packages/vfdl/          ← generic engine, knows nothing about IELTS
apps/ielts/
  backend/
    main.py             ← uvicorn entry point
    config.py           ← env loader
    ielts/
      api.py            ← IELTS-specific routes
      agents/
        flows/          ← *.yaml files — all the interview logic
      ielts_prompts.py  ← legacy system prompts (pre-flow)
  frontend/             ← Vite browser SDK demo
```

## The key boundary

Open `apps/ielts/backend/ielts/api.py`. Notice:

```python
from vfdl.bot import run_bot
from vfdl.api import engine_router
```

The app **imports from vfdl** — not the other way around. All IELTS-specific logic (scoring, flow path, prompts) is passed **into** the engine at call time:

```python
await run_bot(
    connection=conn,
    mode="flow",
    program_id="ielts_practice",
    flows_dir=str(FLOWS_DIR),
    scoring_callback=score_session,   # ← IELTS-specific
)
```

This is why `vfdl` is a reusable package: it never imports the app.

## Start the backend

```bash
cd apps/ielts/backend
uvicorn main:app --reload
```

Visit `http://localhost:8000/health` — you should see all providers as `configured: true`.

---

[Next: The backend app →](./02-backend)
