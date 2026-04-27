"""
FastAPI router — all cloud API endpoints.

Authentication:
  - /auth/* endpoints: public (signup / login)
  - /v1/* endpoints that accept SDK API keys: X-Prepatu-Key header
  - /v1/providers PATCH: Bearer JWT (dashboard only)
  - /v1/ws/{token}: validated via session token (no extra header needed)
"""

from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket

from cloud import auth, credits, flows, providers, usage
from cloud.auth import current_user_any, current_user_jwt, list_api_keys, resolve_api_key, revoke_api_key
from cloud.models import (
    ApiKeyResponse,
    CreditBalance,
    FlowCreate,
    FlowDetail,
    FlowSummary,
    LoginRequest,
    ProviderKeys,
    ProviderKeysUpdate,
    SessionRecord,
    SessionStartRequest,
    SessionStartResponse,
    SignupRequest,
    TokenResponse,
)
from cloud.store import get_db
from cloud.voice import handle_voice_ws

router = APIRouter()


# ── Auth (public) ─────────────────────────────────────────────────────────────

@router.post("/auth/signup", response_model=TokenResponse, tags=["auth"])
async def signup(body: SignupRequest, db: aiosqlite.Connection = Depends(get_db)):
    return await auth.signup(body, db)


@router.post("/auth/login", response_model=TokenResponse, tags=["auth"])
async def login(body: LoginRequest, db: aiosqlite.Connection = Depends(get_db)):
    return await auth.login(body, db)


@router.post("/auth/api-keys", response_model=ApiKeyResponse, tags=["auth"])
async def create_api_key(
    label: str = "default",
    user_id: str = Depends(current_user_jwt),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await auth.create_api_key(user_id, label, db)


@router.get("/auth/api-keys", tags=["auth"])
async def get_api_keys(
    user_id: str = Depends(current_user_jwt),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await list_api_keys(user_id, db)


@router.delete("/auth/api-keys/{key_id:path}", status_code=204, tags=["auth"])
async def revoke_key(
    key_id: str,
    user_id: str = Depends(current_user_jwt),
    db: aiosqlite.Connection = Depends(get_db),
):
    await revoke_api_key(user_id, key_id, db)


# ── API key dependency ────────────────────────────────────────────────────────

async def _user_from_api_key(
    x_prepatu_key: str | None = Header(default=None),
    db: aiosqlite.Connection = Depends(get_db),
) -> str:
    if not x_prepatu_key:
        raise HTTPException(status_code=401, detail="Missing X-Prepatu-Key header")
    return await resolve_api_key(x_prepatu_key, db)


# ── Flows (API key auth) ──────────────────────────────────────────────────────

@router.post("/v1/flows", response_model=FlowDetail, status_code=201, tags=["flows"])
async def create_flow(
    body: FlowCreate,
    user_id: str = Depends(current_user_any),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await flows.create_flow(user_id, body, db)


@router.get("/v1/flows", response_model=list[FlowSummary], tags=["flows"])
async def list_flows(
    user_id: str = Depends(current_user_any),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await flows.list_flows(user_id, db)


# /json sub-routes must be registered BEFORE the bare {flow_id} route
@router.get("/v1/flows/{flow_id}/json", tags=["flows"])
async def get_flow_json(
    flow_id: str,
    user_id: str = Depends(current_user_any),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await flows.get_flow_as_json(user_id, flow_id, db)


@router.put("/v1/flows/{flow_id}/json", status_code=204, tags=["flows"])
async def update_flow_json(
    flow_id: str,
    body: dict,
    user_id: str = Depends(current_user_any),
    db: aiosqlite.Connection = Depends(get_db),
):
    await flows.update_flow_from_json(user_id, flow_id, body, db)


@router.get("/v1/flows/{flow_id}", response_model=FlowDetail, tags=["flows"])
async def get_flow(
    flow_id: str,
    user_id: str = Depends(current_user_any),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await flows.get_flow(user_id, flow_id, db)


@router.delete("/v1/flows/{flow_id}", status_code=204, tags=["flows"])
async def delete_flow(
    flow_id: str,
    user_id: str = Depends(current_user_any),
    db: aiosqlite.Connection = Depends(get_db),
):
    await flows.delete_flow(user_id, flow_id, db)


# ── Sessions (API key auth) ───────────────────────────────────────────────────

@router.post("/v1/sessions", response_model=SessionStartResponse, tags=["sessions"])
async def start_session(
    body: SessionStartRequest,
    user_id: str = Depends(_user_from_api_key),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Reserve a session token and get the WS URL to connect to."""
    return await usage.start_session(user_id, body, db)


# ── Voice WebSocket ───────────────────────────────────────────────────────────

@router.websocket("/v1/ws/{session_token}")
async def voice_ws(
    ws: WebSocket,
    session_token: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    WebSocket voice session.  Client connects after receiving ws_url from
    POST /v1/sessions.  The session token authenticates the connection.
    """
    await handle_voice_ws(ws, session_token, db)


# ── Credits (API key auth) ────────────────────────────────────────────────────

@router.get("/v1/credits/balance", response_model=CreditBalance, tags=["credits"])
async def get_balance(
    user_id: str = Depends(current_user_any),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await credits.get_balance(user_id, db)


@router.get("/v1/sessions", response_model=list[SessionRecord], tags=["sessions"])
async def list_sessions(
    user_id: str = Depends(current_user_any),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        "SELECT token, flow_id, started_at, ended_at, duration_secs "
        "FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 50",
        (user_id,),
    ) as cur:
        rows = await cur.fetchall()
    return [
        SessionRecord(
            token_prefix=r["token"][:8],
            flow_id=r["flow_id"],
            started_at=r["started_at"],
            ended_at=r["ended_at"],
            duration_secs=r["duration_secs"],
        )
        for r in rows
    ]


# ── Provider keys ─────────────────────────────────────────────────────────────

@router.get("/v1/providers", response_model=ProviderKeys, tags=["providers"])
async def get_provider_keys(
    user_id: str = Depends(current_user_any),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await providers.get_provider_keys(user_id, db)


@router.patch("/v1/providers", response_model=ProviderKeys, tags=["providers"])
async def update_provider_keys(
    body: ProviderKeysUpdate,
    user_id: str = Depends(current_user_jwt),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await providers.update_provider_keys(user_id, body, db)


# ── Health ────────────────────────────────────────────────────────────────────

@router.get("/health", tags=["meta"])
async def health():
    return {"status": "ok", "service": "prepatu-cloud"}
