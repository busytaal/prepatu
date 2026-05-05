"""
Payments: Paddle + Freemius webhook handlers, credit package listing.

Credit packages are hard-coded here. Webhook validation uses HMAC-SHA256.
Credits are stored as USD cents in the `credits` table.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid

import asyncpg
from fastapi import HTTPException, Request
from loguru import logger

from cloud.config import settings
from cloud.models import CreditPackage

# ── Credit packages ───────────────────────────────────────────────────────────

CREDIT_PACKAGES: list[CreditPackage] = [
    CreditPackage(
        id="starter",
        name="Starter",
        price_usd=5.00,
        credits=500,
        description="500 credits — great for testing",
    ),
    CreditPackage(
        id="standard",
        name="Standard",
        price_usd=15.00,
        credits=1600,
        description="1 600 credits — most popular",
    ),
    CreditPackage(
        id="pro",
        name="Pro",
        price_usd=40.00,
        credits=5000,
        description="5 000 credits — for power users",
    ),
]

_PACKAGE_MAP = {p.id: p for p in CREDIT_PACKAGES}


def _freemius_plan_map() -> dict[str, CreditPackage]:
    """Map Freemius numeric plan IDs (from .env) -> CreditPackage, built at call time."""
    m: dict[str, CreditPackage] = {}
    for env_key, pkg_id in [
        (settings.freemius_plan_starter,  "starter"),
        (settings.freemius_plan_standard, "standard"),
        (settings.freemius_plan_pro,      "pro"),
    ]:
        if env_key:  # only add if configured
            m[env_key] = _PACKAGE_MAP[pkg_id]
    return m


def list_packages() -> list[CreditPackage]:
    return CREDIT_PACKAGES


# ── Credit helpers ────────────────────────────────────────────────────────────

async def _add_credits(
    db: asyncpg.Connection,
    *,
    user_id: str,
    provider: str,
    transaction_id: str,
    amount_usd_cents: int,
    credits_granted: int,
) -> None:
    """Record a purchase and add credits atomically."""
    purchase_id = str(uuid.uuid4())
    async with db.transaction():
        # Idempotency check — ignore duplicate transaction IDs
        existing = await db.fetchrow(
            "SELECT id FROM credit_purchases WHERE provider = $1 AND transaction_id = $2",
            provider, transaction_id,
        )
        if existing:
            logger.info("[payments] Duplicate transaction {} from {} — ignored", transaction_id, provider)
            return

        await db.execute(
            """
            INSERT INTO credit_purchases
                (id, user_id, provider, transaction_id, amount_usd_cents, credits_granted, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            purchase_id, user_id, provider, transaction_id,
            amount_usd_cents, credits_granted, time.time(),
        )
        await db.execute(
            "UPDATE credits SET balance_usd_cents = balance_usd_cents + $1 WHERE user_id = $2",
            credits_granted, user_id,
        )

    logger.info(
        "[payments] +{} credits for user {} via {} (tx {})",
        credits_granted, user_id, provider, transaction_id,
    )


# ── Paddle webhook ────────────────────────────────────────────────────────────
# Paddle sends HMAC-SHA256 signature in the `Paddle-Signature` header.
# Header format:  ts=<unix_ts>;h1=<hex_digest>
# Signed content: ts + ":" + raw_body

