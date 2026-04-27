---
id: intro
title: Tutorial Overview
sidebar_position: 1
---

# Tutorial — Build an IELTS Speaking Coach

This tutorial walks you through the complete `apps/ielts/` example app — a voice-powered IELTS speaking practice coach. By the end you'll understand:

- How to structure a voice app with VFDL
- How to write YAML flows for real interview sequences
- How to connect the browser SDK to your backend
- How to add a scoring callback

The tutorial is **read-only** — the app is already built. You're exploring it as a worked example, not rebuilding it from scratch.

---

## What we're building

```
User opens app → Onboarding flow (collect name + DOB)
              → Practice flow selection (Part 1 / 2 / 3 / Full)
              → IELTS interview (voice back-and-forth)
              → Feedback flow (AI coach score + tips)
```

All conversation logic lives in YAML files under `apps/ielts/backend/ielts/agents/flows/`. No Python needed for the interview itself.

---

## Tutorial sections

| Step | What you'll learn |
|---|---|
| [1. Project setup](./01-project-setup) | Monorepo layout, how app + engine relate |
| [2. Backend](./02-backend) | How the IELTS FastAPI app mounts vfdl |
| [3. First flow — Onboarding](./03-first-flow) | Real `onboarding.yaml` walkthrough |
| [4. Connect the frontend](./04-connect-frontend) | VoiceAgent pointing at the backend |
| [5. Scoring callback](./05-scoring) | Injecting app logic into flow end |
| [6. Going further](./06-going-further) | What to customise for your own app |
