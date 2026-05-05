from __future__ import annotations

from pydantic import BaseModel, EmailStr


# ── Auth ──────────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ApiKeyResponse(BaseModel):
    key: str
    label: str


# ── Sessions ──────────────────────────────────────────────────────────────────

class SessionStartRequest(BaseModel):
    flow_id: str | None = None
    # Optional runtime variable pre-fill (injected into flow context on start).
    context: dict[str, str] | None = None
    metadata: dict[str, str] | None = None


class SessionStartResponse(BaseModel):
    session_token: str
    ws_url: str          # wss://api.prepatu.io/v1/ws/{session_token}
    transport: str = "websocket"
    credits_remaining: int  # USD cents


# ── Flows ──────────────────────────────────────────────────────

class FlowCreate(BaseModel):
    name: str
    yaml_content: str


class FlowSummary(BaseModel):
    id: str
    name: str
    created_at: float


class FlowDetail(BaseModel):
    id: str
    name: str
    yaml_content: str
    created_at: float


# ── Sessions ──────────────────────────────────────────────────────────────────

class SessionRecord(BaseModel):
    token_prefix: str         # first 8 chars only
    flow_id: str | None
    started_at: float
    ended_at: float | None
    duration_secs: int | None


# ── Credits ───────────────────────────────────────────────────────────────────

class CreditBalance(BaseModel):
    balance_usd_cents: int
    rate_per_minute_usd_cents: int


# ── OTP ───────────────────────────────────────────────────────────────────────

class OtpRequestBody(BaseModel):
    email: EmailStr


class OtpVerifyBody(BaseModel):
    email: EmailStr
    code: str


# ── Credit packages ───────────────────────────────────────────────────────────

class CreditPackage(BaseModel):
    id: str
    name: str
    price_usd: float
    credits: int            # USD cents credited to account
    description: str


# ── Provider keys ─────────────────────────────────────────────────────────────

class ProviderKeys(BaseModel):
    stt_provider: str = "deepgram"
    stt_api_key: str | None = None
    tts_provider: str = "deepgram"
    tts_api_key: str | None = None
    llm_provider: str = "openrouter"
    llm_api_key: str | None = None


class ProviderKeysUpdate(BaseModel):
    stt_provider: str | None = None
    stt_api_key: str | None = None
    tts_provider: str | None = None
    tts_api_key: str | None = None
    llm_provider: str | None = None
    llm_api_key: str | None = None
