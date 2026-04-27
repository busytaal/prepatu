"""
FastAPI application entry point — SmallWebRTC + WebSocket transports.

Endpoints
---------
GET  /                  health check
GET  /interview-types   list available types
GET  /test              browser WebRTC test page
GET  /ws                WebSocket voice session (new)
POST /offer             WebRTC SDP offer -> answer
PATCH /offer/{pc_id}    trickle ICE candidates
"""

import asyncio
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

logger.remove()
logger.add(sys.stderr, level="DEBUG")

from ielts.config import HOST, PORT
import ielts.remote_config as rc
from vfdl.store_instance import store
from ielts.api import app_router
from vfdl.api import engine_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    rc.load_from_disk()
    await store.initialize()
    logger.info(f"Prepatu IELTS voice API starting on {HOST}:{PORT}")
    yield
    await store.close()
    logger.info("Shutting down")


app = FastAPI(title="Prepatu IELTS Voice API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(app_router)
app.include_router(engine_router)

@app.get("/")
async def health():
    return {"status": "ok", "service": "prepatu-ielts-voice-api", "transport": "webrtc"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
