"""
Pipecat bot pipeline.

Pipeline:  Transport → STT → LLM → TTS → Transport
VAD is handled by SileroVADAnalyzer inside the transport input params.

Exports:
  run_bot(connection, system_prompt)   — WebRTC session (existing)
  create_pipeline_services(prompt)     — returns (stt, llm, tts, context, aggregator)
  extract_context_messages(aggregator) — snapshot current message history
"""

import asyncio
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

from vfdl.providers import create_llm, create_stt, create_tts
from vfdl.agents.flow_engine import VoiceFlowController, load_flow
from vfdl.agents.control_observer import ControlObserver


def create_pipeline_services(
    system_prompt: str,
    prior_messages: list[dict] | None = None,
    tools=None,
    provider_overrides: dict | None = None,
):
    """
    Create STT / LLM / TTS services and an LLM context pre-loaded with
    system_prompt and any prior_messages (for context continuity on transport switch).

    provider_overrides: optional dict with per-account keys (see vfdl.providers).
    Returns (stt, llm, tts, user_aggregator, assistant_aggregator).
    """
    stt = create_stt(provider_overrides)
    llm = create_llm(provider_overrides)
    tts = create_tts(provider_overrides)

    messages = [{"role": "system", "content": system_prompt}]
    if prior_messages:
        # Exclude any existing system message from prior context — keep ours
        messages += [m for m in prior_messages if m.get("role") != "system"]

    context = LLMContext(messages=messages, tools=tools) if tools is not None else LLMContext(messages=messages)  # type: ignore[arg-type]
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)
    return stt, llm, tts, user_aggregator, assistant_aggregator


def extract_context_messages(context: LLMContext) -> list[dict]:
    """Snapshot the current LLM message history for transfer to a new pipeline."""
    try:
        return list(context.messages)  # type: ignore[return-value]
    except Exception:
        return []


