"""
ControlObserver — Pipecat frame processor that forwards pipeline lifecycle
events (transcript, status) to a WebSocket control channel.

Used in the dual-channel architecture where:
  - WebRTC carries audio (STT input / TTS output)
  - WebSocket carries JSON messages (transcript, status, intent, artifacts)

Placement:
    ... llm → ControlObserver → IntentObserver → tts → transport.output() ...

Frames handled (all passed through unchanged):
  TranscriptionFrame          → {"type":"transcript","role":"user","text":...}
  LLMTextFrame                → buffered; on LLMFullResponseEndFrame →
                                 {"type":"transcript","role":"assistant","text":...}
  BotStartedSpeakingFrame     → {"type":"status","status":"speaking"}
  BotStoppedSpeakingFrame     → {"type":"status","status":"listening"}
"""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import TYPE_CHECKING

from loguru import logger

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    LLMFullResponseEndFrame,
    LLMTextFrame,
    StartFrame,
    StopFrame,
    TranscriptionFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

# System frames that must be handled by the base class to satisfy
# Pipecat's _started lifecycle guard.
_LIFECYCLE_FRAMES = (StartFrame, StopFrame, CancelFrame)

if TYPE_CHECKING:
    from fastapi import WebSocket


class ControlObserver(FrameProcessor):
    """
    Passthrough processor — inspects frames and sends JSON messages to the
    paired WebSocket control channel without stalling the pipeline.
    """

    def __init__(self, ws: "WebSocket") -> None:
        super().__init__()
        self._ws = ws
        self._llm_buf: list[str] = []

    async def process_frame(self, frame, direction: FrameDirection) -> None:
        # Delegate lifecycle frames to the base so _started is tracked correctly,
        # then forward them downstream so subsequent processors (e.g. TTS) also
        # receive StartFrame and their own _started flag is set.
        if isinstance(frame, _LIFECYCLE_FRAMES):
            await super().process_frame(frame, direction)
            await self.push_frame(frame, direction)
            return

        await self.push_frame(frame, direction)

        # BotStartedSpeakingFrame / BotStoppedSpeakingFrame are emitted by the
        # transport OUTPUT and travel UPSTREAM through the pipeline, so we must
        # handle them regardless of direction.
        if isinstance(frame, BotStartedSpeakingFrame):
            asyncio.create_task(
                self._send({"type": "status", "status": "speaking"})
            )
            return

        if isinstance(frame, BotStoppedSpeakingFrame):
            asyncio.create_task(
                self._send({"type": "status", "status": "listening"})
            )
            return

        # All remaining inspection is downstream-only (transcripts, LLM text).
        if direction != FrameDirection.DOWNSTREAM:
            return

        if isinstance(frame, TranscriptionFrame):
            asyncio.create_task(
                self._send(
                    {
                        "type":     "transcript",
                        "id":       str(uuid.uuid4()),
                        "role":     "user",
                        "text":     frame.text,
                        "is_final": True,
                    }
                )
            )

        elif isinstance(frame, LLMTextFrame):
            self._llm_buf.append(frame.text)

        elif isinstance(frame, LLMFullResponseEndFrame):
            text = "".join(self._llm_buf).strip()
            self._llm_buf.clear()
            if text:
                asyncio.create_task(
                    self._send(
                        {
                            "type":     "transcript",
                            "id":       str(uuid.uuid4()),
                            "role":     "assistant",
                            "text":     text,
                            "is_final": True,
                        }
                    )
                )

        elif isinstance(frame, BotStartedSpeakingFrame):
            asyncio.create_task(
                self._send({"type": "status", "status": "speaking"})
            )

        elif isinstance(frame, BotStoppedSpeakingFrame):
            asyncio.create_task(
                self._send({"type": "status", "status": "listening"})
            )

    async def _send(self, msg: dict) -> None:
        try:
            await self._ws.send_text(json.dumps(msg))
        except Exception as exc:
            logger.warning(f"[ControlObserver] send failed: {exc}")
