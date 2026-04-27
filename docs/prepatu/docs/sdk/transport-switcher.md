---
id: transport-switcher
title: TransportSwitcher
sidebar_position: 4
---

# TransportSwitcher

`TransportSwitcher` wraps two transports and upgrades mid-conversation — start on WebSocket for fastest connection, seamlessly cut over to WebRTC for better audio quality.

---

## Setup

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

---

## Manual upgrade

```typescript
// Pre-connect WebRTC in the background — no audio interruption
await switcher.prepare(rtc);

// Cut over during the next silence gap
const result = await switcher.upgrade();
// { success: true, from: 'websocket', to: 'webrtc', gapMs: 12 }
```

---

## Automatic QoS-driven upgrade

```typescript
switcher.enableQoS();   // monitors primary; upgrades automatically when thresholds breach
```

---

## Lifecycle phases

`idle → preparing → ready → switching → done / failed`

After a successful upgrade, the switcher moves the secondary transport into the primary slot and restarts QoS monitoring on it.

---

## Tear down

```typescript
switcher.destroy();   // cancels QoS, disconnects both transports
```
