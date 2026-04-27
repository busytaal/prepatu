"""
Auth: signup, login, API key issuance, and request authentication.

- JWT for browser/dashboard sessions.
- Opaque API keys (pk_live_...) for SDK-to-cloud calls.
"""

from __future__ import annotations

import secrets
import time
import uuid

import aiosqlite
from fastapi import Depends, Header, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from loguru import logger
from passlib.context import CryptContext

from cloud.config import settings
from cloud.models import ApiKeyResponse, LoginRequest, SignupRequest, TokenResponse
from cloud.store import get_db

pwd_ctx  = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer   = HTTPBearer(auto_error=False)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash(password: str) -> str:
    return pwd_ctx.hash(password)


def _verify(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)


def _make_jwt(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": int(time.time()) + settings.jwt_expire_minutes * 60,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _decode_jwt(token: str) -> str:
    """Returns user_id or raises HTTPException."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id: str = payload["sub"]
        return user_id
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


# ── Signup / Login ────────────────────────────────────────────────────────────

async def signup(body: SignupRequest, db: aiosqlite.Connection) -> TokenResponse:
    async with db.execute("SELECT id FROM users WHERE email = ?", (body.email,)) as cur:
        if await cur.fetchone():
            raise HTTPException(status_code=409, detail="Email already registered")

    user_id = str(uuid.uuid4())
    now     = time.time()
    hashed  = _hash(body.password)

    await db.execute(
        "INSERT INTO users (id, email, hashed_pw, created_at) VALUES (?, ?, ?, ?)",
        (user_id, body.email, hashed, now),
    )
    # Grant signup credits
    await db.execute(
        "INSERT INTO credits (user_id, balance_usd_cents) VALUES (?, ?)",
        (user_id, settings.signup_credit_grant_usd_cents),
    )
    # Default (empty) provider key row
    await db.execute(
        "INSERT INTO provider_keys (user_id) VALUES (?)",
        (user_id,),
    )
    await db.commit()
    logger.info(f"[auth] New user signed up: {body.email}")
    return TokenResponse(access_token=_make_jwt(user_id))


async def login(body: LoginRequest, db: aiosqlite.Connection) -> TokenResponse:
    async with db.execute(
        "SELECT id, hashed_pw FROM users WHERE email = ?", (body.email,)
    ) as cur:
        row = await cur.fetchone()

    if not row or not _verify(body.password, row["hashed_pw"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return TokenResponse(access_token=_make_jwt(row["id"]))


# ── API key management ────────────────────────────────────────────────────────

async def create_api_key(user_id: str, label: str, db: aiosqlite.Connection) -> ApiKeyResponse:
    key = "pk_live_" + secrets.token_urlsafe(32)
    await db.execute(
        "INSERT INTO api_keys (key, user_id, label, created_at) VALUES (?, ?, ?, ?)",
        (key, user_id, label, time.time()),
    )
    await db.commit()
    return ApiKeyResponse(key=key, label=label)


async def resolve_api_key(key: str, db: aiosqlite.Connection) -> str:
    """Resolve an SDK API key to a user_id, or raise 401."""
    async with db.execute(
        "SELECT user_id FROM api_keys WHERE key = ? AND revoked = 0", (key,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")
    return row["user_id"]


# ── FastAPI dependencies ──────────────────────────────────────────────────────

async def current_user_jwt(
    creds: HTTPAuthorizationCredentials | None = Security(bearer),
    db: aiosqlite.Connection = Depends(get_db),
) -> str:
    """Dependency: validates JWT, returns user_id."""
    if not creds:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    return _decode_jwt(creds.credentials)


async def current_user_api_key(
    creds: HTTPAuthorizationCredentials | None = Security(bearer),
    db: aiosqlite.Connection = Depends(get_db),
) -> str:
    """Dependency: validates SDK API key (X-Prepatu-Key header), returns user_id."""
    if not creds:
        raise HTTPException(status_code=401, detail="Missing API key")
    # Support both Bearer <key> and raw key via X-Prepatu-Key (handled in middleware)
    return await resolve_api_key(creds.credentials, db)


async def current_user_any(
    creds: HTTPAuthorizationCredentials | None = Security(bearer),
    x_prepatu_key: str | None = Header(default=None),
    db: aiosqlite.Connection = Depends(get_db),
) -> str:
    """Dependency: accepts either a JWT (dashboard) or SDK API key."""
    if creds:
        token = creds.credentials
        # API keys always start with pk_live_
        if token.startswith("pk_live_"):
            return await resolve_api_key(token, db)
        return _decode_jwt(token)
    if x_prepatu_key:
        return await resolve_api_key(x_prepatu_key, db)
    raise HTTPException(status_code=401, detail="Authentication required")


async def revoke_api_key(user_id: str, key: str, db: aiosqlite.Connection) -> None:
    """Mark an API key as revoked. Raises 404 if it doesn't belong to the user."""
    async with db.execute(
        "SELECT key FROM api_keys WHERE key = ? AND user_id = ?", (key, user_id)
    ) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="Key not found")
    await db.execute("UPDATE api_keys SET revoked = 1 WHERE key = ?", (key,))
    await db.commit()


async def list_api_keys(user_id: str, db: aiosqlite.Connection) -> list[dict]:
    """Return all API keys for this user (key is partially masked)."""
    async with db.execute(
        "SELECT key, label, created_at, revoked FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,),
    ) as cur:
        rows = await cur.fetchall()
    return [
        {
            "key_prefix": r["key"][:14] + "...",  # pk_live_XXXXXX...
            "key_id": r["key"],                     # used for revocation
            "label": r["label"],
            "created_at": r["created_at"],
            "revoked": bool(r["revoked"]),
        }
        for r in rows
    ]
