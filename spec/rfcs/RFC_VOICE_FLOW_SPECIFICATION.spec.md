# RFC: Voice Flow Definition Language (VFDL)

**Version:** `vfdl/0.1-draft`
**Status:** Draft
**Date:** 2026-04-21
**Authors:** Prepatu Team

---

## 1. Abstract

This document specifies a declarative language for defining voice-assisted UI flows as deterministic state machines. The specification — **VFDL (Voice Flow Definition Language)** — allows developers to define UI states, variables, LLM constraints, and transitions in a static configuration file (YAML or JSON). A runtime engine executes the flow, confining the LLM to per-state objectives and providing deterministic fallback paths that do not require LLM cooperation.

The goals are:
1. **Zero hallucination risk on flow control** — the LLM cannot skip steps, invent transitions, or navigate to undefined states.
2. **Configurable via a visual editor** — the YAML/JSON schema is designed to be round-trippable with a web-based graph editor.
3. **LLM-optional** — every transition can be triggered by a deterministic path (UI event, regex, or timeout) so the flow completes even if the LLM misbehaves.

---

## 2. Prior Art & Existing Standards

| Standard | Relevance | Gap for our use case |
|---|---|---|
| **W3C SCXML** | XML-based Harel statechart standard. Event-driven, supports parallel states, guards, data model. | XML-only, no LLM/voice semantics, no UI artifact concept. Heavyweight. |
| **W3C VoiceXML** | Mature IVR dialog markup. Defines prompts, grammars, form-filling. | Designed for telephony, no modern UI artifacts, no LLM integration. |
| **XState (v5)** | JSON-serializable statechart library. Separates config from implementations via `setup()`. | JavaScript-centric. No voice/UI artifact semantics. Config is pure logic, no agent/prompt layer. |
| **RTVI** | Open standard for real-time voice/video inference. Standardized client↔server messaging. | Protocol-level only — defines *how* messages flow, not *what flows to execute*. No state machine. |
| **Rasa Stories/Rules** | YAML-based dialog flow definitions with intent→action mappings. | Tightly coupled to Rasa NLU. No UI artifact layer. |
| **Amazon Alexa APL** | JSON-based presentation language for voice+visual devices. | Proprietary, display-only, no state machine semantics. |

**Conclusion:** No existing standard covers the intersection of *statechart-based flow control + LLM confinement + server-driven UI artifacts + voice interaction*. VFDL fills this gap by combining ideas from SCXML (statecharts), XState (JSON-serializable config), and VoiceXML (voice dialog patterns) into a single specification purpose-built for LLM-powered voice agents.

---

## 3. Terminology

| Term | Definition |
|---|---|
| **Flow** | A complete state machine definition — the top-level document. |
| **State** | A node in the flow graph. Has a UI artifact, agent config, and transitions. |
| **Transition** | An edge between states, triggered by an event. |
| **Event** | Something that can trigger a transition: tool call, UI event, utterance match, or timeout. |
| **Artifact** | A UI instruction pushed to the client (form, options, card, layout change, navigation). |
| **Agent Config** | Per-state LLM instructions: system prompt suffix, allowed tools, and response constraints. |
| **Variable** | A named value collected during the flow (e.g. `first_name`, `color`). Stored in flow context. |
| **Guard** | A boolean condition on a transition (e.g. `color != null`). |
| **Deterministic Path** | A transition path that does not depend on LLM output — uses UI events, regex, or timeouts. |

---

## 4. Design Principles

### 4.1 The LLM is a Guest, Not the Host

The state machine is the authority on flow control. The LLM operates *within* a state — it can converse naturally, extract entities, and call tools — but it **cannot**:
- Transition to a state not listed in the current state's `transitions`
- Call tools not listed in the current state's `agent.tools`
- Skip or reorder states

### 4.2 Every Transition Has a Deterministic Fallback

For each LLM-dependent transition (e.g. "LLM calls `save_name` tool"), there must exist at least one non-LLM path:
- `on_ui_event` — user taps a button or submits a form
- `on_utterance` — regex/keyword match on STT transcript
- `on_timeout` — automatic advance after N seconds

