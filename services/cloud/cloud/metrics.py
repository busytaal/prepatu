"""
Prometheus metrics for the Prepatu Cloud service.

Import from this module to record domain events.  The Instrumentator in
main.py handles HTTP request/latency metrics automatically.
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

# ── Voice session metrics ─────────────────────────────────────────────────────

VOICE_SESSIONS_ACTIVE = Gauge(
    "prepatu_voice_sessions_active",
    "Number of currently active voice WebSocket sessions.",
)

VOICE_SESSIONS_TOTAL = Counter(
    "prepatu_voice_sessions_total",
    "Total voice sessions started since process boot.",
)

VOICE_SESSION_DURATION = Histogram(
    "prepatu_voice_session_duration_seconds",
    "Voice session wall-clock duration.",
    buckets=[30, 60, 120, 300, 600, 1200, 1800, 3600],
)

# ── Credit metrics ────────────────────────────────────────────────────────────

CREDITS_DEDUCTED = Counter(
    "prepatu_credits_deducted_usd_cents_total",
    "Cumulative credits deducted (in USD cents).",
)
