"""
PVP FastAPI router factory.

mount_voice_router() attaches a WebSocket endpoint to a FastAPI app (or
sub-application) and maps query parameters to a SessionContext, then
instantiates the user-supplied BaseVoiceSession subclass for each connection.

Usage::

    from fastapi import FastAPI
    from vfdl.pvp import mount_voice_router
    from myapp.session import MySession

    app = FastAPI()
    mount_voice_router(app, MySession, path="/ws")

The factory pattern (passing the class, not an instance) means each
WebSocket connection gets a fresh session object — no shared state.
"""

from __future__ import annotations

from typing import Type

from fastapi import FastAPI, Query, WebSocket

from .session import AudioConfig, BaseVoiceSession


def mount_voice_router(
    app: FastAPI,
    session_class: Type[BaseVoiceSession],
    path: str = "/ws",
    default_audio: AudioConfig | None = None,
) -> None:
    """
    Register a WebSocket voice endpoint on `app`.

    Parameters
    ----------
    app:
        FastAPI application (or APIRouter if you want a prefix).
    session_class:
        A concrete subclass of BaseVoiceSession.  A new instance is created
        for every incoming WebSocket connection.
    path:
        WebSocket path to register (default ``/ws``).
    default_audio:
        AudioConfig to use when the client has not negotiated its own.
        Defaults to 16 kHz / mono / pcm_s16le.
    """
    audio_cfg = default_audio or AudioConfig()

    @app.websocket(path)
    async def _voice_endpoint(
        ws: WebSocket,
        # Common metadata query parameters — extend as needed
        interview_type: str = Query(default="idle"),
        user_id:        str = Query(default=""),
        language:       str = Query(default="en"),
    ) -> None:
        metadata: dict[str, str] = {
            "interview_type": interview_type,
            "user_id":        user_id,
            "language":       language,
        }
        session = session_class()
        await session.run(ws, metadata=metadata, audio_config=audio_cfg)
