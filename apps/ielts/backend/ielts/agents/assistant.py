"""
Voice Assistant agent.

The assistant's job is to help the user navigate the app by voice.
It has access to the following tools that emit artifact messages back to
the client, which the React Native navigator processes:

  navigate(screen, params)         → { type: "navigate", screen, params }
  show_interview_types()           → { type: "artifact", artifact_type: "options", ... }
  start_interview(interview_type)  → { type: "navigate", screen: "Interview", params }
  get_session_summary()            → { type: "artifact", artifact_type: "card", ... }

Tool-call latency is measured by timestamping:
  1. llm_first_token    (piped through a custom frame observer)
  2. tool_call_start    (FunctionCallInProgressFrame received)
  3. tool_call_end      (result_callback called)
  4. tts_first_audio    (first binary audio frame dispatched)
"""

from __future__ import annotations

import asyncio
import time
import json
import uuid
from typing import TYPE_CHECKING

from loguru import logger

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.frames.frames import FunctionCallInProgressFrame, FunctionCallResultFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair

from ielts.agents.artifacts import SEND_ARTIFACT_SCHEMA, make_send_artifact_handler
from vfdl.pvp.session import BaseVoiceSession, SessionContext
from vfdl.store.interface import E, SessionEvent
from vfdl.ws_transport import FastAPIWSTransport

if TYPE_CHECKING:
    from vfdl.store.interface import SessionStore

ASSISTANT_SYSTEM_PROMPT = """You are a friendly, concise voice assistant for Prepatu, an IELTS speaking practice app.

Your role is to help the user navigate the app by voice. Keep responses SHORT — one or two sentences max.
Do not explain what you are about to do: just do it and briefly confirm.

Available screens you can navigate to:
- Home: the main landing screen
- Interview: start an IELTS practice session (requires interview_type)
- Assistant: back to this assistant

Interview types: part1 (Introduction), part2 (Cue Card), part3 (Discussion), full (Full Mock Test)

If a control channel is available, you may call send_artifact to send UI hints to the frontend:
- artifact_type='intent' with a 1-2 word label (e.g. 'Greeting') to hint the UI before you speak
- artifact_type='navigate' to move the user to a screen
- artifact_type='options' to show a list of choices
- artifact_type='card' to display a summary card
Tool calls are optional — always respond with speech regardless of whether you call a tool.
"""

ONBOARDING_SYSTEM_PROMPT = """You are the voice guide welcoming a brand-new user to Prepatu, an AI-powered IELTS speaking practice app.

## Your goal
Walk the user through a short interactive tour so they arrive at the Home screen feeling confident and excited to practice.

## Conversation flow — follow this sequence exactly

### Step 1 — Warm welcome & name
Greet the user warmly (1–2 sentences). Then ask: "What's your name?"
Wait for them to reply. Use their name in all subsequent speech.

### Step 2 — Show the app around (navigation demo)
Say something like: "Great to meet you, <name>! Let me show you around."
Immediately call send_artifact with artifact_type='navigate', screen='Interview', screen_params={"interviewType": "part1"}.
Then say: "This is where your IELTS practice sessions happen. You speak, I listen and coach."

### Step 3 — Show an example score card artifact
Call send_artifact with artifact_type='card', card_type='score', title='Example Score', content={"band": 6.5, "fluency": 7, "vocabulary": 6, "grammar": 6, "pronunciation": 7, "note": "This is what your feedback will look like after a practice session."}.
Say: "After each session I'll give you a score breakdown like this one."

### Step 4 — Navigate home & offer a choice
Call send_artifact with artifact_type='navigate', screen='Home'.
Say: "You're all set, <name>. Ready to start your first practice session?"
Then call send_artifact with artifact_type='options', prompt='What would you like to do?', options=[{"id": "start_practice", "label": "Start practicing now"}, {"id": "explore", "label": "Not yet, just exploring"}].

## Rules
- Keep each spoken segment short — max 2 sentences before waiting or calling a tool.
- Always speak before and after every tool call so there is no silent gap.
- Use the user's name naturally after step 1.
- Do not skip steps or combine them — the tour must happen in order.
- Never mention that you are an AI or describe yourself as a language model.
"""

INTERVIEW_TYPES = {
    "part1": "Part 1 — Introduction & Interview",
    "part2": "Part 2 — Individual Long Turn (Cue Card)",
    "part3": "Part 3 — Two-way Discussion",
    "full":  "Full Mock Speaking Test",
}

_TOOLS = ToolsSchema(standard_tools=[
    SEND_ARTIFACT_SCHEMA,
    FunctionSchema(
        name="get_session_summary",
        description="Fetch the user's practice session summary from the server, then display it as a card using send_artifact.",
        properties={},
        required=[],
    ),
    FunctionSchema(
        name="show_config",
        description="Fetch the current backend configuration from the server, then display it as a card using send_artifact.",
        properties={},
        required=[],
    ),
])


