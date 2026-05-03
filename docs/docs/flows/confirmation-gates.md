---
id: confirmation-gates
title: Confirmation Gates
sidebar_position: 4
---

# Confirmation Gates

A confirmation gate is a built-in pattern that prevents the flow from advancing until the user explicitly confirms captured data. It solves a common problem with voice agents: the AI hears "Alex", fills in the name, and immediately moves on — but the user never got to verify if it heard correctly.

---

## The Problem

Without a confirmation gate:

```
User says: "My name is Alex"
  → LLM calls save_name(first_name="Alex")
  → Engine transitions to next state immediately
  → User never saw "Alex" on screen
  → User never confirmed "yes, that's correct"
```

The user feels bypassed. Worse, if STT misheard ("Alex" → "Alec"), the error propagates silently.

## The Solution

Add a `confirmation_gate` to the state. The engine will:

1. Let the LLM capture the data (call the tool, set the variable)
2. Push the value to the UI immediately (so the user sees it)
3. **Block the transition** until the user confirms or rejects
4. Auto-generate `confirm_X` and `reject_X` tools for the LLM to call

```yaml
states:
  ask_name:
    ui:
      artifact_type: form
      fields:
        - id: first_name
          type: text
          label: "What's your name?"

    agent:
      prompt: |
        Ask the user their name. When you hear it, call `save_name`.
        Then ask them to confirm: "I heard [name] — is that right?"
        Call `confirm_first_name` when they say yes.
        Call `reject_first_name` if they want to change it.
      tools:
        - save_name

    tools:
      save_name:
        description: "Capture the user's name (does not advance the flow)."
        parameters:
          first_name: { type: string, required: true }

    confirmation_gate:
      variables: [first_name]
      on_confirm: choose_color
      on_reject:
        action: clear
        target: ask_name

    transitions:
      on_ui_event:
        form_submit: choose_color
```

---

## How It Works

### Step by step

```
1. User says: "My name is Alex"
   → LLM calls save_name(first_name="Alex")
   → Engine sets first_name = "Alex"
   → Engine emits flow_variable(first_name="Alex") → UI fills in the field
   → Engine enters "pending_confirmation" phase

2. LLM asks: "I heard Alex — is that right?"

3a. User says "Yes"
   → LLM calls confirm_first_name()
   → Engine transitions to choose_color ✅

3b. User says "No, it's Alice"
   → LLM calls reject_first_name()
   → Engine clears first_name
   → Engine re-enters ask_name (re-ask)
```

### Auto-generated tools

When you declare `confirmation_gate.variables: [first_name]`, the engine automatically creates two tools:

- **`confirm_first_name()`** — advances to `on_confirm` target
- **`reject_first_name()`** — clears the variable and goes to `on_reject.target`

These are registered into the LLM's tool list alongside your regular tools. You don't need to define them in the `tools:` section.

### The LLM still does the NLU

Notice the engine does **not** have a hardcoded list of confirmation phrases ("yes", "yeah", "yep"). The LLM determines whether the user confirmed or rejected — it's better at this than any phrase list. The engine's only job is to ensure one of the confirmation tools was called before any transition fires.

---

## Blocked Transitions

If the LLM tries to call a tool that would trigger a transition while a confirmation gate is pending, the engine **blocks it** and notifies both the frontend and the LLM:

### Frontend notification

```json
{
  "type": "transition_blocked",
  "flow_id": "onboarding",
  "from_state": "ask_name",
  "attempted_target": "choose_color",
  "reason": "pending_confirmation",
  "detail": "Variable 'first_name' was captured but not confirmed by user.",
  "variables": { "first_name": "Alex" }
}
```

### LLM self-correction

The engine injects a system message into the LLM context:

```
[SYSTEM — flow engine]: Transition to 'choose_color' was blocked.
Reason: pending_confirmation.
Variable(s) ['first_name'] captured but not yet confirmed by the user.
Please acknowledge and ask the user to confirm.
```

This is never spoken aloud — it's a `role: system` message. The LLM reads it and self-corrects: *"I still need you to confirm — is Alex correct?"*

---

## Multiple Variables

You can gate on multiple variables at once:

```yaml
confirmation_gate:
  variables: [first_name, date_of_birth]
  on_confirm: next_step
  on_reject:
    action: clear
    target: collect_info
```

This generates `confirm_first_name`, `reject_first_name`, `confirm_date_of_birth`, and `reject_date_of_birth`. The engine only advances when **all** gated variables have been confirmed.

---

## UI Events Bypass the Gate

`on_ui_event` transitions always win — if the user types into the form and hits submit, the confirmation gate is skipped. This is by design: the user explicitly provided the data via UI, so no voice confirmation is needed.

```yaml
transitions:
  on_ui_event:
    form_submit: choose_color    # Bypasses confirmation gate
```

---

## When to Use Confirmation Gates

| Use case | Use a gate? |
|---|---|
| Collecting a name, email, or address | ✅ Yes — STT errors are common with proper nouns |
| Picking from a fixed list (colors, categories) | ❌ Probably not — the LLM can confirm inline |
| Critical data (payment, booking confirmation) | ✅ Absolutely |
| Simple yes/no questions | ❌ No — no data to confirm |
