"""
Session lifecycle: start (validate key + credits, reserve token).

Session end and credit deduction are handled server-side in cloud/voice.py
when the WebSocket disconnects — not via a client-reported endpoint.
"""

from __future__ import annotations

import secrets
import time

import aiosqlite

from cloud.config import settings
from cloud.credits import check_has_credits, get_balance
from cloud.models import SessionStartRequest, SessionStartResponse


async def start_session(
    user_id: str,
    body: SessionStartRequest,
    db: aiosqlite.Connection,
) -> SessionStartResponse:
    await check_has_credits(user_id, db)

    token      = secrets.token_urlsafe(32)
    started_at = time.time()

    await db.execute(
        "INSERT INTO sessions (token, user_id, flow_id, started_at) VALUES (?, ?, ?, ?)",
        (token, user_id, body.flow_id, started_at),
    )
    await db.commit()

    balance = await get_balance(user_id, db)
    ws_url  = f"{settings.public_base_url}/v1/ws/{token}"

    return SessionStartResponse(
        session_token=token,
        ws_url=ws_url,
        credits_remaining=balance.balance_usd_cents,
    )
