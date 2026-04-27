"""
Generic send_artifact tool schema and handler factory.

The LLM calls send_artifact(artifact_type, ...) to push any UI
instruction to the client frontend over the control WebSocket.

All fields are flat (no nested payload object):

artifact_type  required field  other fields
─────────────────────────────────────────────────────────────────
f ield_update   field_id        field_value  (schema-driven form update)
intent         text            hint label, e.g. "Greeting"
navigate       screen          any screen name string
               screen_params   (optional object)
               options         [{id, label}, ...]
card           title           heading string
               card_type       "score"|"info"
               content         object
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from loguru import logger

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema


SEND_ARTIFACT_SCHEMA = FunctionSchema(
    name="send_artifact",
    description=(
        "Send a UI instruction to the client frontend. "
        "Use artifact_type='field_update' to update a specific form field; set 'field_id' and 'field_value'. "
        "Use artifact_type='intent' with a short label in the 'text' field to hint the UI. "
        "Use artifact_type='navigate' to move the user to a screen; set 'screen' to the target screen name. "
        "Use artifact_type='options' to show a list of choices; set 'prompt' and 'options' (array of {id, label}). "
        "Use artifact_type='card' to display a summary card; set 'card_type', 'title', and 'content'."
    ),
    properties={
        "artifact_type": {
            "type": "string",
            "enum": ["field_update", "intent", "navigate", "options", "card"],
            "description": "The type of UI artifact to render.",
        },
        "field_id": {
            "type": "string",
            "description": "For field_update: the schema field identifier to update.",
        },
        "field_value": {
            "description": "For field_update: the new value for the field (any JSON type).",
        },
        "text": {
            "type": "string",
            "description": "For intent: a 1-2 word label, e.g. 'Greeting', 'Question'.",
        },
        "screen": {
            "type": "string",
            "description": "For navigate: the target screen name.",
        },
        "screen_params": {
            "type": "object",
            "description": "For navigate: optional parameters passed to the screen.",
            "additionalProperties": True,
        },
        "prompt": {
            "type": "string",
            "description": "For options: the question or prompt shown above the choices.",
        },
        "options": {
            "type": "array",
            "items": {"type": "object"},
            "description": "For options: array of {id, label} objects.",
        },
        "card_type": {
            "type": "string",
            "description": "For card: 'score' or 'info'.",
        },
        "title": {
            "type": "string",
            "description": "For card: the card heading.",
        },
        "content": {
            "type": "object",
            "description": "For card: card body data.",
            "additionalProperties": True,
        },
    },
    required=["artifact_type"],
)


def make_send_artifact_handler(control_ws, session_label: str = ""):
    """
    Return an async handler for the send_artifact tool.

    control_ws:    FastAPI WebSocket (the control channel), or None.
    session_label: Optional string for log context.
    """
    async def handler(params):
        if control_ws is None:
            logger.warning(
                f"[{session_label}] send_artifact called but control_ws is not initialised — "
                "artifact will be dropped. "
                "Ensure the client opens /ws?mode=control&session_id=<uuid> BEFORE sending the /offer."
            )
            await params.result_callback("")
            return

        args: dict[str, Any] = params.arguments or {}
        artifact_type = args.get("artifact_type", "intent")

        # Build payload from flat args, remapping screen_params → params for navigate
        payload: dict[str, Any] = {}
        for key in ("field_id", "field_value", "text", "screen", "prompt", "options", "card_type", "title", "content"):
            if key in args:
                payload[key] = args[key]
        if "screen_params" in args:
            payload["params"] = args["screen_params"]

        msg = {
            "type": "artifact",
            "id": str(uuid.uuid4()),
            "artifact_type": artifact_type,
            **payload,
        }

        try:
            await control_ws.send_text(json.dumps(msg))
        except Exception as exc:
            logger.warning(f"[{session_label}] send_artifact failed: {exc}")

        # Return a speech cue so the LLM generates a follow-up voice turn.
        # field_update → silent (background state update)
        # intent → silent (just a UI label, no narration needed)
        # navigate → confirm destination aloud
        # options → read the choices aloud
        # card → summarise the card aloud
        if artifact_type in ("field_update", "intent"):
            speech_cue = ""
        elif artifact_type == "navigate":
            screen = payload.get("screen", "the screen")
            speech_cue = f"[UI: navigating to {screen}] Now speak one short confirmation sentence."
        elif artifact_type == "options":
            prompt_text = payload.get("prompt", "")
            labels = ", ".join(o.get("label", "") for o in (payload.get("options") or []))
            speech_cue = (
                f"[UI: options displayed — '{prompt_text}' with choices: {labels}] "
                "Now read these options aloud to the user in a natural, friendly sentence."
            )
        elif artifact_type == "card":
            title = payload.get("title", "info card")
            speech_cue = f"[UI: card '{title}' displayed] Now briefly summarise the card for the user."
        else:
            speech_cue = "[UI updated] Acknowledge briefly."

        await params.result_callback(speech_cue)

    return handler
