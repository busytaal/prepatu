---
id: 06-going-further
title: "Step 6: Going Further"
sidebar_position: 7
---

# Step 6: Going Further

You've seen the complete IELTS app. Here's what to change to build your own voice app.

---

## Replace the flows

Everything interview-specific is in `apps/ielts/backend/ielts/agents/flows/*.yaml`. Delete those files and write your own. The engine and all transport code stays the same.

Useful flows to look at as templates:

| File | Pattern demonstrated |
|---|---|
| `onboarding.yaml` | Form collection, voice-to-form autofill, confirmation gate |
| `ielts_practice.yaml` | Option picker, multi-state session, scoring |
| `free_conversation.yaml` | Simple open-ended chat with a single state |

---

## Replace the app

Fork `apps/ielts/` → `apps/myapp/`. Change:

1. `pyproject.toml` — rename `prepatu-ielts` to your app
2. `ielts/api.py` → `myapp/api.py` — your routes
3. `FLOWS_DIR` — point at your YAML files
4. `scoring_callback` — your scoring / persistence logic

---

## Use vfdl standalone

```bash
pip install vfdl
```

```python
from vfdl.flow_engine import load_flow
from vfdl.bot import run_bot

flow = load_flow("./my_flow.yaml")

# In your FastAPI app:
await run_bot(
    connection=webrtc_connection,
    mode="flow",
    flows_dir="./flows/",
    program_id="my_flow",
    scoring_callback=my_callback,
)
```

---

## Publish the browser SDK

When ready, extract `apps/ielts/frontend/src/sdk/` to `packages/voice-sdk/` and publish as `@prepatu/voice-sdk`. See the Roadmap in [README](https://github.com/busytaal/prepatu#readme).

---

## Add a custom provider

See [Providers](../concepts/providers) for instructions on adding your own STT, TTS, or LLM backend.

---

## Explore the flows visually

The app ships a visual flow editor at `http://localhost:8000/flow-editor` — load, edit, and save any YAML flow from the browser.
