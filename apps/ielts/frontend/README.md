# Prepatu Voice SDK Demo (Browser)

A minimal browser-first TypeScript SDK prototype for voice agents.
This SDK is designed to be transport-agnostic and backend-aware while remaining small and easy to extend.

## What the SDK provides

- `VoiceAgent` with transport/backend separation
- browser `RTCPeerConnection` WebRTC transport support
- configurable transport profiles: `default`, `direct`, `relay`
- backend config for signaling, health, and voice capability metadata
- automatic Cloudflare-style TURN credential refresh via backend TTL metadata
- built-in diagnostics for readiness checks

## New config model

The SDK is designed so a consumer only needs to provide the backend base URL in most cases.

### Minimal usage
- `backend.baseUrl`: backend root URL
- `transport.type`: set to `'webrtc'`
- `metadata`: optional request metadata such as `interview_type`

Other backend paths and discovery behavior are handled by the SDK using defaults and `/capabilities` when available.

### Transport config (optional)
- `type: 'webrtc'`
- `profile`: `default | direct | relay`
- `staticIceServers`: optional static ICE server list
- `iceTransportPolicy`: optional low-level RTC policy

### Backend config (optional overrides)
- `baseUrl`: backend root URL
- `offerPath`: offer/answer signaling path
- `patchPath`: candidate patch path
- `iceServersPath`: optional override path for ICE servers
- `healthPath`: optional health endpoint for diagnostics
- `capabilitiesPath`: optional voice backend metadata path
- optional headers for backend requests

## SDK features

- automatic ICE server refresh when TTL metadata expires
- if the backend returns `ttlSeconds` or `expiresAt`, the SDK caches ICE servers and refreshes them before expiry
- `diagnostics()` method checks:
  - ICE server availability
  - backend health
  - backend capabilities
- no Pipecat-specific APIs are required in the SDK

## Backend interface

The demo assumes the backend exposes these endpoints:

1. `GET /ice-servers`
   - returns `{ iceServers: RTCIceServer[], ttlSeconds?: number, expiresAt?: number }`
   - the SDK uses this response to build the transport

2. `POST /offer?interview_type=...`
   - accepts `{ sdp, type }`
   - returns `{ pc_id, sdp, type }`

3. `PATCH /offer/{pc_id}`
   - accepts `{ candidates: RTCIceCandidateInit[] }`

4. optional `GET /health`
   - used by diagnostics

5. optional `GET /capabilities`
   - returns voice/backend capability metadata

A Pipecat backend can implement these routes, but the SDK will also work with any backend exposing the same generic API.

## Simple usage

```typescript
import { VoiceAgent } from './sdk/VoiceAgent';

const agent = new VoiceAgent({
  backend: { baseUrl: 'http://localhost:8000' },
  metadata: { interview_type: 'part1' },
});

await agent.start();
```

This example requires only the backend URL. The SDK discovers backend capabilities and uses default signaling paths unless overridden.

## Running the demo

```bash
cd frontend
npm install
npm run dev
```

Open the Vite dev server URL in your browser and point the demo at your backend.

## Notes

- `relay` should remain a diagnostic transport mode rather than the default production path.
- `direct` filters out TURN servers from the ICE list.
- `default` enables normal ICE candidate selection.
- diagnostics is available in the demo UI to verify backend readiness.
