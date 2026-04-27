"""
FastAPIWSTransport — bridges a Starlette/FastAPI WebSocket into a Pipecat pipeline.

The two halves:
  FastAPIWSInputTransport   — reads raw PCM16 bytes pushed via push_bytes()
                              and feeds them to the Pipecat audio pipeline
                              (including VAD → STT).
  FastAPIWSOutputTransport  — overrides write_audio_frame() to send PCM16
                              bytes back over the WebSocket.

Usage (see ws_handler.py):
    transport = FastAPIWSTransport(ws, params=TransportParams(...))
    pipeline  = Pipeline([transport.input(), stt, llm, tts, transport.output(), ...])
"""

import asyncio
from typing import Optional

from fastapi import WebSocket
from loguru import logger

from pipecat.frames.frames import InputAudioRawFrame, OutputAudioRawFrame
from pipecat.transports.base_input import BaseInputTransport
from pipecat.transports.base_output import BaseOutputTransport
from pipecat.transports.base_transport import BaseTransport, TransportParams

SAMPLE_RATE = 16_000
NUM_CHANNELS = 1


class FastAPIWSInputTransport(BaseInputTransport):
    """Pipecat input transport backed by a FastAPI WebSocket.

    Call  push_bytes(data)  to enqueue raw PCM16 frames that arrive from the
    WebSocket.  The internal task drains the queue and feeds them to the
    Pipecat audio pipeline (VAD → STT → ...).
    """

    def __init__(self, params: TransportParams, **kwargs):
        super().__init__(params, **kwargs)
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._audio_reader_task: asyncio.Task | None = None

    # ── Lifecycle ──────────────────────────────────────────────────────────

    async def start(self, frame):
        await super().start(frame)
        await self.set_transport_ready(frame)  # creates _audio_in_queue
        self._audio_reader_task = self.create_task(self._reader())

    async def stop(self, frame):
        await self._queue.put(None)  # sentinel → wake reader
        if self._audio_reader_task:
            await self.wait_for_task(self._audio_reader_task)
            self._audio_reader_task = None
        await super().stop(frame)

    async def cancel(self, frame):
        await self._queue.put(None)
        if self._audio_reader_task:
            await self.cancel_task(self._audio_reader_task)
            self._audio_reader_task = None
        await super().cancel(frame)

    # ── Public: called by WSSession ────────────────────────────────────────

    async def push_bytes(self, data: bytes) -> None:
        """Enqueue a raw PCM16 chunk received from the WebSocket."""
        await self._queue.put(data)

    # ── Internal ───────────────────────────────────────────────────────────

    async def _reader(self) -> None:
        """Drain the queue and forward audio frames into Pipecat."""
        while True:
            data = await self._queue.get()
            if data is None:
                break
            frame = InputAudioRawFrame(
                audio=data,
                sample_rate=SAMPLE_RATE,
                num_channels=NUM_CHANNELS,
            )
            await self.push_audio_frame(frame)


class FastAPIWSOutputTransport(BaseOutputTransport):
    """Pipecat output transport that sends PCM16 audio over a FastAPI WebSocket."""

    def __init__(self, ws: WebSocket, params: TransportParams, **kwargs):
        super().__init__(params, **kwargs)
        self._ws = ws
        self._closed = False

    async def start(self, frame):
        await super().start(frame)
        await self.set_transport_ready(frame)  # creates _media_senders[None]

    def mark_closed(self) -> None:
        self._closed = True

    async def write_audio_frame(self, frame: OutputAudioRawFrame) -> bool:
        """Send a PCM16 chunk to the client."""
        if self._closed:
            return False
        try:
            await self._ws.send_bytes(frame.audio)
            return True
        except Exception as exc:
            logger.warning(f"FastAPIWSOutputTransport: send failed: {exc}")
            self._closed = True
            return False


class FastAPIWSTransport(BaseTransport):
    """Top-level transport – glues input + output and provides them to Pipeline."""

    def __init__(
        self,
        ws: WebSocket,
        params: TransportParams,
        input_name: Optional[str] = None,
        output_name: Optional[str] = None,
    ):
        super().__init__(input_name=input_name, output_name=output_name)
        self._params = params
        self._ws = ws
        self._input: Optional[FastAPIWSInputTransport] = None
        self._output: Optional[FastAPIWSOutputTransport] = None

        self._register_event_handler("on_client_connected")
        self._register_event_handler("on_client_disconnected")

    def input(self) -> FastAPIWSInputTransport:
        if not self._input:
            self._input = FastAPIWSInputTransport(
                self._params, name=self._input_name
            )
        return self._input

    def output(self) -> FastAPIWSOutputTransport:
        if not self._output:
            self._output = FastAPIWSOutputTransport(
                self._ws, self._params, name=self._output_name
            )
        return self._output

    async def push_audio(self, data: bytes) -> None:
        """Forward raw PCM16 bytes from the FastAPI WS into the input transport."""
        if self._input:
            await self._input.push_bytes(data)

    def mark_closed(self) -> None:
        if self._output:
            self._output.mark_closed()