This ensures the flow completes even if the LLM hallucinates, refuses to call a tool, or is unavailable.

### 4.3 Server-Driven UI

The client is a "dumb terminal." It renders whatever artifact the server pushes and sends interaction events back. The client never decides which screen to show — the flow engine does.

### 4.4 Serializable and Editable

The entire flow definition is a JSON/YAML document with no embedded code. This enables:
- Version control (git-diffable)
- Visual editing in a web-based graph editor
- Runtime loading without server restart
- Cross-platform use (same flow definition for web, mobile, embedded)

---

## 5. Flow Schema

### 5.1 Top-Level Document

```yaml
# Required
id: string                    # Unique flow identifier (e.g. "onboarding", "booking")
version: string               # Semver (e.g. "1.0.0")
initial_state: string         # Name of the entry state

# Optional
description: string           # Human-readable description
variables: map<string, VariableDef>   # Flow-scoped variables
settings: FlowSettings       # Global flow settings
states: map<string, State>    # The state definitions
```

### 5.2 VariableDef

```yaml
variables:
  first_name:
    type: string              # string | number | boolean | enum | object
    required: true            # Must be set before flow ends?
    default: null             # Default value
    enum: null                # For enum type: list of allowed values
    persist: true             # Survive flow restart?
    
  color:
    type: enum
    enum: [blue, green, purple]
    required: true
```

### 5.3 FlowSettings

```yaml
settings:
  max_duration_secs: 300          # Hard timeout for the entire flow
  on_timeout: "timeout_state"     # State to enter if max_duration is hit
  on_error: "error_state"         # State to enter on unrecoverable error
  llm_required: false             # If false, flow can complete without LLM
  allow_back: false               # Allow navigating to previous states
  base_system_prompt: |           # Prepended to every state's agent.prompt
    You are a friendly onboarding assistant.
```

### 5.4 State

```yaml
states:
  ask_name:
    # --- UI Layer ---
    ui:                           # What the client renders (optional)
      artifact_type: form         # form | options | card | orb_layout | navigate | custom
      fields:                     # Artifact-specific payload
        - id: first_name
          type: text
          label: "What's your name?"
      
    # --- Agent Layer ---
    agent:
      prompt: |                   # State-specific system prompt (appended to base)
        Ask the user their name. When they tell you, call `save_name`.
      tools:                      # ONLY these tools are available in this state
        - save_name
      response_constraint:        # Optional guardrails
        max_tokens: 150
        temperature: 0.7
        stop_phrases: []
    
    # --- Tool Definitions ---
    tools:
      save_name:
        description: "Save the user's first name"
        parameters:
          first_name:
            type: string
            required: true
        # Auto-extraction: if LLM fails to call the tool, try regex
        auto_extract:
          first_name:
            patterns:
              - "my name is\\s+([A-Za-z]+)"
              - "i'm\\s+([A-Za-z]+)"
              - "i am\\s+([A-Za-z]+)"
              - "call me\\s+([A-Za-z]+)"

    # --- Transitions ---
    transitions:
      on_tool_call:               # LLM calls a registered tool
        save_name: choose_color
        
      on_ui_event:                # Client sends a UI interaction
        form_submit: choose_color
        
      on_utterance:               # Regex match on STT transcript (deterministic)
        - pattern: "(?:my name is|i'm|i am|call me)\\s+([A-Za-z]+)"
          capture_to: first_name  # Auto-set variable from capture group
          target: choose_color
          
      on_timeout:                 # Auto-advance after silence
        seconds: 60
        target: ask_name          # Re-enter same state (re-prompt)
        max_retries: 2            # After 2 retries, go to fallback
        fallback: timeout_state
        
    # --- Entry/Exit Hooks ---
    on_enter:
      - set: { greeted: true }    # Set a variable
      - emit: state_entered       # Emit analytics event
    on_exit:
      - emit: state_exited
```

### 5.5 Transition Priority

When multiple transition sources fire simultaneously, priority order is:

1. `on_ui_event` — highest (user explicitly tapped/submitted)
2. `on_tool_call` — LLM called a tool
3. `on_utterance` — regex matched user speech
4. `on_timeout` — lowest priority

