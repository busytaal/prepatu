# Prepatu

**Define voice agents in YAML. The state machine runs the show. The LLM does the talking.**

Prepatu is an open-source engine for building reliable, multi-step voice applications. You describe your conversation as a YAML state machine — the engine confines the LLM to one state at a time, pushes UI artifacts to the client, and ensures the flow completes even if the model misbehaves.

---

## The Problem

LLMs are brilliant at understanding language. They're terrible at following a script.

Ask an LLM to run a 5-step booking flow and it will skip steps, invent transitions, forget where it is, or hallucinate a confirmation the user never gave. Every team building voice agents hits the same wall: **the LLM cannot be trusted with flow control.**

## The Solution

Separate what the LLM is good at (natural language understanding) from what it's bad at (deterministic state management). In Prepatu:

- **A YAML state machine** defines the flow — states, transitions, tools, UI artifacts
- **The LLM** operates *inside* each state — it converses naturally, extracts entities, calls tools
- **The engine** enforces the rules — the LLM cannot skip steps, call tools from other states, or invent transitions

```yaml
# A complete voice flow in 25 lines
id: greeting
version: "1.0.0"
initial_state: hello

settings:
  base_system_prompt: |
    You are a friendly assistant. Keep every reply to one sentence.

states:
  hello:
    agent:
      prompt: Greet the user and ask their name. When they tell you, call `save_name`.
      tools: [save_name]
    tools:
      save_name:
        description: "Save the user's name"
        parameters:
          first_name: { type: string, required: true }
    transitions:
      on_tool_call:
        save_name: farewell     # ← The engine moves to 'farewell'. The LLM can't skip this.

  farewell:
    agent:
      prompt: Say goodbye to {first_name} warmly.
      tools: []
    transitions: {}             # No transitions = conversation ends
```

The LLM in `hello` can *only* call `save_name`. It literally cannot advance the flow any other way. When it does, the engine stores `first_name`, transitions to `farewell`, injects the new prompt (with `{first_name}` interpolated), and the LLM speaks again — all deterministic.

---

## Three Ways to Use Prepatu

### ☁️ Cloud Service

Sign up, upload your YAML flow, connect from any frontend. No backend needed.

```bash
# 1. Get an API key from the dashboard
# 2. Upload your flow
curl -X POST https://api.prepatu.io/v1/flows \
  -H "X-Prepatu-Key: pk_..." \
  -d '{"name": "My Flow", "yaml_content": "..."}'

# 3. Start a session
curl -X POST https://api.prepatu.io/v1/sessions \
  -H "X-Prepatu-Key: pk_..." \
  -d '{"flow_id": "..."}'
# → { "ws_url": "wss://api.prepatu.io/v1/ws/...", "session_token": "..." }

# 4. Connect from the browser using VoiceAgent
```

→ [Cloud Quickstart](https://busytaal.github.io/prepatu/docs/getting-started/cloud-quickstart)

### 📦 `pip install vfdl`

Use the flow engine in your own Python/FastAPI backend:

```bash
pip install vfdl
```

```python
from vfdl.agents.flow_engine import load_flow
flow = load_flow("./my_flow.yaml")  # validates and returns a FlowConfig
```

→ [Self-Hosted Quickstart](https://busytaal.github.io/prepatu/docs/getting-started/self-hosted-quickstart)

### 🍴 Fork the Monorepo

Clone the repo for a full starter kit with reference apps, browser SDK, and cloud service:

```bash
git clone https://github.com/busytaal/prepatu.git
cd prepatu && uv sync --all-packages
```

---

## Example Apps

| App | What it demonstrates | Flow |
|---|---|---|
| **10 Questions** | Voice game — AI picks a secret, user asks yes/no questions | [flow.yaml](apps/ten-questions/flow.yaml) |
| **Booking Wizard** | 3-step appointment booking with voice-to-form autofill | [flow.yaml](apps/demo-wizard/flow.yaml) |
| **IELTS Coach** | Multi-flow language practice app with scoring | [apps/ielts/](apps/ielts/) |

---

## Stack

| Layer | Tech |
|---|---|
| **VFDL Engine** | Python 3.12 · Pipecat · FastAPI |
| **Browser SDK** | TypeScript · WebSocket + WebRTC |
| **Cloud Service** | FastAPI · SQLite · JWT auth · credit-based billing |

---

## Documentation

- **[Introduction](https://busytaal.github.io/prepatu/)** — what Prepatu is and how it works
- **[Cloud Quickstart](https://busytaal.github.io/prepatu/docs/getting-started/cloud-quickstart)** — running in 5 minutes
- **[Writing Flows](https://busytaal.github.io/prepatu/docs/flows/first-flow)** — YAML reference and tutorials
- **[Examples](https://busytaal.github.io/prepatu/docs/examples/ten-questions)** — build a 10 Questions game step by step
- **[API Reference](https://busytaal.github.io/prepatu/docs/reference/cloud-api)** — cloud and self-hosted API docs

---

## Contributing

```bash
# Run tests
uv run pytest

# Frontend type-check
cd packages/sdk && npx tsc --noEmit
```

Please open an issue before submitting a large PR so the approach can be agreed on first.

## License

MIT
