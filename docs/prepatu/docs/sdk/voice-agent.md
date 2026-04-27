---
id: voice-agent
title: VoiceAgent
sidebar_position: 2
---

# VoiceAgent

`VoiceAgent` is the main entry point. It manages microphone capture (`AudioWorklet`), scheduled PCM playback, and session lifecycle on top of any `Transport`.

---

## Factory methods

### `VoiceAgent.withWebSocket(config, options)`

```typescript
const agent = VoiceAgent.withWebSocket(
  { url: 'ws://localhost:8000/ws' },
  { onStatus, onMessage, onError }
);
```

### `VoiceAgent.withWebRTC(config, options)`

```typescript
const agent = VoiceAgent.withWebRTC(
  { baseUrl: 'http://localhost:8000', metadata: { session_type: 'default' } },
  { onStatus }
);
```

### `new VoiceAgent(transport, options)`

Pass any `Transport` — including a `TransportSwitcher` — directly.

---

## Options

| Option | Type | Description |
|---|---|---|
| `onStatus` | `(status: SessionStatus) => void` | `idle → connecting → connected → listening → speaking → ended` |
| `onMessage` | `(msg: BotMessage) => void` | JSON control messages from the server |
| `onQoS` | `(snap: QoSSnapshot) => void` | Live quality metrics (requires `QoSMonitor`) |
| `onError` | `(err: Error) => void` | Transport-level errors |
| `onLog` | `(msg: string) => void` | Internal diagnostic log |

---

## Methods

| Method | Description |
|---|---|
| `connect()` | Opens transport + requests mic permission |
| `disconnect()` | Closes transport + releases mic |
| `setMicEnabled(enabled)` | Mute / unmute microphone |
| `sendMessage(msg)` | Send a JSON control message to the server |

---

## Audio path (WebSocket)

```
getUserMedia (16 kHz, mono, AEC+NS)
    └── AudioWorklet "pcm-sender"
            ├── Int16Array conversion
            └── sendAudio(buffer) → WebSocket binary frame

WebSocket binary frame (PCM16 from server)
    └── Int16Array → Float32Array
            └── AudioBufferSourceNode (scheduled, gapless)
                    └── MediaStreamDestinationNode (AEC reference)
```
