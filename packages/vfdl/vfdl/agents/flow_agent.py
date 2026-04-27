"""
Generic YAML flow agent.

Runs any VFDL flow (a .yaml file) over a single WebSocket voice session.
Everything that defines the agent's behaviour — base system prompt,
state-specific prompts, tool names, tool parameter schemas, and state
transitions — is read from the YAML file at runtime.

No application-specific Python code is required to add a new guided flow.
Just create a new YAML file and pass its directory + name to FlowAgent.

Usage::

    agent = FlowAgent(
        store=_store,
        flow_name="onboarding",
        flows_dir="/path/to/app/agents/flows",
        vad_stop_secs=0.8,
    )
    await agent.run(ws, metadata={"mode": "onboarding", "session_id": sid})
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import TYPE_CHECKING

from loguru import logger
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.transports.base_transport import TransportParams

from vfdl.agents.control_observer import ControlObserver
from vfdl.agents.flow_engine import (
    build_tool_schemas,
    load_flow,
    validate_flow,
    VoiceFlowController,
)
from vfdl.bot import create_pipeline_services
from vfdl.pvp.session import BaseVoiceSession, SessionContext
from vfdl.ws_transport import FastAPIWSTransport

if TYPE_CHECKING:
    from vfdl.store.interface import SessionStore

# Engine-level fallback flows directory (can be overridden per instance).
_DEFAULT_FLOWS_DIR = os.path.join(os.path.dirname(__file__), "flows")


class FlowAgent(BaseVoiceSession):
    """
    Generic PVP-compliant WebSocket session that executes any VFDL flow.

    All agent behaviour (prompts, tool schemas, transitions) is derived
    from the YAML file named ``flow_name`` inside ``flows_dir``.  Python
    code never needs to change when you add or modify a flow — only the YAML.

    Parameters
    ----------
    store:
        Session persistence backend.
    flow_name:
        Stem of the YAML file (without ``.yaml``) to execute.
    flows_dir:
        Directory that contains the flow YAML files.  Defaults to the
        ``flows/`` sub-directory next to this file.  Apps should pass
        their own flows directory so the engine stays content-free.
    vad_stop_secs:
        Seconds of silence before the VAD triggers end-of-utterance.
        Defaults to 0.8 s.  Pass the value from your app's runtime config
        so the engine never imports app-level modules.
    """

    def __init__(
        self,
        store: "SessionStore | None" = None,
        flow_name: str = "onboarding",
        flows_dir: str | None = None,
        vad_stop_secs: float = 0.8,
        # Cloud / multi-tenant extensions
        flow_config: "FlowConfig | None" = None,
        provider_overrides: dict | None = None,
    ) -> None:
        self._store = store
        self._flow_name = flow_name
        self._flows_dir = flows_dir or _DEFAULT_FLOWS_DIR
        self._vad_stop_secs = vad_stop_secs
        # When set, skip file loading and use this directly.
        self._preloaded_flow_config = flow_config
        self._provider_overrides = provider_overrides
        self._transport: FastAPIWSTransport | None = None
        self._pipeline_task: asyncio.Task | None = None
        self._flow_engine: VoiceFlowController | None = None

    # ── BaseVoiceSession hooks ─────────────────────────────────────────────

    async def on_session_start(self, ctx: SessionContext) -> None:
        self._pipeline_task = asyncio.create_task(self._run_pipeline(ctx))
        self._pipeline_task.add_done_callback(
            lambda t: self._log_task_exception(t)
        )

    @staticmethod
    def _log_task_exception(task: asyncio.Task) -> None:
        if not task.cancelled() and task.exception() is not None:
            logger.error(
                f"[FlowAgent] Pipeline task crashed: {task.exception()!r}",
                exc_info=task.exception(),
            )

    async def on_audio(self, data: bytes, ctx: SessionContext) -> None:
        if self._transport:
            await self._transport.push_audio(data)

    async def on_message(self, msg: dict, ctx: SessionContext) -> None:
        """Route ui_event messages to the flow engine; ignore everything else."""
        if msg.get("type") == "ui_event" and self._flow_engine:
            action  = msg.get("action", "")
            payload = msg.get("data") or {}
            await self._flow_engine.handle_ui_event(action, payload)
        else:
            logger.debug(
                f"[flow:{self._flow_name}:{ctx.session_id}] unhandled: {msg.get('type')}"
            )

    async def on_session_end(self, ctx: SessionContext) -> None:
        if self._pipeline_task and not self._pipeline_task.done():
            self._pipeline_task.cancel()
            try:
                await self._pipeline_task
            except (asyncio.CancelledError, Exception) as exc:
                if not isinstance(exc, asyncio.CancelledError):
                    logger.warning(
                        f"[flow:{self._flow_name}:{ctx.session_id}] pipeline ended with: {exc!r}"
                    )
        if self._transport:
            self._transport.mark_closed()

    # ── Pipeline ───────────────────────────────────────────────────────────

    async def _run_pipeline(self, ctx: SessionContext) -> None:
        try:
            await self._run_pipeline_inner(ctx)
        except Exception as exc:
            logger.error(
                f"[flow:{self._flow_name}:{ctx.session_id}] pipeline error: {exc!r}",
                exc_info=True,
            )
            try:
                await ctx.ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
            except Exception:
                pass
            raise

    async def _run_pipeline_inner(self, ctx: SessionContext) -> None:
        # ── 1. Load & validate YAML flow ───────────────────────────────────
        if self._preloaded_flow_config is not None:
            flow_config = self._preloaded_flow_config
        else:
            flow_path = os.path.join(self._flows_dir, f"{self._flow_name}.yaml")
            if not os.path.exists(flow_path):
                logger.error(f"[flow:{self._flow_name}] YAML not found: {flow_path}")
                await ctx.ws.send_text(json.dumps(
                    {"type": "error", "message": f"Flow '{self._flow_name}' not found."}
                ))
                return

            try:
                flow_config = load_flow(flow_path)
            except Exception as exc:
                logger.error(f"[flow:{self._flow_name}] Failed to parse YAML: {exc}")
                await ctx.ws.send_text(json.dumps(
                    {"type": "error", "message": "Flow configuration error."}
                ))
                return

        errors = validate_flow(flow_config, registered_backend_tools=set())
        if errors:
            for e in errors:
                logger.error(f"[flow:{self._flow_name}:{ctx.session_id}] {e}")
            await ctx.ws.send_text(json.dumps(
                {"type": "error", "message": "Flow validation failed."}
            ))
            return

        # ── 2. Base system prompt from YAML settings ───────────────────────
        base_prompt = (flow_config.settings.base_system_prompt or "").strip()
        if not base_prompt:
            base_prompt = f"You are a helpful assistant running the '{flow_config.id}' flow."

        # ── 3. Tool schemas derived entirely from YAML ─────────────────────
        tool_schemas = build_tool_schemas(flow_config)
        tool_names   = [s.name for s in tool_schemas]
        tools        = ToolsSchema(standard_tools=tool_schemas)

        logger.info(
            f"[flow:{self._flow_name}:{ctx.session_id}] "
            f"loaded {len(flow_config.states)} states, {len(tool_schemas)} tools: {tool_names}"
        )

        # ── 4. Build Pipecat transport & pipeline services ─────────────────
        transport = FastAPIWSTransport(
            ws=ctx.ws,
            params=TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                audio_out_sample_rate=ctx.audio_config.sample_rate,
                audio_in_sample_rate=ctx.audio_config.sample_rate,
                audio_out_channels=ctx.audio_config.channels,
                vad_analyzer=SileroVADAnalyzer(
                    params=VADParams(stop_secs=self._vad_stop_secs)
                ),
                vad_audio_passthrough=True,
            ),
        )
        self._transport = transport

        stt, llm, tts, user_aggregator, assistant_aggregator = create_pipeline_services(
            base_prompt, tools=tools, provider_overrides=self._provider_overrides
        )
        context = user_aggregator.context

        # ── 5. Assemble PipelineTask before wiring callbacks ───────────────
        pipeline = Pipeline([
            transport.input(),
            stt,
            user_aggregator,
            llm,
            ControlObserver(ctx.ws),
            tts,
            transport.output(),
            assistant_aggregator,
        ])
        inner_task = PipelineTask(
            pipeline,
            params=PipelineParams(allow_interruptions=True),
            enable_rtvi=False,
        )

        # ── 6. Flow engine callbacks ───────────────────────────────────────
        async def _trigger_llm() -> None:
            await inner_task.queue_frames([LLMRunFrame()])

        async def _send_artifact(payload: dict) -> None:
            msg = {"type": "artifact", "id": str(uuid.uuid4()), **payload}
            logger.info(
                f"[flow:{self._flow_name}:{ctx.session_id}] "
                f"artifact → {payload.get('artifact_type')}"
            )
            try:
                await ctx.ws.send_text(json.dumps(msg))
            except Exception as exc:
                logger.warning(
                    f"[flow:{self._flow_name}:{ctx.session_id}] artifact send failed: {exc}"
                )

        self._flow_engine = VoiceFlowController(
            flow_config=flow_config,
            context=context,
            control_ws=ctx.ws,
            send_artifact_cb=_send_artifact,
            trigger_llm_cb=_trigger_llm,
        )

        # ── 7. Register one shared tool handler for every tool in the flow ─
        async def _tool_handler(params) -> None:
            args  = params.arguments or {}
            name  = params.function_name
            logger.info(
                f"[flow:{self._flow_name}:{ctx.session_id}] tool_call: {name} {args}"
            )
            cue = ""
            if self._flow_engine:
                cue = await self._flow_engine.handle_tool_call(name, args)
            await params.result_callback(cue)

        for name in tool_names:
            llm.register_function(name, _tool_handler)

        # ── 8. Initialise flow: push first artifact + seed LLM context ─────
        await self._flow_engine.initialize(base_prompt)

        # ── 9. Run the pipeline (blocks until session ends) ────────────────
        runner = PipelineRunner(handle_sigint=False)
        await runner.run(inner_task)
