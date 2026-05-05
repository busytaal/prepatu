"""
PostgreSQL store for the cloud service — backed by asyncpg connection pool.

Tables:
  users               — accounts (hashed_pw nullable for social-only accounts)
  api_keys            — API keys per account (multiple allowed)
  credits             — current USD-cent balance per account
  provider_keys       — per-account provider configuration
  sessions            — session usage records
  flows               — per-account VFDL flow YAML documents
  email_verifications — one-time tokens for email verification
  otp_codes           — short-lived 6-digit OTP codes for passwordless login
  oauth_accounts      — links social provider identities to users
  credit_purchases    — idempotent record of payment webhook credits
"""

from __future__ import annotations

from typing import AsyncGenerator

import asyncpg
from loguru import logger

from cloud.config import settings

_pool: asyncpg.Pool | None = None

_CREATE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        email       TEXT UNIQUE NOT NULL,
        hashed_pw   TEXT NOT NULL,
        created_at  DOUBLE PRECISION NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS api_keys (
        key         TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id),
        label       TEXT NOT NULL DEFAULT '',
        created_at  DOUBLE PRECISION NOT NULL,
        revoked     INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS credits (
        user_id             TEXT PRIMARY KEY REFERENCES users(id),
        balance_usd_cents   INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS provider_keys (
        user_id         TEXT PRIMARY KEY REFERENCES users(id),
        stt_provider    TEXT NOT NULL DEFAULT 'deepgram',
        stt_api_key     TEXT,
        tts_provider    TEXT NOT NULL DEFAULT 'deepgram',
        tts_api_key     TEXT,
        llm_provider    TEXT NOT NULL DEFAULT 'openrouter',
        llm_api_key     TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token           TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL REFERENCES users(id),
        flow_id         TEXT,
        started_at      DOUBLE PRECISION NOT NULL,
        ended_at        DOUBLE PRECISION,
        duration_secs   INTEGER
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS flows (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id),
        name         TEXT NOT NULL,
        yaml_content TEXT NOT NULL,
        created_at   DOUBLE PRECISION NOT NULL
    )
    """,
    # ── Auth extensions ──────────────────────────────────────────────────────
    """
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false
    """,
    # Make hashed_pw nullable so social-only accounts can exist
    """
    ALTER TABLE users ALTER COLUMN hashed_pw DROP NOT NULL
    """,
    """
    CREATE TABLE IF NOT EXISTS email_verifications (
        token       TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at  DOUBLE PRECISION NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS otp_codes (
        id          TEXT PRIMARY KEY,
        email       TEXT NOT NULL,
        code_hash   TEXT NOT NULL,
        expires_at  DOUBLE PRECISION NOT NULL,
        used        BOOLEAN NOT NULL DEFAULT false
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS oauth_accounts (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider         TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        UNIQUE (provider, provider_user_id)
    )
    """,
    # ── Payments ─────────────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS credit_purchases (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL REFERENCES users(id),
        provider        TEXT NOT NULL,
        transaction_id  TEXT UNIQUE NOT NULL,
        amount_usd_cents  INT NOT NULL,
        credits_granted   INT NOT NULL,
        created_at      DOUBLE PRECISION NOT NULL
    )
    """,
]


async def init_db() -> None:
    """Create the connection pool and ensure all tables exist."""
    global _pool
    _pool = await asyncpg.create_pool(
        settings.database_url,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
    )
    async with _pool.acquire() as conn:
        for stmt in _CREATE_STATEMENTS:
            await conn.execute(stmt)
    logger.info("[store] PostgreSQL pool ready (min={} max={})", settings.db_pool_min, settings.db_pool_max)


async def close_db() -> None:
    """Gracefully close the connection pool on shutdown."""
    if _pool:
        await _pool.close()


async def get_db() -> AsyncGenerator[asyncpg.Connection, None]:
    """FastAPI dependency — yields a connection from the pool."""
    assert _pool is not None, "Database pool not initialised — was init_db() called?"
    async with _pool.acquire() as conn:
        yield conn
