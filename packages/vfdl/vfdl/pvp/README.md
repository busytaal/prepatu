# Prepatu Voice Protocol (PVP)

**Version:** `pvp/1.0`  
**Status:** Draft

PVP is the wire protocol and server-side interface specification that connects any compliant backend to the [`voiceagent-sdk`](../../frontend/) client library.  It is transport-aware: the baseline uses **WebSocket**, with an optional graceful upgrade path to **WebRTC**.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Transport layers](#transport-layers)
3. [Session lifecycle](#session-lifecycle)
4. [Wire protocol — message reference](#wire-protocol)
5. [Binary frames](#binary-frames)
6. [Implementing a compliant server (Python)](#server-implementation)
7. [Client integration (TypeScript)](#client-integration)
8. [WebRTC upgrade flow](#webrtc-upgrade-flow)
9. [Future: multimodal extension](#multimodal-extension)
10. [Package roadmap](#package-roadmap)

---

## Architecture

```
┌──────────────────────────────────────┐     pvp/1.0      ┌──────────────────────────────────────┐
│        voiceagent-sdk (browser)       │ ◄──────────────► │        prepatu-server (Python)        │
│                                       │   WS / WebRTC    │                                       │
│  VoiceAgent                           │                  │  BaseVoiceSession (ABC)                │
│    ├─ WebSocket transport             │                  │    ├─ on_session_start(ctx)            │
│    ├─ WebRTC transport                │                  │    ├─ on_audio(data, ctx)              │
│    ├─ PCM16 capture  ──────────────► │  binary frames   │    ├─ on_message(msg, ctx)            │
│    └─ PCM16 playback ◄────────────── │  binary frames   │    └─ on_session_end(ctx)             │
│                                       │                  │                                       │
│  QoSMonitor  ─────────────────────► │  JSON frames     │  mount_voice_router(app, MySession)    │
└──────────────────────────────────────┘                  └──────────────────────────────────────┘
```

### Package split (planned)

| Package | Language | Install |
|---|---|---|
| `@prepatu/voice-sdk` | TypeScript | `npm install @prepatu/voice-sdk` |
| `prepatu-server` | Python | `pip install prepatu-server` |

Both packages share the same protocol version string and remain compatible as long as the major version matches.

---

## Transport layers

### WebSocket (baseline)

- **Path:** `GET /ws?interview_type=part1&user_id=abc`
- Messages are **multiplexed on a single connection**: JSON text frames for control, binary frames for audio.
- Query parameters are forwarded to `SessionContext.metadata` and are available to every hook.

### WebRTC (optional upgrade)

The client may request a transport upgrade after the session is established (see [WebRTC upgrade flow](#webrtc-upgrade-flow)).  Once upgraded, audio travels over a DTLS-SRTP media track instead of binary WebSocket frames.  The WebSocket connection remains open for JSON control traffic.

---

## Session lifecycle

```
Client                                      Server
  │                                           │
  │── WS connect ─────────────────────────►  │ accept()
  │                                           │ BaseVoiceSession.run(ws, metadata)
  │◄── { type: "status", status: "idle" } ── │ send config + status
  │◄── { type: "config", ... } ─────────────  │
  │                                           │ on_session_start(ctx)
  │                                           │   └─ pipeline starts
  │── binary PCM16 ──────────────────────►   │ on_audio(data, ctx)  [repeating]
  │── { type: "ping", ts: 1234 } ─────────►  │
  │◄── { type: "pong", ts: 1234, ... } ─────  │ [auto-handled]
  │◄── binary PCM16 (TTS) ────────────────   │
  │◄── { type: "transcript", ... } ─────────  │
  │── WS close ──────────────────────────►   │ on_session_end(ctx)
```

State transitions:

```
idle  ──[pipeline ready]──►  listening  ──[VAD speech detected]──►  speaking (TTS)
                              ▲                                           │
                              └─────────────[TTS complete]───────────────┘
```

`status` messages are emitted at every state transition.

---

## Wire protocol

All text frames carry UTF-8 JSON.

### Client → Server

#### `ping`
```json
{ "type": "ping", "ts": 1718000000000 }
```
| Field | Type | Description |
|---|---|---|
| `ts` | integer | Client epoch milliseconds |

#### `config` *(optional)*
```json
{ "type": "config", "sample_rate": 16000, "channels": 1 }
```
Sent if the client wants to override defaults after reading the server `config` response.  Currently informational; the server does not renegotiate mid-session.

#### `upgrade-offer`
```json
{
  "type":     "upgrade-offer",
  "sdp":      "v=0\r\n...",
  "sdp_type": "offer"
}
```

#### `upgrade-ice`
```json
{
  "type":       "upgrade-ice",
  "candidates": [{ "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 }]
}
```

#### `upgrade-complete`
```json
{ "type": "upgrade-complete" }
```
Signals that WebRTC data channel is open; the server may stop sending audio over the WebSocket.

#### `downgrade`
```json
{ "type": "downgrade" }
```
Client requests fallback to WebSocket audio (e.g. network condition change).

---

### Server → Client

#### `status`
```json
{ "type": "status", "status": "idle" }
```
`status` ∈ `"idle"` | `"listening"` | `"speaking"`

#### `config`
```json
{
  "type":              "config",
  "audio_sample_rate": 16000,
  "audio_channels":    1,
  "audio_encoding":    "pcm_s16le"
}
```
Sent once, immediately after the WebSocket is accepted.  The client reads `audio_sample_rate` to configure its `AudioContext`.

| Field | Type | Notes |
|---|---|---|
| `audio_sample_rate` | integer | Hz — currently always 16 000 |
| `audio_channels` | integer | Currently always 1 (mono) |
| `audio_encoding` | string | `"pcm_s16le"` only in v1 |

#### `transcript`
```json
{
  "type":     "transcript",
  "id":       "uuid-v4",
  "role":     "user",
  "text":     "Hello",
  "is_final": true
}
```
`role` ∈ `"user"` | `"assistant"`.  Partial transcripts use `"is_final": false`.

#### `pong`
```json
{
  "type":      "pong",
  "ts":        1718000000000,
  "server_ts": 1718000000012
}
```
`ts` is the client's original timestamp echoed back; `server_ts` is server epoch ms.  RTT = `now - ts`.

#### `error`
```json
{ "type": "error", "message": "invalid JSON" }
```

#### `upgrade-answer`
```json
{
  "type":     "upgrade-answer",
  "sdp":      "v=0\r\n...",
  "sdp_type": "answer",
  "pc_id":    "uuid-v4"
}
```

#### `upgrade-ice`
```json
{
  "type":       "upgrade-ice",
  "candidates": [{ "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 }]
}
```

#### `upgrade-ready`
```json
{ "type": "upgrade-ready" }
```
Server has set remote description and is ready to receive the data channel.

#### `upgrade-failed`
```json
{ "type": "upgrade-failed", "reason": "not supported" }
```

#### `switch-now`
```json
{ "type": "switch-now" }
```
Server instructs the client to switch its active transport from WebSocket to the established WebRTC connection.

#### `downgrade-complete`
```json
{ "type": "downgrade-complete" }
```

---

## Binary frames

Both directions use the same encoding:

| Property | Value |
|---|---|
| Format | Raw PCM16, little-endian |
| Sample rate | As negotiated via `config` (default 16 000 Hz) |
| Channels | Mono (1) |
| Typical chunk size | ~100 ms = 3 200 bytes at 16 kHz |

The server does not add headers or framing; every binary frame is purely audio samples.

---

## Server implementation

### Minimal example

```python
from fastapi import FastAPI
from backend.pvp import BaseVoiceSession, SessionContext, mount_voice_router

app = FastAPI()

class MySession(BaseVoiceSession):
    async def on_session_start(self, ctx: SessionContext) -> None:
        await self.send_status(ctx, "listening")
        # build your STT → LLM → TTS pipeline here

    async def on_audio(self, data: bytes, ctx: SessionContext) -> None:
        # push PCM16 bytes into your pipeline
        await self._pipeline_transport.push_audio(data)

    async def on_message(self, msg: dict, ctx: SessionContext) -> None:
        # handle non-protocol JSON messages
        pass

    async def on_session_end(self, ctx: SessionContext) -> None:
        # cancel tasks, flush analytics, etc.
        pass

mount_voice_router(app, MySession, path="/ws")
```

### `BaseVoiceSession` API

```python
class BaseVoiceSession(ABC):
    # ── abstract hooks (must override) ─────────────────────────────────────
    async def on_session_start(self, ctx: SessionContext) -> None: ...
    async def on_audio(self, data: bytes, ctx: SessionContext) -> None: ...
    async def on_message(self, msg: dict, ctx: SessionContext) -> None: ...
    async def on_session_end(self, ctx: SessionContext) -> None: ...

    # ── optional hooks ──────────────────────────────────────────────────────
    async def on_upgrade_offer(self, msg: dict, ctx: SessionContext) -> None: ...
    async def on_downgrade(self, ctx: SessionContext) -> None: ...

    # ── send helpers ────────────────────────────────────────────────────────
    async def send_audio(self, ctx, data: bytes) -> None: ...
    async def send_status(self, ctx, status: str) -> None: ...
    async def send_transcript(self, ctx, role, text, id=None, is_final=True) -> None: ...
    async def send_message(self, ctx, msg: dict) -> None: ...
    async def send_error(self, ctx, message: str) -> None: ...
```

### `SessionContext` fields

| Field | Type | Description |
|---|---|---|
| `session_id` | `str` (UUID v4) | Unique per connection |
| `ws` | `WebSocket` | The raw FastAPI WebSocket |
| `metadata` | `dict[str, str]` | Query params forwarded from URL |
| `audio_config` | `AudioConfig` | Negotiated audio parameters |
| `connected_at` | `float` | `time.time()` at accept |

### `AudioConfig` fields

| Field | Default | Description |
|---|---|---|
| `sample_rate` | `16_000` | Hz |
| `channels` | `1` | Mono |
| `encoding` | `"pcm_s16le"` | Only value in v1 |

### `mount_voice_router`

```python
def mount_voice_router(
    app: FastAPI,
    session_class: type[BaseVoiceSession],
    path: str = "/ws",
    default_audio: AudioConfig | None = None,
) -> None
```

Registers a WebSocket endpoint at `path`.  A new `session_class()` instance is created for every connection.  URL query parameters (`interview_type`, `user_id`, `language`, and any custom params) are forwarded to `ctx.metadata`.

---

## Client integration

```typescript
import { VoiceAgent } from "@prepatu/voice-sdk";

const agent = new VoiceAgent({
  wsUrl: "ws://localhost:8080/ws?interview_type=part1",
  onTranscript: (role, text) => console.log(role, text),
  onStatusChange: (status) => updateUI(status),
});

await agent.connect();   // triggers session start
await agent.disconnect();
```

The `VoiceAgent` automatically:
- Reads the `config` message to set its `AudioContext` sample rate
- Routes binary frames to the PCM16 playback pipeline
- Captures microphone audio at 16 kHz via `AudioWorklet` and streams binary frames
- Responds to `ping` with `pong`
- Routes `transcript` / `status` / `error` messages to their registered callbacks

---

## WebRTC upgrade flow

```
Client                                     Server
  │── upgrade-offer (SDP) ──────────────► │ on_upgrade_offer(msg, ctx)
  │◄── upgrade-answer (SDP) ────────────  │   builds RTCPeerConnection
  │── upgrade-ice (trickle) ────────────► │   accumulates remote candidates
  │◄── upgrade-ice (trickle) ───────────  │
  │── upgrade-complete ─────────────────► │ data channel open
  │◄── upgrade-ready ───────────────────  │ second pipeline started on track
  │◄── switch-now ──────────────────────  │ ok for client to mute WS audio
  │                                        │
  │── [audio over DTLS-SRTP track] ─────► │ on_audio routed from media track
```

The server-side implementation of `on_upgrade_offer` is transport-specific.  The reference implementation uses Pipecat's `SmallWebRTCConnection`.  Any compliant server may use a different WebRTC library as long as it produces the correct message sequence above.

---

## Multimodal extension

*Planned for `pvp/2.0` — not yet part of the stable spec.*

Multimodal support has two independent dimensions:

### 1. Native audio LLMs (pipeline replacement)

Models such as GPT-4o Realtime, Gemini Live, and ElevenLabs Conversational AI accept raw audio in and produce raw audio out, removing the need for a separate STT → LLM → TTS pipeline.  PVP treats this as a **pipeline implementation detail** — the wire protocol does not change.  The client still streams PCM16 binary frames and receives PCM16 binary frames; only the server-side `on_session_start` changes:

```python
# Current (v1.0) — three-stage pipeline
class PipecatSession(BaseVoiceSession):
    async def on_session_start(self, ctx):
        # STT (Deepgram) → LLM (OpenRouter) → TTS (Cartesia)
        asyncio.create_task(self._run_stt_llm_tts_pipeline(ctx))

# Future — native audio LLM
class RealtimeSession(BaseVoiceSession):
    async def on_session_start(self, ctx):
        # GPT-4o Realtime / Gemini Live — audio in, audio out
        asyncio.create_task(self._run_native_audio_pipeline(ctx))
```

The server advertises its pipeline mode in the `config` message so the client SDK can adjust behaviour (e.g. disable local VAD when the model handles it server-side):

```json
{
  "type":          "config",
  "audio_sample_rate": 24000,
  "audio_channels": 1,
  "audio_encoding": "pcm_s16le",
  "pipeline_mode": "native_audio"
}
```

`pipeline_mode` ∈ `"stt_llm_tts"` (default, current) | `"native_audio"`.

### 2. Rich client ingress (video / image frames)

For sessions where the user shares their camera or uploads an image, the client sends additional binary frames tagged by a content-type header frame:

```json
{ "type": "media-start", "media_type": "image", "mime": "image/jpeg", "frame_id": "uuid" }
```
followed by binary frame(s) containing the raw image bytes, then:
```json
{ "type": "media-end", "frame_id": "uuid" }
```

Video frames from a live camera track arrive over the WebRTC media track (requires WebRTC upgrade).

New hooks added to `BaseVoiceSession`:

```python
# Still image submitted by the user (between media-start / media-end)
async def on_image_frame(
    self, data: bytes, mime: str, ctx: SessionContext
) -> None: ...

# Video frame from WebRTC camera track (decoded, RGBA bytes)
async def on_video_frame(
    self, data: bytes, width: int, height: int, ctx: SessionContext
) -> None: ...
```

New server→client message types:

```json
{ "type": "video-config", "width": 640, "height": 480, "fps": 30 }
{ "type": "artifact", "artifact_type": "image", "url": "...", "caption": "..." }
```

Video track negotiation happens during the WebRTC upgrade handshake; `pvp/1.0` clients ignore `video-config`.

---

## Package roadmap

| Milestone | Target |
|---|---|
| `pvp/1.0` — WebSocket baseline | **Current** |
| `prepatu-server` PyPI package | Near-term |
| `@prepatu/voice-sdk` npm package | Near-term |
| WebRTC upgrade (server side) | Medium-term |
| Trickle-ICE & TURN support | Medium-term |
| Partial transcript streaming | Medium-term |
| `pvp/2.0` — native audio LLM pipeline mode | Long-term |
| `pvp/2.0` — rich client ingress (image/video frames) | Long-term |
| Versioned schema registry | Long-term |
| Client SDK for React Native | Long-term |

---

## Versioning

The protocol version is `pvp/<major>.<minor>`.

- **Minor bumps** add optional fields / new optional message types.  Existing clients ignore unknown keys; existing servers ignore unknown `type` values.
- **Major bumps** introduce breaking changes to required message shapes or the session lifecycle.

The server always advertises its version in the `config` message:

```json
{ "type": "config", "pvp_version": "1.0", "audio_sample_rate": 16000, ... }
```

*(The `pvp_version` field will be added in the first published release.)*
