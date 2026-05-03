---
id: wire-protocol
title: Wire Protocol (PVP)
sidebar_position: 4
---

# Wire Protocol (PVP)

The Prepatu Voice Protocol (PVP) defines the JSON control messages exchanged over WebSocket or the WebRTC data channel alongside the audio stream.

---

## Server → Client

### `config`
Sent immediately after connection is established.

```json
{
  "type": "config",
  "audio_sample_rate": 16000,
  "audio_encoding": "pcm_s16le"
}
```

### `status`
Session lifecycle events.

```json
{"type": "status", "status": "idle"}
{"type": "status", "status": "listening"}
{"type": "status", "status": "speaking"}
{"type": "status", "status": "ended"}
```

### `transcript`
A completed utterance from user or assistant.

```json
{
  "type": "transcript",
  "id": "uuid",
  "role": "user",
  "text": "My name is Alex."
}
```

### `pong`

```json
{"type": "pong", "ts": 1713000000000, "server_ts": 1713000000001}
```

### `error`

```json
{"type": "error", "message": "..."}
```

---

## Flow Engine Extensions

### `flow_state`
Sent on every state transition. Contains the current state's UI artifact.

```json
{
  "type": "flow_state",
  "flow_id": "onboarding",
  "state": "collect_info",
  "artifact": {
    "artifact_type": "form",
    "fields": [
      {"id": "first_name", "type": "text", "label": "First name"}
    ]
  },
  "variables": {"first_name": null, "date_of_birth": null},
  "available_actions": ["form_submit"]
}
```

### `flow_variable`
Sent whenever a flow variable is updated.

```json
{
  "type": "flow_variable",
  "flow_id": "onboarding",
  "key": "first_name",
  "value": "Alex"
}
```

### `artifact`
Mid-state artifact updates (e.g. auto-fill a form field by voice).

```json
{
  "type": "artifact",
  "artifact_type": "field_update",
  "field_id": "first_name",
  "value": "Alex"
}
```

### `flow_end`

```json
{
  "type": "flow_end",
  "flow_id": "onboarding",
  "reason": "completed",
  "variables": {"first_name": "Alex", "date_of_birth": "15 March 1995"}
}
```

---

## Client → Server

### `ping`

```json
{"type": "ping", "ts": 1713000000000}
```

### `config`
Optional — declare audio format if different from default.

```json
{"type": "config", "sample_rate": 16000, "channels": 1}
```

### `ui_event`
Sent when the user interacts with a UI artifact.

```json
{
  "type": "ui_event",
  "flow_id": "onboarding",
  "action": "form_submit",
  "data": {"first_name": "Alex", "date_of_birth": "15 March 1995"}
}
```

```json
{
  "type": "ui_event",
  "flow_id": "onboarding",
  "action": "option_select",
  "data": {"selected_id": "part1"}
}
```
