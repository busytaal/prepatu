import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path
from pydantic import BaseModel
from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import FileResponse, JSONResponse
from loguru import logger

import ielts.remote_config as rc
from ielts.ielts_prompts import get_system_prompt
from ielts.config import SYSTEM_PROMPT, SYSTEM_PROMPT_FILE
from vfdl.store_instance import store
from vfdl.api import rtc_handler
from vfdl.bot import run_bot
from vfdl.agents.flow_agent import FlowAgent
from ielts.agents.assistant import AssistantAgent, ASSISTANT_SYSTEM_PROMPT
from ielts.agents.interview import InterviewAgent
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCRequest,
    SmallWebRTCPatchRequest,
    IceCandidate,
)

app_router = APIRouter(tags=["App"])

TEMPLATES_DIR = Path(__file__).parent / "templates"
FLOWS_DIR = Path(__file__).parent / "agents" / "flows"

INTERVIEW_TYPES = {
    "idle": "Idle — available when needed",
    "part1": "Part 1 — Introduction & Interview",
    "part2": "Part 2 — Individual Long Turn (Cue Card)",
    "part3": "Part 3 — Two-way Discussion",
    "full": "Full Mock Speaking Test (Parts 1, 2 & 3)",
}

# ── Remote config endpoints ────────────────────────────────────────────────────

@app_router.get("/config")
async def client_config():
    """Public endpoint — minimal runtime flags the client SDK needs."""
    return rc.public_dict()

@app_router.get("/admin/config")
async def admin_config_get():
    """Full config including provider overrides."""
    return rc.as_dict()

@app_router.post("/admin/config")
async def admin_config_post(request: Request):
    """Update config and flush to disk."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)
    updated = rc.update_config(body)
    return rc.as_dict(updated)

@app_router.get("/admin")
@app_router.get("/test")
@app_router.get("/turn_test")
async def serve_admin_pages(request: Request):
    if "turn_test" in request.url.path:
        return FileResponse(TEMPLATES_DIR / "turn_test.html")
    if "admin" in request.url.path:
        return FileResponse(TEMPLATES_DIR / "admin.html")
    return FileResponse(TEMPLATES_DIR / "test.html")

# ── Flow Editor API ────────────────────────────────────────────────────────────

@app_router.get("/flow-editor")
async def flow_editor_page():
    return FileResponse(TEMPLATES_DIR / "flow_editor.html")

@app_router.get("/flows")
async def list_flows():
    """List all available flow YAML files."""
    files = [f.stem for f in FLOWS_DIR.glob("*.yaml")]
    return {"flows": files}

@app_router.get("/flows/{name}")
async def get_flow(name: str):
    """Return a flow's YAML content as JSON-friendly dict."""
    import yaml as _yaml
    path = FLOWS_DIR / f"{name}.yaml"
    if not path.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    with open(path, encoding="utf-8") as f:
        data = _yaml.safe_load(f)
    return data

