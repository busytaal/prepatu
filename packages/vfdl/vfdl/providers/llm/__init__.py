from os import getenv

from vfdl.providers.llm.openrouter import create as create_openrouter


def create_llm(overrides: dict | None = None):
    provider = (overrides or {}).get("llm_provider") or getenv("LLM_PROVIDER", "openrouter")
    provider = provider.lower()
    if provider == "openrouter":
        kw = {}
        if overrides:
            if overrides.get("llm_api_key"):  kw["api_key"] = overrides["llm_api_key"]
            if overrides.get("llm_model"):    kw["model"]   = overrides["llm_model"]
        return create_openrouter(**kw)
    raise ValueError(f"Unknown LLM_PROVIDER: {provider}")


def check_llm_config():
    try:
        create_llm()
        return True
    except Exception:
        return False