This ensures deterministic UI actions always win over probabilistic LLM decisions.

### 5.6 Guards

Transitions can have guards — conditions that must be true for the transition to fire:

```yaml
transitions:
  on_tool_call:
    confirm_color:
      target: move_orb
      guard:
        all:                      # ALL conditions must be true
          - variable: color
            operator: in
            value: [blue, green, purple]
          - variable: first_name
            operator: not_empty
```

Guard operators: `eq`, `neq`, `in`, `not_in`, `not_empty`, `empty`, `gt`, `lt`, `gte`, `lte`, `matches` (regex).

### 5.7 Artifact Types

| Type | Purpose | Payload Fields |
|---|---|---|
| `form` | Text input fields | `fields: [{id, type, label, placeholder?}]` |
| `field_update` | Populate a form field by voice/LLM | `field_id: string, value: string` |
| `options` | Tappable choices | `prompt, options: [{id, label, description?}]` |
| `card` | Info display | `card_type, title, content: {}` |
| `orb_layout` | Reposition voice orb | `position: center\|bottom\|bottom_right\|top_right` |
| `navigate` | Screen transition | `screen, params?: {}` |
| `feedback` | Inline annotation | `feedback_type, content: {}` |
| `dismiss` | Remove artifact | `target_id?` (null = dismiss all) |
| `custom` | App-defined | `component: string, props: {}` |

---

## 6. Wire Protocol Extension

VFDL extends the existing Prepatu Voice Protocol (PVP) with these message types:

### 6.1 Server → Client

#### `flow_state`
Sent when the flow engine enters a new state. The client uses this to render the UI.

```json
{
  "type": "flow_state",
  "flow_id": "onboarding",
  "state": "ask_name",
  "artifact": {
    "artifact_type": "form",
    "fields": [{"id": "first_name", "type": "text", "label": "What's your name?"}]
  },
  "variables": { "first_name": null, "color": null },
  "available_actions": ["form_submit"],
  "progress": { "current": 1, "total": 4 }
}
```

#### `flow_variable`
Sent when a flow variable is updated (so the client can reflect it in analytics / debug UI).

```json
{
  "type": "flow_variable",
  "flow_id": "onboarding",
  "key": "first_name",
  "value": "Alex"
}
```

#### `artifact` — `field_update`
Sent automatically by the flow engine whenever a variable is set **and** the current
state's `form` artifact contains a field whose `id` matches the variable name.  
The client must update the corresponding input value without requiring user interaction.

This is the primary mechanism by which **voice populates UI form fields** — the server
is the source of truth; the client is a dumb terminal.

```json
{
  "type": "artifact",
  "artifact_type": "field_update",
  "field_id": "first_name",
  "value": "Alex"
}
```

**YAML author contract**: Name the form field `id` to match the flow variable name.
No extra configuration is needed — the engine handles auto-emission.

```yaml
# In the state's ui section:
ui:
  artifact_type: form
  fields:
    - id: first_name   # ← must match the variable name "first_name"
      type: text
      label: "What's your name?"
```

#### `flow_end`
```json
{
  "type": "flow_end",
  "flow_id": "onboarding",
  "reason": "completed",
  "variables": { "first_name": "Alex", "color": "blue" }
}
```

### 6.2 Client → Server

#### `ui_event`
```json
{
  "type": "ui_event",
  "flow_id": "onboarding",
  "action": "form_submit",
  "data": { "first_name": "Alex" }
}
```

#### `ui_event` (option select)
```json
{
  "type": "ui_event",
  "flow_id": "onboarding", 
  "action": "option_select",
  "data": { "selected_id": "blue" }
}
```

---

## 7. Runtime Engine Behavior

### 7.1 State Entry Sequence

When the engine enters a state:

```
1. Execute on_enter hooks (set variables, emit events)
2. Push UI artifact to client via flow_state message
3. Update LLM context:
   a. Replace system prompt = base_prompt + "\n\n[CURRENT OBJECTIVE]\n" + state.agent.prompt
   b. Format prompt with current variables (template interpolation)
   c. Register ONLY the tools listed in state.agent.tools
   d. Apply response_constraint (max_tokens, temperature)
4. Trigger LLM generation (so the agent speaks immediately)
5. Start timeout timer (if on_timeout is defined)
6. Begin listening for transition events
```

