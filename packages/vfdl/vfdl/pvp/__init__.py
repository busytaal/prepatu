"""
Prepatu Voice Protocol (PVP) — backend interface package.

Exports the public interface surface:
  BaseVoiceSession  — abstract WebSocket session handler
  SessionContext    — metadata handed to a session on connect
  AudioConfig       — negotiated audio parameters
  PvpMessage        — typed server→client message helpers
  mount_voice_router — FastAPI router factory
"""

from .session import BaseVoiceSession, SessionContext, AudioConfig
from .messages import PvpMessage
from .router import mount_voice_router

__all__ = [
    "BaseVoiceSession",
    "SessionContext",
    "AudioConfig",
    "PvpMessage",
    "mount_voice_router",
]
