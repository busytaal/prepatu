"""
OAuth2 social login — Google and GitHub.

Flow:
  1. Browser calls GET /auth/oauth/{provider}
     → Backend redirects to provider's authorization URL with a state param.
  2. Provider redirects back to GET /auth/oauth/{provider}/callback?code=&state=
     → Backend exchanges code for token, fetches profile, finds or creates a user,
       issues a JWT, then redirects the browser to /ui?token=<jwt>.

The state param is a random hex string stored in-memory for 10 minutes to prevent
CSRF.  In production with multiple workers, swap _state_store for Redis.
"""

from __future__ import annotations

import secrets
import time
import urllib.parse
import uuid

import asyncpg
import httpx
from fastapi import HTTPException
from fastapi.responses import RedirectResponse
from loguru import logger

from cloud.auth import _make_jwt
from cloud.config import settings

# ── In-memory CSRF state store (TTL 10 min) ───────────────────────────────────
_state_store: dict[str, float] = {}
_STATE_TTL = 600


def _new_state() -> str:
    state = secrets.token_hex(16)
    _state_store[state] = time.time()
    return state


def _verify_state(state: str) -> bool:
    ts = _state_store.pop(state, None)
    if ts is None:
        return False
    return (time.time() - ts) < _STATE_TTL


# ── Provider configuration ────────────────────────────────────────────────────

_PROVIDERS = {
    "google": {
        "auth_url":    "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url":   "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v3/userinfo",
        "scope":       "openid email profile",
    },
    "github": {
        "auth_url":    "https://github.com/login/oauth/authorize",
        "token_url":   "https://github.com/login/oauth/access_token",
        "userinfo_url": "https://api.github.com/user",
        "scope":       "read:user user:email",
    },
}


def _callback_uri(provider: str) -> str:
    base = settings.frontend_url.replace("https://", "https://api.")
    # Use the API base URL for the callback
    return f"{settings.public_base_url.replace('ws://', 'http://').replace('wss://', 'https://')}/auth/oauth/{provider}/callback"


# ── Redirect to provider ──────────────────────────────────────────────────────

def build_redirect(provider: str) -> RedirectResponse:
    cfg = _PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")

    client_id = getattr(settings, f"{provider}_client_id")
    if not client_id:
        raise HTTPException(status_code=501, detail=f"{provider} OAuth not configured")

    state = _new_state()
    params = {
        "client_id":     client_id,
        "redirect_uri":  _callback_uri(provider),
        "response_type": "code",
        "scope":         cfg["scope"],
        "state":         state,
    }
    if provider == "google":
        params["access_type"] = "online"

    url = cfg["auth_url"] + "?" + urllib.parse.urlencode(params)
    return RedirectResponse(url=url)


# ── Handle callback ───────────────────────────────────────────────────────────

async def handle_callback(provider: str, code: str, state: str, db: asyncpg.Connection) -> RedirectResponse:
    if not _verify_state(state):
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    cfg = _PROVIDERS[provider]
    client_id     = getattr(settings, f"{provider}_client_id")
    client_secret = getattr(settings, f"{provider}_client_secret")

    async with httpx.AsyncClient(timeout=10) as client:
        # Exchange code → access token
        token_resp = await client.post(
            cfg["token_url"],
            data={
                "client_id":     client_id,
                "client_secret": client_secret,
                "code":          code,
                "redirect_uri":  _callback_uri(provider),
                "grant_type":    "authorization_code",
            },
            headers={"Accept": "application/json"},
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to exchange OAuth code")

        token_data   = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=502, detail="No access token in OAuth response")

        # Fetch user profile
        userinfo_resp = await client.get(
            cfg["userinfo_url"],
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        if userinfo_resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch OAuth user info")

        profile = userinfo_resp.json()

    provider_user_id, email = _extract_profile(provider, profile)

    if not email:
        raise HTTPException(status_code=400, detail="OAuth provider did not return an email address")

    # GitHub: primary email may need a second call
    if provider == "github" and not email:
        email = await _github_primary_email(access_token)

    user_id = await _find_or_create_user(provider, provider_user_id, email, db)
    jwt     = _make_jwt(user_id)

    logger.info("[oauth] {} login: {} (user {})", provider, email, user_id)

    # Redirect browser to dashboard with token in fragment (not in server logs)
    redirect_url = f"{settings.frontend_url}/ui#oauth_token={jwt}"
    return RedirectResponse(url=redirect_url, status_code=302)


def _extract_profile(provider: str, profile: dict) -> tuple[str, str]:
    if provider == "google":
        return str(profile.get("sub", "")), profile.get("email", "")
    if provider == "github":
        return str(profile.get("id", "")), profile.get("email", "") or ""
    raise ValueError(f"Unknown provider {provider}")


async def _github_primary_email(access_token: str) -> str:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://api.github.com/user/emails",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        if resp.status_code == 200:
            for entry in resp.json():
                if entry.get("primary") and entry.get("verified"):
                    return entry["email"]
    return ""


async def _find_or_create_user(
    provider: str, provider_user_id: str, email: str, db: asyncpg.Connection
) -> str:
    # Check if this social identity is already linked
    row = await db.fetchrow(
        "SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2",
        provider, provider_user_id,
    )
    if row:
        return row["user_id"]

    # Check if an account exists with this email (link it)
    user_row = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)

    async with db.transaction():
        if user_row:
            user_id = user_row["id"]
        else:
            # Create new user — no password (social-only)
            user_id = str(uuid.uuid4())
            now     = time.time()
            await db.execute(
                "INSERT INTO users (id, email, hashed_pw, email_verified, created_at) VALUES ($1, $2, NULL, true, $3)",
                user_id, email, now,
            )
            await db.execute(
                "INSERT INTO credits (user_id, balance_usd_cents) VALUES ($1, $2)",
                user_id, settings.signup_credit_grant_usd_cents,
            )
            await db.execute("INSERT INTO provider_keys (user_id) VALUES ($1)", user_id)

        # Link the social identity
        await db.execute(
            "INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id) VALUES ($1, $2, $3, $4) "
            "ON CONFLICT (provider, provider_user_id) DO NOTHING",
            str(uuid.uuid4()), user_id, provider, provider_user_id,
        )

        # Mark email as verified (came from trusted provider)
        await db.execute("UPDATE users SET email_verified = true WHERE id = $1", user_id)

    return user_id
