"""
PVP typed message constructors.

All server→client message shapes in one place.  Use these instead of
building dicts by hand so that a future schema validator can enforce them.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal


class PvpMessage:
    """
    Static factory methods for every server→client message type.

    Example::

        await ctx.ws.send_text(json.dumps(PvpMessage.status("listening")))
        await ctx.ws.send_text(json.dumps(PvpMessage.transcript("user", "Hello")))
    """

    @staticmethod
    def status(status: Literal["idle", "listening", "speaking"]) -> dict[str, Any]:
        return {"type": "status", "status": status}

    @staticmethod
    def config(
        sample_rate: int = 16_000,
        channels: int = 1,
        encoding: str = "pcm_s16le",
    ) -> dict[str, Any]:
        return {
            "type":              "config",
            "audio_sample_rate": sample_rate,
            "audio_channels":    channels,
            "audio_encoding":    encoding,
        }

    @staticmethod
    def transcript(
        role: Literal["user", "assistant"],
        text: str,
        transcript_id: str | None = None,
        is_final: bool = True,
    ) -> dict[str, Any]:
        return {
            "type":     "transcript",
            "id":       transcript_id or str(uuid.uuid4()),
            "role":     role,
            "text":     text,
            "is_final": is_final,
        }

    @staticmethod
    def pong(client_ts: int | None) -> dict[str, Any]:
        return {
            "type":      "pong",
            "ts":        client_ts,
            "server_ts": int(time.time() * 1000),
        }

    @staticmethod
    def error(message: str) -> dict[str, Any]:
        return {"type": "error", "message": message}

    @staticmethod
    def upgrade_answer(sdp: str, sdp_type: str, pc_id: str) -> dict[str, Any]:
        return {
            "type":     "upgrade-answer",
            "sdp":      sdp,
            "sdp_type": sdp_type,
            "pc_id":    pc_id,
        }

    @staticmethod
    def upgrade_ice(candidates: list[dict[str, Any]]) -> dict[str, Any]:
        return {"type": "upgrade-ice", "candidates": candidates}

    @staticmethod
    def intent(text: str) -> dict[str, Any]:
        """Short intent label derived from the bot's most recent utterance."""
        return {"type": "intent", "text": text}

    @staticmethod
    def upgrade_ready() -> dict[str, Any]:
        return {"type": "upgrade-ready"}

    @staticmethod
    def upgrade_failed(reason: str) -> dict[str, Any]:
        return {"type": "upgrade-failed", "reason": reason}

    @staticmethod
    def switch_now() -> dict[str, Any]:
        return {"type": "switch-now"}

    @staticmethod
    def downgrade_complete() -> dict[str, Any]:
        return {"type": "downgrade-complete"}

    # ── Future: multimodal ────────────────────────────────────────────────────

    # @staticmethod
    # def video_config(width: int, height: int, fps: int, encoding: str) -> dict:
    #     return {"type": "video-config", "width": width, "height": height,
    #             "fps": fps, "encoding": encoding}

    # @staticmethod
    # def artifact(artifact_type: str, content: Any, mime: str | None = None) -> dict:
    #     return {"type": "artifact", "artifact_type": artifact_type,
    #             "content": content, "mime": mime}
