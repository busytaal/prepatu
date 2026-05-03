"""
Credit ledger: balance checks and per-session deductions.

Credits are stored as integer USD cents (e.g. 200 = $2.00).
Deductions happen at session end based on actual duration × rate.
"""

from __future__ import annotations

import math

import asyncpg
from fastapi import HTTPException

from cloud.config import settings
from cloud.models import CreditBalance


async def get_balance(user_id: str, db: asyncpg.Connection) -> CreditBalance:
    row = await db.fetchrow(
        "SELECT balance_usd_cents FROM credits WHERE user_id = $1", user_id
    )
    balance = row["balance_usd_cents"] if row else 0
    return CreditBalance(
        balance_usd_cents=balance,
        rate_per_minute_usd_cents=settings.default_rate_per_minute_usd_cents,
    )


async def check_has_credits(user_id: str, db: asyncpg.Connection) -> None:
    """Raises 402 if the account has no remaining credits."""
    balance = await get_balance(user_id, db)
    if balance.balance_usd_cents <= 0:
        raise HTTPException(status_code=402, detail="Insufficient credits. Top up at prepatu.io/credits")


async def deduct(user_id: str, duration_seconds: int, db: asyncpg.Connection) -> int:
    """
    Deduct credits for a completed session.
    Returns the new balance in USD cents.
    Floors to zero — never goes negative.
    """
    minutes = math.ceil(duration_seconds / 60)
    cost    = minutes * settings.default_rate_per_minute_usd_cents

    await db.execute(
        "UPDATE credits SET balance_usd_cents = GREATEST(0, balance_usd_cents - $1) WHERE user_id = $2",
        cost, user_id,
    )

    row = await db.fetchrow(
        "SELECT balance_usd_cents FROM credits WHERE user_id = $1", user_id
    )
    return row["balance_usd_cents"] if row else 0