### 7.2 Utterance Matching (Deterministic LLM Bypass)

When STT produces a transcript, before the LLM processes it:

```
1. Check on_utterance patterns against the transcript
2. If a pattern matches:
   a. Extract capture groups into variables
   b. Evaluate guards
   c. If guards pass → transition immediately (skip LLM)
   d. If guards fail → let LLM process normally
3. If no pattern matches → let LLM process normally
```

This is the key hallucination prevention mechanism. For critical flows, you define utterance patterns that deterministically extract data and transition without LLM involvement.

### 7.3 Tool Call Handling

When the LLM calls a tool:

```
1. Verify tool is in state.agent.tools (reject if not)
2. Validate arguments against tool schema
3. If validation fails AND auto_extract is defined:
   a. Try regex extraction from latest user utterance
   b. Backfill missing arguments
4. Store extracted variables in flow context
5. Check on_tool_call transitions
6. If a transition matches → enter next state
```

### 7.4 LLM Failure Modes & Mitigations

| Failure Mode | Mitigation |
|---|---|
| LLM never calls the expected tool | `on_utterance` regex catches the data, `on_timeout` re-prompts |
| LLM calls a tool with wrong arguments | `auto_extract` backfills from speech, schema validation rejects garbage |
| LLM calls a tool not in `agent.tools` | Engine rejects it silently, logs warning |
| LLM tries to skip ahead | Impossible — tool registry is scoped per state |
| LLM hallucinates a screen name | `navigate` artifact `screen` is validated against an allowlist |
| LLM is down / times out | `on_timeout` with `fallback` state, or UI-only path completes the flow |

---

## 8. Example Flow: Onboarding

```yaml
id: onboarding
version: "1.0.0"
initial_state: ask_name
description: "3-step onboarding: name → color → orb placement"

variables:
  first_name:
    type: string
    required: true
  color:
    type: enum
    enum: [blue, green, purple]
    required: true

settings:
  max_duration_secs: 180
  on_timeout: timeout_exit
  base_system_prompt: |
    You are a friendly onboarding guide for Prepatu, an IELTS practice app.
    Keep responses to 1-2 sentences. Use the user's name naturally once known.

states:
  # ── Step 1: Ask Name ──────────────────────────────
  ask_name:
    ui:
      artifact_type: form
      fields:
        - id: first_name
          type: text
          label: "What's your name?"
    agent:
      prompt: |
        Greet the user warmly and ask their name. 
        When they tell you, call `save_name`.
      tools: [save_name]
    tools:
      save_name:
        description: "Save the user's first name"
        parameters:
          first_name: { type: string, required: true }
        auto_extract:
          first_name:
            patterns:
              - "(?:my name is|i'm|i am|call me)\\s+([A-Za-z][A-Za-z'\\-]*)"
    transitions:
      on_tool_call:
        save_name: choose_color
      on_ui_event:
        form_submit: choose_color
      on_utterance:
        - pattern: "(?:my name is|i'm|i am|call me)\\s+([A-Za-z][A-Za-z'\\-]*)"
          capture_to: first_name
          target: choose_color
      on_timeout:
        seconds: 45
        target: ask_name
        max_retries: 2
        fallback: timeout_exit

  # ── Step 2: Choose Color ──────────────────────────
  choose_color:
    ui:
      artifact_type: options
      prompt: "Nice to meet you, {first_name}! Pick a theme color:"
      options:
        - { id: blue, label: Blue }
        - { id: green, label: Green }
        - { id: purple, label: Purple }
    agent:
      prompt: |
        Nice to meet you, {first_name}! Let's pick a color for your profile.
        You can say a color or they can tap one on screen.
        Ask them to confirm before calling `confirm_color`.
      tools: [confirm_color]
    tools:
      confirm_color:
        description: "Confirm the chosen color after user says yes"
        parameters:
          color: { type: string, enum: [blue, green, purple], required: true }
        auto_extract:
          color:
            patterns: ["\\b(blue|green|purple)\\b"]
    transitions:
      on_tool_call:
        confirm_color:
          target: move_orb
          guard:
            all:
              - { variable: color, operator: in, value: [blue, green, purple] }
      on_ui_event:
        option_select: move_orb     # Direct tap = no confirmation needed
      on_utterance:
        - pattern: "\\b(blue|green|purple)\\b"
          capture_to: color
          requires_confirmation: true  # Engine asks "Did you mean {color}?"
          target: move_orb

  # ── Step 3: Move Orb ─────────────────────────────
  move_orb:
    ui:
      artifact_type: orb_layout
      position: bottom
    agent:
      prompt: |
        Tell {first_name} the voice orb will live at the bottom during practice.
        Then call `finish_onboarding`.
      tools: [finish_onboarding]
    tools:
      finish_onboarding:
        description: "Complete the onboarding tour"
        parameters: {}
    transitions:
      on_tool_call:
        finish_onboarding: end_flow
      on_timeout:
        seconds: 15
        target: end_flow          # Auto-advance if LLM doesn't call tool

  # ── Terminal States ───────────────────────────────
  end_flow:
    ui:
      artifact_type: navigate
      screen: Home
    agent:
      prompt: "Say a brief goodbye and stay silent."
      tools: []
    transitions: {}               # No transitions = terminal state

  timeout_exit:
    ui:
      artifact_type: navigate
      screen: Home
    agent:
      prompt: "The user seems busy. Say goodbye briefly."
      tools: []
    transitions: {}
```

