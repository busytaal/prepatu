---
id: self-hosted
title: Self-Hosted Deployment
sidebar_position: 1
---

# Self-Hosted Deployment

## Requirements

- Python 3.12+ with `uv`
- Node.js 18+ (browser demo only)
- A server with a public IP (for WebRTC TURN)

---

## Production backend

```bash
cd apps/ielts/backend
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

`--workers 4` runs 4 uvicorn processes. Each WebRTC session is I/O-bound (waiting on STT/TTS API responses), so 4 workers handle ~20–40 concurrent sessions comfortably.

:::caution Scaling
Python GIL contention becomes a bottleneck at 50–100 concurrent sessions with WebRTC (aiortc codec runs in a thread pool). Horizontal scaling with a load balancer + multiple instances is recommended beyond that.
:::

---

## TURN server

WebRTC through symmetric NAT or corporate firewalls requires TURN. Two options:

**Cloudflare TURN** (recommended — managed, pay-per-use):
```dotenv
TURN_PROVIDER=cloudflare
TURN_KEY_ID=...
TURN_API_TOKEN=...
```

**Self-hosted coturn**:
```dotenv
TURN_PROVIDER=static
TURN_SERVER=turn:your-server.example.com:3478
TURN_USERNAME=user
TURN_PASSWORD=pass
```

---

## Reverse proxy (nginx)

WebSocket and WebRTC both need specific proxy headers:

```nginx
location /ws {
    proxy_pass         http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_read_timeout 3600s;
}

location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

## Frontend (static hosting)

```bash
cd apps/ielts/frontend
npm run build
# → dist/ — deploy to any static host (Cloudflare Pages, Vercel, S3, etc.)
```

Set `VITE_BACKEND_URL` (or equivalent in `src/config.ts`) to point at your backend URL.
