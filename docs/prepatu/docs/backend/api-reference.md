---
id: api-reference
title: API Reference
sidebar_position: 4
---

# API Reference

All endpoints are served by the VFDL engine router (`vfdl.api`) and the reference app (`ielts.api`).

---

## Health & Diagnostics

### `GET /health`

```json
{
  "status": "ok",
  "service": "prepatu-ielts-voice-api",
  "transport": "webrtc",
  "stt_provider": "deepgram",
  "stt_configured": true,
  "tts_provider": "deepgram",
  "tts_configured": true,
  "llm_provider": "openrouter",
  "llm_configured": true,
  "turn_provider": "cloudflare",
  "turn_configured": true,
  "system_prompt_configured": true
}
```

### `GET /capabilities`

```json
{
  "stt": {"provider": "deepgram"},
  "tts": {"provider": "deepgram"},
  "llm": {"provider": "openrouter", "model": "openai/gpt-4o-mini"},
  "turn": {"provider": "cloudflare"},
  "transport": {"webrtc": true}
}
```

---

## WebRTC

### `POST /offer`

Initiates a WebRTC session. Body is a standard WebRTC SDP offer.

**Request body** — `application/json`
```json
{
  "sdp": "v=0\r\no=- ...",
  "type": "offer"
}
```

**Query params**

| Param | Default | Description |
|---|---|---|
| `mode` | `assistant` | `assistant` or `flow` |
| `program_id` | `null` | Flow ID to run (required when `mode=flow`) |

**Response**
```json
{
  "pc_id": "abc-123",
  "sdp": "v=0\r\no=- ...",
  "type": "answer"
}
```

### `PATCH /offer/{pc_id}`

Trickle ICE — add remote candidates after the initial offer/answer exchange.

**Request body**
```json
{
  "candidates": [
    {"candidate": "candidate:...", "sdpMid": "0", "sdpMLineIndex": 0}
  ]
}
```

### `GET /ice-servers`

Returns TURN/STUN servers for the client to use in `RTCPeerConnection`.

```json
{
  "iceServers": [
    {"urls": "stun:stun.cloudflare.com:3478"},
    {
      "urls": "turn:turn.cloudflare.com:3478",
      "username": "...",
      "credential": "..."
    }
  ],
  "ttlSeconds": 3600
}
```

---

## WebSocket

### `WS /ws`

Voice session over WebSocket.

**Query params**

| Param | Default | Description |
|---|---|---|
| `mode` | `assistant` | `assistant` or `flow` |
| `program_id` | `null` | Flow ID (required when `mode=flow`) |

**Binary frames** — client→server: raw PCM16, 16 kHz, mono, little-endian (~100 ms chunks / 3,200 bytes)  
**Binary frames** — server→client: raw PCM16, 16 kHz, mono, little-endian (TTS output)

**JSON control messages** — see [Wire Protocol](./wire-protocol).

---

## Test Pages

| Path | Description |
|---|---|
| `GET /test` | Built-in WebRTC browser test page |
| `GET /flow-editor` | Visual YAML flow editor (admin) |
