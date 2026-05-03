---
id: booking-wizard
title: "Example: Booking Wizard"
sidebar_position: 2
---

# Build a Booking Wizard

In this example we build a 3-step voice appointment booking wizard. The user provides their contact details, picks a date and service, reviews everything, and confirms — all by voice, with forms that fill in live.

This example demonstrates:
- **Form artifacts** with voice-to-form autofill
- **Capture tools** that update individual fields without advancing the flow
- **Multi-step wizards** with variable interpolation across states
- **Review & confirm** pattern with restart capability

---

## The Flow Design

```
collect_contact → collect_appointment → review → done
                                          ↓
                                  restart_booking → collect_contact
```

| State | UI | What's collected |
|---|---|---|
| `collect_contact` | Form (name + email) | `full_name`, `email` |
| `collect_appointment` | Form (date + time + service) | `date`, `time_slot`, `service` |
| `review` | Card (summary) | Nothing — confirmation only |
| `done` | Card (success) | — |

---

## Step 1: Contact Details

```yaml
states:
  collect_contact:
    ui:
      artifact_type: form
      prompt: "Hi! Let's start with your contact details."
      fields:
        - id: full_name
          label: Full Name
          type: text
          placeholder: "e.g. Jane Smith"
        - id: email
          label: Email Address
          type: email
          placeholder: "jane@example.com"

    agent:
      prompt: |
        You are on Step 1 of 3: Contact Details.
        Greet the user warmly and ask for their full name and email address.
        IMPORTANT: As soon as the user gives you their name, IMMEDIATELY call
        `capture_name` — do not wait for the email first. This updates the
        form field in real time.
        Similarly, as soon as you have their email, call `capture_email`.
        Once you have BOTH name and email confirmed, call `save_contact` to
        proceed to the next step.
      tools:
        - capture_name
        - capture_email
        - save_contact
```

### Capture Tools — The Voice-to-Form Pattern

This is the key pattern. Three tools are defined, but only `save_contact` triggers a transition:

```yaml
    tools:
      capture_name:
        description: "Call IMMEDIATELY when the user tells you their name."
        speech_cue: "Got it! Now could you please share your email address?"
        parameters:
          full_name: { type: string, required: true }

      capture_email:
        description: "Call IMMEDIATELY when the user tells you their email."
        # No speech_cue → engine auto-generates from remaining unfilled fields
        parameters:
          email: { type: string, required: true }

      save_contact:
        description: "Call once you have BOTH name and email confirmed."
        parameters:
          full_name: { type: string, required: true }
          email: { type: string, required: true }

    transitions:
      on_tool_call:
        save_contact: collect_appointment
        # capture_name and capture_email are NOT here — they stay in this state
      on_ui_event:
        form_submit: collect_appointment
```

**What happens when the user says "I'm Jane Smith":**

1. LLM calls `capture_name(full_name="Jane Smith")`
2. Engine sets `full_name = "Jane Smith"` (flow variable)
3. Engine emits `flow_variable(key="full_name", value="Jane Smith")`
4. Engine sees `full_name` matches form field `id: full_name` → emits `field_update`
5. Frontend receives field_update → the "Full Name" input fills in with "Jane Smith"
6. No transition fires (capture_name isn't in `on_tool_call`)
7. LLM receives the `speech_cue`: "Got it! Now could you please share your email?"
8. LLM asks for the email

The form fields fill in **one at a time** as the user speaks. This feels magical.

### Auto-Generated Speech Cues

When `capture_email` is called and it has no explicit `speech_cue`, the engine auto-generates one from the remaining unfilled form fields:

- If email was the last field: *"Got it, all fields are captured."*
- If name is still missing: *"Got it! I still need your Full Name."*

---

## Step 2: Appointment Details

```yaml
  collect_appointment:
    ui:
      artifact_type: form
      prompt: "Great, {full_name}! Now let's pick your appointment."
      fields:
        - id: date
          label: Preferred Date
          type: text
          placeholder: "e.g. May 20 or next Monday"
        - id: time_slot
          label: Time Slot
          type: text
          placeholder: "9 AM, 10 AM, 11 AM, 2 PM, 3 PM, or 4 PM"
        - id: service
          label: Service Type
          type: text
          placeholder: "consultation, support, or demo"

    agent:
      prompt: |
        You are on Step 2 of 3: Appointment Details.
        You already have {full_name}'s email ({email}).
        Ask for date, time slot, and service type.
        Call `save_appointment` when you have all three.
      tools: [save_appointment]

    tools:
      save_appointment:
        description: "Save date, time, and service — move to review."
        parameters:
          date: { type: string, required: true }
          time_slot: { type: string, required: true }
          service:
            type: string
            required: true
            enum: [consultation, support, demo]

    transitions:
      on_tool_call:
        save_appointment: review
      on_ui_event:
        form_submit: review
```

Notice `{full_name}` in the UI prompt — the engine interpolates the variable from Step 1.

---

## Step 3: Review & Confirm

```yaml
  review:
    ui:
      artifact_type: card
      prompt: |
        Booking Summary

        Name:    {full_name}
        Email:   {email}
        Date:    {date}
        Time:    {time_slot}
        Service: {service}

    agent:
      prompt: |
        Read the booking details back to {full_name}.
        Ask them to confirm. Call `confirm_booking` if yes.
        Call `restart_booking` if they want to start over.
      tools: [confirm_booking, restart_booking]

    tools:
      confirm_booking:
        description: "Finalize the booking."
      restart_booking:
        description: "Start over from step 1."

    transitions:
      on_tool_call:
        confirm_booking: done
        restart_booking: collect_contact
```

Two tools, two possible paths:
- **Confirm** → `done` (success)
- **Restart** → `collect_contact` (loop back to Step 1)

---

## Step 4: Done

```yaml
  done:
    ui:
      artifact_type: card
      prompt: |
        Booking Confirmed! ✅

        Thank you, {full_name}!
        Your {service} is booked for {date} at {time_slot}.
        A confirmation will be sent to {email}.

    agent:
      prompt: |
        Congratulate {full_name}. Wish them a great day.
      tools: []
    transitions: {}
```

Terminal state — no tools, no transitions.

---

## The Complete Flow

The full YAML is available at [`apps/demo-wizard/flow.yaml`](https://github.com/busytaal/prepatu/blob/main/apps/demo-wizard/flow.yaml).

---

## Frontend — Rendering the Wizard

```typescript
let currentFields = [];

function handleMessage(msg) {
  if (msg.type === 'flow_state') {
    const a = msg.artifact;
    if (a.artifact_type === 'form') {
      currentFields = a.fields;
      renderForm(a);
    } else if (a.artifact_type === 'card') {
      renderCard(a);
    }
  }

  if (msg.type === 'artifact' && msg.artifact_type === 'field_update') {
    // Voice-to-form autofill — update the input
    const input = document.getElementById(`field-${msg.field_id}`);
    if (input) input.value = msg.value;
  }
}
```

---

## Patterns to Reuse

| Pattern | How it's used | Reuse in your app |
|---|---|---|
| Capture tools | `capture_name` fills one field at a time | Any multi-field form |
| `speech_cue` | Custom follow-up after partial capture | Guide the conversation |
| Auto-generated cues | Engine knows which fields remain | Less YAML to write |
| Variable interpolation | `{full_name}` in prompts and cards | Personalize every state |
| Restart loop | `restart_booking → collect_contact` | Edit flows, undo patterns |
| `on_ui_event` fallback | Form submit works without voice | Accessibility, multimodal |
