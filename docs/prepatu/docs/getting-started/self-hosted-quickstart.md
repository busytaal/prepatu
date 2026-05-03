---
id: self-hosted-quickstart
title: Self-Hosted Quickstart
sidebar_position: 2
---

# Self-Hosted Quickstart

Run the VFDL engine on your own machine with your own API keys.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Python | ≥ 3.12 | VFDL engine runtime |
| [uv](https://docs.astral.sh/uv/) | latest | Python package manager |
| Node.js | ≥ 18 | Browser SDK (optional) |

You'll also need API keys for:
- **[Deepgram](https://console.deepgram.com/)** — speech-to-text + text-to-speech
- **[OpenRouter](https://openrouter.ai/keys)** — LLM (routes to GPT-4o, Claude, etc.)

---

## 1. Clone & Install

```bash
git clone https://github.com/busytaal/prepatu.git
cd prepatu
uv sync --all-packages
```

This installs the `vfdl` engine and the reference IELTS app into a shared virtual environment.

:::tip Using vfdl standalone?
```bash
pip install vfdl
```
No need to clone the monorepo if you just want the engine as a library.
:::

---

## 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in your API keys:

```dotenv
STT_API_KEY=dg-...          # Deepgram
TTS_API_KEY=dg-...          # Deepgram (same key works for both)
LLM_API_KEY=sk-or-...       # OpenRouter
```

See the full [Environment Variables Reference](../reference/env-variables) for all options (TURN servers, voice selection, model choice, etc.).

---

## 3. Start the Backend

```bash
cd apps/ielts/backend
uvicorn main:app --host 0.0.0.0 --reload
```

The API is now running at `http://localhost:8000`.

---

## 4. Run Your First Flow

Save this as `my_flow.yaml`:

```yaml
id: greeting
version: "1.0.0"
initial_state: hello

settings:
  base_system_prompt: |
    You are a friendly assistant. Keep every reply to one sentence.

states:
  hello:
    agent:
      prompt: |
        Greet the user warmly and ask their name.
        When they tell you, call `save_name`.
      tools: [save_name]
    tools:
      save_name:
        description: "Save the user's name."
        parameters:
          first_name:
            type: string
            required: true
    transitions:
      on_tool_call:
        save_name: farewell

  farewell:
    agent:
      prompt: |
        Say goodbye to {first_name} warmly. Keep it to one sentence.
      tools: []
    transitions: {}
```

Point the backend at your flow by setting `FLOWS_DIR` to the folder containing it, then connect with `mode=flow`.

---

## 5. Connect a Browser (Optional)

Start the SDK demo:

```bash
cd apps/ielts/frontend
npm install
npm run dev
# → http://localhost:5173
```

Choose **WebSocket** transport, click **Connect**, and start talking.

---

## What Just Happened?

1. The engine loaded your YAML into a `FlowConfig` state machine
2. On session start it entered `hello` — injected the prompt and registered only `save_name`
3. When the LLM called `save_name(first_name="Alex")`, the engine stored the variable and transitioned to `farewell`
4. In `farewell`, `{first_name}` was interpolated to "Alex" automatically
5. No transitions defined → conversation ends

---

## Next Steps

- **[Your First Flow](../flows/first-flow)** — understand every part of a YAML flow
- **[YAML Reference](../flows/yaml-reference)** — the complete specification
- **[Architecture](../reference/architecture)** — how the engine, pipeline, and transports fit together
- **[Deployment](../reference/deployment)** — production deployment guide
