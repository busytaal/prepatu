# Prepatu

> **Define voice agents in YAML. The state machine runs the show. The LLM does the talking.**

[![Docs](https://img.shields.io/badge/docs-docs.prepatu.com-4A90E2)](https://docs.prepatu.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm](https://img.shields.io/npm/v/@prepatu/sdk)](https://www.npmjs.com/package/@prepatu/sdk)

Prepatu is an open-source engine for building reliable, multi-step voice applications. You describe your conversation as a YAML state machine — the engine confines the LLM to one state at a time, pushes UI artifacts to the client, and ensures the flow completes even if the model misbehaves.

---

## Why a state machine?

LLMs are brilliant at understanding language. They're terrible at following a script.

Ask an LLM to run a 5-step booking flow and it will skip steps, invent transitions, forget where it is, or hallucinate a confirmation the user never gave. Every team building voice agents hits the same wall: **the LLM cannot be trusted with flow control.**

Prepatu solves this by separating concerns:

- **YAML state machine** — defines the flow: states, transitions, tools, artifacts
- **LLM** — operates *inside* each state: natural language, entity extraction, tool calls
- **Engine** — enforces the rules: the LLM cannot skip states, call foreign tools, or invent transitions

```yaml
id: support-agent
initial_state: greet

states:
  greet:
    agent:
      prompt: |
        Welcome the user and ask how you can help today.
        Call `collect_issue` once you understand their problem.
      tools: [collect_issue]
    transitions:
      on_tool_call:
        collect_issue: resolve   # ← engine moves here, LLM can't skip it

  resolve:
    agent:
      prompt: Diagnose and solve {issue}. When done, call `close`.
      tools: [close]
    transitions:
      on_tool_call:
        close: end
```

→ [State machine deep-dive](https://docs.prepatu.com/docs/flows/state-machine) · [YAML reference](https://docs.prepatu.com/docs/flows/yaml-reference) · [Variables & interpolation](https://docs.prepatu.com/docs/flows/variables)

---

## Three ways to use Prepatu

### ☁️ Managed Cloud — zero infra

Sign up at [prepatu.com](https://prepatu.com/ui), upload your flow, connect from any frontend.

```bash
# Upload a flow
curl -X POST https://api.prepatu.com/v1/flows \
  -H "X-Prepatu-Key: pk_live_..." \
  -F "name=support-agent" \
  -F "yaml_content=<flow.yaml"

# Start a session → get a WebSocket URL back
curl -X POST https://api.prepatu.com/v1/sessions \
  -H "X-Prepatu-Key: pk_live_..." \
  -d '{"flow_id": "flw_..."}'
```

Connect from the browser in one line:

```ts
import { Prepatu } from '@prepatu/sdk';

const agent = await Prepatu.createAgent({ apiKey: 'pk_live_...', flowId: 'flw_...' });
agent.on('audio', buf => /* play it */);
await agent.connect();
```

→ [Cloud quickstart](https://docs.prepatu.com/docs/getting-started/cloud-quickstart) · [Cloud API reference](https://docs.prepatu.com/docs/reference/cloud-api) · [Credit & QoS](https://docs.prepatu.com/docs/reference/qos)

---

### 📦 Self-hosted — your infra, your keys

```bash
pip install vfdl
```

```python
from vfdl.agents.flow_engine import load_flow

flow = load_flow("./flow.yaml")   # validates, returns FlowConfig
```

Or run the full cloud service yourself:

```bash
git clone https://github.com/busytaal/prepatu.git
cd prepatu
uv sync --all-packages
uv run uvicorn services.cloud.main:app --port 4000
```

→ [Self-hosted quickstart](https://docs.prepatu.com/docs/getting-started/self-hosted-quickstart) · [Deployment guide](https://docs.prepatu.com/docs/reference/deployment) · [Environment variables](https://docs.prepatu.com/docs/reference/env-variables) · [Self-hosted API](https://docs.prepatu.com/docs/reference/self-hosted-api)

---

### 🧩 JavaScript / TypeScript SDK

```bash
npm install @prepatu/sdk
```

```ts
import { Prepatu } from '@prepatu/sdk';

// Managed cloud
const agent = await Prepatu.createAgent({ apiKey: 'pk_live_...', flowId: 'flw_...' });

// Self-hosted
const agent = await Prepatu.createAgent({ backendUrl: 'wss://your-server/ws' });

agent.on('message', msg => console.log(msg));
agent.on('status',  s   => console.log(s));
await agent.connect();
```

→ [SDK — connecting](https://docs.prepatu.com/docs/sdk/connecting) · [Sending events](https://docs.prepatu.com/docs/sdk/sending-events) · [Handling artifacts](https://docs.prepatu.com/docs/sdk/handling-artifacts) · [Full API reference](https://docs.prepatu.com/docs/sdk/voice-agent-reference)

---

## Example apps

| App | What it shows | Source |
|---|---|---|
| **10 Questions** | Voice game — AI picks a secret, you ask yes/no questions | [apps/ten-questions/](apps/ten-questions/) |
| **Booking Wizard** | 3-step appointment booking with voice-to-form autofill | [apps/demo-wizard/](apps/demo-wizard/) |
| **IELTS Coach** | Full mobile + web app — multi-flow language practice with scoring | [apps/ielts/](apps/ielts/) |

→ [10 Questions walkthrough](https://docs.prepatu.com/docs/examples/ten-questions) · [Booking Wizard walkthrough](https://docs.prepatu.com/docs/examples/booking-wizard) · [IELTS Coach walkthrough](https://docs.prepatu.com/docs/examples/ielts-coach)

---

## Flows — what you can do in YAML

| Feature | Docs |
|---|---|
| States, transitions, tool calls | [First flow](https://docs.prepatu.com/docs/flows/first-flow) |
| Variables & prompt interpolation | [Variables](https://docs.prepatu.com/docs/flows/variables) |
| Push UI cards, forms, images to the browser | [Artifacts](https://docs.prepatu.com/docs/flows/artifacts) |
| Human-in-the-loop confirmation gates | [Confirmation gates](https://docs.prepatu.com/docs/flows/confirmation-gates) |
| Full YAML field reference | [YAML reference](https://docs.prepatu.com/docs/flows/yaml-reference) |

---

## Architecture & internals

| Topic | Docs |
|---|---|
| How the engine works end-to-end | [Architecture](https://docs.prepatu.com/docs/reference/architecture) |
| Audio pipeline (STT → LLM → TTS) | [Pipeline](https://docs.prepatu.com/docs/reference/pipeline) |
| Swapping STT / LLM / TTS providers | [Providers](https://docs.prepatu.com/docs/reference/providers) |
| WebSocket wire protocol | [Wire protocol](https://docs.prepatu.com/docs/reference/wire-protocol) |
| Transport options (WebSocket / WebRTC) | [Transports](https://docs.prepatu.com/docs/reference/transports) |
| Flow engine internals | [Flow engine](https://docs.prepatu.com/docs/reference/flow-engine) |

---

## Repo layout

```
packages/
  sdk/          — @prepatu/sdk (TypeScript, CJS + ESM)
  vfdl/         — Python flow engine (pip install vfdl)
services/
  cloud/        — Managed cloud service (FastAPI, SQLite, JWT, credits)
apps/
  ten-questions/  — Voice game demo
  demo-wizard/    — Booking wizard demo
  ielts/          — Full IELTS coaching app (backend + frontend + mobile)
deploy/         — Docker Compose + observability stack (Prometheus, Loki, Grafana)
docs/prepatu/   — Docusaurus docs (deployed to docs.prepatu.com)
```

---

## Dev setup

```bash
git clone https://github.com/busytaal/prepatu.git
cd prepatu

# Python (engine + cloud service)
uv sync --all-packages
uv run pytest

# SDK
cd packages/sdk && npm install && npm run build

# Run the cloud service locally
uv run uvicorn services.cloud.main:app --reload --port 4000
```

---

## Contributing

Open an issue before submitting a large PR so the approach can be agreed on first.

```bash
uv run pytest                        # full test suite
cd packages/sdk && npx tsc --noEmit  # TypeScript check
```

## License

MIT
