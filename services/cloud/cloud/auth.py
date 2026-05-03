"""
Auth: signup, login, API key issuance, and request authentication.

- JWT for browser/dashboard sessions.
- Opaque API keys (pk_live_...) for SDK-to-cloud calls.
"""

from __future__ import annotations

import secrets
import time
import uuid

import asyncpg
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

async def signup(body: SignupRequest, db: asyncpg.Connection) -> TokenResponse:
    row = await db.fetchrow("SELECT id FROM users WHERE email = $1", body.email)
    if row:
        raise HTTPException(status_code=409, detail="Email already registered")

    user_id = str(uuid.uuid4())
    now     = time.time()
    hashed  = _hash(body.password)

    async with db.transaction():
        await db.execute(
            "INSERT INTO users (id, email, hashed_pw, created_at) VALUES ($1, $2, $3, $4)",
            user_id, body.email, hashed, now,
        )
        await db.execute(
            "INSERT INTO credits (user_id, balance_usd_cents) VALUES ($1, $2)",
            user_id, settings.signup_credit_grant_usd_cents,
        )
        await db.execute(
            "INSERT INTO provider_keys (user_id) VALUES ($1)",
            user_id,
        )

    logger.info("[auth] New user signed up: {}", body.email)
    return TokenResponse(access_token=_make_jwt(user_id))


async def login(body: LoginRequest, db: asyncpg.Connection) -> TokenResponse:
    row = await db.fetchrow(
        "SELECT id, hashed_pw FROM users WHERE email = $1", body.email
    )
    if not row or not _verify(body.password, row["hashed_pw"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    logger.info("[auth] Login: {}", body.email)
    return TokenResponse(access_token=_make_jwt(row["id"]))


# ── API key management ────────────────────────────────────────────────────────

async def create_api_key(user_id: str, label: str, db: asyncpg.Connection) -> ApiKeyResponse:
    key = "pk_live_" + secrets.token_urlsafe(32)
    await db.execute(
        "INSERT INTO api_keys (key, user_id, label, created_at) VALUES ($1, $2, $3, $4)",
        key, user_id, label, time.time(),
    )
    return ApiKeyResponse(key=key, label=label)


async def resolve_api_key(key: str, db: asyncpg.Connection) -> str:
    """Resolve an SDK API key to a user_id, or raise 401."""
    row = await db.fetchrow(
        "SELECT user_id FROM api_keys WHERE key = $1 AND revoked = 0", key
    )
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")
    return row["user_id"]


# ── FastAPI dependencies ──────────────────────────────────────────────────────

async def current_user_jwt(
    creds: HTTPAuthorizationCredentials | None = Security(bearer),
    db: asyncpg.Connection = Depends(get_db),
) -> str:
    """Dependency: validates JWT, returns user_id."""
    if not creds:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    return _decode_jwt(creds.credentials)


async def current_user_api_key(
    creds: HTTPAuthorizationCredentials | None = Security(bearer),
    db: asyncpg.Connection = Depends(get_db),
) -> str:
    """Dependency: validates SDK API key, returns user_id."""
    if not creds:
        raise HTTPException(status_code=401, detail="Missing API key")
    return await resolve_api_key(creds.credentials, db)


async def current_user_any(
    creds: HTTPAuthorizationCredentials | None = Security(bearer),
    x_prepatu_key: str | None = Header(default=None),
    db: asyncpg.Connection = Depends(get_db),
) -> str:
    """Dependency: accepts either a JWT (dashboard) or SDK API key."""
    if creds:
        token = creds.credentials
        if token.startswith("pk_live_"):
            return await resolve_api_key(token, db)
        return _decode_jwt(token)
    if x_prepatu_key:
        return await resolve_api_key(x_prepatu_key, db)
    raise HTTPException(status_code=401, detail="Authentication required")


async def revoke_api_key(user_id: str, key: str, db: asyncpg.Connection) -> None:
    """Mark an API key as revoked. Raises 404 if it doesn't belong to the user."""
    row = await db.fetchrow(
        "SELECT key FROM api_keys WHERE key = $1 AND user_id = $2", key, user_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Key not found")
    await db.execute("UPDATE api_keys SET revoked = 1 WHERE key = $1", key)


async def list_api_keys(user_id: str, db: asyncpg.Connection) -> list[dict]:
    """Return all API keys for this user (key is partially masked)."""
    rows = await db.fetch(
        "SELECT key, label, created_at, revoked FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
        user_id,
    )
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

