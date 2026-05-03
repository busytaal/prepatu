---
id: cloud-quickstart
title: Cloud Quickstart
sidebar_position: 1
---

# Cloud Quickstart

Upload a YAML flow, get a WebSocket URL, and talk to your voice agent — no backend to deploy.

:::info Prerequisites
You need a Prepatu account. Sign up at the [dashboard](https://dashboard.prepatu.io) or via the API below.
:::

---

## 1. Create an Account & API Key

```bash
# Sign up
curl -X POST https://api.prepatu.io/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "your-password"}'
# → { "access_token": "eyJ...", "token_type": "bearer" }

# Create an API key (use the access_token from signup)
curl -X POST https://api.prepatu.io/auth/api-keys?label=my-app \
  -H "Authorization: Bearer eyJ..."
# → { "key": "pk_live_...", "label": "my-app" }
```

Save your API key — you'll use it as the `X-Prepatu-Key` header for all API calls.

:::tip Dashboard
You can also create API keys from the [Prepatu Dashboard](https://dashboard.prepatu.io). The dashboard also has a visual flow editor for building flows without writing YAML by hand.
:::

---

## 2. Upload a Flow

Let's upload the **10 Questions** game — a voice game where the AI secretly picks something and the user asks yes/no questions to guess it.

Save this as `ten-questions.yaml` (or [grab it from GitHub](https://github.com/busytaal/prepatu/blob/main/apps/ten-questions/flow.yaml)):

```yaml
id: ten-questions
version: "1.0.0"
initial_state: setup

settings:
  base_system_prompt: |
    You are the host of a 10 Questions game.
    You secretly chose something — the player asks yes/no questions.
    Answer honestly. Never reveal the secret unless they guess correctly.
    Be playful and keep answers snappy (1-2 sentences max).

states:
  setup:
    ui:
      artifact_type: card
      prompt: "🎯 10 Questions — I'm thinking of something… Ask yes/no questions!"
    agent:
      prompt: |
        Pick ONE specific thing (animal, celebrity, food, place, or object).
        Call `begin_game` with your secret. Then welcome the player.
      tools: [begin_game]
    tools:
      begin_game:
        description: "Lock in your secret choice. Never reveal this."
        parameters:
          secret_thing: { type: string, required: true }
    transitions:
      on_tool_call:
        begin_game: playing

  playing:
    ui:
      artifact_type: card
      prompt: "❓ Question {questions_asked} / 10 — Last answer: {last_answer}"
    agent:
      prompt: |
        Your secret: {secret_thing}. Questions asked: {questions_asked} / 10.
        Answer yes/no questions, call `record_answer` after each.
        Call `guess_correct` if they guess right, `out_of_questions` after 10.
      tools: [record_answer, guess_correct, guess_wrong, out_of_questions]
    tools:
      record_answer:
        description: "Record the answer and update the count."
        parameters:
          last_answer: { type: string, required: true }
          questions_asked: { type: string, required: true }
      guess_correct:
        description: "Player guessed correctly."
      guess_wrong:
        description: "Player guessed wrong — stay in game."
        speech_cue: "Nope, not it! Keep digging!"
        parameters:
          wrong_guess: { type: string, required: true }
      out_of_questions:
        description: "All 10 questions used."
    transitions:
      on_tool_call:
        guess_correct: won
        out_of_questions: lost

  won:
    ui:
      artifact_type: card
      prompt: "🎉 You got it! It was: {secret_thing}"
    agent:
      prompt: Congratulate them! Ask if they want to play again.
      tools: [play_again]
    tools:
      play_again:
        description: "Start a new round."
    transitions:
      on_tool_call:
        play_again: setup

  lost:
    ui:
      artifact_type: card
      prompt: "😅 Out of questions! It was: {secret_thing}"
    agent:
      prompt: Reveal the answer with a fun reaction. Offer to play again.
      tools: [play_again]
    tools:
      play_again:
        description: "Start a new round."
    transitions:
      on_tool_call:
        play_again: setup
```

Upload it:

```bash
curl -X POST https://api.prepatu.io/v1/flows \
  -H "X-Prepatu-Key: pk_live_..." \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"10 Questions\", \"yaml_content\": \"$(cat ten-questions.yaml)\"}"
# → { "id": "f-abc123...", "name": "10 Questions", ... }
```

Copy the `id` — that's your **Flow ID**.

---

## 3. Start a Session

```bash
curl -X POST https://api.prepatu.io/v1/sessions \
  -H "X-Prepatu-Key: pk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"flow_id": "f-abc123..."}'
# → {
#     "session_token": "st_...",
#     "ws_url": "wss://api.prepatu.io/v1/ws/st_...",
#     "credits_remaining": 200
#   }
```

The `ws_url` is a ready-to-connect WebSocket endpoint. Your session is waiting.

---

## 4. Connect from the Browser

Create a simple HTML page:

```html
<!DOCTYPE html>
<html>
<head><title>10 Questions</title></head>
<body>
  <h1>🎯 10 Questions</h1>
  <div id="card"></div>
  <button id="connect">Start Game</button>
  <button id="disconnect" disabled>End</button>

  <script type="module">
    // In production, use: import { VoiceAgent } from '@prepatu/voice-sdk'
    // For now, copy VoiceAgent from packages/sdk/src/

    document.getElementById('connect').onclick = async () => {
      // Step 1: Start a session from your backend (don't expose API keys client-side)
      const res = await fetch('/api/start-session', { method: 'POST' });
      const { ws_url } = await res.json();

      // Step 2: Connect VoiceAgent to the WebSocket
      const agent = VoiceAgent.withWebSocket(
        { url: ws_url },
        {
          onMessage: msg => {
            // Render flow artifacts
            if (msg.type === 'flow_state' || msg.type === 'artifact') {
              document.getElementById('card').textContent = msg.prompt || '';
            }
          },
          onStatus: s => console.log('Status:', s),
          onError: err => console.error(err),
        }
      );

      await agent.connect();
      document.getElementById('disconnect').onclick = () => agent.disconnect();
    };
  </script>
</body>
</html>
```

Click **Start Game**, allow your microphone, and start playing. The AI picks a secret, you ask questions — the flow engine keeps everything on track.

---

## What Just Happened?

```
1. You uploaded a YAML flow to the cloud
2. Started a session — the engine loaded the flow into a state machine
3. Connected via WebSocket — the engine entered the `setup` state
4. The LLM called `begin_game` — engine stored the secret and transitioned to `playing`
5. Each question → the LLM called `record_answer` — engine updated variables
6. Correct guess → `guess_correct` → engine transitioned to `won`
```

At no point could the LLM skip a step, reveal the secret prematurely, or invent a transition that doesn't exist in the YAML.

---

## Next Steps

- **[Your First Flow](../flows/first-flow)** — write a YAML flow from scratch and understand every field
- **[YAML Reference](../flows/yaml-reference)** — the complete flow specification
- **[Booking Wizard Example](../examples/booking-wizard)** — build a multi-step form with voice-to-form autofill
- **[Self-Hosted Quickstart](./self-hosted-quickstart)** — run the engine on your own infrastructure
