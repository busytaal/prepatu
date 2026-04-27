"""
Interview agent.

Runs the IELTS practice pipeline with one tool: end_interview().

Latency instrumentation measures four timestamps per turn:
  1. turn_start        — VAD signals end of user speech (handled via transport event)
  2. llm_first_token   — first streaming token arrives from the LLM
  3. tool_call_start   — FunctionCallInProgressFrame received (if tool called)
  4. tool_call_end     — result_callback invoked
  5. tts_first_audio   — first binary audio frame dispatched to client

These are emitted as session_events so you can compute:
  STT latency      = llm_first_token.ts - turn_start.ts
  Tool overhead    = tool_call_end.ts  - tool_call_start.ts
  TTS TTFA         = tts_first_audio.ts - (tool_call_end or llm_first_token).ts
  Total turn RTT   = tts_first_audio.ts - turn_start.ts
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import TYPE_CHECKING

from loguru import logger

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.processors.aggregators.llm_context import LLMContext

from ielts.agents.artifacts import SEND_ARTIFACT_SCHEMA, make_send_artifact_handler
from vfdl.pvp.session import BaseVoiceSession, SessionContext
from vfdl.store.interface import E
from vfdl.ws_transport import FastAPIWSTransport

if TYPE_CHECKING:
    from vfdl.store.interface import SessionStore

_END_INTERVIEW_SCHEMA = FunctionSchema(
    name="end_interview",
    description=(
        "End the current IELTS practice interview. "
        "Call this when the user explicitly asks to stop, finish, or end the interview."
    ),
    properties={
        "reason": {
            "type": "string",
            "description": "Brief reason for ending (e.g. 'user request', 'time limit').",
        },
    },
    required=[],
)

_TOOLS_WITH_ARTIFACTS = ToolsSchema(standard_tools=[SEND_ARTIFACT_SCHEMA, _END_INTERVIEW_SCHEMA])
_TOOLS_NO_ARTIFACTS   = ToolsSchema(standard_tools=[_END_INTERVIEW_SCHEMA])


class InterviewAgent(BaseVoiceSession):
    """PVP-compliant session that runs an IELTS practice interview."""

    def __init__(self, store: "SessionStore", interview_type: str = "part1", system_prompt: str | None = None) -> None:
        self._store = store
        self._interview_type = interview_type
        self._system_prompt = system_prompt
        self._transport: FastAPIWSTransport | None = None
        self._pipeline_task: asyncio.Task | None = None
        # Guard: prevent end_interview being called before the user has spoken
        self._user_has_spoken = False
        # Per-turn latency timestamps
        self._t_turn_start:      float | None = None
        self._t_llm_first_token: float | None = None
        self._t_tool_call_start: float | None = None
        self._t_tts_first_audio: float | None = None

    # ── BaseVoiceSession hooks ─────────────────────────────────────────────

    async def on_session_start(self, ctx: SessionContext) -> None:
        await self._store.emit(ctx.session_id, E.CONNECTED, {
            "mode": "interview",
            "interview_type": self._interview_type,
        })
        self._pipeline_task = asyncio.create_task(self._run_pipeline(ctx))

    async def on_audio(self, data: bytes, ctx: SessionContext) -> None:
        self._user_has_spoken = True
        if self._transport:
            await self._transport.push_audio(data)

    async def on_message(self, msg: dict, ctx: SessionContext) -> None:
        logger.debug(f"[interview:{ctx.session_id}] unhandled: {msg.get('type')}")

    async def on_session_end(self, ctx: SessionContext) -> None:
        await self._store.emit(ctx.session_id, E.DISCONNECTED)
        await self._store.end_session(ctx.session_id)
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
        from pipecat.frames.frames import (
            LLMRunFrame,
            FunctionCallInProgressFrame,
            AudioRawFrame,
        )
        from pipecat.pipeline.pipeline import Pipeline
        from pipecat.pipeline.runner import PipelineRunner
        from pipecat.pipeline.task import PipelineParams, PipelineTask
        from pipecat.transports.base_transport import TransportParams
        from pipecat.audio.vad.silero import SileroVADAnalyzer
        from pipecat.audio.vad.vad_analyzer import VADParams
        import ielts.remote_config as rc

        cfg = rc.get_config()
        system_prompt = self._system_prompt or ""

        transport = FastAPIWSTransport(
            ws=ctx.ws,
            params=TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                audio_out_sample_rate=ctx.audio_config.sample_rate,
                audio_in_sample_rate=ctx.audio_config.sample_rate,
                audio_out_channels=ctx.audio_config.channels,
                vad_analyzer=SileroVADAnalyzer(
                    params=VADParams(stop_secs=cfg.vad_stop_secs)
                ),
                vad_audio_passthrough=True,
            ),
        )
        self._transport = transport

        active_tools = _TOOLS_WITH_ARTIFACTS if self.control_ws is not None else _TOOLS_NO_ARTIFACTS
        from vfdl.bot import create_pipeline_services
        stt, llm, tts, user_aggregator, assistant_aggregator = create_pipeline_services(
            system_prompt, tools=active_tools
        )

        if self.control_ws is not None:
            llm.register_function("send_artifact", make_send_artifact_handler(self.control_ws, ctx.session_id))
        # end_interview is always registered — it's a flow action, not a UI artifact
        llm.register_function("end_interview", self._tool_end_interview(ctx))

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

        await task.queue_frames([LLMRunFrame()])
        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)

    def _tool_end_interview(self, ctx: SessionContext):
        store = self._store
        async def handler(params):
            # Reject spurious calls that fire before the user has said anything.
            # This prevents the LLM from ending the interview on its very first turn.
            if not self._user_has_spoken:
                logger.warning(
                    f"[interview:{ctx.session_id}] end_interview called before user spoke — ignoring"
                )
                await params.result_callback(
                    "Ignore this tool call. The candidate has not spoken yet. "
                    "Continue with the interview greeting."
                )
                return

            t_start = time.time()
            if self._t_llm_first_token is not None:
                self._t_tool_call_start = t_start

            await store.emit(ctx.session_id, E.TOOL_CALL_START, {
                "tool":   "end_interview",
                "reason": params.arguments.get("reason", "user_request"),
                "t_llm_first_token": self._t_llm_first_token,
            })

            # Emit navigate artifact → app goes back to Home
            artifact = {
                "type":   "navigate",
                "id":     str(uuid.uuid4()),
                "screen": "Home",
                "params": {},
            }
            try:
                await ctx.ws.send_text(json.dumps({"type": "artifact", **artifact}))
            except Exception:
                pass

            t_end = time.time()
            await store.emit(ctx.session_id, E.TOOL_CALL_END, {
                "tool":       "end_interview",
                "latency_ms": round((t_end - t_start) * 1000),
            })
            await store.emit(ctx.session_id, E.INTERVIEW_ENDED, {
                "interview_type": self._interview_type,
            })

            await params.result_callback(
                "Interview ended. Great work — head back to the home screen."
            )

            # Cancel the pipeline after the TTS reply completes
            if self._pipeline_task:
                asyncio.get_event_loop().call_later(3.0, self._pipeline_task.cancel)

        return handler

    # ── Latency snapshot ───────────────────────────────────────────────────

    async def _emit_latency_snapshot(self, ctx: SessionContext) -> None:
        """
        Emit a structured latency snapshot once tts_first_audio fires.
        This gives you all four deltas in one event for easy querying.
        """
        ts = self._t_tts_first_audio or time.time()
        data: dict = {
            "t_turn_start":      self._t_turn_start,
            "t_llm_first_token": self._t_llm_first_token,
            "t_tool_call_start": self._t_tool_call_start,
            "t_tts_first_audio": ts,
        }

        # Compute deltas where both boundaries are known
        if self._t_turn_start and self._t_llm_first_token:
            data["stt_latency_ms"] = round(
                (self._t_llm_first_token - self._t_turn_start) * 1000
            )
        if self._t_tool_call_start and self._t_tts_first_audio:
            data["tool_overhead_ms"] = round(
                (self._t_tts_first_audio - self._t_tool_call_start) * 1000
            )
        elif self._t_llm_first_token and self._t_tts_first_audio:
            data["tts_ttfa_ms"] = round(
                (self._t_tts_first_audio - self._t_llm_first_token) * 1000
            )
        if self._t_turn_start and self._t_tts_first_audio:
            data["total_rtt_ms"] = round(
                (self._t_tts_first_audio - self._t_turn_start) * 1000
            )

        await self._store.emit(ctx.session_id, E.TTS_FIRST_AUDIO, data)

        logger.info(
            f"[interview:{ctx.session_id}] latency snapshot: "
            f"stt={data.get('stt_latency_ms')}ms "
            f"tool_overhead={data.get('tool_overhead_ms')}ms "
            f"total_rtt={data.get('total_rtt_ms')}ms"
        )

        # Reset for next turn
        self._t_turn_start      = None
        self._t_llm_first_token = None
        self._t_tool_call_start = None
        self._t_tts_first_audio = None