---

## 9. Confirmation Gates & Blocked Transition Feedback

This section covers the specific pattern where:
1. The user provides data via voice
2. The UI reflects the captured value immediately
3. The agent asks the user to confirm before advancing
4. If the engine tries to advance without confirmation being satisfied, it is **blocked** and both the frontend and the LLM are notified

### 9.1 The Problem

Without a confirmation gate, the typical failure mode is:

```
User says: "My name is Alex"
  → STT → LLM context → LLM calls save_name(first_name="Alex")
  → Engine transitions to next state immediately
  → User never saw their name reflected in the form
  → User never confirmed "yes, that's correct"
```

This is jarring. The user feels bypassed.

### 9.2 State-Level Confirmation Gate

**Design principle: the LLM does the NLU, the state machine enforces the invariant.**

We do not hardcode phrase lists like `["yes", "yeah", "yep"]`. That replicates NLU that the LLM already handles correctly and flexibly. Instead, the state machine exposes two confirmation tools (`confirm_<variable>` and `reject_<variable>`) that the LLM calls when *it* determines the user has confirmed or rejected. The state machine's only job is to ensure those tools were called before any transition fires.

```yaml
states:
  ask_name:
    confirmation_gate:
      variables: [first_name]     # Variables that require explicit confirmation
      on_confirm: choose_color    # Target state after LLM calls confirm_first_name
      on_reject:                  # What happens when LLM calls reject_first_name
        action: clear             # Clear the variable(s)
        target: ask_name          # Re-enter state (re-ask)
```

This declaration automatically registers two tools into the state's `agent.tools`:
- `confirm_first_name()` — LLM calls this when it judges the user said yes
- `reject_first_name()` — LLM calls this when it judges the user said no / wants to correct

The LLM's `agent.prompt` instructs it on when and how to use these tools, but the understanding of what constitutes a confirmation is left entirely to the LLM.

**Engine behavior when `confirmation_gate` is declared:**

```
1. Variable captured (via tool call, utterance, or UI event)
   → emit flow_variable to frontend (UI fills in the field visually)
   → Enter "pending_confirmation" sub-phase
   → LLM generates: e.g. "I heard Alex — does that sound right?"
   → Timeout starts (same on_timeout rules apply)

2a. LLM calls confirm_first_name()
   → transition fires to on_confirm target

2b. LLM calls reject_first_name()
   → variable cleared → flow_variable(first_name=null) to frontend
   → transition to on_reject.target

2c. LLM tries to transition WITHOUT calling confirm/reject first
   → BLOCKED (see Section 9.3)
```

### 9.3 Blocked Transition Notification

When a guard fails, a required confirmation is pending, or an LLM tries to call a tool that would cause an invalid transition, the engine **does not silently swallow the event**. It emits a `transition_blocked` notification to both the frontend and the LLM context.

