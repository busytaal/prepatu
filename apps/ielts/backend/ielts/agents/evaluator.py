"""
Session evaluator — scores a completed session using the LLM.

For sessions with scoring: "ielts" (from programs.yaml), this module
is called after the session ends.  It sends the transcript to the LLM
with an IELTS-specific rubric prompt and stores the structured result
in the session_scores table.

IELTS band descriptors assessed (all on 1–9 scale, 0.5 increments):
  - Fluency and Coherence (FC)
  - Lexical Resource (LR)
  - Grammatical Range and Accuracy (GRA)
  - Pronunciation (P) — estimated from text patterns
  - Overall Band — mean of the four, rounded to nearest 0.5
"""

from __future__ import annotations

import json
import math
import time
from os import getenv
from typing import Any

from loguru import logger

# ── IELTS evaluation prompt ─────────────────────────────────────────────────

_IELTS_SYSTEM = """
You are an experienced IELTS Speaking examiner and language assessor.
You will receive a transcript of a speaking session and score the CANDIDATE's
performance on the official IELTS Speaking Assessment Criteria.

ONLY evaluate the candidate's turns (marked USER:). Ignore examiner/agent turns.
""".strip()

_IELTS_USER_TEMPLATE = """
--- TRANSCRIPT ---
{transcript}
--- END TRANSCRIPT ---

Score the candidate on the IELTS 9-band scale (use 0.5 increments: 4.0, 4.5, 5.0 ... 9.0).

Band guide (key levels):
  9 — Expert user; fully operational command
  8 — Very good; occasional inaccuracies
  7 — Good; handles complex language well; some imprecision
  6 — Competent; generally effective despite inaccuracies
  5 — Modest; partial command; copes with overall meaning
  4 — Limited; basic competence confined to familiar situations

Criteria:
1. Fluency and Coherence (FC): Speaks without noticeable effort; connected discourse; 
   appropriate connectors; avoids repetition and self-correction.
2. Lexical Resource (LR): Range, accuracy, and appropriacy of vocabulary; 
   ability to paraphrase; use of idiomatic expressions.
3. Grammatical Range and Accuracy (GRA): Range of grammatical structures; 
   frequency and impact of errors.
4. Pronunciation (P): Intelligibility; phonological features; ease of understanding.
   NOTE: Since this is text-only, estimate pronunciation from:
   - Response length (very short answers → likely pronunciation anxiety)
   - Spelling patterns indicating non-native phonology
   - Reported hesitations or fillers in the text

Return ONLY valid JSON — no markdown, no explanation outside JSON:
{{
  "fluency_coherence": <float>,
  "lexical_resource": <float>,
  "grammatical_range": <float>,
  "pronunciation": <float>,
  "overall_band": <float>,
  "feedback": {{
    "strengths": ["<specific strength with example from transcript>",
                  "<specific strength with example from transcript>"],
    "improvements": ["<improvement area with concrete action>",
                     "<improvement area with concrete action>"],
    "examiner_comment": "<2–3 sentence holistic summary of the candidate's performance>"
  }},
  "metrics": {{
    "estimated_words_per_min": <int or null>,
    "filler_words": <int>,
    "topics_covered": ["<topic 1>", "<topic 2>"]
  }}
}}
""".strip()


def _round_to_half(value: float) -> float:
    """Round to the nearest 0.5 band (IELTS convention)."""
    return math.floor(value * 2 + 0.5) / 2


def _build_transcript(messages: list[dict]) -> str:
    """Extract user and assistant turns from the LLM context messages."""
    lines: list[str] = []
    for m in messages:
        role = m.get("role", "")
        content = m.get("content") or ""
        if not isinstance(content, str):
            content = str(content)
        content = content.strip()
        if not content:
            continue
        if role == "user":
            lines.append(f"USER: {content}")
        elif role == "assistant":
            lines.append(f"AGENT: {content}")
        # Skip system messages
    return "\n\n".join(lines)


async def evaluate_ielts(
    session_id: str,
    messages: list[dict],
    store: Any,  # SessionStore — avoided circular import
    program_id: str = "ielts_practice",
) -> dict:
    """
    Evaluate an IELTS speaking session.

    Parameters
    ----------
    session_id : str
        Used to store results in the DB.
    messages : list[dict]
        The full LLM context message list from the session.
    store : SessionStore
        Active store instance for persisting scores.
    program_id : str
        Which program was run (stored alongside scores).

    Returns
    -------
    dict  The parsed scores dict (or an error dict on failure).
    """
    transcript = _build_transcript(messages)
    if not transcript:
        logger.warning(f"[Evaluator] session {session_id}: empty transcript — skipping evaluation")
        return {"error": "empty_transcript"}

    user_turns = [m for m in messages if m.get("role") == "user" and (m.get("content") or "").strip()]
    if len(user_turns) < 2:
        logger.info(f"[Evaluator] session {session_id}: too few user turns ({len(user_turns)}) — skipping")
        return {"error": "insufficient_turns"}

    api_key = getenv("LLM_API_KEY") or getenv("OPENROUTER_API_KEY", "")
    base_url = getenv("LLM_BASE_URL") or getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    model = getenv("LLM_MODEL") or getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")

    if not api_key:
        logger.warning("[Evaluator] No API key configured — skipping evaluation")
        return {"error": "no_api_key"}

    try:
        from openai import AsyncOpenAI  # available via pipecat-ai[openai]
        client = AsyncOpenAI(api_key=api_key, base_url=base_url)

        prompt = _IELTS_USER_TEMPLATE.format(transcript=transcript)
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _IELTS_SYSTEM},
                {"role": "user",   "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=800,
        )

        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)

        # Validate and normalise band scores
        criteria = ["fluency_coherence", "lexical_resource", "grammatical_range", "pronunciation"]
        for key in criteria:
            val = data.get(key)
            if isinstance(val, (int, float)):
                data[key] = _round_to_half(float(val))

        # Recalculate overall band as mean, rounded to nearest 0.5
        valid_scores = [data[k] for k in criteria if isinstance(data.get(k), (int, float))]
        if valid_scores:
            data["overall_band"] = _round_to_half(sum(valid_scores) / len(valid_scores))

        # Persist to store
        try:
            await store.save_session_scores(
                session_id=session_id,
                program_id=program_id,
                scores=data,
            )
            logger.info(f"[Evaluator] session {session_id}: overall band {data.get('overall_band')} saved")
        except Exception as exc:
            logger.warning(f"[Evaluator] score persistence failed: {exc}")

        return data

    except Exception as exc:
        logger.warning(f"[Evaluator] evaluation failed for session {session_id}: {exc}")
        return {"error": str(exc)}
