from os import getenv

from vfdl.providers.stt.deepgram import create as create_deepgram


def create_stt(overrides: dict | None = None):
    provider = (overrides or {}).get("stt_provider") or getenv("STT_PROVIDER", "deepgram")
    provider = provider.lower()
    if provider == "deepgram":
        return create_deepgram(**{k: v for k, v in (overrides or {}).items() if k == "api_key" or k == "stt_api_key"})
    raise ValueError(f"Unknown STT_PROVIDER: {provider}")


def check_stt_config():
    try:
        create_stt()
        return True
    except Exception:
        return False