#### Why notify the LLM?

Without feedback, the LLM continues as if the transition succeeded. It might respond with phrases like "Great, let's pick a color!" while the user is still on the name screen. The blocked notification is injected back into the LLM context as a system message so the LLM can self-correct.

#### `transition_blocked` — Server → Client

```json
{
  "type": "transition_blocked",
  "flow_id": "onboarding",
  "from_state": "ask_name",
  "attempted_target": "choose_color",
  "reason": "pending_confirmation",
  "detail": "Variable 'first_name' was captured but not confirmed by user.",
  "current_phase": "pending_confirmation",
  "variables": { "first_name": "Alex" }
}
```

`reason` values:
- `pending_confirmation` — a confirmation gate is active
- `guard_failed` — a guard expression evaluated to false
- `tool_not_allowed` — LLM called a tool not in `agent.tools` for this state
- `invalid_target` — transition target state does not exist
- `variable_invalid` — captured variable failed type/enum validation

#### LLM Self-Correction Injection

When a transition is blocked, the engine appends a system message to the LLM context **on the next turn** (never mid-speech):

```
[SYSTEM — flow engine]: Transition to 'choose_color' was blocked.
Reason: pending_confirmation.
The user has not confirmed their name yet. 
The current phase is: pending_confirmation.
Current variables: {first_name: "Alex"}.
Please acknowledge and ask the user to confirm.
```

This message is **not spoken** — it is injected as a `role: system` message so only the LLM sees it. The LLM then generates a response that acknowledges the situation and asks for confirmation naturally.

### 9.4 Variable Reflection to UI

Whenever the engine sets a flow variable (from any source — tool call, utterance regex, UI event), it immediately emits `flow_variable` to the client:

```json
{ "type": "flow_variable", "flow_id": "onboarding", "key": "first_name", "value": "Alex" }
```

The client uses this to update the form field visually (e.g. fill in the text input with "Alex") **before** any confirmation has happened. This gives the user immediate visual feedback that their speech was heard correctly — and lets them see if there was a mishearing before they confirm.

**Complete flow for the name screen:**

```
User speaks: "My name is Alex"
  ↓ STT transcript
  ↓ utterance regex matches → first_name = "Alex"
  ↓ Server emits flow_variable(first_name="Alex")
        → Client fills in text field: [Alex        ]
  ↓ Engine enters pending_confirmation phase
  ↓ LLM is prompted: "I heard Alex — is that right?"
  ↓ Agent speaks: "Nice! I heard Alex. Is that correct?"

User confirms: "Yes"
  ↓ confirm_phrases matches
  ↓ Transition fires → choose_color
  ↓ Server emits flow_state(choose_color)
        → Client renders options screen

--- OR ---

User corrects: "No, it's Alice"
  ↓ reject_phrases matches
  ↓ first_name cleared → flow_variable(first_name=null)
        → Client clears text field: [            ]
  ↓ Re-enter ask_name
  ↓ Agent speaks: "My apologies! What's your name?"
```

### 9.5 Full YAML for the Ask Name State with Confirmation Gate

```yaml
states:
  ask_name:
    ui:
      artifact_type: form
      fields:
        - id: first_name
          type: text
          label: "What's your name?"
          # Client shows this as editable; flow_variable messages auto-fill it

    agent:
      prompt: |
        Greet the user and ask their name.
        When you hear their name, DO NOT move forward yet.
        Say: "I heard [name] — is that right?"
        Only advance once the user says yes.
      tools: [save_name]
      # Note: no transition tools here — the engine handles advancement

    tools:
      save_name:
        description: "Record the user's name (does not advance — confirmation required)"
        parameters:
          first_name: { type: string, required: true }
        auto_extract:
          first_name:
            patterns:
              - "(?:my name is|i'm|i am|call me)\\s+([A-Za-z][A-Za-z'\\-]*)"
        # Tool SETS the variable but does NOT trigger a transition
        # Transition is owned by confirmation_gate, not on_tool_call
        sets_variable: first_name
        advances: false           # Explicit: this tool does not advance the state

    confirmation_gate:
      variables: [first_name]
      prompt: "I heard {first_name} — is that right?"
      confirm_phrases: ["yes", "yeah", "yep", "correct", "right", "sure", "ok"]
      reject_phrases:  ["no", "nope", "wrong", "not quite", "actually"]
      on_confirm: choose_color
      on_reject:
        action: clear
        target: ask_name

    transitions:
      on_ui_event:
        form_submit: choose_color   # Typing and submitting bypasses voice confirmation

    on_transition_blocked:
      notify_llm: true             # Inject system message (see 9.3)
      notify_client: true          # Emit transition_blocked to frontend
      log_level: warning
```

