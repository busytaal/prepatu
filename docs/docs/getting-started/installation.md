---
id: installation
title: Installation
sidebar_position: 1
---

# Installation

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Python | ≥ 3.12 | VFDL engine |
| [uv](https://docs.astral.sh/uv/) | latest | Python package manager |
| Node.js | ≥ 18 | Browser SDK / docs |

---

## 1. Clone the repo

```bash
git clone https://github.com/busytaal/prepatu.git
cd prepatu
```

---

## 2. Install Python packages

```bash
uv sync --all-packages
```

This installs both `vfdl` (the engine) and `prepatu-ielts` (the reference app) into a shared virtual environment at `.venv/`.

:::tip Using vfdl standalone?
```bash
pip install vfdl
```
:::

---

## 3. Environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

```dotenv
STT_API_KEY=dg-...          # Deepgram
TTS_API_KEY=dg-...          # Deepgram (same key)
LLM_API_KEY=sk-or-...       # OpenRouter
```

See the full [Environment Variable Reference](../backend/env-reference) for all options.

---

## 4. Start the backend

```bash
cd apps/ielts/backend
uvicorn main:app --host 0.0.0.0 --reload
```

Backend is now running at `http://localhost:8000`.

---

## 5. Start the browser SDK demo *(optional)*

```bash
cd apps/ielts/frontend
npm install
npm run dev
```

Open `http://localhost:5173` — live debug panel with transport controls, QoS charts, and event log.
