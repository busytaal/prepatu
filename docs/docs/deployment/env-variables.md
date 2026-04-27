---
id: env-variables
title: Environment Variables
sidebar_position: 2
---

# Environment Variables (Deployment)

See [Environment Variable Reference](../backend/env-reference) for the full list.

For production, set these as system environment variables or via your deployment platform's secrets manager — not as a `.env` file.

## Minimum set for production

```dotenv
STT_PROVIDER=deepgram
STT_API_KEY=dg-...
TTS_PROVIDER=deepgram
TTS_API_KEY=dg-...
TTS_VOICE=aura-2-thalia-en
LLM_PROVIDER=openrouter
LLM_API_KEY=sk-or-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini
TURN_PROVIDER=cloudflare
TURN_KEY_ID=...
TURN_API_TOKEN=...
HOST=0.0.0.0
PORT=8000
```
