# Prepatu — Voice Flow Engine & SDK

Transport-agnostic voice pipeline runtime ([VFDL](packages/vfdl/)) built on [Pipecat](https://github.com/pipecat-ai/pipecat) + FastAPI. Ships with a TypeScript browser SDK (WebSocket + WebRTC) and a live debug panel. Use VFDL as a standalone `pip install vfdl` package or fork the monorepo as a starting point for your own voice experience.

**Stack at a glance**

| Layer | Tech |
|---|---|
| VFDL engine | Python 3.12, Pipecat, FastAPI — `packages/vfdl/` |
| Browser SDK | TypeScript, Vite — WebSocket + WebRTC transports |

---

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Backend](#backend)
  - [Requirements](#requirements)
  - [Environment Variables](#environment-variables)
  - [Running](#running)
  - [API Reference](#api-reference)
  - [Wire Protocol](#wire-protocol)
- [Browser SDK](#browser-sdk)
  - [VoiceAgent](#voiceagent)
  - [WebSocketTransport](#websockettransport)
  - [WebRTCTransport](#webrtctransport)
  - [TransportSwitcher](#transportswitcher)
  - [QoSMonitor](#qosmonitor)
  - [QoSCharts](#qoscharts)
- [Debug Panel](#debug-panel)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Architecture

```
Browser
┌──────────────────────────────────────────────┐
│  VoiceAgent                                  │
│  ┌─────────────────────────────────────────┐ │
│  │ AudioWorklet (capture, 16 kHz PCM16)    │ │
│  │ AudioContext  (playback, scheduled)     │ │
│  │ MediaStreamDestination (AEC reference) │ │
│  └─────────────────────────────────────────┘ │
│         ▲ onAudio   ▼ sendAudio              │
│  ┌──────┴──────────────────┐                 │
│  │   TransportSwitcher     │  (optional)     │
│  │  ┌──────────┐ ┌───────┐ │                 │
│  │  │  WS      │ │ WebRTC│ │                 │
│  │  └──────────┘ └───────┘ │                 │
│  └─────────────────────────┘                 │
└──────────────────────────────────────────────┘
           │ TCP / UDP
┌──────────────────────────────────────────────┐
│  FastAPI + Pipecat backend                   │
│                                              │
│  WebSocket path:                             │
│  WS /ws  →  STT → LLM → TTS  →  WS          │
│  (Deepgram)  (OpenRouter)  (Cartesia)        │
│                                              │
│  WebRTC path:                                │
│  POST /offer  →  SmallWebRTC + Pipecat       │
│  PATCH /offer/{pc_id}  (trickle ICE)        │
└──────────────────────────────────────────────┘
```

Both paths run the same STT → LLM → TTS Pipecat pipeline. WebSocket carries raw PCM16; WebRTC uses Opus via the browser's native codec stack.

---

## Quick Start

```bash
# 1 — clone
git clone https://github.com/busytaal/prepatu.git
cd prepatu

# 2 — install all Python packages (requires uv — https://docs.astral.sh/uv/)
uv sync --all-packages

# 3 — copy and fill in environment variables
cp .env.example .env         # then open .env and add your API keys

# 4 — start the backend
cd apps/ielts/backend
uvicorn main:app --host 0.0.0.0 --reload

# 5 — start the browser SDK demo (in a second terminal)
cd apps/ielts/frontend
npm install
npm run dev          # Vite dev server → http://localhost:5173
# or: npm run build  # production bundle → apps/ielts/frontend/dist/
```

Open `http://localhost:5173` for the live debug panel.

---

## Backend

### Requirements

| Dependency | Purpose |
|---|---|
| Python ≥ 3.12 | runtime |
| `pipecat-ai` | pipeline orchestration |
| `fastapi` + `uvicorn` | HTTP / WebSocket server |
| `deepgram-sdk` | STT + TTS provider |
| `openai` (via OpenRouter) | LLM provider |
| `aiosqlite` | session storage |

### Environment Variables

Copy `.env.example` to `.env` and fill in your keys:

```dotenv
# --- Provider selection (only supported values shown) ---
STT_PROVIDER=deepgram
TTS_PROVIDER=deepgram
LLM_PROVIDER=openrouter
TURN_PROVIDER=cloudflare   # or "static"

# --- Deepgram (STT + TTS share one key) ---
STT_API_KEY=dg-...
TTS_API_KEY=dg-...
TTS_VOICE=aura-2-thalia-en   # Deepgram voice ID

# --- LLM (OpenRouter) ---
LLM_API_KEY=sk-or-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini   # any OpenRouter model slug

# --- TURN (needed for WebRTC through NAT / corporate firewalls) ---
TURN_KEY_ID=...
TURN_API_TOKEN=...
TURN_TTL_SECONDS=3600

# --- Server ---
HOST=0.0.0.0
PORT=8000

# --- System prompt override (optional) ---
SYSTEM_PROMPT=You are a helpful voice assistant.
# SYSTEM_PROMPT_FILE=./prompts/agent_prompt.txt
```

Getting API keys:
- **Deepgram** — <https://console.deepgram.com/>
- **OpenRouter** — <https://openrouter.ai/keys>
- **Cloudflare TURN** — <https://dash.cloudflare.com/> → Calls → TURN credentials


### Running

```bash
# Development (from apps/ielts/backend/)
uvicorn main:app --host 0.0.0.0 --reload

# Production
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

### API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check — returns `{"status":"ok"}` |
| `WS` | `/ws` | WebSocket voice session |
| `POST` | `/offer` | WebRTC SDP offer → answer |
| `PATCH` | `/offer/{pc_id}` | Trickle ICE candidate exchange |
| `GET` | `/ice-servers` | TURN/STUN server list for the client |
| `GET` | `/test` | Built-in WebRTC browser test page |

### Wire Protocol

#### WebSocket

Client → Server (binary): raw PCM16, 16 kHz, mono, little-endian. Recommended chunk size ~100 ms (3 200 bytes).

Client → Server (text / JSON):

```jsonc
{ "type": "ping",   "ts": 1713000000000 }
{ "type": "config", "sample_rate": 16000, "channels": 1 }
```

Server → Client (binary): raw PCM16, 16 kHz, mono, little-endian (TTS output).

Server → Client (text / JSON):

```jsonc
{ "type": "config",     "audio_sample_rate": 16000, "audio_encoding": "pcm_s16le" }
{ "type": "status",     "status": "idle" | "listening" | "speaking" }
{ "type": "transcript", "id": "...", "role": "user" | "assistant", "text": "..." }
{ "type": "pong",       "ts": 1713000000000, "server_ts": 1713000000001 }
{ "type": "error",      "message": "..." }
```

---

## Browser SDK

All SDK files live under `apps/ielts/frontend/src/sdk/`.

```
sdk/
  transports/
    Transport.ts           — shared interfaces & types
    WebSocketTransport.ts  — WebSocket implementation
    WebRTCTransport.ts     — WebRTC implementation (SmallWebRTC)
    TransportSwitcher.ts   — seamless WS→WebRTC upgrade
  utils/
    QoSMonitor.ts          — continuous quality metrics
    QoSCharts.ts           — canvas sparkline visualiser
  VoiceAgent.ts            — high-level API (mic + playback + transport)
```

### VoiceAgent

The main entry point. Manages mic capture (AudioWorklet), scheduled PCM playback, and session lifecycle.

```typescript
import { VoiceAgent } from './sdk/VoiceAgent';

// WebSocket only
const agent = VoiceAgent.withWebSocket(
  { url: 'ws://localhost:8000/ws' },
  {
    onStatus:  status => console.log('session:', status),
    onMessage: msg    => console.log('bot:', msg),
    onError:   err    => console.error(err),
  }
);

await agent.connect();   // opens WebSocket + requests mic
agent.setMicEnabled(false);   // mute
agent.sendMessage({ type: 'ping', ts: Date.now() });
agent.disconnect();

// WebRTC only
const agent = VoiceAgent.withWebRTC(
  { baseUrl: 'http://localhost:8000', metadata: { session_type: 'default' } },
  { onStatus: s => console.log(s) }
);
```

**`VoiceAgentOptions`**

| Option | Type | Description |
|---|---|---|
| `transport` | `Transport \| TransportLike` | Any transport or a `TransportSwitcher` |
| `onStatus` | `(status: SessionStatus) => void` | `idle` → `connecting` → `connected` → `listening` → `speaking` → `ended` |
| `onMessage` | `(msg: BotMessage) => void` | Transcript, status, and control messages from the bot |
| `onQoS` | `(snap: QoSSnapshot) => void` | Live quality metrics (when a `QoSMonitor` is attached) |
| `onError` | `(err: Error) => void` | Transport-level errors |
| `onLog` | `(msg: string) => void` | Internal diagnostic log |

#### Audio path (WebSocket mode)

```
getUserMedia (16 kHz, mono, AEC+NS)
    └── AudioWorklet "pcm-sender" (audio thread)
            ├── Int16Array conversion
            └── postMessage → sendAudio(buffer) → WebSocket binary frame

WebSocket binary frame (PCM16 from server)
    └── Int16Array → Float32Array
            └── AudioBufferSourceNode (scheduled, sequential)
                    └── MediaStreamDestinationNode → <audio> (AEC reference)
```

### WebSocketTransport

Low-level WebSocket wrapper. Use `VoiceAgent.withWebSocket()` for most cases.

```typescript
import { WebSocketTransport } from './sdk/transports/WebSocketTransport';

const t = new WebSocketTransport({
  url:       'ws://localhost:8000/ws',
  timeoutMs: 10_000,   // connect timeout (default 10 s)
});

t.on('onAudio',        data   => { /* ArrayBuffer of PCM16 */ });
t.on('onMessage',      msg    => { /* JSON control message  */ });
t.on('onStatusChange', status => { /* idle|connecting|connected|failed|closed */ });
t.on('onError',        err    => { /* Error */ });

await t.connect();
t.sendAudio(pcmBuffer);    // ArrayBuffer
t.sendMessage({ type: 'ping', ts: Date.now() });
t.disconnect();
```

### WebRTCTransport

WebRTC transport using SmallWebRTC (Pipecat's lightweight signalling layer). The browser's mic is attached via `getUserMedia` and sent as a media track; received audio fires `onTrack`.

```typescript
import { WebRTCTransport } from './sdk/transports/WebRTCTransport';

const t = new WebRTCTransport({
  baseUrl:          'http://localhost:8000',
  metadata:         { session_type: 'default' },
  iceTransportPolicy: 'all',    // 'relay' forces TURN
  staticIceServers: [],         // skip /ice-servers fetch
  timeoutMs:        15_000,
});

t.on('onTrack', stream => {
  const audio = document.createElement('audio');
  audio.srcObject = stream;
  audio.autoplay = true;
});

await t.connect();
```

`sendAudio()` is a no-op on WebRTC — audio flows through the media track automatically.

### TransportSwitcher

Wraps the primary transport and pre-connects a secondary transport in the background, then cuts over mid-conversation with a configurable silence gap.

```typescript
import { WebSocketTransport }  from './sdk/transports/WebSocketTransport';
import { WebRTCTransport }     from './sdk/transports/WebRTCTransport';
import { TransportSwitcher }   from './sdk/transports/TransportSwitcher';

const ws  = new WebSocketTransport({ url: 'ws://localhost:8000/ws' });
const rtc = new WebRTCTransport({ baseUrl: 'http://localhost:8000' });

const switcher = new TransportSwitcher(ws, {
  triggers:        ['manual', 'qos'],   // 'server-signal' also available
  silenceGapMs:    300,                 // wait for 300 ms of silence before cutting
  upgradeTimeoutMs: 10_000,
  qosThresholds: {
    rttUpgradeMs:          250,   // upgrade WS→WebRTC when avg RTT > 250 ms
    consecutiveBreachCount: 3,    // require 3 consecutive breaches (avoids flapping)
  },
});

await ws.connect();

// Background connection — does not interrupt the conversation
await switcher.prepare(rtc);

// Manual upgrade
const result = await switcher.upgrade();
// { success: true, from: 'websocket', to: 'webrtc', gapMs: 12 }

// QoS-driven automatic upgrade
switcher.enableQoS();   // attaches a QoSMonitor to the primary

// Tear down
switcher.destroy();
```

**Switch lifecycle phases:** `idle → preparing → ready → switching → done / failed`

After a successful upgrade the switcher internally moves `secondary` into the `primary` slot and restarts QoS monitoring on the new transport.

### QoSMonitor

Attaches to any `Transport` and continuously measures quality metrics.

```typescript
import { QoSMonitor } from './sdk/utils/QoSMonitor';

const monitor = new QoSMonitor(
  transport,
  snapshot => {
    console.log(`RTT: ${snapshot.rttMs} ms, jitter: ${snapshot.jitterMs} ms`);
    console.log(`Audio delivery: ${(snapshot.audioDeliveryRatio! * 100).toFixed(1)}%`);
  },
  {
    pingIntervalMs:      5_000,   // how often to send a ping
    rttWindowSize:       10,      // rolling window for avg / jitter
    audioEvalIntervalMs: 3_000,   // how often to calculate delivery ratio
  }
);

monitor.start();
monitor.notifySendAudio();   // call this whenever you send audio, for response-latency tracking
monitor.stop();
```

**`QoSSnapshot` fields**

| Field | Unit | Description |
|---|---|---|
| `rttMs` | ms | Latest ping/pong round-trip time |
| `avgRttMs` | ms | Rolling average over last N samples |
| `jitterMs` | ms | Std-dev of the RTT window |
| `responseLatencyMs` | ms | Time from last user utterance end → first bot audio frame |
| `audioDeliveryRatio` | 0–1 | Fraction of expected audio frames that arrived on time |
| `measuredAt` | epoch ms | Timestamp of this snapshot |

### QoSCharts

Real-time canvas sparklines — 4 charts (RTT, Jitter, Response Latency, Audio Delivery %) with two series per chart.

```typescript
import { QoSCharts } from './sdk/utils/QoSCharts';

const charts = new QoSCharts(containerElement, { maxPoints: 60 });

// Push a snapshot into whichever series it belongs to
monitor.onChange = snap => charts.push('websocket', snap);

// After an upgrade
charts.push('webrtc', snap);

charts.clear();    // wipe all data
charts.destroy();  // cancel RAF loop, remove canvases
```

Series colours: **WebSocket = blue `#3c8fff`**, **WebRTC = orange `#ff8c42`**.

---

## Debug Panel

Start the Vite dev server (`npm run dev` in `apps/ielts/frontend/`) to open the two-column debug panel at `http://localhost:5173`.

**Left column**
- **Transport Mode** — WebRTC only / WebSocket only / WS→WebRTC (Switcher)
- **Connection Config** — backend base URL, WebSocket URL, metadata JSON
- **QoS Thresholds** — RTT upgrade/downgrade thresholds, consecutive breach count
- **Actions** — Connect, Disconnect, Ping, Mute, Send JSON
- **Transport Switcher** — Prepare, Upgrade, QoS auto-upgrade toggle (switcher mode only)

**Right column**
- **QoS Charts** — live sparklines for all 4 metrics with WS/WebRTC series
- **Live QoS Metrics** — numeric readout of the latest snapshot
- **Transport State** — primary/secondary type & status, session status, active transport
- **Event Log** — timestamped log of all events, with Clear button

---

## Roadmap

Planned improvements, roughly in priority order:

### Near-term

- [ ] **Opus encoding on the WebSocket path** — encode outbound PCM16 with Opus in a Web Worker before sending; decode inbound on arrival. Closes the codec quality gap with WebRTC.
- [ ] **Downgrade: WebRTC → WebSocket** — `switcher.downgrade()` is scaffolded but not fully wired; complete the reverse cut-over path.
- [ ] **Server-signal trigger** — the backend can send `{ "type": "switch-now" }` to trigger an upgrade server-side (e.g. on network congestion detection); the frontend handler is stubbed.
- [ ] **Transcript display** — surface `{ type: "transcript" }` messages from the backend as a live subtitles component.
- [ ] **React bindings** — `useVoiceAgent()` hook with state + ref-stable callbacks wrapping `VoiceAgent`.

### Medium-term

- [ ] **Interrupt handling** — wire Pipecat's `allow_interruptions` through to the frontend: play a brief tone and clear the playback queue when the user speaks over the bot.
- [ ] **Session resumption** — persist LLM context across reconnects so a dropped WebSocket can resume the same conversation thread.
- [ ] **RTVI-compatible message layer** — adopt the open [RTVI](https://github.com/rtvi-ai/rtvi) message schema so the SDK can swap backend implementations.

### Long-term

- [ ] **Adaptive bitrate** — `QoSMonitor` already detects degradation; use it to dynamically lower the PCM sample rate (16 kHz → 8 kHz) before Opus encoding when bandwidth is constrained.
- [ ] **Multi-speaker diarisation** — pass Deepgram's speaker labels through to the transcript events.
- [ ] **Streaming transcript** — use Deepgram interim results for sub-100 ms caption latency.
- [ ] **Plugin system** — allow `VoiceAgent` consumers to register frame processors (noise gate, custom VAD rules, etc.) without forking the SDK.
- [ ] **NPM package** — publish `@prepatu/voice-sdk` so the SDK can be consumed in any web project without copying source files.

---

## Contributing

```bash
# Run all tests (from repo root)
uv run pytest

# Frontend type-check
cd apps/ielts/frontend && npx tsc --noEmit

# Frontend build
cd apps/ielts/frontend && npm run build
```

Please open an issue before submitting a large PR so the approach can be agreed on first.

## License

MIT
