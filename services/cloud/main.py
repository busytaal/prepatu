from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()  # load .env into os.environ BEFORE any provider or settings import

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from cloud.api import router
from cloud.store import init_db
from vfdl.api import engine_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("[cloud] Prepatu Cloud API starting on port 4000")
    yield
    logger.info("[cloud] Prepatu Cloud API stopped")


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
    allow_origins=["*"],  # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# vfdl engine router: /health (config check), /ice-servers
app.include_router(engine_router)

# Cloud router: auth, flows, sessions, WS voice, credits, providers
app.include_router(router)

# Dashboard SPA — must be mounted last so API routes take priority
app.mount("/ui", StaticFiles(directory="dashboard", html=True), name="dashboard")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=4000, reload=True)
