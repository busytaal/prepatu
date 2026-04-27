---
id: providers
title: Providers
sidebar_position: 5
---

# Providers

VFDL uses a pluggable provider system for STT, TTS, LLM, and TURN. Select providers via environment variables — no code changes required.

---

## STT (Speech-to-Text)

| Provider | `STT_PROVIDER` value | Key env var |
|---|---|---|
| Deepgram | `deepgram` (default) | `STT_API_KEY` |

```dotenv
STT_PROVIDER=deepgram
STT_API_KEY=dg-...
```

---

## TTS (Text-to-Speech)

| Provider | `TTS_PROVIDER` value | Key env vars |
|---|---|---|
| Deepgram Aura 2 | `deepgram` (default) | `TTS_API_KEY`, `TTS_VOICE` |
| Cartesia | `cartesia` | `TTS_API_KEY`, `TTS_VOICE` |

```dotenv
TTS_PROVIDER=deepgram
TTS_API_KEY=dg-...
TTS_VOICE=aura-2-thalia-en   # any Deepgram voice ID
```

---

## LLM

| Provider | `LLM_PROVIDER` value | Key env vars |
|---|---|---|
| OpenRouter | `openrouter` (default) | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |

```dotenv
LLM_PROVIDER=openrouter
LLM_API_KEY=sk-or-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini
```

Any [OpenRouter model slug](https://openrouter.ai/models) works as `LLM_MODEL`.

---

## TURN (ICE / WebRTC)

TURN servers are needed for WebRTC through symmetric NAT and corporate firewalls.

| Provider | `TURN_PROVIDER` value | Key env vars |
|---|---|---|
| Cloudflare | `cloudflare` | `TURN_KEY_ID`, `TURN_API_TOKEN`, `TURN_TTL_SECONDS` |
| Static | `static` (default) | `TURN_SERVER`, `TURN_USERNAME`, `TURN_PASSWORD` |

```dotenv
# Cloudflare (dynamic credentials, recommended for production)
TURN_PROVIDER=cloudflare
TURN_KEY_ID=...
TURN_API_TOKEN=...
TURN_TTL_SECONDS=3600

# Static (manual server, useful for self-hosted coturn)
TURN_PROVIDER=static
TURN_SERVER=turn:my-server.example.com:3478
TURN_USERNAME=user
TURN_PASSWORD=pass
```

---

## Adding a Custom Provider

Create a new module in `packages/vfdl/vfdl/providers/<type>/myprovider.py` that returns a Pipecat-compatible processor, then register it in the provider factory at `packages/vfdl/vfdl/providers/<type>/__init__.py`.
