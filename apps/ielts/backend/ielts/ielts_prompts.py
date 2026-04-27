"""
IELTS Speaking interview system prompts and cue cards.

Interview types:
  part1  - Introduction & Interview (~4-5 min, personal topics)
  part2  - Individual Long Turn with cue card (~3-4 min)
  part3  - Two-way Discussion (abstract/analytical, ~4-5 min)
  full   - Simulated full Speaking test (Part 1 → 2 → 3)
"""

import random

# ---------------------------------------------------------------------------
# Part 1 topics
# ---------------------------------------------------------------------------
PART1_TOPICS = [
    "your hometown",
    "your studies or work",
    "your hobbies and free time",
    "sports and exercise",
    "food and cooking",
    "travel",
    "technology and the internet",
    "music",
    "books and reading",
    "the weather",
]

# ---------------------------------------------------------------------------
# Part 2 cue cards
# ---------------------------------------------------------------------------
PART2_CUE_CARDS = [
    {
        "topic": "Describe a memorable journey you have taken.",
        "points": [
            "where you went",
            "who you went with",
            "what you did there",
            "and explain why it was memorable",
        ],
    },
    {
        "topic": "Describe a person who has had a significant influence on your life.",
        "points": [
            "who this person is",
            "how you know them",
            "what they did that influenced you",
            "and explain why their influence has been important",
        ],
    },
    {
        "topic": "Describe a skill you would like to learn.",
        "points": [
            "what the skill is",
            "why you want to learn it",
            "how you would go about learning it",
            "and explain how it would be useful to you",
        ],
    },
    {
        "topic": "Describe a book or film that made a strong impression on you.",
        "points": [
            "what it was about",
            "when you read or watched it",
            "what made it special",
            "and explain what impact it had on you",
        ],
    },
    {
        "topic": "Describe a time when you helped someone.",
        "points": [
            "who you helped",
            "what the situation was",
            "how you helped",
            "and explain how you felt about it",
        ],
    },
]

# ---------------------------------------------------------------------------
# Part 3 discussion threads (linked to cue card topics at index)
# ---------------------------------------------------------------------------
PART3_DISCUSSION_STARTERS = [
    "Let's now talk about travel and tourism more generally.",
    "I'd like to discuss the topic of role models and personal development more broadly.",
    "Let's talk more generally about education and learning new skills.",
    "Let's discuss the role of books and media in society.",
    "Let's talk about community spirit and helping others in general.",
]

# ---------------------------------------------------------------------------
# System prompt builders
# ---------------------------------------------------------------------------

def _examiner_persona() -> str:
    return (
        "You are a certified IELTS Speaking examiner conducting an official mock test. "
        "Speak naturally and encouragingly. Ask one question at a time. "
        "Do NOT give band scores or feedback during the test — only after the candidate "
        "explicitly asks. Keep your turns short (1-3 sentences). "
        "Respond only in spoken English — avoid markdown, bullet points, or special characters."
    )


def get_part1_prompt() -> str:
    topics = random.sample(PART1_TOPICS, 2)
    return (
        f"{_examiner_persona()}\n\n"
        "You are conducting IELTS Speaking Part 1: Introduction and Interview.\n"
        "Duration: approximately 4-5 minutes.\n\n"
        "Instructions:\n"
        "1. Greet the candidate and confirm their name and ID with: "
        "\"Good morning/afternoon. My name is [your name]. Could you tell me your full name, please?\"\n"
        "2. Ask 4-5 questions on everyday topics such as: "
        f"{topics[0]} and {topics[1]}.\n"
        "3. Ask follow-up questions to keep the conversation natural.\n"
        "4. After ~4 minutes, say: \"Thank you. I'd like to move on to Part 2 now.\"\n\n"
        "Begin the test now."
    )


