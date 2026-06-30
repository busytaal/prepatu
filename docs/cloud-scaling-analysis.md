# Prepatu Cloud Scaling Analysis & Load Testing Strategy

## 1. Cloud Scaling Analysis: Weak Points

After reviewing the `services/cloud` codebase and its integration with the `vfdl` engine, several potential weak points and bottlenecks for scaling the cloud deployment have been identified:

### 1.1 CPU-Bound Pipeline Execution in FastAPI Workers
**Location:** `services/cloud/cloud/voice.py` and `vfdl.agents.flow_agent`
**Issue:** The WebSocket endpoint `/v1/ws/{session_token}` directly boots a `FlowAgent`, which initializes a Pipecat `PipelineTask`. Each active voice session runs an audio pipeline within the same process handling the FastAPI server. Audio processing, streaming, and pipeline management are CPU-bound and I/O-heavy.
**Impact:** A single FastAPI worker running Uvicorn can only handle a limited number of concurrent voice sessions before event loop starvation occurs. The `Dockerfile` specifies 2 workers, meaning the instance could quickly become saturated by a modest number of concurrent WebSockets. The FastAPI HTTP endpoints (like `/auth/*`, `/v1/flows`, etc.) will suffer from severe latency when the workers are busy processing audio pipelines.

### 1.2 Database Bottleneck on Session Lifecycle
**Location:** `services/cloud/cloud/usage.py` and `services/cloud/cloud/voice.py`
**Issue:** Every session starts with a database insertion (`INSERT INTO sessions`), followed by several reads to fetch keys and flow data, and finishes with an `UPDATE sessions` and `UPDATE credits`.
**Impact:** While PostgreSQL (`asyncpg`) is fast, relying strictly on DB writes/reads in the critical path of establishing and tearing down a WebSocket connection means the database could become the primary bottleneck if thousands of sessions connect/disconnect concurrently. There is no caching layer (e.g., Redis) for active session tokens, provider keys, or flow configurations.

### 1.3 State Loss on Worker Restart or Crash
**Location:** `services/cloud/cloud/voice.py`
**Issue:** Active voice sessions are pinned to the specific worker and instance handling the WebSocket connection. The system has no mechanism for resuming a session if the connection drops.
**Impact:** If a cloud instance is restarted, scaled down, or crashes, all active sessions on that instance are terminated. The associated credits are updated in a `finally` block in `handle_voice_ws`, but a hard crash might skip this block, leaving the session "active" indefinitely in the database and failing to deduct credits properly.

### 1.4 Centralized Provider Key Resolution
**Location:** `services/cloud/cloud/voice.py`
**Issue:** The cloud service resolves provider API keys per user on every session start by hitting the `provider_keys` table.
**Impact:** This adds latency to session initialization and increases DB load.

### 1.5 Sync Blocking YAML Parsing
**Location:** `services/cloud/cloud/voice.py` -> `_parse_flow_yaml`
**Issue:** The system uses `_yaml.safe_load`, which is a synchronous operation.
**Impact:** Parsing large YAML files will block the asyncio event loop for the entire FastAPI worker, affecting all other connected WebSocket sessions and HTTP requests.


## 2. Load Testing Strategy

To evaluate the maximum capacity of the cloud server and find the exact breaking point of the event loop, we need to stress-test the WebSocket endpoints without incurring massive costs from real STT/TTS/LLM providers.

### 2.1 Strategy: Mock Provider Services

We will implement mock Pipecat services that simulate the I/O and latency of the real providers without actually making network requests.

**Mock Providers to Implement:**
1.  **Mock STT (Speech-to-Text):**
    - Takes inbound audio chunks from the transport.
    - Instead of sending to Deepgram, it simply buffers audio and occasionally yields a dummy `TextFrame` (e.g., "Hello, this is a mock user utterance.") to simulate a transcription event.
2.  **Mock LLM:**
    - Listens for context frames.
    - Simulates processing delay using `asyncio.sleep(0.5)`.
    - Yields dummy response `TextFrame` or `LLMFullResponseFrame` based on the flow context.
3.  **Mock TTS (Text-to-Speech):**
    - Takes `TextFrame` inputs.
    - Simulates synthesis latency.
    - Generates dummy sine-wave audio bytes (or static silence) and yields `AudioRawFrame` to push back to the transport.

**Implementation Details:**
- We can inject these mock providers by adding a new environment variable or configuration flag (e.g., `MOCK_PROVIDERS=true`).
- In `vfdl.providers`, we override `create_stt`, `create_llm`, and `create_tts` to return our mock Pipecat services when the flag is set.

### 2.2 Load Testing Scenario

We will use a load testing tool capable of maintaining concurrent WebSockets (such as `Artillery`, `Locust` with WebSocket extensions, or a custom Python script using `websockets` and `asyncio`).

**Test Execution Steps:**
1.  **Setup:**
    - Deploy the Prepatu Cloud service locally or to a staging server with `MOCK_PROVIDERS=true`.
    - Populate the database with test users and generic flows.
2.  **Ramp-up:**
    - The load tester creates $N$ virtual users.
    - Each user calls `POST /v1/sessions` to get a session token.
3.  **Connection:**
    - Each user connects to `wss://<host>/v1/ws/{session_token}`.
4.  **Simulation:**
    - The load tester streams dummy PCM audio data (or silence) to the WebSocket at the expected sample rate (e.g., 16kHz, 16-bit) to keep the pipeline active.
    - The mock providers process this data, keeping the CPU load realistic to the framework overhead (though lower than real network parsing).
5.  **Metrics Collection:**
    - Monitor the Prometheus metrics endpoint (`/metrics`) to observe `prepatu_voice_sessions_active`.
    - Monitor CPU and Memory usage of the FastAPI worker process.
    - Measure the latency of a separate, out-of-band HTTP request (e.g., `GET /health`) during the load test. When the HTTP latency spikes dramatically, we have found the event loop saturation point.

### 2.3 Success Criteria
The cloud service should gracefully handle a target number of concurrent sessions per worker (e.g., 50-100) without crashing, dropping connections, or significantly increasing the latency of basic HTTP routes.
