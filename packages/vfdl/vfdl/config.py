from os import getenv

# These two env vars are the only config the engine needs.
# HOST/PORT are app-level concerns — not imported here.
SYSTEM_PROMPT: str | None = getenv("SYSTEM_PROMPT", None)
SYSTEM_PROMPT_FILE: str | None = getenv("SYSTEM_PROMPT_FILE", None)

# ── Prepatu Cloud (optional) ──────────────────────────────────────────────────
# Set PREPATU_API_KEY to enable managed provider key resolution and usage
# reporting. Omit entirely for fully self-hosted deployments.
PREPATU_API_KEY: str | None = getenv("PREPATU_API_KEY", None)
PREPATU_CLOUD_API_URL: str = getenv("PREPATU_CLOUD_API_URL", "https://api.prepatu.io")
