---
id: 04-connect-frontend
title: "Step 4: Connect the Frontend"
sidebar_position: 5
---

# Step 4: Connect the Frontend

## Start the dev server

```bash
cd apps/ielts/frontend
npm install
npm run dev
# → http://localhost:5173
```

## What the debug panel shows

The Vite app (`apps/ielts/frontend/src/App.ts`) wires up `VoiceAgent` with all three transport modes. When connected you'll see:

- **Event Log** — every `flow_state`, `flow_variable`, `transcript`, and `status` message in real time
- **Transport State** — which transport is active and its status
- **QoS Charts** — RTT, jitter, audio delivery for both WS and WebRTC

## How VoiceAgent is wired in the demo

```typescript
// Simplified from apps/ielts/frontend/src/App.ts

const agent = VoiceAgent.withWebSocket(
  { url: `ws://${backendHost}/ws?mode=flow&program_id=onboarding` },
  {
    onStatus:  s   => updateUI(s),
    onMessage: msg => logEvent(msg),
    onError:   err => console.error(err),
  }
);

await agent.connect();
```

## Handling flow_state messages

When the flow engine enters a new state it sends a `flow_state` message. In the `onMessage` callback, check `msg.type`:

```typescript
onMessage: msg => {
  if (msg.type === 'flow_state') {
    renderArtifact(msg.artifact);   // show form, options, card, etc.
  }
  if (msg.type === 'flow_end') {
    showSummary(msg.variables);     // session complete
  }
  if (msg.type === 'artifact' && msg.artifact_type === 'field_update') {
    fillFormField(msg.field_id, msg.value);  // voice-to-form autofill
  }
}
```

## Sending UI events back

When the user taps a button or submits a form, send a `ui_event`:

```typescript
agent.sendMessage({
  type: 'ui_event',
  flow_id: 'onboarding',
  action: 'form_submit',
  data: { first_name: 'Alex', date_of_birth: '15 March 1995' }
});
```

This triggers the `on_ui_event.form_submit` transition in the current state — skipping the LLM entirely.

---

[Next: Scoring callback →](./05-scoring)
