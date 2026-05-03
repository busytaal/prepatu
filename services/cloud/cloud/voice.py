"""
Cloud WebSocket voice session handler.

Per connection it:
  1. Validates the session token
  2. Resolves per-account provider keys (falling back to master keys)
  3. Loads the user's stored flow YAML from DB (or uses a generic default)
  4. Boots a FlowAgent with those keys and that flow
  5. On disconnect, records duration and deducts credits
"""

from __future__ import annotations

import json
import time

import asyncpg
import yaml as _yaml
from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

from vfdl.agents.flow_engine import FlowConfig
from vfdl.agents.flow_agent import FlowAgent

from cloud.config import settings
from cloud.credits import deduct
from cloud.metrics import VOICE_SESSIONS_ACTIVE, VOICE_SESSIONS_TOTAL, VOICE_SESSION_DURATION, CREDITS_DEDUCTED

# ── Default fallback flow (used when no flow_id is supplied) ──────────────────
_DEFAULT_FLOW_YAML = """
id: generic_assistant
version: "1.0.0"
initial_state: converse
description: "Generic open-ended conversational assistant"

settings:
  base_system_prompt: |
    You are a friendly, helpful voice assistant.
    Keep responses concise — 1 to 3 sentences.
    Speak naturally; the user is talking to you in real time.

states:
  converse:
    agent:
      prompt: ""
      tools: []
    transitions: {}
""".strip()


def _parse_flow_yaml(yaml_content: str) -> FlowConfig:
    data = _yaml.safe_load(yaml_content)
    return FlowConfig(**data)


def _build_provider_overrides(row: asyncpg.Record) -> dict:
    """Build provider_overrides dict from a provider_keys DB row."""
    overrides: dict = {}
    if row["stt_provider"]:
        overrides["stt_provider"] = row["stt_provider"]
    if row["tts_provider"]:
        overrides["tts_provider"] = row["tts_provider"]
    if row["llm_provider"]:
        overrides["llm_provider"] = row["llm_provider"]

    overrides["stt_api_key"] = row["stt_api_key"] or _master_key(row["stt_provider"] or "deepgram")
    overrides["tts_api_key"] = row["tts_api_key"] or _master_key(row["tts_provider"] or "cartesia")
    overrides["llm_api_key"] = row["llm_api_key"] or _master_key(row["llm_provider"] or "openrouter")
    return overrides


def _master_key(provider: str) -> str:
    mapping = {
        "deepgram":   settings.master_deepgram_key,
        "openai":     settings.master_openai_key,
        "openrouter": settings.master_openrouter_key,
        "cartesia":   settings.master_cartesia_key,
        "elevenlabs": settings.master_elevenlabs_key,
    }
    return mapping.get(provider.lower(), "")


async def handle_voice_ws(ws: WebSocket, session_token: str, db: asyncpg.Connection) -> None:
    """
    Entry point called by the /v1/ws/{session_token} route.

    Validates the token, resolves keys + flow, then hands off to FlowAgent.
    Records duration and deducts credits on disconnect.
    """
    # ── 1. Validate session token ─────────────────────────────────────────────
    session_row = await db.fetchrow(
        "SELECT user_id, flow_id, started_at FROM sessions WHERE token = $1 AND ended_at IS NULL",
        session_token,
    )
    if not session_row:
        await ws.accept()
        await ws.send_text(json.dumps({"type": "error", "message": "Invalid or expired session token."}))
        await ws.close(code=4401)
        return

    user_id    = session_row["user_id"]
    flow_id    = session_row["flow_id"]
    started_at = time.time()

    # ── 2. Resolve provider keys ──────────────────────────────────────────────
    keys_row = await db.fetchrow(
        "SELECT * FROM provider_keys WHERE user_id = $1", user_id
    )
    provider_overrides = _build_provider_overrides(keys_row) if keys_row else {}

    # ── 3. Load flow (from DB if flow_id set, else generic default) ───────────
    flow_config: FlowConfig | None = None
    if flow_id:
        flow_row = await db.fetchrow(
            "SELECT yaml_content FROM flows WHERE id = $1 AND user_id = $2",
            flow_id, user_id,
        )
        if flow_row:
            try:
                flow_config = _parse_flow_yaml(flow_row["yaml_content"])
            except Exception as exc:
                logger.error("[voice] Failed to parse flow {}: {}", flow_id, exc)

    if flow_config is None:
        flow_config = _parse_flow_yaml(_DEFAULT_FLOW_YAML)

    # ── 4. Boot the flow agent ────────────────────────────────────────────────
    agent = FlowAgent(flow_config=flow_config, provider_overrides=provider_overrides)

    VOICE_SESSIONS_ACTIVE.inc()
    VOICE_SESSIONS_TOTAL.inc()
    logger.info("[voice] start session={} user={} flow={}", session_token[:8], user_id[:8], flow_config.id)

    try:
        await agent.run(ws, metadata={"session_token": session_token, "user_id": user_id})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("[voice] session={} unexpected error: {}", session_token[:8], exc)
    finally:
        # ── 5. Record duration and deduct credits ─────────────────────────────
        duration_secs = int(time.time() - started_at)
        VOICE_SESSIONS_ACTIVE.dec()
        VOICE_SESSION_DURATION.observe(duration_secs)

        await db.execute(
            "UPDATE sessions SET ended_at = $1, duration_secs = $2 WHERE token = $3",
            time.time(), duration_secs, session_token,
        )
        try:
            new_balance = await deduct(user_id, duration_secs, db)
            cost = duration_secs  # approximate; deduct returns actual
            CREDITS_DEDUCTED.inc(cost)
            logger.info(
                "[voice] end session={} duration={}s balance_cents={}",
                session_token[:8], duration_secs, new_balance,
            )
        except Exception as exc:
            logger.warning("[voice] credit deduction failed user={}: {}", user_id, exc)

