---
id: 02-backend
title: "Step 2: The Backend App"
sidebar_position: 3
---

# Step 2: The Backend App

## Entry point — `main.py`

```python
# apps/ielts/backend/main.py (simplified)
from fastapi import FastAPI
from vfdl.api import engine_router    # /health, /capabilities, /offer, /ice-servers, /ws
from ielts.api import app_router      # IELTS-specific routes

app = FastAPI()
app.include_router(engine_router)
app.include_router(app_router)
```

The engine provides all transport and voice endpoints. The app router adds IELTS-specific endpoints on top:

| Route | Purpose |
|---|---|
| `GET /programs` | Practice program catalog |
| `GET /flows` | List YAML flow files |
| `GET /flows/{name}` | Read a flow as JSON |
| `POST /flows/{name}` | Save a flow (visual editor) |
| `GET /profile` | User profile (device-keyed) |
| `GET /sessions` | Session history |
| `GET /flow-editor` | Visual YAML flow editor (admin) |

## Config — `config.py`

```python
# apps/ielts/backend/config.py
from dotenv import load_dotenv
load_dotenv()

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", "")
```

## Flows directory

All YAML flows live at a known path relative to the package:

```python
FLOWS_DIR = Path(__file__).parent / "agents" / "flows"
```

The engine receives this as a string parameter — it never hardcodes a path itself.

## pyproject.toml

```toml
[project]
name = "prepatu-ielts"
version = "0.1.0"
dependencies = [
    "vfdl",          # ← the engine as a workspace dependency
    "fastapi",
    "uvicorn[standard]",
    "python-dotenv",
    "loguru",
]
```

---

[Next: Your first flow — Onboarding →](./03-first-flow)