---

## 10. Visual Flow Editor (Concept)

The YAML/JSON schema is designed to be editable in a web-based visual editor:

```
┌─────────────────────────────────────────────────────────────────┐
│  Flow Editor: onboarding v1.0.0                          [Save]│
├──────────────────────────┬──────────────────────────────────────┤
│                          │  State: ask_name                    │
│   ┌───────────┐          │  ┌─ UI ───────────────────────────┐ │
│   │ ask_name  │──────────│  │ type: form                     │ │
│   └─────┬─────┘          │  │ fields: [first_name: text]     │ │
│         │                │  └────────────────────────────────┘ │
│         ▼                │  ┌─ Agent ────────────────────────┐ │
│   ┌─────────────┐        │  │ prompt: "Greet and ask name"   │ │
│   │choose_color │────────│  │ tools: [save_name]             │ │
│   └─────┬───────┘        │  └────────────────────────────────┘ │
│         │                │  ┌─ Transitions ──────────────────┐ │
│         ▼                │  │ tool:save_name → choose_color  │ │
│   ┌──────────┐           │  │ ui:form_submit → choose_color  │ │
│   │ move_orb │───────────│  │ utterance: /my name is (\w+)/  │ │
│   └─────┬────┘           │  │ timeout: 45s → retry (max 2)  │ │
│         ▼                │  └────────────────────────────────┘ │
│   ┌──────────┐           │                                    │
│   │ end_flow │           │  ┌─ Variables ────────────────────┐ │
│   └──────────┘           │  │ first_name: string (required)  │ │
│                          │  │ color: enum (required)         │ │
│                          │  └────────────────────────────────┘ │
└──────────────────────────┴──────────────────────────────────────┘
```

The editor would:
- Parse YAML ↔ render graph (using a library like Reactflow)
- Allow drag-and-drop state creation
- Inline editing of prompts, tools, transitions
- Export valid YAML/JSON
- Validate the flow (no orphan states, all transitions resolve, all required variables have a setter)

---

## 10. Relationship to Existing Prepatu Architecture

### 10.1 What Already Exists

| Component | File | Status |
|---|---|---|
| Flow schema (Pydantic) | `backend/agents/flow_engine.py` | Basic — `FlowConfig`, `StateConfig`, `UIConfig` |
| Flow YAML loader | `backend/agents/flow_engine.py` | Working — `load_flow()` |
| Flow controller | `backend/agents/flow_engine.py` | Working — `VoiceFlowController` |
| Onboarding flow | `backend/agents/flows/onboarding.yaml` | Working example |
| Artifact types | `mobile/src/types/artifacts.ts` | Comprehensive TypeScript union |
| Wire protocol (PVP) | `backend/pvp/` | Documented, versioned |
| Server-Driven UI | `backend/agents/artifacts.py` | Working for assistant mode |

### 10.2 What VFDL Adds

| Feature | Current | VFDL |
|---|---|---|
| Variable declarations | Implicit (`state_data` dict) | Explicit with types, enums, validation |
| Utterance matching | Hardcoded in Python (`_infer_name`) | Declarative regex in YAML |
| Guards | None | Composable boolean expressions |
| Timeout transitions | None | Per-state configurable |
| Tool schema in flow file | Hardcoded in `bot.py` | Declared alongside states |
| Auto-extraction fallback | Hardcoded in `handle_tool_call` | Declarative `auto_extract` per tool |
| Flow-level settings | None | `max_duration`, `on_error`, `on_timeout` |
| Progress tracking | None | `progress: {current, total}` in `flow_state` |
| Visual editability | Edit YAML by hand | Schema designed for graph editor |

