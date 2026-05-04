import sys
import time
import uuid
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()  # load .env BEFORE any settings import

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger
from prometheus_fastapi_instrumentator import Instrumentator

from cloud.api import router
from cloud.config import settings
from cloud.store import init_db, close_db
from vfdl.api import engine_router


# ── Logging setup ─────────────────────────────────────────────────────────────

def _configure_logging() -> None:
    """
    Dev:  human-readable coloured output.
    Prod: single-line JSON per record (LOG_JSON=true) — suitable for Loki/Promtail.
    """
    logger.remove()
    if settings.log_json:
        logger.add(
            sys.stdout,
            level=settings.log_level,
            serialize=True,         # loguru built-in JSON serialisation
            enqueue=False,
            backtrace=False,
            diagnose=False,
        )
    else:
        logger.add(
            sys.stdout,
            level=settings.log_level,
            format=(
                "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
                "<level>{level: <8}</level> | "
                "<cyan>{name}</cyan>:<cyan>{line}</cyan> | "
                "<level>{message}</level>"
            ),
            colorize=True,
            enqueue=False,
        )


_configure_logging()


# ── OpenTelemetry (optional — enabled only when OTEL_ENDPOINT is set) ─────────

def _setup_otel(app: FastAPI) -> None:
    if not settings.otel_endpoint:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        provider = TracerProvider()
        exporter = OTLPSpanExporter(endpoint=settings.otel_endpoint, insecure=True)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)
        logger.info("[otel] Tracing enabled → {}", settings.otel_endpoint)
    except ImportError:
        logger.warning(
            "[otel] OTEL_ENDPOINT set but opentelemetry packages not installed. "
            "Install with: pip install 'prepatu-cloud[otel]'"
        )


# ── App lifespan ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("[cloud] Prepatu Cloud API ready on port 4000")
    yield
    await close_db()
    logger.info("[cloud] Prepatu Cloud API stopped")


# ── Application factory ───────────────────────────────────────────────────────

app = FastAPI(
    title="Prepatu Cloud API",
    version="0.1.0",
    description=(
        "Managed voice backend for Prepatu. "
        "Handles auth, credits, per-account flow storage, "
        "provider key resolution, and live WebSocket voice sessions."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # restrict to your domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / access-log middleware ───────────────────────────────────────────

@app.middleware("http")
async def _access_log(request: Request, call_next) -> Response:
    req_id = str(uuid.uuid4())[:8]
    start  = time.perf_counter()
    with logger.contextualize(request_id=req_id):
        response: Response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "{method} {path} → {status} ({duration:.1f}ms) [{req_id}]",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration=duration_ms,
            req_id=req_id,
        )
    return response


# ── Prometheus metrics ────────────────────────────────────────────────────────

_instrumentator = Instrumentator(
    should_group_status_codes=True,
    should_ignore_untemplated=True,
    should_instrument_requests_inprogress=True,
    inprogress_labels=True,
)
_instrumentator.instrument(app)


@app.get("/metrics", include_in_schema=False)
async def metrics(request: Request):
    """
    Prometheus scrape endpoint.
    Protected by bearer token when METRICS_TOKEN is set.
    """
    from fastapi import HTTPException
    from fastapi.responses import PlainTextResponse
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

    if settings.metrics_token:
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {settings.metrics_token}":
            raise HTTPException(status_code=401, detail="Unauthorized")

    return PlainTextResponse(
        generate_latest().decode(),
        media_type=CONTENT_TYPE_LATEST,
    )


# ── Root redirect ────────────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def _root():
    """Redirect browsers to the UI at /ui (relative — works on any host)."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/ui", status_code=307)


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(engine_router)   # /health, /ice-servers
app.include_router(router)          # auth, flows, sessions, WS voice, credits

# Dashboard SPA — must be last so API routes take priority
app.mount("/ui", StaticFiles(directory="dashboard", html=True), name="dashboard")

# Wire up OTEL after the app is fully configured
_setup_otel(app)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=4000, reload=True)

