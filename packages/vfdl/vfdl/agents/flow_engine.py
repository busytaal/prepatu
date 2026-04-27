import json
import logging
import re
import yaml
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ── Schemas ────────────────────────────────────────────────────────────────────

class VariableDef(BaseModel):
    type: str = "string"             # string | enum
    enum: Optional[List[str]] = None
    required: bool = False

class UIConfig(BaseModel):
    artifact_type: str
    prompt: Optional[str] = None
    fields: Optional[List[Dict[str, Any]]] = None
    options: Optional[List[Dict[str, Any]]] = None
    position: Optional[str] = None
    screen: Optional[str] = None
    params: Optional[Dict[str, Any]] = None

class AgentConfig(BaseModel):
    prompt: str
    tools: List[str] = Field(default_factory=list)

class ToolParameterDef(BaseModel):
    type: str = "string"
    description: str = ""
    required: bool = False
    enum: Optional[List[str]] = None

class ToolDef(BaseModel):
    description: str = ""
    parameters: Dict[str, ToolParameterDef] = Field(default_factory=dict)
    speech_cue: Optional[str] = None
    """Optional explicit reply the engine passes back to the LLM after this tool
    is called without a state transition.  When absent, the engine auto-generates
    a cue from the remaining unfilled form fields in the current state."""

class FlowSettings(BaseModel):
    base_system_prompt: str = ""
    max_duration_secs: Optional[int] = None
    on_timeout: Optional[str] = None
    on_error: Optional[str] = None

class TransitionsConfig(BaseModel):
    on_tool_call: Dict[str, Any] = Field(default_factory=dict)  # value: str | dict
    on_ui_event: Dict[str, str] = Field(default_factory=dict)
    on_action: Dict[str, Any] = Field(default_factory=dict)   # value: str | {target, set?}

class ConfirmationGate(BaseModel):
    variables: List[str]
    on_confirm: str
    on_reject: Dict[str, str] = Field(default_factory=lambda: {"action": "clear", "target": ""})

class StateConfig(BaseModel):
    ui: Optional[UIConfig] = None
    agent: AgentConfig
    transitions: TransitionsConfig
    confirmation_gate: Optional[ConfirmationGate] = None
    tools: Dict[str, ToolDef] = Field(default_factory=dict)  # per-state tool schemas from YAML

class FlowConfig(BaseModel):
    id: str
    version: str = "1.0.0"
    description: str = ""
    initial_state: str
    variables: Dict[str, VariableDef] = Field(default_factory=dict)
    settings: FlowSettings = Field(default_factory=FlowSettings)
    states: Dict[str, StateConfig]

