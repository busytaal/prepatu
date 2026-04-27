"""
IntentObserver — Pipecat frame processor that derives an intent label from
the bot's LLM response and sends it to the client AFTER the bot has finished
speaking (BotStoppedSpeakingFrame), so it never appears mid-utterance.

Flow:
    LLMTextFrame      → buffer text while LLM streams
    LLMFullResponseEndFrame → freeze the buffered text as `_pending_text`
    BotStoppedSpeakingFrame → fire background task: classify → send intent

Placement in pipeline:
    ... llm → IntentObserver → tts → transport.output() ...

System frames (including BotStoppedSpeakingFrame) propagate through all
processors, so the observer sees it even though it originates later in the
pipeline.
"""
from __future__ import annotations

import asyncio
import json
from os import getenv
from typing import TYPE_CHECKING

from loguru import logger
from openai import AsyncOpenAI

from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    CancelFrame,
    LLMFullResponseEndFrame,
    LLMTextFrame,
    StartFrame,
    StopFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

_LIFECYCLE_FRAMES = (StartFrame, StopFrame, CancelFrame)

if TYPE_CHECKING:
    from fastapi import WebSocket


_INTENT_SYSTEM = (
    "You classify the intent of a voice assistant's utterance into ONE short label. "
    "Reply with a single title-case word or short phrase (2 words max). "
    "Examples: Greeting, Question, Feedback, Instruction, Encouragement, "
    "Clarification, Prompt, Farewell, Confirmation."
)


class IntentObserver(FrameProcessor):
    """
    Passthrough processor that derives an intent label from the bot's
    completed LLM response and sends ``{type: intent, text: <label>}``
    to the client WebSocket after the bot stops speaking.
    """

    def __init__(self, ws: "WebSocket") -> None:
        super().__init__()
        self._ws = ws
        self._buf: list[str] = []       # accumulates LLM tokens for current turn
        self._pending: str = ""          # stored full response, waiting for BotStopped

        # Reuse the same OpenRouter endpoint / key as the main LLM
        api_key  = getenv("LLM_API_KEY") or getenv("OPENROUTER_API_KEY", "")
        base_url = getenv("LLM_BASE_URL") or getenv("OPENROUTER_BASE_URL",
                                                     "https://openrouter.ai/api/v1")
        model    = getenv("INTENT_MODEL") or getenv("LLM_MODEL") or \
                   getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._model  = model

    # ── FrameProcessor interface ───────────────────────────────────────────

    async def process_frame(self, frame, direction: FrameDirection) -> None:
        # Delegate lifecycle frames to the base so _started is tracked correctly.
        if isinstance(frame, _LIFECYCLE_FRAMES):
            await super().process_frame(frame, direction)
            return

        # Always passthrough first — never block the pipeline
        await self.push_frame(frame, direction)

        # Only care about downstream frames (LLM → TTS direction)
        if direction != FrameDirection.DOWNSTREAM:
            return

        if isinstance(frame, LLMTextFrame):
            self._buf.append(frame.text)

        elif isinstance(frame, LLMFullResponseEndFrame):
            self._pending = "".join(self._buf).strip()
            self._buf.clear()

        elif isinstance(frame, BotStoppedSpeakingFrame):
            # Bot finished speaking — safe to send intent now
            if self._pending:
                text = self._pending
                self._pending = ""
                asyncio.create_task(self._classify_and_send(text))

    # ── Intent classification ──────────────────────────────────────────────

    async def _classify_and_send(self, text: str) -> None:
        try:
            resp = await self._client.chat.completions.create(
                model=self._model,
                max_tokens=8,
                temperature=0,
                messages=[
                    {"role": "system", "content": _INTENT_SYSTEM},
                    {"role": "user",   "content": text},
                ],
            )
            label = (resp.choices[0].message.content or "").strip()
            # Sanitise: strip quotes/punctuation, truncate to 24 chars
            label = label.strip("\"'.,!?").strip()[:24]
            await self._ws.send_text(json.dumps({"type": "intent", "text": label}))
            logger.debug(f"[intent] '{label}' ← '{text[:60]}…'")
        except Exception as exc:
            logger.warning(f"[intent] classification failed: {exc}")
