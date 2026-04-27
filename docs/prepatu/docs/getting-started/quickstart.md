---
id: quickstart
title: Quick Start
sidebar_position: 2
---

# Quick Start

:::info
Make sure you've completed [Installation](./installation) first.
:::

## Run your first voice session

### 1. Start the backend

```bash
cd apps/ielts/backend
uvicorn main:app --reload
```

### 2. Open the debug panel

```bash
cd apps/ielts/frontend
npm run dev
# → http://localhost:5173
```

### 3. Connect

1. Choose **WebSocket** transport in the panel.
2. Click **Connect** — your browser asks for microphone permission.
3. Say something. You'll hear the AI respond.

---

## Your first YAML flow

Save this as `my_flow.yaml` anywhere accessible to the backend:

```yaml
id: greeting
version: "1.0.0"
initial_state: hello

settings:
  base_system_prompt: |
    You are a friendly assistant. Keep every reply to one sentence.

states:
  hello:
    agent:
      prompt: |
        Greet the user warmly and ask their name.
        When they tell you, call `save_name`.
      tools:
        - save_name
    tools:
      save_name:
        description: "Save the user's name."
        parameters:
          first_name:
            type: string
            required: true
    transitions:
      on_tool_call:
        save_name: farewell

  farewell:
    agent:
      prompt: |
        Say goodbye to the user by name using the variable {first_name}.
        Then call `end_flow`.
      tools:
        - end_flow
    tools:
      end_flow:
        description: "End the conversation."
        parameters: {}
    transitions:
      on_tool_call:
        end_flow: __end__
```

Point the backend at this flow by setting `FLOWS_DIR` to the folder containing it.  
The flow will run automatically when a session starts with `mode=flow`.

---

## What just happened?

1. The engine loaded your YAML into a `FlowConfig` state machine.
2. On session start it entered `hello` — injected the state's `agent.prompt` into the LLM and registered only `save_name` as an available tool.
3. When the LLM called `save_name`, the engine stored `first_name` in flow context and transitioned to `farewell`.
4. In `farewell`, `{first_name}` was interpolated into the prompt automatically.
5. `end_flow` triggered `__end__` — the reserved terminal state.

Continue to [Flow YAML reference →](../concepts/flow-yaml)