@app_router.post("/flows/{name}")
async def save_flow(name: str, request: Request):
    """Save a flow from a JSON body back to YAML."""
    import yaml as _yaml
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)
    path = FLOWS_DIR / f"{name}.yaml"
    with open(path, "w", encoding="utf-8") as f:
        _yaml.dump(body, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    return {"ok": True, "saved": name}

@app_router.get("/interview-types")
async def interview_types():
    return {"types": [{"id": k, "label": v} for k, v in INTERVIEW_TYPES.items()]}

# ── Language programs ─────────────────────────────────────────────────────────

@app_router.get("/programs")
async def get_programs():
    """Return the server-defined practice program catalog."""
    import yaml as _yaml
    path = FLOWS_DIR / "programs.yaml"
    if not path.exists():
        return {"programs": []}
    with open(path, encoding="utf-8") as f:
        data = _yaml.safe_load(f)
    return data or {"programs": []}

# ── User profile ──────────────────────────────────────────────────────────────

@app_router.get("/profile")
async def get_profile(device_id: str):
    if not device_id:
        return JSONResponse({"error": "device_id required"}, status_code=400)
    profile = await store.get_profile(device_id)
    if profile is None:
        # Auto-create with defaults
        profile = await store.upsert_profile(device_id)
    return profile

@app_router.patch("/profile")
async def patch_profile(request: Request):
    body = await request.json()
    device_id = body.get("device_id", "").strip()
    if not device_id:
        return JSONResponse({"error": "device_id required"}, status_code=400)
    profile = await store.upsert_profile(
        device_id=device_id,
        name=body.get("name"),
        target_band=body.get("target_band"),
        active_program=body.get("active_program"),
    )
    return profile

@app_router.get("/sessions")
async def list_sessions_for_device(
    device_id: str,
    program_id: str | None = None,
    limit: int = 50,
):
    if not device_id:
        return JSONResponse({"error": "device_id required"}, status_code=400)
    sessions = await store.list_sessions_for_device(
        device_id, program_id=program_id, limit=limit
    )
    return {"sessions": sessions}


# ── Voice session state (shared between /ws control channel and /offer) ────────

_control_channels: dict[str, WebSocket] = {}
_ui_event_queues: dict[str, asyncio.Queue] = {}


# ── Context preamble builder ───────────────────────────────────────────────────

async def _build_context_preamble(device_id: str | None) -> str:
    """Fetch recent user context events and return a compact system-prompt preamble."""
    if not device_id:
        return ""
    try:
        events = await store.get_user_context(device_id, limit=15)
    except Exception:
        return ""
    if not events:
        return ""
    lines: list[str] = []
    for ev in reversed(events):
        ts = datetime.fromtimestamp(ev["ts"]).strftime("%Y-%m-%d %H:%M")
        data = ev["data"]
        etype = ev["event_type"]
        if etype == "onboarding_completed":
            lines.append(f"[{ts}] User completed onboarding.")
        elif etype == "screen_visited":
            lines.append(f"[{ts}] User visited screen: {data.get('screen', '?')}.")
        elif etype == "session_completed":
            m = data.get("mode", "?")
            itype = data.get("interview_type")
            suffix = f" ({itype})" if itype else ""
            lines.append(f"[{ts}] Completed {m} session{suffix}.")
        elif etype == "session_started":
            lines.append(f"[{ts}] Started {data.get('mode', '?')} session.")
    if not lines:
        return ""
    return (
        "## User history (most recent activity — use to personalise your greeting):\n"
        + "\n".join(lines)
        + "\n\n"
    )


# ── WebRTC signalling ──────────────────────────────────────────────────────────

class OfferRequest(BaseModel):
    sdp: str
    type: str
    pc_id: str | None = None
    restart_pc: bool | None = None


class IcePatchRequest(BaseModel):
    pc_id: str | None = None
    candidates: list[dict]


@app_router.post("/offer")
async def webrtc_offer(
    body: OfferRequest,
    mode: str = "interview",
    interview_type: str = "part1",
    session_id: str | None = None,
    device_id: str | None = None,
    program_id: str | None = None,
):
    sid = session_id
    if interview_type not in INTERVIEW_TYPES:
        interview_type = "part1"

    context_preamble = await _build_context_preamble(device_id)

    if SYSTEM_PROMPT:
        system_prompt = SYSTEM_PROMPT
        tools = None
    elif SYSTEM_PROMPT_FILE:
        system_prompt = Path(SYSTEM_PROMPT_FILE).read_text(encoding="utf-8")
        tools = None
    elif mode == "onboarding":
        system_prompt = context_preamble + "You are an AI onboarding agent."
        tools = None
    elif mode == "program":
        system_prompt = context_preamble + "You are a language practice assistant."
        tools = None
    elif mode == "assistant":
        from ielts.agents.assistant import _TOOLS as _ASSISTANT_TOOLS
        system_prompt = context_preamble + ASSISTANT_SYSTEM_PROMPT
        tools = _ASSISTANT_TOOLS
    else:
        from ielts.agents.interview import _TOOLS_WITH_ARTIFACTS as _INTERVIEW_TOOLS
        system_prompt = context_preamble + get_system_prompt(interview_type)
        tools = _INTERVIEW_TOOLS

    request = SmallWebRTCRequest(
        sdp=body.sdp,
        type=body.type,
        pc_id=body.pc_id,
        restart_pc=body.restart_pc,
    )

    async def on_connection(connection):
        control_ws = _control_channels.get(sid) if sid else None
        ui_events = _ui_event_queues.get(sid) if sid else None
        cfg = rc.get_config()

        _scoring_callback = None
        if mode == "program" and program_id and store and sid:
            import yaml as _yaml_sc
            try:
                _progs_data = _yaml_sc.safe_load(
                    (FLOWS_DIR / "programs.yaml").read_text(encoding="utf-8")
                ) or {}
                _prog = next(
                    (p for p in _progs_data.get("programs", []) if p["id"] == program_id), None
                )
                if _prog and _prog.get("scoring") == "ielts":
                    from ielts.agents.evaluator import evaluate_ielts
                    _sid = sid
                    _store = store
                    _prog_id = program_id
                    async def _scoring_callback(session_id: str, messages: list):
                        asyncio.create_task(evaluate_ielts(session_id, messages, _store, _prog_id))
                        logger.info(f"[/offer] scheduled IELTS evaluation for {session_id}")
            except Exception as _sc_exc:
                logger.warning(f"[/offer] Could not build scoring callback: {_sc_exc}")

        asyncio.create_task(
            run_bot(
                connection, system_prompt, tools=tools,
                control_ws=control_ws, ui_events=ui_events,
                mode=mode, interview_type=interview_type,
                program_id=program_id, store=store, session_id=sid,
                vad_stop_secs=cfg.vad_stop_secs,
                flows_dir=str(FLOWS_DIR),
                scoring_callback=_scoring_callback,
            )
        )

    try:
        answer = await rtc_handler.handle_web_request(request, on_connection)
        if answer is None:
            return JSONResponse({"error": "offer processing returned no answer"}, status_code=500)
        return JSONResponse(answer)
    except Exception as exc:
        logger.exception("/offer failed")
        return JSONResponse({"error": "offer processing failed", "detail": str(exc)}, status_code=500)


@app_router.patch("/offer/{pc_id}")
async def webrtc_ice(pc_id: str, body: IcePatchRequest):
    candidates = [
        IceCandidate(
            candidate=c["candidate"],
            sdp_mid=c["sdpMid"],
            sdp_mline_index=c["sdpMLineIndex"],
        )
        for c in body.candidates
    ]
    patch = SmallWebRTCPatchRequest(pc_id=pc_id, candidates=candidates)
    try:
        await rtc_handler.handle_patch_request(patch)
        return {"status": "ok"}
    except Exception as exc:
        logger.exception(f"/offer/{pc_id} ICE patch failed")
        return JSONResponse({"error": "ICE patch failed", "detail": str(exc)}, status_code=500)


# ── WebSocket voice session ────────────────────────────────────────────────────

@app_router.websocket("/ws")
async def websocket_voice(
    ws: WebSocket,
    mode: str = "interview",
    interview_type: str = "part1",
    session_id: str | None = None,
    device_id: str | None = None,
    program_id: str | None = None,
):
    sid = session_id or str(uuid.uuid4())

    if mode == "control":
        await ws.accept()
        _control_channels[sid] = ws
        _ui_event_queues[sid] = asyncio.Queue()
        logger.info(f"[{sid}] control channel opened")
        await ws.send_text(json.dumps({"type": "status", "status": "idle"}))
        try:
            while True:
                frame = await ws.receive()
                if frame["type"] == "websocket.disconnect":
                    break
                if frame.get("text"):
                    try:
                        msg = json.loads(frame["text"])
                        if msg.get("type") == "ping":
                            await ws.send_text(json.dumps({"type": "pong", "ts": msg.get("ts")}))
                        elif msg.get("type") == "ui_event":
                            await _ui_event_queues[sid].put(msg)
                    except Exception:
                        pass
        except Exception:
            pass
        finally:
            _control_channels.pop(sid, None)
            _ui_event_queues.pop(sid, None)
            logger.info(f"[{sid}] control channel closed")
        return

    if mode == "assistant":
        await store.create_session(sid, mode="assistant", metadata={"remote_addr": ""})
        agent = AssistantAgent(store=store)
        await agent.run(ws, metadata={"mode": "assistant", "session_id": sid})
    elif mode == "onboarding":
        await store.create_session(sid, mode="onboarding", metadata={"remote_addr": ""})
        agent = FlowAgent(store=store, flow_name="onboarding", flows_dir=str(FLOWS_DIR), vad_stop_secs=rc.get_config().vad_stop_secs)
        await agent.run(ws, metadata={"mode": "onboarding", "session_id": sid})
    elif mode == "program" and program_id:
        import yaml as _yaml
        _progs = _yaml.safe_load((FLOWS_DIR / "programs.yaml").read_text()) or {}
        _prog = next((p for p in _progs.get("programs", []) if p["id"] == program_id), None)
        _flow_name = (_prog or {}).get("flow", "free_conversation")
        await store.create_session(
            sid, mode="program",
            metadata={"program_id": program_id, "device_id": device_id or ""},
        )
        agent = FlowAgent(store=store, flow_name=_flow_name, flows_dir=str(FLOWS_DIR), vad_stop_secs=rc.get_config().vad_stop_secs)
        await agent.run(ws, metadata={"mode": "program", "program_id": program_id, "session_id": sid})
    else:
        if interview_type not in INTERVIEW_TYPES:
            interview_type = "part1"
        await store.create_session(
            sid, mode="interview",
            interview_type=interview_type,
            metadata={"interview_type": interview_type},
        )
        agent = InterviewAgent(
            store=store,
            interview_type=interview_type,
            system_prompt=get_system_prompt(interview_type),
        )
        await agent.run(
            ws,
            metadata={"mode": "interview", "interview_type": interview_type, "session_id": sid},
        )