def load_flow(file_path: str | Path) -> FlowConfig:
    with open(file_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return FlowConfig(**data)


# ── Tool Schema Builder ────────────────────────────────────────────────────────

def build_tool_schemas(flow: "FlowConfig") -> List[Any]:
    """
    Derive FunctionSchema objects for every tool referenced across the flow.

    - Tool parameter schemas come from the per-state `tools:` YAML section.
    - The first definition of a tool name wins (states are iterated in order).
    - Confirmation-gate engine tools (confirm_X / reject_X) get auto-generated stubs.
    - Any tool listed in agent.tools but missing a YAML `tools:` definition gets
      a generic zero-argument stub so the LLM can still call it.
    """
    from pipecat.adapters.schemas.function_schema import FunctionSchema  # local import avoids circular

    seen: set = set()
    schemas: List[FunctionSchema] = []

    # Collect tool definitions — first definition wins across states
    tool_defs: Dict[str, ToolDef] = {}
    for state_cfg in flow.states.values():
        for t_name, tdef in state_cfg.tools.items():
            if t_name not in tool_defs:
                tool_defs[t_name] = tdef

    for state_cfg in flow.states.values():
        # User-defined tools listed in agent.tools
        for t_name in state_cfg.agent.tools:
            if t_name in seen:
                continue
            seen.add(t_name)
            tdef = tool_defs.get(t_name)
            if tdef and tdef.parameters:
                props: Dict[str, Any] = {}
                req: List[str] = []
                for p_name, p in tdef.parameters.items():
                    prop: Dict[str, Any] = {"type": p.type}
                    if p.description:
                        prop["description"] = p.description
                    if p.enum:
                        prop["enum"] = p.enum
                    props[p_name] = prop
                    if p.required:
                        req.append(p_name)
                schemas.append(FunctionSchema(
                    name=t_name,
                    description=(tdef.description or f"Flow tool: {t_name}."),
                    properties=props,
                    required=req,
                ))
            else:
                desc = tdef.description if tdef else f"Flow tool: {t_name}."
                schemas.append(FunctionSchema(
                    name=t_name, description=desc, properties={}, required=[]
                ))

        # Engine-generated confirm_X / reject_X for confirmation gates
        if state_cfg.confirmation_gate:
            for var in state_cfg.confirmation_gate.variables:
                for prefix in ("confirm", "reject"):
                    eng = f"{prefix}_{var}"
                    if eng not in seen:
                        seen.add(eng)
                        schemas.append(FunctionSchema(
                            name=eng,
                            description=f"Flow engine: {eng}.",
                            properties={},
                            required=[],
                        ))

    return schemas


# ── Startup Validator ──────────────────────────────────────────────────────────

KNOWN_ARTIFACT_TYPES = {
    "form", "options", "card", "orb_layout", "navigate",
    "feedback", "dismiss", "custom", "intent",
}

def validate_flow(flow: FlowConfig, registered_backend_tools: set) -> List[str]:
    """
    Validate a flow config before the pipeline starts.
    Returns a list of error strings — empty means valid.
    """
    errors: List[str] = []
    all_states = set(flow.states.keys())

    if flow.initial_state not in all_states:
        errors.append(f"initial_state '{flow.initial_state}' is not defined in states")

    for state_name, state in flow.states.items():
        # Transition targets exist
        for tool_name, raw in state.transitions.on_tool_call.items():
            target = raw if isinstance(raw, str) else raw.get("target", "")
            if target and target not in all_states:
                errors.append(f"[{state_name}] on_tool_call.{tool_name} -> unknown state '{target}'")

        for event, raw_target in state.transitions.on_ui_event.items():
            if raw_target not in all_states:
                errors.append(f"[{state_name}] on_ui_event.{event} -> unknown state '{raw_target}'")

        # Confirmation gate targets exist
        if state.confirmation_gate:
            gate = state.confirmation_gate
            if gate.on_confirm not in all_states:
                errors.append(f"[{state_name}] confirmation_gate.on_confirm -> unknown state '{gate.on_confirm}'")
            reject_target = gate.on_reject.get("target", "")
            if reject_target and reject_target not in all_states:
                errors.append(f"[{state_name}] confirmation_gate.on_reject.target -> unknown state '{reject_target}'")

    return errors


# ── Flow Controller ────────────────────────────────────────────────────────────

class VoiceFlowController:
    """
    Executes a VFDL flow: manages state transitions, LLM context updates,
    UI artifact delivery, variable tracking, and confirmation gates.
    """

    def __init__(
        self,
        flow_config: FlowConfig,
        context: Any,            # Pipecat LLMContext
        control_ws: Any,
        send_artifact_cb: Callable,
        trigger_llm_cb: Callable,
    ):
        self.flow = flow_config
        self.context = context
        self.control_ws = control_ws
        self.send_artifact = send_artifact_cb
        self.trigger_llm = trigger_llm_cb

        self.current_state_name: str = ""
        self.state_data: Dict[str, Any] = {}
        self.base_system_prompt: str = ""
        self._pending_confirmation: bool = False

    # ── Internal helpers ───────────────────────────────────────────────────────

    async def _emit_flow_variable(self, key: str, value: Any) -> None:
        """Notify client immediately when a variable is set."""
        if not self.control_ws:
            return
        try:
            await self.control_ws.send_text(json.dumps({
                "type": "flow_variable",
                "flow_id": self.flow.id,
                "key": key,
                "value": value,
            }))
        except Exception as exc:
            logger.warning(f"[FlowEngine] flow_variable send failed: {exc}")

    async def _emit_transition_blocked(
        self, attempted_target: str, reason: str, detail: str
    ) -> None:
        """
        Notify the client and inject a self-correction message into the LLM
        context so it knows why it was blocked and can recover naturally.
        """
        state_vars = {k: self.state_data.get(k) for k in self.flow.variables}

        # 1. Notify client
        if self.control_ws:
            try:
                await self.control_ws.send_text(json.dumps({
                    "type": "transition_blocked",
                    "flow_id": self.flow.id,
                    "from_state": self.current_state_name,
                    "attempted_target": attempted_target,
                    "reason": reason,
                    "detail": detail,
                    "variables": state_vars,
                }))
            except Exception as exc:
                logger.warning(f"[FlowEngine] transition_blocked send failed: {exc}")

        # 2. Inject self-correction into LLM context
        correction = (
            f"[SYSTEM — flow engine]: Transition to '{attempted_target}' was blocked. "
            f"Reason: {reason}. {detail} "
            f"Current variables: {state_vars}. "
            f"Please handle this naturally in your next response."
        )
        try:
            self.context.messages.append({"role": "system", "content": correction})
        except Exception as exc:
            logger.warning(f"[FlowEngine] LLM context injection failed: {exc}")

    async def _set_variable(self, key: str, value: Any) -> None:
        """Set a flow variable, notify the client, and push a field_update artifact
        if the current state's form has a field whose id matches the variable name."""
        self.state_data[key] = value
        await self._emit_flow_variable(key, value)

        # Auto-emit field_update artifact when the active state has a matching form field.
        # This is the SDUI mechanism: voice populates a UI input without LLM involvement.
        state = self.flow.states.get(self.current_state_name)
        if state and state.ui and state.ui.artifact_type == "form" and state.ui.fields:
            field_ids = [f.get("id") for f in state.ui.fields if isinstance(f, dict)]
            if key in field_ids:
                await self.send_artifact({
                    "artifact_type": "field_update",
                    "field_id": key,
                    "value": value,
                })

    # ── Public interface ───────────────────────────────────────────────────────

    async def handle_user_utterance(self, text: str) -> None:
        """
        Called on each STT transcript. The LLM handles NLU.
        The engine only enforces state invariants — no hardcoded phrase matching.
        """
        pass  # Intentionally empty — LLM is responsible for NLU

    async def initialize(self, base_system_prompt: str) -> None:
        self.base_system_prompt = base_system_prompt
        await self.enter_state(self.flow.initial_state)

    async def enter_state(self, state_name: str) -> None:
        if state_name not in self.flow.states:
            logger.error(f"[FlowEngine] State '{state_name}' not found in flow '{self.flow.id}'.")
            return

        self.current_state_name = state_name
        self._pending_confirmation = False
        state = self.flow.states[state_name]
        logger.info(f"[FlowEngine] Entering state: {state_name}")

        if state.ui:
            await self._push_ui(state.ui)

        await self._update_agent(state.agent, state.confirmation_gate)

    async def _push_ui(self, ui: UIConfig) -> None:
        payload: Dict[str, Any] = {"artifact_type": ui.artifact_type}
        if ui.prompt:
            try:
                payload["prompt"] = ui.prompt.format(**self.state_data)
            except KeyError:
                payload["prompt"] = ui.prompt
        if ui.fields:   payload["fields"] = ui.fields
        if ui.options:  payload["options"] = ui.options
        if ui.position: payload["position"] = ui.position
        if ui.screen:   payload["screen"] = ui.screen
        if ui.params:   payload["params"] = ui.params
        await self.send_artifact(payload)

    async def _update_agent(
        self, agent: AgentConfig, gate: Optional[ConfirmationGate] = None
    ) -> None:
        try:
            formatted_prompt = agent.prompt.format(**self.state_data)
        except KeyError:
            formatted_prompt = agent.prompt

        gate_hint = ""
        if gate:
            confirm_tools = " / ".join(f"`confirm_{v}()`" for v in gate.variables)
            reject_tools  = " / ".join(f"`reject_{v}()`"  for v in gate.variables)
            gate_hint = (
                f"\n\n[FLOW ENGINE]: After the user provides "
                f"{', '.join(gate.variables)}, ask them to confirm. "
                f"Call {confirm_tools} when they say yes. "
                f"Call {reject_tools} if they want to change it. "
                f"Do NOT advance the flow until you call one of these tools."
            )

        combined = (
            f"{self.base_system_prompt}\n\n[CURRENT OBJECTIVE]\n{formatted_prompt}{gate_hint}"
        )
        messages = self.context.messages
        if messages and messages[0].get("role") == "system":
            messages[0]["content"] = combined
        else:
            messages.insert(0, {"role": "system", "content": combined})

        messages.append({"role": "system", "content": "You just entered a new step. " + formatted_prompt})
        await self.trigger_llm()

    async def handle_ui_event(self, event_name: str, payload: Dict[str, Any]) -> None:
        """UI events always win — they bypass confirmation gates."""
        state = self.flow.states.get(self.current_state_name)
        if not state:
            return

        # Special: validation error — inject reminder into LLM without state change
        if event_name == "form_validation_error":
            missing = payload.get("missing_fields", "required fields")
            reminder = (
                f"[UI]: The user tapped Continue but '{missing}' still needs to be filled in. "
                f"In one brief friendly sentence, remind them to say or type the missing information."
            )
            try:
                self.context.messages.append({"role": "system", "content": reminder})
                await self.trigger_llm()
            except Exception as exc:
                logger.warning(f"[FlowEngine] form_validation_error handling failed: {exc}")
            return

        for k, v in payload.items():
            await self._set_variable(k, v)

        next_state = state.transitions.on_ui_event.get(event_name)
        if next_state:
            self._pending_confirmation = False
            await self.enter_state(next_state)
            return

        raw_action = state.transitions.on_action.get(event_name)
        if raw_action:
            # on_action value can be: str (target only) or dict {target, set: {k: v}}
            if isinstance(raw_action, dict):
                for k, v in (raw_action.get("set") or {}).items():
                    await self._set_variable(k, v)
                next_state_action = raw_action.get("target")
            else:
                next_state_action = raw_action
            if next_state_action:
                self._pending_confirmation = False
                await self.enter_state(next_state_action)

    def _auto_speech_cue(self, tool_name: str) -> str:
        """Generate a speech cue from the remaining unfilled form fields in the
        current state, or fall back to the tool's explicit speech_cue if set.

        Called only for tools that do NOT trigger a state transition."""
        state = self.flow.states.get(self.current_state_name)
        if not state:
            return "Got it. Please continue."

        # Explicit override wins.
        tdef = state.tools.get(tool_name)
        if tdef and tdef.speech_cue:
            return tdef.speech_cue

        # Auto-generate from remaining unfilled form fields.
        if state.ui and state.ui.artifact_type == "form" and state.ui.fields:
            missing = [
                f.get("label") or f.get("id", "?")
                for f in state.ui.fields
                if isinstance(f, dict) and not self.state_data.get(f.get("id", ""))
            ]
            if not missing:
                return "Got it, all fields are captured."
            if len(missing) == 1:
                return f"Got it! Now could you please provide your {missing[0]}?"
            listed = ", ".join(missing[:-1]) + f" and {missing[-1]}"
            return f"Got it! I still need your {listed}."

        return "Got it. Please continue."

    async def handle_tool_call(self, tool_name: str, args: Dict[str, Any]) -> str:
        """Called when the LLM triggers a tool.

        Returns a speech cue string to pass to result_callback:
        - Empty string when a state transition fires (the new state's
          _update_agent / trigger_llm drives the next voice turn).
        - A non-empty cue when no transition fires (capture tools etc.),
          so the LLM immediately generates a follow-up voice turn.
        """
        state = self.flow.states.get(self.current_state_name)
        if not state:
            return

        gate = state.confirmation_gate

        # ── Engine-generated confirm/reject tools ──────────────────────────────
        if gate:
            for var in gate.variables:
                if tool_name == f"confirm_{var}":
                    if self._pending_confirmation:
                        logger.info(f"[FlowEngine] {tool_name} → {gate.on_confirm}")
                        self._pending_confirmation = False
                        await self.enter_state(gate.on_confirm)
                    else:
                        logger.warning(f"[FlowEngine] {tool_name} called but gate not active")
                    return ""

                if tool_name == f"reject_{var}":
                    logger.info(f"[FlowEngine] {tool_name} — clearing {var}")
                    await self._set_variable(var, None)
                    self._pending_confirmation = False
                    target = gate.on_reject.get("target") or self.current_state_name
                    await self.enter_state(target)
                    return ""

        # ── Block normal transitions while confirmation is pending ─────────────
        if self._pending_confirmation:
            raw = state.transitions.on_tool_call.get(tool_name)
            attempted = raw if isinstance(raw, str) else (raw.get("target", "?") if raw else "?")
            gate_vars = gate.variables if gate else []
            await self._emit_transition_blocked(
                attempted_target=attempted,
                reason="pending_confirmation",
                detail=f"Variable(s) {gate_vars} captured but not yet confirmed by the user.",
            )
            return ""

        # ── Regular tool call — save args, check gate activation ──────────────
        for k, v in args.items():
            if v is not None:
                await self._set_variable(k, v)

        # If a confirmation_gate is declared and all its variables are now set,
        # enter pending_confirmation — the LLM will ask for confirmation naturally.
        if gate:
            gate_vars_set = all(self.state_data.get(v) for v in gate.variables)
            if gate_vars_set and not self._pending_confirmation:
                logger.info(f"[FlowEngine] Gate variables {gate.variables} set — pending confirmation")
                self._pending_confirmation = True
                return self._auto_speech_cue(tool_name)

        # ── Normal transition ──────────────────────────────────────────────────
        raw = state.transitions.on_tool_call.get(tool_name)
        if raw:
            next_state = raw if isinstance(raw, str) else raw.get("target")
            if next_state:
                await self.enter_state(next_state)
                return ""

        # ── No transition — capture tool ───────────────────────────────────────
        # Variables already saved above. Return a speech cue so the LLM
        # immediately generates a follow-up voice turn.
        return self._auto_speech_cue(tool_name)