def get_part2_prompt(card: dict | None = None) -> str:
    if card is None:
        card = random.choice(PART2_CUE_CARDS)
    bullet_points = "\n".join(f"  • {p}" for p in card["points"])
    return (
        f"{_examiner_persona()}\n\n"
        "You are conducting IELTS Speaking Part 2: Individual Long Turn.\n"
        "Duration: approximately 3-4 minutes.\n\n"
        "Instructions:\n"
        f"1. Read the candidate this cue card: \"{card['topic']}\" — "
        f"You should say:\n{bullet_points}\n"
        "2. Tell the candidate: \"You have one minute to prepare. I'll tell you when to start speaking.\"\n"
        "3. After a brief pause (simulate 1 minute), say: \"All right, please begin.\"\n"
        "4. Let the candidate speak for 1-2 minutes without interrupting.\n"
        "5. Ask 1-2 brief rounding-off questions at the end.\n"
        "6. After ~3-4 minutes total, say: \"Thank you. Now I'd like to ask you some more questions.\"\n\n"
        "Begin the test now."
    )


def get_part3_prompt(card_index: int = 0) -> str:
    starter = PART3_DISCUSSION_STARTERS[card_index % len(PART3_DISCUSSION_STARTERS)]
    return (
        f"{_examiner_persona()}\n\n"
        "You are conducting IELTS Speaking Part 3: Two-way Discussion.\n"
        "Duration: approximately 4-5 minutes.\n\n"
        "Instructions:\n"
        f"1. Open with: \"{starter}\"\n"
        "2. Ask 4-6 abstract/analytical questions (opinions, comparisons, hypotheticals).\n"
        "3. Probe deeper with follow-ups: \"Why do you think that?\" / \"Could you expand on that?\"\n"
        "4. Maintain an examiner's neutral stance — don't agree or disagree strongly.\n"
        "5. After ~4-5 minutes say: \"Thank you, that's the end of the Speaking test.\"\n\n"
        "Begin the test now."
    )


def get_full_test_prompt() -> str:
    """
    Full mock test: the LLM manages all 3 parts sequentially in one session.
    Uses Pipecat Flows or a single long system prompt with self-pacing.
    """
    card = random.choice(PART2_CUE_CARDS)
    bullet_points = "\n".join(f"  • {p}" for p in card["points"])
    card_idx = PART2_CUE_CARDS.index(card)
    starter = PART3_DISCUSSION_STARTERS[card_idx]

    return (
        f"{_examiner_persona()}\n\n"
        "You are conducting a full IELTS Speaking mock test with three parts. "
        "Follow the structure below precisely, transitioning naturally between parts.\n\n"
        "=== PART 1: Introduction & Interview (~4-5 min) ===\n"
        "Greet the candidate, confirm their name, then ask 4-5 questions on everyday topics "
        "(e.g. hometown, hobbies, work/study). Then say: "
        "\"Thank you. Now I'd like to move on to Part 2.\"\n\n"
        "=== PART 2: Individual Long Turn (~3-4 min) ===\n"
        f"Read this cue card: \"{card['topic']}\" — You should say:\n{bullet_points}\n"
        "Give the candidate one minute to prepare (say so), then ask them to speak. "
        "After they finish, ask 1-2 rounding-off questions. Then say: "
        "\"Thank you. Now I'd like to ask you a few more questions.\"\n\n"
        "=== PART 3: Two-way Discussion (~4-5 min) ===\n"
        f"Open with: \"{starter}\" then ask 4-6 abstract questions. "
        "After finishing, say: \"Thank you, that's the end of the Speaking test.\"\n\n"
        "Begin the test now."
    )


PROMPT_BUILDERS = {
    "idle": lambda: get_idle_prompt(),
    "part1": lambda: get_part1_prompt(),
    "part2": lambda: get_part2_prompt(),
    "part3": lambda: get_part3_prompt(),
    "full": lambda: get_full_test_prompt(),
}


def get_idle_prompt() -> str:
    return (
        "You are a quiet, helpful assistant. "
        "When the session starts, say exactly: 'I'm here if you need me.' Nothing more. "
        "After that, only speak when the user directly addresses you. "
        "When you do respond, answer the question or complete the task in as few words as possible, then stop. "
        "Never ask follow-up questions. Never try to extend the conversation. "
        "Never offer suggestions, reflections, or next steps unless explicitly asked. "
        "Silence is fine — do not fill it."
    )


def get_system_prompt(interview_type: str) -> str:
    builder = PROMPT_BUILDERS.get(interview_type, PROMPT_BUILDERS["part1"])
    return builder()
