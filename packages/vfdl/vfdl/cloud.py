"""
Prepatu Cloud integration for vfdl.

When PREPATU_API_KEY is set, the engine:
  1. Resolves provider keys from the cloud API (unless overridden locally).
  2. Reports session usage (duration in seconds) at session end for credit deduction.

Self-hosted deployments that set their own STT/TTS/LLM keys in .env are
unaffected — cloud integration is entirely opt-in via PREPATU_API_KEY.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from os import getenv
from typing import Any

import httpx
from loguru import logger

CLOUD_API_URL = getenv("PREPATU_CLOUD_API_URL", "https://api.prepatu.io")


@dataclass
class CloudConfig:
    """Cloud integration settings, populated from env vars or passed directly."""

    api_key: str | None = field(default_factory=lambda: getenv("PREPATU_API_KEY"))
    cloud_api_url: str = field(default_factory=lambda: CLOUD_API_URL)

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)


@dataclass
class SessionUsage:
    session_token: str
    start_time: float = field(default_factory=time.time)

    def elapsed_seconds(self) -> int:
        return int(time.time() - self.start_time)


async def resolve_provider_keys(config: CloudConfig) -> dict[str, str]:
    """
    Fetch per-account provider keys from the cloud API.
    Returns a dict of env-var-style keys, e.g. {"DEEPGRAM_API_KEY": "...", ...}.
    Raises on network error — callers should fall back to local env if this fails.
    """
    if not config.enabled:
        return {}

    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(
            f"{config.cloud_api_url}/v1/providers",
            headers={"X-Prepatu-Key": config.api_key},  # type: ignore[arg-type]
        )
        response.raise_for_status()
        data: dict[str, Any] = response.json()

    # Map cloud provider key names → env var names the vfdl providers expect
    mapping: dict[str, str] = {}
    if stt_key := data.get("stt_api_key"):
        mapping[_provider_env_var(data.get("stt_provider", ""), "STT")] = stt_key
    if tts_key := data.get("tts_api_key"):
        mapping[_provider_env_var(data.get("tts_provider", ""), "TTS")] = tts_key
    if llm_key := data.get("llm_api_key"):
        mapping[_provider_env_var(data.get("llm_provider", ""), "LLM")] = llm_key

    return mapping


async def report_usage(config: CloudConfig, session_token: str, duration_seconds: int) -> None:
    """
    Report session end to the cloud API so credits can be deducted.
    Non-fatal — logs a warning on failure rather than raising.
    """
    if not config.enabled:
        return

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                f"{config.cloud_api_url}/v1/sessions/end",
                json={"session_token": session_token, "duration_seconds": duration_seconds},
                headers={"X-Prepatu-Key": config.api_key},  # type: ignore[arg-type]
            )
            response.raise_for_status()
    except Exception as exc:
        logger.warning(f"[cloud] Failed to report usage for session {session_token}: {exc}")


def _provider_env_var(provider: str, role: str) -> str:
    """Map a provider name + role to the expected env var name."""
    provider = provider.lower()
    mapping = {
        ("deepgram", "STT"): "DEEPGRAM_API_KEY",
        ("deepgram", "TTS"): "DEEPGRAM_API_KEY",
        ("openai",   "STT"): "OPENAI_API_KEY",
        ("openai",   "TTS"): "OPENAI_API_KEY",
        ("openai",   "LLM"): "OPENAI_API_KEY",
        ("openrouter","LLM"): "OPENROUTER_API_KEY",
        ("cartesia", "TTS"): "CARTESIA_API_KEY",
        ("elevenlabs","TTS"): "ELEVENLABS_API_KEY",
    }
    return mapping.get((provider, role), f"{provider.upper()}_API_KEY")
