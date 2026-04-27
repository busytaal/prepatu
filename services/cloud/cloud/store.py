"""
SQLite store for the cloud service.

Tables:
  users          — accounts
  api_keys       — API keys per account (multiple allowed)
  credits        — current USD-cent balance per account
  provider_keys  — per-account provider configuration
  sessions       — session usage records
"""

from __future__ import annotations

import aiosqlite
from loguru import logger

from cloud.config import settings

DB_PATH = settings.db_path

CREATE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        email       TEXT UNIQUE NOT NULL,
        hashed_pw   TEXT NOT NULL,
        created_at  REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS api_keys (
        key         TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id),
        label       TEXT NOT NULL DEFAULT '',
        created_at  REAL NOT NULL,
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
        started_at      REAL NOT NULL,
        ended_at        REAL,
        duration_secs   INTEGER
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS flows (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id),
        name        TEXT NOT NULL,
        yaml_content TEXT NOT NULL,
        created_at  REAL NOT NULL
    )
    """,
]


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        for stmt in CREATE_STATEMENTS:
            await db.execute(stmt)
        await db.commit()
    logger.info(f"[store] Database ready at {DB_PATH}")


async def get_db() -> aiosqlite.Connection:
    """Dependency-injection helper for FastAPI routes."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db
