---
id: transports
title: Transport Layer
sidebar_position: 5
---

# Transport Layer

All transports implement the same `Transport` interface — swap them without changing application logic.

---

## Transport Interface

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

---

## TransportSwitcher

`TransportSwitcher` wraps two transports and upgrades mid-conversation — start on WebSocket for fastest connection, seamlessly cut over to WebRTC for better audio quality.

### Setup

```typescript
import { WebSocketTransport }  from './sdk/transports/WebSocketTransport';
import { WebRTCTransport }     from './sdk/transports/WebRTCTransport';
import { TransportSwitcher }   from './sdk/transports/TransportSwitcher';

const ws  = new WebSocketTransport({ url: 'ws://localhost:8000/ws' });
const rtc = new WebRTCTransport({ baseUrl: 'http://localhost:8000' });

const switcher = new TransportSwitcher(ws, {
  triggers: ['manual', 'qos'],
  silenceGapMs: 300,
  upgradeTimeoutMs: 10_000,
  qosThresholds: {
    rttUpgradeMs: 250,           // upgrade when avg RTT > 250 ms
    consecutiveBreachCount: 3,   // require 3 consecutive breaches
  },
});

await ws.connect();
```

### Manual Upgrade

```typescript
// Pre-connect WebRTC in the background — no audio interruption
await switcher.prepare(rtc);

// Cut over during the next silence gap
const result = await switcher.upgrade();
// { success: true, from: 'websocket', to: 'webrtc', gapMs: 12 }
```

### Automatic QoS-Driven Upgrade

```typescript
switcher.enableQoS();   // monitors primary; upgrades automatically when thresholds breach
```

### Lifecycle Phases

`idle → preparing → ready → switching → done / failed`

After a successful upgrade, the switcher moves the secondary transport into the primary slot and restarts QoS monitoring on it.

### Tear Down

```typescript
switcher.destroy();   // cancels QoS, disconnects both transports
```