async def paddle_webhook(request: Request, db: asyncpg.Connection) -> dict:
    if not settings.paddle_webhook_secret:
        raise HTTPException(status_code=503, detail="Paddle not configured")

    raw_body = await request.body()
    sig_header = request.headers.get("Paddle-Signature", "")

    ts = ""
    h1 = ""
    for part in sig_header.split(";"):
        if part.startswith("ts="):
            ts = part[3:]
        elif part.startswith("h1="):
            h1 = part[3:]

    if not ts or not h1:
        raise HTTPException(status_code=400, detail="Missing Paddle-Signature")

    # Replay-attack guard: reject if timestamp is older than 5 minutes
    try:
        ts_int = int(ts)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid timestamp in Paddle-Signature")
    if abs(time.time() - ts_int) > 300:
        raise HTTPException(status_code=400, detail="Paddle-Signature timestamp too old")

    signed = (ts + ":" + raw_body.decode()).encode()
    expected = hmac.new(
        settings.paddle_webhook_secret.encode(),
        signed,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, h1):
        raise HTTPException(status_code=401, detail="Invalid Paddle signature")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type: str = payload.get("event_type", "")
    logger.info("[payments/paddle] Event: {}", event_type)

    if event_type == "transaction.completed":
        data       = payload.get("data", {})
        tx_id      = data.get("id", "")
        custom     = data.get("custom_data", {}) or {}
        user_id    = custom.get("user_id") or data.get("customer", {}).get("custom_data", {}).get("user_id", "")
        package_id = custom.get("package_id", "")

        if not user_id:
            logger.warning("[payments/paddle] transaction.completed with no user_id — skipped")
            return {"received": True}

        pkg = _PACKAGE_MAP.get(package_id)
        credits = pkg.credits if pkg else _cents_from_paddle(data)
        amount  = _amount_from_paddle(data)

        await _add_credits(
            db,
            user_id=user_id,
            provider="paddle",
            transaction_id=tx_id,
            amount_usd_cents=amount,
            credits_granted=credits,
        )

    return {"received": True}


def _cents_from_paddle(data: dict) -> int:
    """Fallback: derive credits from transaction amount (1 credit per cent)."""
    try:
        items = data.get("details", {}).get("totals", {})
        return int(items.get("total", "0"))
    except Exception:
        return 0


def _amount_from_paddle(data: dict) -> int:
    try:
        return int(data.get("details", {}).get("totals", {}).get("total", "0"))
    except Exception:
        return 0


# ── Freemius webhook ──────────────────────────────────────────────────────────
# Freemius signs webhooks with HMAC-SHA256 using the secret key.
# The signature is in the `X-Freemius-Signature` header as a base64 string.

async def freemius_webhook(request: Request, db: asyncpg.Connection) -> dict:
    if not settings.freemius_secret_key:
        raise HTTPException(status_code=503, detail="Freemius not configured")

    raw_body = await request.body()
    sig_header = request.headers.get("X-Freemius-Signature", "")

    if settings.freemius_sandbox:
        logger.warning("[payments/freemius] SANDBOX MODE — skipping signature validation")
    else:
        if not sig_header:
            raise HTTPException(status_code=400, detail="Missing X-Freemius-Signature")

    expected_bytes = hmac.new(
        settings.freemius_secret_key.encode(),
        raw_body,
        hashlib.sha256,
    ).digest()
    expected_b64 = base64.b64encode(expected_bytes).decode()

    if not settings.freemius_sandbox and not hmac.compare_digest(expected_b64, sig_header):
        raise HTTPException(status_code=401, detail="Invalid Freemius signature")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type: str = payload.get("type", "")
    logger.info("[payments/freemius] Event: {}", event_type)

    # Freemius fires `purchase.completed` or `subscription.activated`
    if event_type in ("purchase.completed", "subscription.activated"):
        purchase = payload.get("objects", {}).get("purchase", {})
        user_obj = payload.get("objects", {}).get("user", {})

        tx_id      = str(purchase.get("id", ""))
        email      = user_obj.get("email", "")
        package_id = str(purchase.get("plan_id", ""))

        if not email:
            logger.warning("[payments/freemius] No email in payload — skipped")
            return {"received": True}

        user_row = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
        if not user_row:
            logger.warning("[payments/freemius] Unknown user {} — skipped", email)
            return {"received": True}

        plan_map = _freemius_plan_map()
        pkg      = plan_map.get(package_id)
        credits  = pkg.credits if pkg else int(purchase.get("gross", 0))
        amount   = int(purchase.get("gross", 0))

        await _add_credits(
            db,
            user_id=user_row["id"],
            provider="freemius",
            transaction_id=tx_id,
            amount_usd_cents=amount,
            credits_granted=credits,
        )

    return {"received": True}
