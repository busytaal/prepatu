"""
Prepatu-specific send_artifact tool schema.

Extends the generic engine schema with a hard enum on the ``screen``
field so the LLM is guided to only navigate to screens that exist in the
Prepatu React Native app.

All other fields and the handler factory are re-exported unchanged from
the engine layer so the rest of the app only needs to import from here.
"""

from __future__ import annotations

from pipecat.adapters.schemas.function_schema import FunctionSchema

# Re-export handler factory unchanged — no Prepatu logic in the handler.
from vfdl.agents.artifacts import make_send_artifact_handler  # noqa: F401

SEND_ARTIFACT_SCHEMA = FunctionSchema(
    name="send_artifact",
    description=(
        "Send a UI instruction to the Prepatu client. "
        "Use artifact_type='intent' with a short label in the 'text' field to hint the UI. "
        "Use artifact_type='navigate' to move the user to a screen; set 'screen' to "
        "'Home', 'Interview', or 'Assistant'. "
        "Use artifact_type='options' to show a list of choices; set 'prompt' and 'options' (array of {id, label}). "
        "Use artifact_type='card' to display a summary card; set 'card_type', 'title', and 'content'."
    ),
    properties={
        "artifact_type": {
            "type": "string",
            "enum": ["intent", "navigate", "options", "card"],
            "description": "The type of UI artifact to render.",
        },
        "text": {
            "type": "string",
            "description": "For intent: a 1-2 word label, e.g. 'Greeting', 'Question'.",
        },
        "screen": {
            "type": "string",
            "enum": ["Home", "Interview", "Assistant"],
            "description": "For navigate: the Prepatu screen to navigate to.",
        },
        "screen_params": {
            "type": "object",
            "description": "For navigate: optional parameters passed to the screen (e.g. {interviewType: 'part1'}).",
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
