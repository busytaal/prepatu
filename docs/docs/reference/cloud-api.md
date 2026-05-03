---
id: cloud-api
title: Cloud API Reference
sidebar_position: 2
---

# Cloud API Reference

The Prepatu Cloud API lets you manage flows, start voice sessions, and monitor usage without running your own backend.

**Base URL:** `https://api.prepatu.io`

---

## Authentication

Two authentication methods:

| Method | Header | Used for |
|---|---|---|
| **JWT Bearer** | `Authorization: Bearer <token>` | Dashboard, account management |
| **API Key** | `X-Prepatu-Key: pk_live_...` | SDK integration, flow management, sessions |

---

## Auth Endpoints

### `POST /auth/signup`

Create a new account.

```json
// Request
{ "email": "you@example.com", "password": "your-password" }

// Response 200
{ "access_token": "eyJ...", "token_type": "bearer" }
```

### `POST /auth/login`

```json
// Request
{ "email": "you@example.com", "password": "your-password" }

// Response 200
{ "access_token": "eyJ...", "token_type": "bearer" }
```

### `POST /auth/api-keys?label=my-app`

Create an API key. Requires JWT auth.

```json
// Response 201
{ "key": "pk_live_...", "label": "my-app" }
```

### `GET /auth/api-keys`

List all API keys for the account. Requires JWT auth.

### `DELETE /auth/api-keys/{key_id}`

Revoke an API key. Requires JWT auth.

---

## Flow Endpoints

Flows are VFDL YAML documents stored in the cloud. Each account can store multiple named flows.

### `POST /v1/flows`

Upload a new flow.

```json
// Request (API key or JWT)
{
  "name": "My Booking Flow",
  "yaml_content": "id: booking\nversion: \"1.0.0\"\n..."
}

// Response 201
{
  "id": "f-abc123...",
  "name": "My Booking Flow",
  "yaml_content": "...",
  "created_at": 1718000000.0
}
```

The server validates the YAML on upload — invalid YAML returns `422`.

### `GET /v1/flows`

List all flows for the account.

```json
// Response 200
[
  { "id": "f-abc123", "name": "My Booking Flow", "created_at": 1718000000.0 },
  { "id": "f-def456", "name": "10 Questions", "created_at": 1718000100.0 }
]
```

### `GET /v1/flows/{flow_id}`

Get a single flow including its YAML content.

### `DELETE /v1/flows/{flow_id}`

Delete a flow.

### `GET /v1/flows/{flow_id}/json`

Get the flow as parsed JSON (for the visual editor).

### `PUT /v1/flows/{flow_id}/json`

Update a flow from JSON (the server serializes it back to YAML).

---

## Session Endpoints

### `POST /v1/sessions`

Start a voice session. Returns a WebSocket URL to connect to.

```json
// Request (API key required)
{
  "flow_id": "f-abc123",
  "context": { "user_name": "Alex" },
  "metadata": { "source": "web" }
}

// Response 200
{
  "session_token": "st_...",
  "ws_url": "wss://api.prepatu.io/v1/ws/st_...",
  "transport": "websocket",
  "credits_remaining": 197
}
```

| Field | Description |
|---|---|
| `flow_id` | Optional — omit for a generic assistant session |
| `context` | Pre-fill flow variables before the flow starts |
| `metadata` | Forwarded to session hooks (analytics, logging) |

### `GET /v1/sessions`

List recent sessions (last 50).

```json
// Response 200
[
  {
    "token_prefix": "st_abc12",
    "flow_id": "f-abc123",
    "started_at": 1718000000.0,
    "ended_at": 1718000120.0,
    "duration_secs": 120
  }
]
```

---

## Voice WebSocket

### `WS /v1/ws/{session_token}`

Connect to a voice session. The session token authenticates the connection — no additional headers needed.

Once connected, the session follows the [Prepatu Voice Protocol (PVP)](./wire-protocol):
- **Client → Server:** Binary PCM16 audio frames + JSON control messages
- **Server → Client:** Binary PCM16 TTS audio + JSON flow messages

---

## Credits

### `GET /v1/credits/balance`

```json
// Response 200
{
  "balance_usd_cents": 197,
  "rate_per_minute_usd_cents": 3
}
```

New accounts receive $2.00 (200 cents) in free credits. Sessions are charged at $0.03/minute.

---

## Provider Keys

Bring your own STT/TTS/LLM keys to avoid using shared credits.

### `GET /v1/providers`

```json
// Response 200
{
  "stt_provider": "deepgram",
  "stt_api_key": null,
  "tts_provider": "deepgram",
  "tts_api_key": null,
  "llm_provider": "openrouter",
  "llm_api_key": null
}
```

`null` means the account uses Prepatu's shared keys (deducted from credits).

### `PATCH /v1/providers`

Update provider keys (JWT auth required).

```json
// Request
{
  "stt_api_key": "dg-...",
  "llm_api_key": "sk-or-..."
}
```

When you provide your own keys, those providers are not charged against your credits.

---

## Health

### `GET /health`

```json
{ "status": "ok", "service": "prepatu-cloud" }
```
