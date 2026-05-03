---
id: ten-questions
title: "Example: 10 Questions Game"
sidebar_position: 1
---

# Build a 10 Questions Game

In this example we build a complete voice game: the AI secretly picks something, the player asks up to 10 yes/no questions, and tries to guess what it is. The entire game logic lives in a single YAML file.

This example demonstrates:
- **Card-based UI** — no forms, just display cards that update with game state
- **Capture tools without transitions** — `record_answer` and `guess_wrong` stay in the same state
- **`speech_cue`** — custom speech hints that drive the LLM's next response
- **Flow variables as live UI state** — `questions_asked` and `last_answer` update the card in real time

---

## The Game Design

```
setup → playing → won → (play_again → setup)
                → lost → (play_again → setup)
```

| State | What happens |
|---|---|
| `setup` | AI picks a secret thing, calls `begin_game` |
| `playing` | User asks questions, AI answers. Stays here until guess or 10 questions |
| `won` | User guessed correctly |
| `lost` | Used all 10 questions without guessing |

---

## The Flow — Step by Step

### Header & Variables

```yaml
id: ten-questions
version: "1.0.0"
initial_state: setup

variables:
  secret_thing:
    type: string
    required: true
  questions_asked:
    type: string
    required: false
  last_answer:
    type: string
    required: false
```

Three variables:
- `secret_thing` — what the AI chose (never shown to the player until game ends)
- `questions_asked` — running count, updated live on the card
- `last_answer` — the AI's most recent yes/no answer

### Settings

```yaml
settings:
  base_system_prompt: |
    You are the host of a 10 Questions game. You have secretly chosen something —
    an animal, celebrity, movie, food, place, or everyday object.
    The player asks yes/no questions and you answer honestly and briefly.
    Never reveal the secret unless they guess it correctly or the game ends.
    Be playful, encouraging, and keep your answers snappy (1–2 sentences max).
```

This personality persists across all states.

### `setup` — AI Picks a Secret

```yaml
states:
  setup:
    ui:
      artifact_type: card
      prompt: |
        🎯  10 Questions

        I'm thinking of something…
        Ask yes/no questions to figure out what it is.
        You get 10 questions — make them count!

    agent:
      prompt: |
        Start a new round of 10 Questions.
        Secretly pick ONE specific thing — be specific (e.g. "a flamingo", not "a bird").
        Do NOT reveal your choice. Call `begin_game` with your secret,
        then warmly welcome the player and explain the rules.
      tools: [begin_game]

    tools:
      begin_game:
        description: "Lock in your secret choice and start the game."
        parameters:
          secret_thing:
            type: string
            description: "The specific thing you are secretly thinking of."
            required: true

    transitions:
      on_tool_call:
        begin_game: playing
```

The AI has one job: pick something and call `begin_game`. It can't do anything else — `begin_game` is the only tool.

### `playing` — The Main Game Loop

This is the most interesting state:

```yaml
  playing:
    ui:
      artifact_type: card
      prompt: |
        ❓  Question {questions_asked} / 10

        Last answer: {last_answer}

    agent:
      prompt: |
        Your secret: {secret_thing}
        Questions asked: {questions_asked} / 10.

        For each player input:
        • YES/NO QUESTION — Answer honestly, then call `record_answer`.
        • CORRECT GUESS — Call `guess_correct`.
        • WRONG GUESS — Call `guess_wrong` with their guess.
        • AFTER 10 QUESTIONS — Call `out_of_questions`.
      tools: [record_answer, guess_correct, guess_wrong, out_of_questions]

    tools:
      record_answer:
        description: "Call after answering each yes/no question."
        parameters:
          last_answer:
            type: string
            description: "The yes/no answer you just gave."
            required: true
          questions_asked:
            type: string
            description: "Running total of questions asked (1–10)."
            required: true

      guess_correct:
        description: "The player guessed correctly."

      guess_wrong:
        description: "The player guessed wrong — stay in game."
        speech_cue: "Nope, that's not it! You still have questions left — keep digging!"
        parameters:
          wrong_guess:
            type: string
            description: "What the player guessed."
            required: true

      out_of_questions:
        description: "Player used all 10 questions without a correct guess."

    transitions:
      on_tool_call:
        guess_correct: won
        out_of_questions: lost
        # record_answer and guess_wrong are NOT listed here
```

**Key VFDL pattern: tools without transitions.**

`record_answer` and `guess_wrong` are defined as tools but have **no entry in `on_tool_call`**. When the LLM calls them:

1. The engine saves the arguments as variables (`last_answer`, `questions_asked`)
2. The engine emits `flow_variable` events → the card UI updates live
3. The engine **stays in `playing`** — no transition fires
4. The LLM gets a `speech_cue` back and continues the conversation

This is how you do "in-state work" — the flow stays put while the AI keeps the game going.

### `won` and `lost` — End States

```yaml
  won:
    ui:
      artifact_type: card
      prompt: |
        🎉  You got it!
        It was: {secret_thing}
        Questions used: {questions_asked} / 10

    agent:
      prompt: |
        Congratulate the player! Ask if they want to play again.
        Call `play_again` if yes.
      tools: [play_again]

    tools:
      play_again:
        description: "Start a new round with a fresh secret."

    transitions:
      on_tool_call:
        play_again: setup     # Loops back to the beginning
```

`lost` is identical except the prompt reveals the answer and commiserates.

Notice `play_again → setup` — the flow loops. The state machine resets, the AI picks a new secret, and the game starts over.

---

## The Complete Flow

The full YAML is available at [`apps/ten-questions/flow.yaml`](https://github.com/busytaal/prepatu/blob/main/apps/ten-questions/flow.yaml).

---

## Running It

### Cloud

```bash
# Upload the flow
curl -X POST https://api.prepatu.io/v1/flows \
  -H "X-Prepatu-Key: pk_live_..." \
  -d '{"name": "10 Questions", "yaml_content": "..."}'

# Start a session
curl -X POST https://api.prepatu.io/v1/sessions \
  -H "X-Prepatu-Key: pk_live_..." \
  -d '{"flow_id": "..."}'
```

### Self-Hosted

Copy `flow.yaml` to your `FLOWS_DIR` and connect with `mode=flow&program_id=ten-questions`.

---

## Frontend Tips

Since 10 Questions uses only `card` artifacts, the frontend is simple — just a div that updates:

```typescript
onMessage: msg => {
  if (msg.type === 'flow_state' || msg.type === 'artifact') {
    document.getElementById('card').innerText = msg.prompt || '';
  }
  // Variables update the card live via flow_state re-emission
  if (msg.type === 'flow_variable') {
    console.log(`${msg.key} = ${msg.value}`);
  }
}
```

---

## Patterns to Reuse

| Pattern | How it's used here | Reuse in your app |
|---|---|---|
| Tools without transitions | `record_answer` saves data without moving | Tracking, logging, partial saves |
| `speech_cue` | `guess_wrong` tells the LLM what to say next | Custom follow-up prompts |
| Flow variable → live UI | `questions_asked` updates the card | Scoreboards, progress bars |
| Looping flows | `play_again → setup` | Multi-round games, surveys |
