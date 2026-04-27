---
id: qos
title: QoS Monitor & Charts
sidebar_position: 5
---

# QoS Monitor & Charts

---

## QoSMonitor

Attaches to any `Transport` and continuously measures voice call quality.

```typescript
import { QoSMonitor } from './sdk/utils/QoSMonitor';

const monitor = new QoSMonitor(
  transport,
  snapshot => {
    console.log(`RTT: ${snapshot.rttMs} ms`);
    console.log(`Jitter: ${snapshot.jitterMs} ms`);
    console.log(`Audio delivery: ${(snapshot.audioDeliveryRatio! * 100).toFixed(1)}%`);
  },
  {
    pingIntervalMs:      5_000,
    rttWindowSize:       10,
    audioEvalIntervalMs: 3_000,
  }
);

monitor.start();
// Call this whenever you send audio, for response-latency measurement:
monitor.notifySendAudio();
monitor.stop();
```

### QoSSnapshot fields

| Field | Unit | Description |
|---|---|---|
| `rttMs` | ms | Latest ping/pong RTT |
| `avgRttMs` | ms | Rolling average (last N samples) |
| `jitterMs` | ms | Std-dev of the RTT window |
| `responseLatencyMs` | ms | Time from user utterance end → first bot audio |
| `audioDeliveryRatio` | 0–1 | Fraction of expected frames that arrived on time |
| `measuredAt` | epoch ms | Snapshot timestamp |

---

## QoSCharts

Real-time canvas sparklines — 4 charts (RTT, Jitter, Response Latency, Audio Delivery %) with WS and WebRTC series.

```typescript
import { QoSCharts } from './sdk/utils/QoSCharts';

const charts = new QoSCharts(containerElement, { maxPoints: 60 });

monitor.onChange = snap => charts.push('websocket', snap);
// After upgrade:
charts.push('webrtc', snap);

charts.clear();
charts.destroy();   // stops RAF loop, removes canvases
```

Series colours: **WebSocket = `#3c8fff`**, **WebRTC = `#ff8c42`**.
