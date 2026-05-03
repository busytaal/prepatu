# Build context: repo root (docker build -f services/cloud/Dockerfile .)
# This lets uv resolve the workspace (vfdl package lives in packages/vfdl).

FROM python:3.13-slim AS base

# Apply any pending OS-level security patches before adding application code
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

# Copy workspace descriptor + lock file first for layer-cache efficiency
COPY pyproject.toml uv.lock ./

# Copy only the packages the cloud service depends on
COPY packages/vfdl packages/vfdl
COPY services/cloud services/cloud

# Install prepatu-cloud and its dependencies (no dev extras)
RUN uv sync --package prepatu-cloud --no-dev --frozen

# ── Runtime ───────────────────────────────────────────────────────────────────
WORKDIR /app/services/cloud

# Activate the venv created by uv
ENV PATH="/app/.venv/bin:$PATH"

# Produce JSON logs in production (consumed by Promtail → Loki)
ENV LOG_JSON=true
ENV LOG_LEVEL=INFO

EXPOSE 4000

# Two workers: enough for voice-session concurrency on a single VPS.
# Increase via UVICORN_WORKERS env var if needed.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "4000", \
     "--workers", "2", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