class AssistantAgent(BaseVoiceSession):
    """PVP-compliant session that runs the voice assistant pipeline."""

    def __init__(self, store: "SessionStore") -> None:
        self._store = store
        self._transport: FastAPIWSTransport | None = None
        self._pipeline_task: asyncio.Task | None = None
        self._llm = None
        # latency instrumentation timestamps (per turn)
        self._t_llm_first_token: float | None = None
        self._t_tool_call_start: float | None = None

    # ── BaseVoiceSession hooks ─────────────────────────────────────────────

    async def on_session_start(self, ctx: SessionContext) -> None:
        await self._store.emit(ctx.session_id, E.CONNECTED, {"mode": "assistant"})
        self._pipeline_task = asyncio.create_task(self._run_pipeline(ctx))

    async def on_audio(self, data: bytes, ctx: SessionContext) -> None:
        if self._transport:
            await self._transport.push_audio(data)

    async def on_message(self, msg: dict, ctx: SessionContext) -> None:
        logger.debug(f"[assistant:{ctx.session_id}] unhandled: {msg.get('type')}")

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
        print("THIS IS THE FIRST LINE OF _run_pipeline", flush=True)
        from pipecat.frames.frames import LLMRunFrame
        from pipecat.pipeline.pipeline import Pipeline
        from pipecat.pipeline.runner import PipelineRunner
        from pipecat.pipeline.task import PipelineParams, PipelineTask
        from pipecat.transports.base_transport import TransportParams
        from pipecat.audio.vad.silero import SileroVADAnalyzer
        from pipecat.audio.vad.vad_analyzer import VADParams
        import ielts.remote_config as rc

        cfg = rc.get_config()

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

        active_tools = _TOOLS if self.control_ws is not None else None
        
        from vfdl.bot import create_pipeline_services
        stt, llm, tts, user_aggregator, assistant_aggregator = create_pipeline_services(
            ASSISTANT_SYSTEM_PROMPT, tools=active_tools
        )
        self._llm = llm

        # Register tool handlers only when tools are active
        if active_tools is not None:
            llm.register_function("send_artifact",      make_send_artifact_handler(self.control_ws, ctx.session_id))
            llm.register_function("get_session_summary", self._tool_get_session_summary(ctx))
            llm.register_function("show_config",         self._tool_show_config(ctx))

        pipeline = Pipeline([
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ])

        from pipecat.pipeline.task import PipelineTask, PipelineParams
        task = PipelineTask(
            pipeline,
            params=PipelineParams(allow_interruptions=True),
            enable_rtvi=False,
        )

        await task.queue_frames([LLMRunFrame()])
        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)

    # ── Tool handlers ──────────────────────────────────────────────────────────────

    def _tool_get_session_summary(self, ctx: SessionContext):
        store = self._store
        async def handler(params):
            t_start = time.time()
            await store.emit(ctx.session_id, E.TOOL_CALL_START, {"tool": "get_session_summary"})
            sessions = await store.list_sessions(limit=20)
            total_secs = 0.0
            per_mode: dict[str, float] = {}
            for s in sessions:
                dur = (s.ended_at or time.time()) - s.started_at
                total_secs += dur
                per_mode[s.mode] = per_mode.get(s.mode, 0.0) + dur
            ws = self.control_ws or ctx.ws
            await ws.send_text(json.dumps({
                "type": "artifact", "id": str(uuid.uuid4()),
                "artifact_type": "card", "cardType": "score",
                "title": "Practice Summary",
                "content": {
                    "total_minutes": round(total_secs / 60, 1),
                    "sessions": len(sessions),
                    "by_mode": {k: round(v / 60, 1) for k, v in per_mode.items()},
                },
            }))
            await store.emit(ctx.session_id, E.TOOL_CALL_END, {
                "tool": "get_session_summary",
                "latency_ms": round((time.time() - t_start) * 1000),
            })
            mins = round(total_secs / 60, 1)
            await params.result_callback(
                f"You've practiced for {mins} minutes across {len(sessions)} sessions."
            )
        return handler

    def _tool_show_config(self, ctx: SessionContext):
        store = self._store
        async def handler(params):
            t_start = time.time()
            await store.emit(ctx.session_id, E.TOOL_CALL_START, {"tool": "show_config"})
            import ielts.remote_config as rc
            cfg = rc.get_config()
            ws = self.control_ws or ctx.ws
            await ws.send_text(json.dumps({
                "type": "artifact", "id": str(uuid.uuid4()),
                "artifact_type": "card", "cardType": "info",
                "title": "Current Configuration",
                "content": {
                    "transport": cfg.transport,
                    "pipeline": cfg.pipeline_mode,
                    "stt": cfg.stt_provider or "deepgram",
                    "tts": cfg.tts_provider or "deepgram",
                    "llm": cfg.llm_provider or "openrouter",
                    "vad_stop_secs": cfg.vad_stop_secs,
                    "audio_sample_rate": cfg.audio_sample_rate,
                    "audio_encoding": cfg.audio_encoding,
                    "allow_upgrade": cfg.allow_upgrade,
                    "maintenance": cfg.maintenance,
                },
            }))
            await store.emit(ctx.session_id, E.TOOL_CALL_END, {
                "tool": "show_config",
                "latency_ms": round((time.time() - t_start) * 1000),
            })
            await params.result_callback(
                f"Using {cfg.transport} transport with {cfg.pipeline_mode} pipeline."
            )
        return handler
