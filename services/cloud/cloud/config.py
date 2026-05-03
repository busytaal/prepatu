from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Security ──────────────────────────────────────────────────────────────
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # ── Database ──────────────────────────────────────────────────────────────
    # PostgreSQL DSN.  Example: postgresql://user:pass@host:5432/dbname
    database_url: str = "postgresql://prepatu:prepatu@localhost:5432/prepatu_cloud"
    db_pool_min: int = 2
    db_pool_max: int = 10

    # ── Credits ───────────────────────────────────────────────────────────────
    default_rate_per_minute_usd_cents: int = 3   # $0.03 / min
    signup_credit_grant_usd_cents: int = 200     # $2.00

    # ── Managed backend ───────────────────────────────────────────────────────
    public_base_url: str = "ws://localhost:4000"

    # ── Logging & Observability ───────────────────────────────────────────────
    # Set LOG_JSON=true in production to emit structured JSON logs.
    log_json: bool = False
    log_level: str = "INFO"
    # Optional: OTLP gRPC endpoint for distributed tracing (e.g. http://otel-collector:4317).
    # Leave empty to disable OpenTelemetry.
    otel_endpoint: str = ""
    # Optional bearer token to protect /metrics.  Leave empty = open.
    metrics_token: str = ""

    # ── Master provider keys (Prepatu-owned, used when user hasn't set their own) ──
    master_deepgram_key: str = ""
    master_openai_key: str = ""
    master_openrouter_key: str = ""
    master_cartesia_key: str = ""
    master_elevenlabs_key: str = ""


settings = Settings()
