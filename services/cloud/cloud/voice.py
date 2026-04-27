"""
Cloud WebSocket voice session handler.

This is where the managed service actually runs voice pipelines.
Per connection it:
  1. Validates the session token
  2. Resolves per-account provider keys (falling back to master keys)
  3. Loads the user's stored flow YAML from DB (or uses a generic default)
  4. Boots a FlowAgent with those keys and that flow
  5. On disconnect, records duration and deducts credits
"""

from __future__ import annotations

import io
import time

import aiosqlite
import yaml as _yaml
from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

from vfdl.agents.flow_engine import FlowConfig, load_flow
from vfdl.agents.flow_agent import FlowAgent
from vfdl.pvp.session import BaseVoiceSession

from cloud.config import settings
from cloud.credits import deduct
from cloud.store import get_db

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


def _build_provider_overrides(row: aiosqlite.Row) -> dict:
    """Build provider_overrides dict from a provider_keys DB row."""
    overrides: dict = {}
    if row["stt_provider"]:  overrides["stt_provider"]  = row["stt_provider"]
    if row["tts_provider"]:  overrides["tts_provider"]  = row["tts_provider"]
    if row["llm_provider"]:  overrides["llm_provider"]  = row["llm_provider"]

    # User-set keys take priority; fall back to master keys from settings.
    overrides["stt_api_key"] = (
        row["stt_api_key"] or _master_key(row["stt_provider"] or "deepgram")
    )
    overrides["tts_api_key"] = (
        row["tts_api_key"] or _master_key(row["tts_provider"] or "cartesia")
    )
    overrides["llm_api_key"] = (
        row["llm_api_key"] or _master_key(row["llm_provider"] or "openrouter")
    )
    return overrides


def _master_key(provider: str) -> str:
    mapping = {
        "deepgram":    settings.master_deepgram_key,
        "openai":      settings.master_openai_key,
        "openrouter":  settings.master_openrouter_key,
        "cartesia":    settings.master_cartesia_key,
        "elevenlabs":  settings.master_elevenlabs_key,
    }
    return mapping.get(provider.lower(), "")


async def handle_voice_ws(ws: WebSocket, session_token: str, db: aiosqlite.Connection) -> None:
    """
    Entry point called by the /v1/ws/{session_token} route.

    Validates the token, resolves keys + flow, then hands off to FlowAgent.
    Records duration and deducts credits on disconnect.
    """
    # ── 1. Validate session token ─────────────────────────────────────────────
    async with db.execute(
        "SELECT user_id, flow_id, started_at FROM sessions WHERE token = ? AND ended_at IS NULL",
        (session_token,),
    ) as cur:
        session_row = await cur.fetchone()

    if not session_row:
        await ws.accept()
        import json
        await ws.send_text(json.dumps({"type": "error", "message": "Invalid or expired session token."}))
        await ws.close(code=4401)
        return

    user_id    = session_row["user_id"]
    flow_id    = session_row["flow_id"]
    started_at = time.time()

    # ── 2. Resolve provider keys ──────────────────────────────────────────────
    async with db.execute(
        "SELECT * FROM provider_keys WHERE user_id = ?",
        (user_id,),
    ) as cur:
        keys_row = await cur.fetchone()

    provider_overrides = _build_provider_overrides(keys_row) if keys_row else {}

    # ── 3. Load flow (from DB if flow_id set, else generic default) ───────────
    flow_config: FlowConfig | None = None
    if flow_id:
        async with db.execute(
            "SELECT yaml_content FROM flows WHERE id = ? AND user_id = ?",
            (flow_id, user_id),
        ) as cur:
            flow_row = await cur.fetchone()
        if flow_row:
            try:
                flow_config = _parse_flow_yaml(flow_row["yaml_content"])
            except Exception as exc:
                logger.error(f"[voice] Failed to parse flow {flow_id}: {exc}")
                # Fall through to default

    if flow_config is None:
        flow_config = _parse_flow_yaml(_DEFAULT_FLOW_YAML)

    # ── 4. Boot the flow agent ────────────────────────────────────────────────
    agent = FlowAgent(
        flow_config=flow_config,
        provider_overrides=provider_overrides,
    )

    logger.info(f"[voice] session={session_token[:8]}… user={user_id[:8]}… flow={flow_config.id}")

    try:
        await agent.run(ws, metadata={"session_token": session_token, "user_id": user_id})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error(f"[voice] session={session_token[:8]}… unexpected error: {exc}")
    finally:
        # ── 5. Record duration and deduct credits ─────────────────────────────
        duration_secs = int(time.time() - started_at)
        await db.execute(
            "UPDATE sessions SET ended_at = ?, duration_secs = ? WHERE token = ?",
            (time.time(), duration_secs, session_token),
        )
        await db.commit()
        try:
            await deduct(user_id, duration_secs, db)
        except Exception as exc:
            logger.warning(f"[voice] Credit deduction failed for {user_id}: {exc}")
        logger.info(f"[voice] session={session_token[:8]}… ended after {duration_secs}s")
