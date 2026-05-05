from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Security ──────────────────────────────────────────────────────────────
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = "postgresql://prepatu:prepatu@localhost:5432/prepatu_cloud"
    db_pool_min: int = 2
    db_pool_max: int = 10

    # ── Credits ───────────────────────────────────────────────────────────────
    default_rate_per_minute_usd_cents: int = 3   # $0.03 / min
    signup_credit_grant_usd_cents: int = 200     # $2.00

    # ── Managed backend ───────────────────────────────────────────────────────
    public_base_url: str = "ws://localhost:4000"
    frontend_url: str = "https://prepatu.com"

    # ── Email (Zoho SMTP) ─────────────────────────────────────────────────────
    smtp_host: str = "smtp.zoho.com"
    smtp_port: int = 587
    smtp_user: str = ""           # e.g. noreply@busytaal.com
    smtp_password: str = ""
    email_from: str = "Prepatu <noreply@busytaal.com>"
    email_require_verification: bool = True

    # ── OAuth — Google ────────────────────────────────────────────────────────
    google_client_id: str = ""
    google_client_secret: str = ""

    # ── OAuth — GitHub ────────────────────────────────────────────────────────
    github_client_id: str = ""
    github_client_secret: str = ""

    # ── Payments — Paddle ─────────────────────────────────────────────────────
    paddle_webhook_secret: str = ""
    paddle_environment: str = "sandbox"    # "sandbox" | "production"

    # ── Payments — Freemius ───────────────────────────────────────────────────
    freemius_secret_key: str = ""
    freemius_public_key: str = ""
    freemius_plugin_id: str = ""          # "Product ID" from Freemius dashboard (their JS SDK calls it plugin_id)
    freemius_plan_starter: str = ""       # numeric plan ID for Starter ($5)
    freemius_plan_standard: str = ""      # numeric plan ID for Standard ($15)
    freemius_plan_pro: str = ""           # numeric plan ID for Pro ($40)
    freemius_sandbox: bool = False         # set True to enable test mode (skips webhook sig + credits sandbox purchases)

    # ── Logging & Observability ───────────────────────────────────────────────
    log_json: bool = False
    log_level: str = "INFO"
    otel_endpoint: str = ""
    metrics_token: str = ""

    # ── Master provider keys ──────────────────────────────────────────────────
    master_deepgram_key: str = ""
    master_openai_key: str = ""
    master_openrouter_key: str = ""
    master_cartesia_key: str = ""
    master_elevenlabs_key: str = ""


settings = Settings()
