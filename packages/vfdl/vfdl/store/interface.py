"""
DB-agnostic session store interface.

Current implementation: SQLite (backend/store/sqlite.py)
Planned: MongoDB, vector DB per need — swap by changing the factory in main.py.

Schema (logical):
  sessions
    id            TEXT  PRIMARY KEY   (UUID)
    mode          TEXT                ("assistant" | "interview")
    interview_type TEXT               (null for assistant)
    started_at    REAL                (Unix epoch float)
    ended_at      REAL | NULL
    metadata      TEXT                (JSON)

  session_events
    id            TEXT  PRIMARY KEY   (UUID)
    session_id    TEXT  REFERENCES sessions(id)
    event_type    TEXT                (see EventType constants below)
    ts            REAL                (Unix epoch float, high-res)
    data          TEXT                (JSON — arbitrary per-event payload)

Event types emitted by the pipeline
─────────────────────────────────────
  connected           session opened
  disconnected        session closed
  turn_start          VAD end-of-speech detected
  turn_end            TTS audio delivery done
  llm_first_token     first token from LLM (after STT round-trip)
  tool_call_start     FunctionCallInProgressFrame received
  tool_call_end       tool result pushed back to LLM
  tts_first_audio     first TTS audio chunk dispatched to client
  interview_ended     end_interview tool was invoked
"""

from __future__ import annotations

import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

# ── Event type constants ───────────────────────────────────────────────────────

class E:
    CONNECTED        = "connected"
    DISCONNECTED     = "disconnected"
    TURN_START       = "turn_start"
    TURN_END         = "turn_end"
    LLM_FIRST_TOKEN  = "llm_first_token"
    TOOL_CALL_START  = "tool_call_start"
    TOOL_CALL_END    = "tool_call_end"
    TTS_FIRST_AUDIO  = "tts_first_audio"
    INTERVIEW_ENDED  = "interview_ended"


# ── Data classes ───────────────────────────────────────────────────────────────

@dataclass
class SessionRecord:
    id:             str
    mode:           str               # "assistant" | "interview"
    interview_type: str | None
    started_at:     float
    ended_at:       float | None
    metadata:       dict[str, Any]


@dataclass
class SessionEvent:
    id:         str   = field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str   = ""
    event_type: str   = ""
    ts:         float = field(default_factory=time.time)
    data:       dict  = field(default_factory=dict)


@dataclass
class ProfileRecord:
    device_id:      str
    name:           str | None
    target_band:    float
    active_program: str
    created_at:     float
    updated_at:     float


@dataclass
class ScoreRecord:
    session_id:          str
    program_id:          str
    fluency_coherence:   float | None
    lexical_resource:    float | None
    grammatical_range:   float | None
    pronunciation:       float | None
    overall_band:        float | None
    feedback:            dict
    evaluated_at:        float


# ── Abstract interface ─────────────────────────────────────────────────────────

class SessionStore(ABC):

    @abstractmethod
    async def create_session(
        self,
        session_id: str,
        mode: str,
        interview_type: str | None = None,
        metadata: dict | None = None,
    ) -> SessionRecord: ...

    @abstractmethod
    async def end_session(self, session_id: str) -> None: ...

    @abstractmethod
    async def append_event(self, event: SessionEvent) -> None: ...

    @abstractmethod
    async def get_session(self, session_id: str) -> SessionRecord | None: ...

    @abstractmethod
    async def get_events(
        self,
        session_id: str,
        event_types: list[str] | None = None,
    ) -> list[SessionEvent]: ...

    @abstractmethod
    async def list_sessions(
        self,
        mode: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[SessionRecord]: ...

    @abstractmethod
    async def get_device_flag(self, device_id: str, key: str) -> bool | None:
        """Return a stored flag for a device, or None if not set."""
        ...

    @abstractmethod
    async def set_device_flag(self, device_id: str, key: str, value: bool) -> None:
        """Persist a boolean flag for a device."""
        ...

    @abstractmethod
    async def append_user_event(
        self,
        device_id: str,
        event_type: str,
        data: dict,
    ) -> None:
        """
        Record a user-level context event (not tied to a single session).
        event_type examples: 'screen_visited', 'session_completed', 'onboarding_completed'
        Stored events are returned to the LLM as a brief context summary so it
        can personalise greetings and remember where the user left off.
        """
        ...

    @abstractmethod
    async def get_user_context(
        self,
        device_id: str,
        limit: int = 20,
    ) -> list[dict]:
        """Return the most recent context events for a device, newest first."""
        ...

    @abstractmethod
    async def get_profile(self, device_id: str) -> ProfileRecord | None: ...

    @abstractmethod
    async def upsert_profile(
        self,
        device_id: str,
        name: str | None = None,
        target_band: float = 6.5,
        active_program: str = "free_talk",
    ) -> ProfileRecord: ...

    @abstractmethod
    async def save_session_scores(
        self,
        session_id: str,
        program_id: str,
        scores: dict,
    ) -> None: ...

    @abstractmethod
    async def get_session_scores(self, session_id: str) -> ScoreRecord | None: ...

    @abstractmethod
    async def list_sessions_for_device(
        self,
        device_id: str,
        program_id: str | None = None,
        limit: int = 50,
    ) -> list[dict]: ...

    # ── Convenience helpers ────────────────────────────────────────────────────

    async def emit(
        self,
        session_id: str,
        event_type: str,
        data: dict | None = None,
    ) -> None:
        await self.append_event(SessionEvent(
            session_id=session_id,
            event_type=event_type,
            data=data or {},
        ))

    async def time_series(
        self,
        mode: str | None = None,
        limit: int = 500,
    ) -> list[dict]:
        """
        Return a flat list of time-series points suitable for plotting.
        Each point: { ts, session_id, mode, event_type, data }
        """
        sessions = await self.list_sessions(mode=mode, limit=limit)
        result = []
        for s in sessions:
            events = await self.get_events(s.id)
            for ev in events:
                result.append({
                    "ts":         ev.ts,
                    "session_id": s.id,
                    "mode":       s.mode,
                    "event_type": ev.event_type,
                    "data":       ev.data,
                })
        return sorted(result, key=lambda x: x["ts"])
