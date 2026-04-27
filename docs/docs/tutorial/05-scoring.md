---
id: 05-scoring
title: "Step 5: Scoring Callback"
sidebar_position: 6
---

# Step 5: Scoring Callback

The flow engine knows nothing about IELTS band scores. The app injects that logic via a callback passed to `run_bot()`.

## How it works

When a flow reaches `__end__`, the engine calls:

```python
scoring_callback(session_id, flow_id, variables)
```

`variables` is a dict of everything collected during the flow — `first_name`, `date_of_birth`, or in the practice flow: band scores, transcripts, etc.

## The IELTS scoring callback

In `apps/ielts/backend/ielts/api.py`:

```python
async def score_session(session_id: str, flow_id: str, variables: dict):
    """
    Called by the flow engine at flow_end.
    Persist scores, trigger feedback push, update profile.
    """
    band_score  = variables.get("band_score")
    fluency     = variables.get("fluency_score")
    feedback    = variables.get("feedback_text")

    await store.save_session_result(
        session_id=session_id,
        flow_id=flow_id,
        band_score=band_score,
        feedback=feedback,
    )
    logger.info(f"Session {session_id} scored: {band_score}")
```

Then passed into the engine:

```python
await run_bot(
    ...
    scoring_callback=score_session,
)
```

## Variables collected by the practice flow

Open `apps/ielts/backend/ielts/agents/flows/ielts_practice.yaml`. The `feedback` state has the LLM call tools like:

```yaml
tools:
  save_feedback:
    description: "Save overall band score and written feedback."
    parameters:
      band_score:
        type: number
        required: true
      feedback_text:
        type: string
        required: true
```

When `save_feedback` is called, the engine stores these into flow variables and the scoring callback receives them at `__end__`.

## No app code in the engine

The scoring callback is a plain async function — it can call your database, send a push notification, update a profile, log to an analytics service — none of that lives in `vfdl`. The engine just calls the function pointer you passed in.

---

[Next: Going further →](./06-going-further)
