---
id: transports
title: Transports
sidebar_position: 3
---

# Transports

All transports implement the same `Transport` interface — swap them without changing application logic.

---

## Transport interface

```typescript
interface Transport {
  connect(): Promise<void>;
  disconnect(): void;
  sendAudio(buffer: ArrayBuffer): void;
  sendMessage(msg: object): void;
  on(event: 'onAudio' | 'onMessage' | 'onStatusChange' | 'onError' | 'onTrack', handler): void;
}
```

---

## WebSocketTransport

```typescript
import { WebSocketTransport } from './sdk/transports/WebSocketTransport';

const t = new WebSocketTransport({
  url:       'ws://localhost:8000/ws',
  timeoutMs: 10_000,
});

t.on('onAudio',        buf    => { /* ArrayBuffer PCM16 */ });
t.on('onMessage',      msg    => { /* JSON control object */ });
t.on('onStatusChange', status => { /* idle|connecting|connected|failed|closed */ });
t.on('onError',        err    => { /* Error */ });

await t.connect();
t.sendAudio(pcmBuffer);
t.disconnect();
```

---

## WebRTCTransport

Uses SmallWebRTC (Pipecat's lightweight signalling layer). Audio flows through a media track — `sendAudio()` is a no-op.

```typescript
import { WebRTCTransport } from './sdk/transports/WebRTCTransport';

const t = new WebRTCTransport({
  baseUrl:            'http://localhost:8000',
  metadata:           { session_type: 'default' },
  iceTransportPolicy: 'all',   // 'relay' forces TURN only
  staticIceServers:   [],      // skip /ice-servers fetch
  timeoutMs:          15_000,
});

t.on('onTrack', stream => {
  const audio = document.createElement('audio');
  audio.srcObject = stream;
  audio.autoplay = true;
});

await t.connect();
```

`iceTransportPolicy: 'relay'` is useful for testing that TURN is correctly configured.