async def run_bot(
    connection: SmallWebRTCConnection,
    system_prompt: str,
    tools=None,
    control_ws=None,
    ui_events=None,
    mode: str = "assistant",
    interview_type: str = "part1",
    program_id: str | None = None,
    store=None,
    session_id: str | None = None,
    vad_stop_secs: float = 0.8,
    flows_dir: str | None = None,
    scoring_callback=None,
) -> None:
    """
    Create and run a Pipecat pipeline for one WebRTC session.
    Blocks until the session ends.

    Parameters
    ----------
    vad_stop_secs:
        Seconds of silence before VAD triggers end-of-utterance.  Pass the
        current runtime value from your app's config system.
    flows_dir:
        Directory containing VFDL YAML flow files.  Required when mode is
        ``'onboarding'`` or ``'program'``.  Pass ``str(FLOWS_DIR)`` from app.
    scoring_callback:
        Optional ``async (session_id: str, messages: list[dict]) -> None``
        invoked when the session ends.  The app uses this to trigger
        post-session scoring without the engine importing evaluator code.
    """
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=vad_stop_secs)),
            vad_audio_passthrough=True,
        ),
    )

    def get_context():
        return user_aggregator.context

    from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
    from pipecat.frames.frames import Frame, TextFrame, AudioRawFrame, TranscriptionFrame, LLMMessagesFrame, LLMRunFrame
    
    class DebugObserver(FrameProcessor):
        def __init__(self, label: str):
            super().__init__(name=label)
            self._label = label

        async def process_frame(self, frame: Frame, direction: FrameDirection):
            # Keep FrameProcessor lifecycle state in sync (StartFrame, cancel, etc.)
            # before forwarding frames downstream.
            await super().process_frame(frame, direction)

            frame_name = frame.__class__.__name__
            if frame_name not in ["InputAudioRawFrame", "OutputAudioRawFrame", "SilenceFrame", "VADParamsUpdateFrame"]:
                content = ""
                if isinstance(frame, TextFrame):
                    content = f"Text='{frame.text[:50]}...'"
                elif isinstance(frame, TranscriptionFrame):
                    content = f"Transcription='{frame.text[:50]}...'"
                elif isinstance(frame, LLMMessagesFrame):
                    content = f"Messages={len(frame.messages)}"
                logger.debug(f"[{self._label}] {direction.name}: {frame_name} {content}")
            
            await self.push_frame(frame, direction)

    class PassthroughBridge(FrameProcessor):
        def __init__(self):
            super().__init__(name="FlowPassthrough")

        async def process_frame(self, frame: Frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            await self.push_frame(frame, direction)

    class FlowSpeechBridge(FrameProcessor):
        def __init__(self, engine: VoiceFlowController | None):
            super().__init__(name="FlowSpeechBridge")
            self._engine = engine

        async def process_frame(self, frame: Frame, direction: FrameDirection):
            await super().process_frame(frame, direction)

            if (
                self._engine
                and direction == FrameDirection.DOWNSTREAM
                and isinstance(frame, TranscriptionFrame)
                and isinstance(frame.text, str)
                and frame.text.strip()
            ):
                try:
                    await self._engine.handle_user_utterance(frame.text)
                except Exception as exc:
                    logger.warning(f"[run_bot] flow speech bridge error: {exc}")

            await self.push_frame(frame, direction)

    stt, llm, tts, user_aggregator, assistant_aggregator = create_pipeline_services(system_prompt, tools=tools)
    
    context = get_context()

    flow_engine = None
    _base_prompt = None
    if mode == "onboarding":
        import os as _os
        import uuid as _uuid2
        import json as _json2
        from vfdl.agents.flow_engine import (
            build_tool_schemas as _build_schemas,
            validate_flow as _validate_flow,
        )
        from pipecat.adapters.schemas.tools_schema import ToolsSchema as _ToolsSchema

        flow_path = _os.path.join(flows_dir, "onboarding.yaml") if flows_dir else ""
        try:
            flow_config_data = load_flow(flow_path)
        except Exception as _exc:
            logger.error(f"[run_bot] Failed to load onboarding YAML: {_exc}")
            flow_config_data = None  # type: ignore[assignment]

        if flow_config_data is not None:
            validation_errors = _validate_flow(flow_config_data, registered_backend_tools=set())
            if validation_errors:
                for _e in validation_errors:
                    logger.error(f"[run_bot] Flow validation: {_e}")
                flow_config_data = None  # type: ignore[assignment]

        if flow_config_data is not None:
            # Derive base system prompt from YAML
            _base_prompt = (flow_config_data.settings.base_system_prompt or "").strip()
            if not _base_prompt:
                _base_prompt = "You are a helpful onboarding assistant."

            # Derive all tool schemas from YAML — no hardcoded registry
            _tool_schemas = _build_schemas(flow_config_data)
            _tool_names   = [s.name for s in _tool_schemas]

            # Re-create context with YAML base prompt and YAML tool schemas
            stt, llm, tts, user_aggregator, assistant_aggregator = create_pipeline_services(
                _base_prompt, tools=_ToolsSchema(standard_tools=_tool_schemas)
            )
            context = user_aggregator.context

            async def _trigger_llm():
                await task.queue_frames([LLMRunFrame()])

            async def _send_ui(payload):
                _ws = control_ws
                if not _ws:
                    logger.warning("[run_bot] onboarding artifact dropped: control_ws unavailable")
                    return
                try:
                    await _ws.send_text(_json2.dumps(
                        {"type": "artifact", "id": str(_uuid2.uuid4()), **payload}
                    ))
                except Exception as _exc2:
                    logger.warning(f"[run_bot] onboarding artifact send failed: {_exc2}")

            flow_engine = VoiceFlowController(
                flow_config=flow_config_data,
                context=context,
                control_ws=control_ws,
                send_artifact_cb=_send_ui,
                trigger_llm_cb=_trigger_llm,
            )

            async def _handle_flow_tool(params):
                args = params.arguments or {}
                if flow_engine:
                    await flow_engine.handle_tool_call(params.function_name, args)
                await params.result_callback("ok")

            for _t in _tool_names:
                llm.register_function(_t, _handle_flow_tool)

    elif mode == "program" and program_id:
        import os as _os
        import json as _json_prog
        import uuid as _uuid_prog
        import yaml as _yaml_prog
        from pathlib import Path as _Path_prog
        from vfdl.agents.flow_engine import (
            build_tool_schemas as _build_schemas_p,
            validate_flow as _validate_flow_p,
        )
        from pipecat.adapters.schemas.tools_schema import ToolsSchema as _ToolsSchema_p

        _flows_dir = _Path_prog(flows_dir) if flows_dir else _Path_prog(__file__).parent / "flows"
        _programs_path = _flows_dir / "programs.yaml"
        _program_meta = None
        _flow_name_p = None
        _scoring_p = None
        try:
            with open(_programs_path, encoding="utf-8") as _pf:
                _programs_data = _yaml_prog.safe_load(_pf)
            _program_meta = next(
                (p for p in (_programs_data or {}).get("programs", []) if p["id"] == program_id),
                None,
            )
            if _program_meta:
                _flow_name_p = _program_meta.get("flow")
                _scoring_p   = _program_meta.get("scoring")
        except Exception as _exc_p:
            logger.error(f"[run_bot] Failed to load programs.yaml: {_exc_p}")

        if _flow_name_p:
            _flow_path_p = _flows_dir / f"{_flow_name_p}.yaml"
            try:
                flow_config_data = load_flow(str(_flow_path_p))
            except Exception as _exc_p2:
                logger.error(f"[run_bot] Failed to load flow {_flow_name_p}: {_exc_p2}")
                flow_config_data = None  # type: ignore[assignment]

            if flow_config_data is not None:
                _errors_p = _validate_flow_p(flow_config_data, registered_backend_tools=set())
                if _errors_p:
                    for _e_p in _errors_p:
                        logger.error(f"[run_bot] Flow validation ({_flow_name_p}): {_e_p}")
                    flow_config_data = None  # type: ignore[assignment]

            if flow_config_data is not None:
                _base_prompt_p = (flow_config_data.settings.base_system_prompt or "").strip()
                if not _base_prompt_p:
                    _base_prompt_p = "You are a helpful language practice assistant."
                _base_prompt = _base_prompt_p

                _tool_schemas_p = _build_schemas_p(flow_config_data)
                _tool_names_p   = [s.name for s in _tool_schemas_p]

                stt, llm, tts, user_aggregator, assistant_aggregator = create_pipeline_services(
                    _base_prompt_p, tools=_ToolsSchema_p(standard_tools=_tool_schemas_p)
                )
                context = user_aggregator.context

                async def _trigger_llm_p():
                    await task.queue_frames([LLMRunFrame()])

                async def _send_ui_p(payload):
                    _ws_p = control_ws
                    if not _ws_p:
                        logger.warning("[run_bot] program artifact dropped: control_ws unavailable")
                        return
                    try:
                        await _ws_p.send_text(_json_prog.dumps(
                            {"type": "artifact", "id": str(_uuid_prog.uuid4()), **payload}
                        ))
                    except Exception as _exc_p3:
                        logger.warning(f"[run_bot] program artifact send failed: {_exc_p3}")

                flow_engine = VoiceFlowController(
                    flow_config=flow_config_data,
                    context=context,
                    control_ws=control_ws,
                    send_artifact_cb=_send_ui_p,
                    trigger_llm_cb=_trigger_llm_p,
                )

                async def _handle_flow_tool_p(params):
                    args = params.arguments or {}
                    if flow_engine:
                        await flow_engine.handle_tool_call(params.function_name, args)
                    await params.result_callback("ok")

                for _t_p in _tool_names_p:
                    llm.register_function(_t_p, _handle_flow_tool_p)

    # Register tool handlers whenever tools are provided.
    # Artifacts are sent over control_ws if available; otherwise a warning is logged.
    # The tool call still completes so the pipeline never stalls.
    if tools is not None:
        import json as _json
        import uuid as _uuid

        async def _send(payload: dict):
            if control_ws is None:
                logger.warning(
                    f"[run_bot] send_artifact called but control_ws is not initialized "
                    f"(session has no control channel). Artifact dropped: {payload.get('artifact_type')}"
                )
                return
            try:
                await control_ws.send_text(_json.dumps(payload))
            except Exception as exc:
                logger.warning(f"[run_bot] control_ws send failed: {exc}")

        async def _handle_send_artifact(params):
            args = params.arguments or {}
            artifact_type = args.get("artifact_type", "intent")
            payload = {k: v for k, v in args.items() if k != "artifact_type"}
            if "screen_params" in payload:
                payload["params"] = payload.pop("screen_params")
            await _send({"type": "artifact", "id": str(_uuid.uuid4()), "artifact_type": artifact_type, **payload})
            # Return a speech cue so the LLM narrates what appeared on screen
            if artifact_type == "intent":
                cue = ""
            elif artifact_type == "navigate":
                screen = payload.get("screen", "the screen")
                cue = f"[UI: navigating to {screen}] Speak one short confirmation."
            elif artifact_type == "options":
                prompt_text = payload.get("prompt", "")
                labels = ", ".join(o.get("label", "") for o in (payload.get("options") or []))
                cue = (
                    f"[UI: options displayed — '{prompt_text}' with choices: {labels}] "
                    "Read these options aloud to the user in a natural, friendly sentence."
                )
            elif artifact_type == "card":
                title = payload.get("title", "info card")
                cue = f"[UI: card '{title}' displayed] Briefly summarise the card for the user."
            else:
                cue = "[UI updated] Acknowledge briefly."
            await params.result_callback(cue)

        async def _handle_end_interview(params):
            await _send({"type": "artifact", "id": str(_uuid.uuid4()), "artifact_type": "navigate",
                         "screen": "Home", "params": {}})
            await params.result_callback("Interview ended.")

        async def _handle_noop(params):
            await params.result_callback("Done.")

        handler_map = {
            "send_artifact":      _handle_send_artifact,
            "end_interview":      _handle_end_interview,
            "get_session_summary": _handle_noop,
            "show_config":        _handle_noop,
        }
        for name, handler in handler_map.items():
            llm.register_function(name, handler)

    pipeline = Pipeline(
        [
            transport.input(),
            DebugObserver("A_AfterTransport"),
            stt,
            DebugObserver("B_AfterSTT"),
            # Feed recognized speech directly into onboarding flow transitions
            # so UI updates still occur when tool calls are sparse.
            FlowSpeechBridge(flow_engine) if flow_engine else PassthroughBridge(),
            user_aggregator,
            DebugObserver("C_AfterUserAggregator"),
            llm,
            DebugObserver("D_AfterLLM"),
            ControlObserver(control_ws),
            tts,
            DebugObserver("E_AfterTTS"),
            transport.output(),
            assistant_aggregator,
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True),
        enable_rtvi=False,
    )

    @transport.event_handler("on_client_connected")
    async def on_connected(t, conn):
        logger.info("WebRTC client connected")
        if flow_engine:
            await flow_engine.initialize(_base_prompt)
        else:
            await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(t, conn):
        logger.info("WebRTC client disconnected")
        if scoring_callback and session_id:
            try:
                _msgs = list(context.messages) if context else []
                asyncio.create_task(scoring_callback(session_id, _msgs))
            except Exception as _eval_exc:
                logger.warning(f"[run_bot] scoring_callback failed: {_eval_exc}")
        if 'event_task' in locals():
            event_task.cancel()
        await task.cancel()

    async def process_ui_events():
        if not ui_events or not flow_engine: return
        while True:
            try:
                evt = await ui_events.get()
                action_name = evt.get("action")
                action_data = evt.get("data", {})
                await flow_engine.handle_ui_event(action_name, action_data)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error processing UI event: {e}")

    event_task = asyncio.create_task(process_ui_events())

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)