---

## 11. Validation Rules

A conforming VFDL processor MUST validate:

1. `initial_state` references an existing state
2. All transition targets reference existing states
3. All `agent.tools` entries have a matching tool definition (state-local or global)
4. All template variables in prompts (`{first_name}`) reference declared variables
5. Enum variables used in guards reference valid enum values
6. No orphan states (unreachable from `initial_state`)
7. At least one terminal state exists (state with empty `transitions`)
8. Every state with an LLM-dependent transition also has a deterministic fallback (WARNING, not ERROR)

---

## 12. Open Questions

> [!IMPORTANT]
> **Parallel/nested states:** Should VFDL support SCXML-style parallel regions and nested substates? This adds power but significant complexity. Current recommendation: defer to v2.

> [!IMPORTANT]
> **History states:** Should re-entering a parent state resume at the last active child? Useful for "back" navigation. Current recommendation: optional, via `allow_back` flag.

> [!WARNING]
> **Tool definition ownership:** Should tools be defined inline per-state (current proposal) or in a global `tools` section referenced by name? Global is DRYer but inline is more self-contained.

> [!NOTE]
> **Confirmation loops:** Section 9 formalizes this as a first-class `confirmation_gate` feature at the state level. The alternative — an explicit intermediate "confirm" state — is more verbose but gives more control. VFDL should support both: `confirmation_gate` as sugar for simple cases, explicit states for complex ones.

> [!NOTE]
> **LLM-generated flows (autoconfigurable forms):** Because VFDL is a serializable, schema-validated, code-free document, it is a natural target for LLM generation. A future SDK expansion could expose a `Prepatu.createFlow(description)` API where the developer provides a natural-language description of a wizard or form (e.g. `"Collect name, email, and preferred appointment date, confirm each field before advancing"`) and the SDK — or a `POST /v1/flows/generate` cloud endpoint — uses an LLM to produce a valid VFDL YAML. The generated flow would be validated by the existing schema rules (Section 11) before being accepted. This would make Prepatu a no-code voice form builder. Key design constraint: generated flows must pass the same validation as hand-authored ones — the LLM generates structure, never executable code.

> [!NOTE]
> **Session-start variable injection:** The cloud service use case (multi-tenant, wizard-as-a-service) may benefit from a lightweight mechanism to pass a `context` map when starting a session — pre-filling flow variables or overriding `base_system_prompt` at runtime without creating a new flow definition. Example: the same "appointment booking" flow reused across accounts, but each account injects their business name and available time slots as startup context. This avoids flow-per-tenant proliferation while keeping flows static and auditable.

---

## 13. Implementation Roadmap

| Phase | Scope |
|---|---|
| **Phase 1** | Upgrade `FlowConfig` Pydantic models to match VFDL schema. Add `variables`, `guards`, `on_utterance`, `on_timeout`. |
| **Phase 1b** | Add `confirmation_gate` and `on_transition_blocked` to `VoiceFlowController`. Emit `flow_variable` immediately on capture. |
| **Phase 2** | Add `flow_state` / `flow_variable` / `flow_end` / `transition_blocked` wire messages to PVP. |
| **Phase 3** | Build validation layer (Section 12 rules). |
| **Phase 4** | Build web-based visual flow editor (React + Reactflow). |
| **Phase 5** | Add flow testing framework — simulate flows without LLM by using only deterministic paths. |

---

## 14. References

1. W3C SCXML — [https://www.w3.org/TR/scxml/](https://www.w3.org/TR/scxml/)
2. W3C VoiceXML 2.1 — [https://www.w3.org/TR/voicexml21/](https://www.w3.org/TR/voicexml21/)
3. XState v5 Documentation — [https://stately.ai/docs](https://stately.ai/docs)
4. RTVI Specification — [https://github.com/rtvi-ai/rtvi](https://github.com/rtvi-ai/rtvi)
5. Prepatu Voice Protocol (PVP) — `backend/pvp/README.md`
6. Harel Statecharts — D. Harel, "Statecharts: A Visual Formalism for Complex Systems," 1987
