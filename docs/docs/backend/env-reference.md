---
id: env-reference
title: Environment Variables
sidebar_position: 5
---

# Environment Variable Reference

Copy `.env.example` to `.env` at the repo root and fill in the values below.

---

## Required

| Variable | Example | Description |
|---|---|---|
| `STT_API_KEY` | `dg-...` | Deepgram API key (STT) |
| `TTS_API_KEY` | `dg-...` | Deepgram API key (TTS — same key) |
| `LLM_API_KEY` | `sk-or-...` | OpenRouter API key |

---

## STT

| Variable | Default | Description |
|---|---|---|
| `STT_PROVIDER` | `deepgram` | STT provider name |

---

## TTS

| Variable | Default | Description |
|---|---|---|
| `TTS_PROVIDER` | `deepgram` | TTS provider name |
| `TTS_VOICE` | `aura-2-thalia-en` | Deepgram voice ID |

---

## LLM

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `openrouter` | LLM provider name |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible base URL |
| `LLM_MODEL` | `openai/gpt-4o-mini` | Model slug |

---

## TURN / ICE

| Variable | Default | Description |
|---|---|---|
| `TURN_PROVIDER` | `static` | `cloudflare` or `static` |
| `TURN_KEY_ID` | — | Cloudflare TURN key ID |
| `TURN_API_TOKEN` | — | Cloudflare TURN API token |
| `TURN_TTL_SECONDS` | `3600` | Credential TTL |
| `TURN_SERVER` | — | Static TURN URI e.g. `turn:host:3478` |
| `TURN_USERNAME` | — | Static TURN username |
| `TURN_PASSWORD` | — | Static TURN password |

---

## Server

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8000` | Listen port |

---

## System Prompt

| Variable | Default | Description |
|---|---|---|
| `SYSTEM_PROMPT` | — | Inline system prompt string |
| `SYSTEM_PROMPT_FILE` | — | Path to a `.txt` file containing the system prompt |

When `mode=flow`, the YAML `settings.base_system_prompt` takes precedence over these variables.

---

## Getting API Keys

- **Deepgram** — [console.deepgram.com](https://console.deepgram.com/)
- **OpenRouter** — [openrouter.ai/keys](https://openrouter.ai/keys)
- **Cloudflare TURN** — Cloudflare Dashboard → Calls → TURN credentials
