---
id: browser
title: Browser SDK Overview
sidebar_position: 1
---

# Browser SDK

The browser SDK lives at `apps/ielts/frontend/src/sdk/`. It is a transport-agnostic TypeScript library — use it standalone or extend it for your own app.

```
sdk/
  VoiceAgent.ts            ← high-level API (mic + playback + transport)
  transports/
    Transport.ts           ← shared interface & types
    WebSocketTransport.ts
    WebRTCTransport.ts
    TransportSwitcher.ts   ← WS→WebRTC upgrade mid-session
  utils/
    QoSMonitor.ts          ← continuous quality metrics
    QoSCharts.ts           ← canvas sparklines
```

---

## Quick usage

```typescript
import { VoiceAgent } from './sdk/VoiceAgent';

const agent = VoiceAgent.withWebSocket(
  { url: 'ws://localhost:8000/ws' },
  {
    onStatus:  s   => console.log('status:', s),
    onMessage: msg => console.log('message:', msg),
    onError:   err => console.error(err),
  }
);

await agent.connect();
// user speaks → bot replies

agent.setMicEnabled(false);  // mute
agent.disconnect();
```

---

## Transport selection guide

| Scenario | Recommended transport |
|---|---|
| Quick prototype, same network | `WebSocketTransport` |
| Production, unknown network | `WebRTCTransport` |
| Best of both | `TransportSwitcher` (starts WS, upgrades to WebRTC) |

Continue to:
- [VoiceAgent](./voice-agent)
- [Transports](./transports)
- [TransportSwitcher](./transport-switcher)
- [QoS](./qos)
