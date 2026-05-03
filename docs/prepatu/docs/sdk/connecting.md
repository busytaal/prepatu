---
id: connecting
title: Connecting to Prepatu
sidebar_position: 1
---

# Connecting to Prepatu

This page covers how your frontend connects to a Prepatu voice session — whether you're using the cloud service or a self-hosted backend.

---

## The Connection Flow

```
1. Your backend gets a WebSocket URL
   - Cloud: POST /v1/sessions → { ws_url: "wss://..." }
   - Self-hosted: construct the URL directly (ws://localhost:8000/ws)

2. Your frontend connects VoiceAgent to that URL

3. VoiceAgent handles:
   - Microphone capture (AudioWorklet, 16 kHz PCM16)
   - Audio playback (scheduled PCM16 buffers)
   - JSON message routing (flow_state, transcript, status, etc.)
```

---

## Cloud Connection

### Step 1: Start a Session (Server-Side)

Call the cloud API from your backend — **never expose your API key to the client**:

```typescript
// Your backend (Node.js, Python, etc.)
const res = await fetch('https://api.prepatu.io/v1/sessions', {
  method: 'POST',
  headers: {
    'X-Prepatu-Key': process.env.PREPATU_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ flow_id: 'your-flow-id' }),
});

const { ws_url, session_token } = await res.json();
// ws_url = "wss://api.prepatu.io/v1/ws/st_..."
```

### Step 2: Connect VoiceAgent (Client-Side)

```typescript
import { VoiceAgent } from '@prepatu/voice-sdk';

// Get the ws_url from your backend
const res = await fetch('/api/start-session', { method: 'POST' });
const { ws_url } = await res.json();

const agent = VoiceAgent.withWebSocket(
  { url: ws_url },
  {
    onStatus:  status => console.log('Session:', status),
    onMessage: msg    => handleMessage(msg),
    onError:   err    => console.error('Error:', err),
  }
);

await agent.connect();   // Opens WebSocket + requests microphone
```

---

## Self-Hosted Connection

Connect directly to your backend's WebSocket endpoint:

```typescript
const agent = VoiceAgent.withWebSocket(
  { url: 'ws://localhost:8000/ws?mode=flow&program_id=my_flow' },
  {
    onStatus:  status => console.log('Session:', status),
    onMessage: msg    => handleMessage(msg),
    onError:   err    => console.error(err),
  }
);

await agent.connect();
```

---

## Session Lifecycle

```
idle → connecting → connected → listening → speaking → listening → ... → ended
```

The `onStatus` callback fires at every transition. Common patterns:

```typescript
onStatus: status => {
  if (status === 'connected') showMicIndicator();
  if (status === 'listening') setOrb('listening');
  if (status === 'speaking')  setOrb('speaking');
  if (status === 'ended')     showSummary();
}
```

---

## Basic Controls

```typescript
// Mute/unmute the microphone
agent.setMicEnabled(false);
agent.setMicEnabled(true);

// Send a text message (ping, config, ui_event)
agent.sendMessage({ type: 'ping', ts: Date.now() });

// Disconnect
agent.disconnect();
```

---

## WebRTC Connection (Alternative)

For better audio quality and NAT traversal:

```typescript
const agent = VoiceAgent.withWebRTC(
  {
    baseUrl: 'http://localhost:8000',
    metadata: { session_type: 'default' },
  },
  {
    onStatus:  s   => console.log(s),
    onMessage: msg => handleMessage(msg),
  }
);

await agent.connect();
```

WebRTC uses the browser's native Opus codec — no raw PCM16 encoding needed. Audio flows through media tracks automatically.

---

## Next Steps

- **[Handling Artifacts](./handling-artifacts)** — rendering forms, cards, and options from flow_state messages
- **[Sending UI Events](./sending-events)** — how to send form submissions and button taps back to the engine
- **[VoiceAgent Reference](./voice-agent-reference)** — full API documentation
