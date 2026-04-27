"""
PVP session interface.

Any application that wants to be reachable by voiceagent-sdk must implement
BaseVoiceSession.  The base class handles:
  - WebSocket lifecycle (accept, receive loop, task cleanup)
  - Wire-protocol framing (ping/pong, config broadcast, error shapes)
  - Upgrade signalling stubs (WebSocket → WebRTC)

Subclasses override:
  on_session_start(ctx)      — build pipeline, greet user, etc.
  on_audio(data, ctx)        — raw PCM16 from client
  on_message(msg, ctx)       — JSON control message (non-protocol types)
  on_session_end(ctx)        — cleanup (db write, analytics, etc.)

Optionally override:
  on_upgrade_offer(msg, ctx) — WebRTC SDP offer from client
  on_downgrade(ctx)          — client requested fallback to WS
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger


# ── Data classes ───────────────────────────────────────────────────────────────

@dataclass
class AudioConfig:
    """Negotiated audio parameters broadcast to the client on connect."""
    sample_rate: int   = 16_000
    channels:    int   = 1
    encoding:    str   = "pcm_s16le"   # only supported value currently


@dataclass
class SessionContext:
    """
    Immutable context handed to every callback.

    Populated once when the WebSocket connects and passed through the session
    lifetime so handlers never need to store state on self.
    """
    session_id:     str
    ws:             WebSocket
    metadata:       dict[str, str]   = field(default_factory=dict)
    audio_config:   AudioConfig      = field(default_factory=AudioConfig)
    connected_at:   float            = field(default_factory=time.time)

    # Future: connection_info (IP, user agent), auth token, etc.


# ── Abstract base ──────────────────────────────────────────────────────────────

class BaseVoiceSession(ABC):
    """
    Abstract WebSocket voice session handler compatible with voiceagent-sdk.

    Quick-start
    -----------
    class MySession(BaseVoiceSession):
        async def on_session_start(self, ctx: SessionContext) -> None:
            # build your STT→LLM→TTS pipeline here
            await self.send_status(ctx, "listening")

        async def on_audio(self, data: bytes, ctx: SessionContext) -> None:
            # push PCM16 bytes into your pipeline
            ...

        async def on_message(self, msg: dict, ctx: SessionContext) -> None:
            # handle application-level JSON messages
            ...

        async def on_session_end(self, ctx: SessionContext) -> None:
            # teardown resources
            ...

    control_ws
    ──────────
    Optional separate WebSocket for JSON control messages (e.g. artifacts,
    intent).  When set, _send_json routes to control_ws instead of ctx.ws.
    Useful for the dual-channel architecture where WebRTC carries audio and
    a side WebSocket carries structured messages.

    Future multimodal dimensions
    ──────────────────────────────
    1. Native audio LLMs (pvp/2.0): replace the STT→LLM→TTS pipeline with a
       single model (e.g. GPT-4o Realtime, Gemini Live) that handles audio
       in/out natively.  The wire protocol is unchanged; only on_session_start
       differs.  Advertise pipeline_mode="native_audio" in the config message.

    2. Rich ingress (pvp/2.0): override on_image_frame / on_video_frame to
       accept camera frames or uploaded images from the client.
    """

    #: Optional control WebSocket — set this before calling run() when you
    #: want artifact/intent messages routed to a separate channel.
    control_ws: WebSocket | None = None

    # ── Subclass hooks ─────────────────────────────────────────────────────

    @abstractmethod
    async def on_session_start(self, ctx: SessionContext) -> None:
        """Called once, after the WebSocket is accepted and config is sent."""

    @abstractmethod
    async def on_audio(self, data: bytes, ctx: SessionContext) -> None:
        """
        Called for every inbound binary frame.

        data: raw PCM16 bytes at ctx.audio_config.sample_rate, mono,
              little-endian.  Chunk size is client-defined (~100 ms typical).
        """

    @abstractmethod
    async def on_message(self, msg: dict[str, Any], ctx: SessionContext) -> None:
        """
        Called for inbound JSON text frames whose `type` is not handled
        by the base class (i.e. not ping / config / upgrade-* / downgrade).
        """

    @abstractmethod
    async def on_session_end(self, ctx: SessionContext) -> None:
        """
        Called once at session teardown, regardless of how it ended
        (clean disconnect, error, server shutdown).
        """

    # ── Optional hooks ─────────────────────────────────────────────────────

    async def on_upgrade_offer(
        self,
        msg: dict[str, Any],
        ctx: SessionContext,
    ) -> None:
        """
        Inbound WebRTC SDP offer from the client (`type: "upgrade-offer"`).

        Default: reject with upgrade-failed.
        Override to wire SmallWebRTC / aiortc signalling.
        """
        await self._send_json(ctx, {"type": "upgrade-failed", "reason": "not supported"})

    async def on_downgrade(self, ctx: SessionContext) -> None:
        """
        Client requested fallback from WebRTC to WebSocket (`type: "downgrade"`).

        Default: acknowledge.
        """
        await self._send_json(ctx, {"type": "downgrade-complete"})

    # ── Future multimodal ingress hooks (pvp/2.0, not yet in protocol) ────
    # Still image submitted by the user (arrives between media-start/media-end)
    # async def on_image_frame(self, data: bytes, mime: str, ctx: SessionContext) -> None: ...
    #
    # Video frame from WebRTC camera track (RGBA, decoded)
    # async def on_video_frame(self, data: bytes, width: int, height: int, ctx: SessionContext) -> None: ...

    # ── Helpers — send to client ────────────────────────────────────────────

    async def send_audio(self, ctx: SessionContext, data: bytes) -> None:
        """Send raw PCM16 audio to the client."""
        try:
            await ctx.ws.send_bytes(data)
        except Exception as exc:
            logger.warning(f"[{ctx.session_id}] send_audio failed: {exc}")

    async def send_status(
        self,
        ctx: SessionContext,
        status: str,     # "idle" | "listening" | "speaking"
    ) -> None:
        await self._send_json(ctx, {"type": "status", "status": status})

    async def send_transcript(
        self,
        ctx: SessionContext,
        role: str,       # "user" | "assistant"
        text: str,
        transcript_id: str | None = None,
        is_final: bool = True,
    ) -> None:
        await self._send_json(ctx, {
            "type":     "transcript",
            "id":       transcript_id or str(uuid.uuid4()),
            "role":     role,
            "text":     text,
            "is_final": is_final,
        })

    async def send_message(self, ctx: SessionContext, msg: dict[str, Any]) -> None:
        """Send an arbitrary JSON message to the client."""
        await self._send_json(ctx, msg)

    async def send_error(self, ctx: SessionContext, message: str) -> None:
        await self._send_json(ctx, {"type": "error", "message": message})

    # ── Entry point — called by mount_voice_router ──────────────────────────

    async def run(
        self,
        ws: WebSocket,
        metadata: dict[str, str] | None = None,
        audio_config: AudioConfig | None = None,
    ) -> None:
        """
        Accept the WebSocket and run the full session lifecycle.
        Called by the router; do not call directly in application code.
        """
        ctx = SessionContext(
            session_id=str(uuid.uuid4()),
            ws=ws,
            metadata=metadata or {},
            audio_config=audio_config or AudioConfig(),
        )
        logger.info(f"[{ctx.session_id}] session started metadata={ctx.metadata}")

        await ws.accept()
        await self._send_json(ctx, {"type": "status", "status": "idle"})
        await self._send_json(ctx, {
            "type":              "config",
            "audio_sample_rate": ctx.audio_config.sample_rate,
            "audio_channels":    ctx.audio_config.channels,
            "audio_encoding":    ctx.audio_config.encoding,
        })

        try:
            await self.on_session_start(ctx)
            await self._receive_loop(ctx)
        except WebSocketDisconnect:
            logger.info(f"[{ctx.session_id}] client disconnected")
        except Exception as exc:
            logger.exception(f"[{ctx.session_id}] unhandled error: {exc}")
        finally:
            try:
                await self.on_session_end(ctx)
            except Exception as exc:
                logger.warning(f"[{ctx.session_id}] on_session_end error: {exc}")
            logger.info(f"[{ctx.session_id}] session ended")

    # ── Internal ────────────────────────────────────────────────────────────

    async def _receive_loop(self, ctx: SessionContext) -> None:
        while True:
            frame = await ctx.ws.receive()

            if frame["type"] == "websocket.disconnect":
                break

            if frame.get("bytes") is not None:
                await self.on_audio(frame["bytes"], ctx)
            elif frame.get("text") is not None:
                try:
                    msg = json.loads(frame["text"])
                except json.JSONDecodeError:
                    await self.send_error(ctx, "invalid JSON")
                    continue
                await self._dispatch_message(msg, ctx)

    async def _dispatch_message(
        self,
        msg: dict[str, Any],
        ctx: SessionContext,
    ) -> None:
        t = msg.get("type")

        if t == "ping":
            await self._send_json(ctx, {
                "type":      "pong",
                "ts":        msg.get("ts"),
                "server_ts": int(time.time() * 1000),
            })

        elif t == "config":
            # Client-side config acknowledgement — subclass may inspect if needed
            await self.on_message(msg, ctx)

        elif t == "upgrade-offer":
            await self.on_upgrade_offer(msg, ctx)

        elif t == "upgrade-ice":
            # Trickle ICE relay — default no-op; override to wire aiortc
            pass

        elif t == "upgrade-complete":
            pass

        elif t == "downgrade":
            await self.on_downgrade(ctx)

        else:
            await self.on_message(msg, ctx)

    async def _send_json(self, ctx: SessionContext, msg: dict[str, Any]) -> None:
        ws = self.control_ws or ctx.ws
        try:
            await ws.send_text(json.dumps(msg))
        except Exception as exc:
            logger.warning(f"[{ctx.session_id}] send_json failed: {exc}")
