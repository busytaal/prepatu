"""
Auth: signup, login, email verification, OTP, API key management, request authentication.

- JWT for browser/dashboard sessions.
- Opaque API keys (pk_live_...) for SDK-to-cloud calls.
- Email verification required before API key issuance (configurable).
- OTP (6-digit code) for passwordless login.
"""

from __future__ import annotations

import hashlib
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
from cloud.email import send_otp_email, send_verification_email
from cloud.models import ApiKeyResponse, LoginRequest, OtpRequestBody, OtpVerifyBody, SignupRequest, TokenResponse
from cloud.store import get_db

pwd_ctx  = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer   = HTTPBearer(auto_error=False)

# OTP rate-limit: max requests per email per hour (in-memory)
_otp_rate: dict[str, list[float]] = {}
_OTP_MAX_PER_HOUR = 5
_OTP_TTL_MINUTES  = 10


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


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


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
            "INSERT INTO users (id, email, hashed_pw, email_verified, created_at) VALUES ($1, $2, $3, false, $4)",
            user_id, body.email, hashed, now,
        )
        await db.execute(
            "INSERT INTO credits (user_id, balance_usd_cents) VALUES ($1, $2)",
            user_id, settings.signup_credit_grant_usd_cents,
        )
        await db.execute("INSERT INTO provider_keys (user_id) VALUES ($1)", user_id)

    # Send verification email (non-blocking failure)
    if settings.email_require_verification:
        try:
            token = secrets.token_urlsafe(32)
            await db.execute(
                "INSERT INTO email_verifications (token, user_id, expires_at) VALUES ($1, $2, $3)",
                token, user_id, time.time() + 86400,
            )
            await send_verification_email(body.email, token)
        except Exception as exc:
            logger.warning("[auth] Could not send verification email: {}", exc)

    logger.info("[auth] New user signed up: {}", body.email)
    return TokenResponse(access_token=_make_jwt(user_id))


async def login(body: LoginRequest, db: asyncpg.Connection) -> TokenResponse:
    row = await db.fetchrow(
        "SELECT id, hashed_pw FROM users WHERE email = $1", body.email
    )
    if not row or not row["hashed_pw"] or not _verify(body.password, row["hashed_pw"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    logger.info("[auth] Login: {}", body.email)
    return TokenResponse(access_token=_make_jwt(row["id"]))


# ── Email verification ────────────────────────────────────────────────────────

async def verify_email(token: str, db: asyncpg.Connection) -> dict:
    row = await db.fetchrow(
        "SELECT user_id, expires_at FROM email_verifications WHERE token = $1", token
    )
    if not row:
        raise HTTPException(status_code=400, detail="Invalid verification token")
    if time.time() > row["expires_at"]:
        raise HTTPException(status_code=400, detail="Verification link expired")

    async with db.transaction():
        await db.execute("UPDATE users SET email_verified = true WHERE id = $1", row["user_id"])
        await db.execute("DELETE FROM email_verifications WHERE token = $1", token)

    return {"verified": True}


# ── OTP login ─────────────────────────────────────────────────────────────────

async def otp_request(body: OtpRequestBody, db: asyncpg.Connection) -> dict:
    email = body.email.lower().strip()

    # Rate limit
    now   = time.time()
    times = [t for t in _otp_rate.get(email, []) if now - t < 3600]
    if len(times) >= _OTP_MAX_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many OTP requests — try again later")
    _otp_rate[email] = times + [now]

    code      = str(secrets.randbelow(900000) + 100000)  # 6-digit
    code_hash = _hash_code(code)
    otp_id    = str(uuid.uuid4())

    await db.execute(
        "INSERT INTO otp_codes (id, email, code_hash, expires_at, used) VALUES ($1, $2, $3, $4, false)",
        otp_id, email, code_hash, now + _OTP_TTL_MINUTES * 60,
    )

    try:
        await send_otp_email(email, code)
    except Exception as exc:
        logger.error("[auth] OTP email failed: {}", exc)
        raise HTTPException(status_code=503, detail="Could not send OTP email")

    return {"sent": True}


async def otp_verify(body: OtpVerifyBody, db: asyncpg.Connection) -> TokenResponse:
    email     = body.email.lower().strip()
    code_hash = _hash_code(body.code)
    now       = time.time()

    row = await db.fetchrow(
        "SELECT id, expires_at, used FROM otp_codes "
        "WHERE email = $1 AND code_hash = $2 ORDER BY expires_at DESC LIMIT 1",
        email, code_hash,
    )
    if not row or row["used"] or now > row["expires_at"]:
        raise HTTPException(status_code=401, detail="Invalid or expired OTP code")

    await db.execute("UPDATE otp_codes SET used = true WHERE id = $1", row["id"])

    # Find or create user for this email (passwordless signup path)
    user_row = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if user_row:
        user_id = user_row["id"]
        # Mark verified if not already
        await db.execute("UPDATE users SET email_verified = true WHERE id = $1", user_id)
    else:
        user_id = str(uuid.uuid4())
        async with db.transaction():
            await db.execute(
                "INSERT INTO users (id, email, hashed_pw, email_verified, created_at) VALUES ($1, $2, NULL, true, $3)",
                user_id, email, now,
            )
            await db.execute(
                "INSERT INTO credits (user_id, balance_usd_cents) VALUES ($1, $2)",
                user_id, settings.signup_credit_grant_usd_cents,
            )
            await db.execute("INSERT INTO provider_keys (user_id) VALUES ($1)", user_id)

    return TokenResponse(access_token=_make_jwt(user_id))


# ── API key management ────────────────────────────────────────────────────────

async def create_api_key(user_id: str, label: str, db: asyncpg.Connection) -> ApiKeyResponse:
    if settings.email_require_verification:
        row = await db.fetchrow("SELECT email_verified FROM users WHERE id = $1", user_id)
        if row and not row["email_verified"]:
            raise HTTPException(
                status_code=403,
                detail="Email not verified. Check your inbox for a verification link.",
            )

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


async def list_api_keys(user_id: str, db: asyncpg.Connection) -> list[dict]:
    rows = await db.fetch(
        "SELECT key, label, created_at FROM api_keys WHERE user_id = $1 AND revoked = 0 ORDER BY created_at DESC",
        user_id,
    )
    return [{"key": r["key"], "label": r["label"], "created_at": r["created_at"]} for r in rows]


async def revoke_api_key(user_id: str, key: str, db: asyncpg.Connection) -> None:
    """Mark an API key as revoked. Raises 404 if it doesn't belong to the user."""
    row = await db.fetchrow(
        "SELECT key FROM api_keys WHERE key = $1 AND user_id = $2", key, user_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Key not found")
    await db.execute("UPDATE api_keys SET revoked = 1 WHERE key = $1", key)


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

