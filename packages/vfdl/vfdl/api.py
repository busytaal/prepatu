from os import getenv
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from loguru import logger
from vfdl.config import SYSTEM_PROMPT, SYSTEM_PROMPT_FILE
from vfdl.providers.stt import check_stt_config
from vfdl.providers.tts import check_tts_config
from vfdl.providers.llm import check_llm_config
from vfdl.providers.turn import get_turn_provider
from vfdl.providers.turn.static import fetch_ice_servers as fetch_static_ice_servers
from pipecat.transports.smallwebrtc.request_handler import SmallWebRTCRequestHandler
from pipecat.transports.smallwebrtc.connection import IceServer

engine_router = APIRouter(tags=["Engine"])


def _to_ice_server(server: dict[str, object]) -> IceServer | None:
    urls = server.get("urls")
    username = server.get("username")
    credential = server.get("credential")

    if isinstance(urls, str):
        urls_value: str | list[str] = urls
    elif isinstance(urls, list) and all(isinstance(u, str) for u in urls):
        urls_value = urls
    else:
        return None

    username_value = username if isinstance(username, str) else None
    credential_value = credential if isinstance(credential, str) else None

    return IceServer(urls=urls_value, username=username_value, credential=credential_value)

ice_servers_for_handler = []
try:
    static_payload = fetch_static_ice_servers()
    ice_servers_for_handler = [
        ice_server
        for ice_server in (_to_ice_server(server) for server in static_payload.get("iceServers", []))
        if ice_server is not None
    ]
except Exception as exc:
    logger.warning(f"Unable to build ICE servers for handler from static config: {exc}")

rtc_handler = SmallWebRTCRequestHandler(ice_servers=ice_servers_for_handler)


@engine_router.get("/health")
async def health_check():
    """Backend health endpoint for diagnostics."""
    turn_provider = get_turn_provider()
    return {
        "status": "ok",
        "service": "prepatu-ielts-voice-api",
        "transport": "webrtc",
        "stt_provider": getenv("STT_PROVIDER", "deepgram"),
        "stt_configured": check_stt_config(),
        "tts_provider": getenv("TTS_PROVIDER", "deepgram"),
        "tts_configured": check_tts_config(),
        "llm_provider": getenv("LLM_PROVIDER", "openrouter"),
        "llm_configured": check_llm_config(),
        "turn_provider": turn_provider.provider_name,
        "turn_configured": turn_provider.check_config(),
        "system_prompt_configured": bool(SYSTEM_PROMPT or SYSTEM_PROMPT_FILE),
    }


@engine_router.get("/capabilities")
async def capabilities():
    """Backend capabilities endpoint for voice diagnostics."""
    return {
        "stt": {"provider": getenv("STT_PROVIDER", "deepgram")},
        "tts": {"provider": getenv("TTS_PROVIDER", "deepgram")},
        "llm": {
            "provider": getenv("LLM_PROVIDER", "openrouter"),
            "model": getenv("LLM_MODEL", getenv("OPENROUTER_MODEL", "")),
        },
        "turn": {"provider": getenv("TURN_PROVIDER", "static")},
        "transport": {"webrtc": True},
    }

@engine_router.get("/ice-servers")
async def get_ice_servers():
    """Return ICE servers for WebRTC peer connection."""
    turn_provider = get_turn_provider()
    try:
        payload = turn_provider.fetch_ice_servers()
        return {
            "iceServers": payload.get("iceServers", []),
            "ttlSeconds": payload.get("ttlSeconds"),
        }
    except Exception as exc:
        logger.exception("Failed to fetch ICE servers from TURN provider")
        return JSONResponse(
            {
                "iceServers": [],
                "warning": "Failed to fetch ICE servers from TURN provider",
                "error": str(exc),
            },
            status_code=502,
        )

