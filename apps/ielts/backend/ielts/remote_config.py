"""
Remote configuration store.

Exposes a small set of runtime flags that the admin UI can toggle without
redeploying.  The active config is kept in memory (refreshed from the JSON
file on every write) so a process restart always reloads persisted values.

Endpoints (registered in main.py):
  GET  /config          — public: minimal flags the client SDK needs
  GET  /admin/config    — full config (all fields)
  POST /admin/config    — update one or more fields and persist to disk
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

_CONFIG_FILE = Path(os.getenv("REMOTE_CONFIG_PATH", "remote_config.json"))


# ── Schema ─────────────────────────────────────────────────────────────────────

@dataclass
class RemoteConfig:
    # ── Transport ──────────────────────────────────────────────────────────
    # Which transport the SDK should use.
    #   "websocket"   — raw PCM16 over a single WebSocket connection
    #   "webrtc"      — DTLS-SRTP media over WebRTC (lower latency / better AEC)
    #   "auto"        — SDK picks: WebRTC if available, else WebSocket fallback
    transport: Literal["websocket", "webrtc", "auto"] = "websocket"

    # Allow the SDK to upgrade from WebSocket to WebRTC mid-session.
    allow_upgrade: bool = True

    # ── STT / LLM / TTS ───────────────────────────────────────────────────
    # Switch the backend pipeline mode without redeployment.
    #   "stt_llm_tts"   — classic three-stage Pipecat pipeline
    #   "native_audio"  — single native-audio LLM (e.g. GPT-4o Realtime)
    pipeline_mode: Literal["stt_llm_tts", "native_audio"] = "stt_llm_tts"

    # Override the active providers at runtime (empty string = use env var).
    stt_provider: str = ""
    tts_provider: str = ""
    llm_provider: str = ""
    llm_model:    str = ""

    # ── VAD ───────────────────────────────────────────────────────────────
    # Server-side voice-activity detection sensitivity (0.0–1.0).
    vad_stop_secs:     float = 0.8
    # Whether the client should display a local VAD indicator.
    client_vad_ui:     bool  = True

    # ── Session ───────────────────────────────────────────────────────────
    # Maximum session duration in seconds (0 = unlimited).
    max_session_secs:  int   = 0
    # Default interview type when none is specified.
    default_interview: str   = "idle"

    # ── Feature flags ─────────────────────────────────────────────────────
    # Show the QoS debug panel in the web SDK.
    qos_panel:         bool  = True
    # Enable transcript display in the mobile app.
    show_transcript:   bool  = True
    # Force the onboarding flow even if the device flag says it was completed.
    force_onboarding:  bool  = False
    # Maintenance mode — clients display a banner but cannot start a session.
    maintenance:       bool  = False
    maintenance_msg:   str   = "Service is temporarily unavailable."

    # ── Audio ─────────────────────────────────────────────────────────────
    audio_sample_rate: int   = 16_000
    audio_encoding:    Literal["pcm_s16le"] = "pcm_s16le"


# ── Singleton store ─────────────────────────────────────────────────────────────

_config: RemoteConfig = RemoteConfig()


def get_config() -> RemoteConfig:
    """Return the current in-memory config."""
    return _config


def load_from_disk() -> None:
    """Populate _config from the JSON file (called at startup)."""
    global _config
    if _CONFIG_FILE.exists():
        try:
            raw = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
            _config = _from_dict(raw)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                f"remote_config: could not load {_CONFIG_FILE}: {exc} — using defaults"
            )


def update_config(patch: dict) -> RemoteConfig:
    """
    Apply a partial update dict, persist to disk, and return the new config.

    Only keys that exist on RemoteConfig are accepted; unknown keys are ignored.
    """
    global _config
    current = asdict(_config)
    valid_keys = set(current.keys())
    for k, v in patch.items():
        if k in valid_keys:
            current[k] = v
    _config = _from_dict(current)
    _persist()
    return _config


def as_dict(cfg: RemoteConfig | None = None) -> dict:
    return asdict(cfg or _config)


def public_dict() -> dict:
    """Minimal subset the client SDK needs (no provider secrets)."""
    cfg = _config
    return {
        "transport":        cfg.transport,
        "allow_upgrade":    cfg.allow_upgrade,
        "pipeline_mode":    cfg.pipeline_mode,
        "vad_stop_secs":    cfg.vad_stop_secs,
        "client_vad_ui":    cfg.client_vad_ui,
        "max_session_secs": cfg.max_session_secs,
        "default_interview":cfg.default_interview,
        "qos_panel":        cfg.qos_panel,
        "show_transcript":  cfg.show_transcript,
        "force_onboarding": cfg.force_onboarding,
        "maintenance":      cfg.maintenance,
        "maintenance_msg":  cfg.maintenance_msg,
        "audio_sample_rate":cfg.audio_sample_rate,
        "audio_encoding":   cfg.audio_encoding,
    }


# ── Internal helpers ───────────────────────────────────────────────────────────

def _from_dict(raw: dict) -> RemoteConfig:
    fields = {f.name for f in RemoteConfig.__dataclass_fields__.values()}  # type: ignore[attr-defined]
    return RemoteConfig(**{k: v for k, v in raw.items() if k in fields})


def _persist() -> None:
    try:
        _CONFIG_FILE.write_text(
            json.dumps(asdict(_config), indent=2),
            encoding="utf-8",
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(f"remote_config: persist failed: {exc}")
