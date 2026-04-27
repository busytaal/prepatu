from __future__ import annotations

from pydantic import EmailStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Security ──────────────────────────────────────────────────────────────
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # ── Database ──────────────────────────────────────────────────────────────
    db_path: str = "cloud.db"

    # ── Credits ───────────────────────────────────────────────────────────────
    # Default rate charged per minute of conversation, in USD cents.
    # Covers blended STT + TTS + LLM costs + margin.
    default_rate_per_minute_usd_cents: int = 3  # $0.03 / min

    # Sign-up free credit grant in USD cents
    signup_credit_grant_usd_cents: int = 200  # $2.00

    # ── Managed backend ───────────────────────────────────────────────────────
    # The public WebSocket base URL clients use to connect to this service.
    # Used to construct ws_url in SessionStartResponse.
    # In production: set to wss://api.prepatu.io
    public_base_url: str = "ws://localhost:4000"

    # ── Master provider keys (Prepatu-owned, used when user hasn't set their own) ──
    master_deepgram_key: str = ""
    master_openai_key: str = ""
    master_openrouter_key: str = ""
    master_cartesia_key: str = ""
    master_elevenlabs_key: str = ""


settings = Settings()
