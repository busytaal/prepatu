"""
Per-account provider key management.

Priority at session time:
  1. User's own keys (stored here) — charged at cost, no margin.
  2. Prepatu master keys (settings.master_*) — charged at default rate.
"""

from __future__ import annotations

import aiosqlite

from cloud.config import settings
from cloud.models import ProviderKeys, ProviderKeysUpdate


async def get_provider_keys(user_id: str, db: aiosqlite.Connection) -> ProviderKeys:
    async with db.execute(
        "SELECT * FROM provider_keys WHERE user_id = ?", (user_id,)
    ) as cur:
        row = await cur.fetchone()

    if not row:
        return ProviderKeys()

    # If the user hasn't set a key, fall back to Prepatu's master key.
    return ProviderKeys(
        stt_provider=row["stt_provider"],
        stt_api_key=row["stt_api_key"] or _master_key(row["stt_provider"]) or None,
        tts_provider=row["tts_provider"],
        tts_api_key=row["tts_api_key"] or _master_key(row["tts_provider"]) or None,
        llm_provider=row["llm_provider"],
        llm_api_key=row["llm_api_key"] or _master_key(row["llm_provider"]) or None,
    )


async def update_provider_keys(
    user_id: str, update: ProviderKeysUpdate, db: aiosqlite.Connection
) -> ProviderKeys:
    # Build SET clause from non-None fields only
    fields = {k: v for k, v in update.model_dump().items() if v is not None}
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        await db.execute(
            f"UPDATE provider_keys SET {set_clause} WHERE user_id = ?",
            (*fields.values(), user_id),
        )
        await db.commit()

    return await get_provider_keys(user_id, db)


def _master_key(provider: str) -> str:
    mapping = {
        "deepgram":   settings.master_deepgram_key,
        "openai":     settings.master_openai_key,
        "openrouter": settings.master_openrouter_key,
        "cartesia":   settings.master_cartesia_key,
        "elevenlabs": settings.master_elevenlabs_key,
    }
    return mapping.get(provider.lower(), "")
