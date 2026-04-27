from os import getenv
from pipecat.services.openai.llm import OpenAILLMService


def create(**overrides):
    api_key = overrides.get("api_key") or getenv("LLM_API_KEY") or getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        raise ValueError("LLM_API_KEY or OPENROUTER_API_KEY must be set for OpenRouter LLM")

    base_url = overrides.get("base_url") or getenv("LLM_BASE_URL") or getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    model = overrides.get("model") or getenv("LLM_MODEL") or getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")

    return OpenAILLMService(api_key=api_key, base_url=base_url, model=model)
