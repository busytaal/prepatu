"""
WebSocket voice session handler — Pipecat implementation of BaseVoiceSession.

Implements the Prepatu Voice Protocol (PVP) backend interface using Pipecat's
STT → LLM → TTS pipeline.  The wire protocol, receive loop, ping/pong, and
config broadcast are all handled by BaseVoiceSession.  This class only needs
to build the pipeline and push audio into it.

See backend/pvp/ for the full interface specification.
"""

import asyncio
from typing import Any

from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.transports.base_transport import TransportParams

from vfdl.bot import create_pipeline_services
from vfdl.pvp.session import AudioConfig, BaseVoiceSession, SessionContext
from vfdl.ws_transport import FastAPIWSTransport

AUDIO_SAMPLE_RATE = 16_000
AUDIO_CHANNELS    = 1


class WSSession(BaseVoiceSession):
    """
    Pipecat-backed voice session.

    Lifecycle:
      on_session_start → _run_pipeline (concurrent task)
      on_audio         → push PCM bytes into FastAPIWSTransport queue
      on_session_end   → cancel pipeline, mark transport closed
    """

    def __init__(self, system_prompt: str) -> None:
        self._system_prompt  = system_prompt
        self._transport:     FastAPIWSTransport | None = None
        self._pipeline_task: asyncio.Task | None = None

    # ── BaseVoiceSession hooks ─────────────────────────────────────────────

    async def on_session_start(self, ctx: SessionContext) -> None:
        self._pipeline_task = asyncio.create_task(self._run_pipeline(ctx))

    async def on_audio(self, data: bytes, ctx: SessionContext) -> None:
        if self._transport:
            await self._transport.push_audio(data)

    async def on_message(self, msg: dict[str, Any], ctx: SessionContext) -> None:
        logger.debug(f"[{ctx.session_id}] unhandled message type: {msg.get('type')}")

    async def on_session_end(self, ctx: SessionContext) -> None:
        if self._pipeline_task and not self._pipeline_task.done():
            self._pipeline_task.cancel()
            try:
                await self._pipeline_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._transport:
            self._transport.mark_closed()

    # ── Pipeline ───────────────────────────────────────────────────────────

    async def _run_pipeline(self, ctx: SessionContext) -> None:
        """Build and run the STT → LLM → TTS Pipecat pipeline."""
        transport = FastAPIWSTransport(
            ws=ctx.ws,
            params=TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                audio_out_sample_rate=ctx.audio_config.sample_rate,
                audio_in_sample_rate=ctx.audio_config.sample_rate,
                audio_out_channels=ctx.audio_config.channels,
                vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.8)),
                vad_audio_passthrough=True,
            ),
        )
        self._transport = transport

        stt, llm, tts, user_aggregator, assistant_aggregator = create_pipeline_services(
            self._system_prompt
        )

        pipeline = Pipeline([
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ])

        task = PipelineTask(
            pipeline,
            params=PipelineParams(allow_interruptions=True),
            enable_rtvi=False,
        )
        self._pipeline_task_inner = task
        await task.queue_frames([LLMRunFrame()])

        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)

