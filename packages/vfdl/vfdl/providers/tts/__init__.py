from os import getenv

from vfdl.providers.tts.deepgram import create as create_deepgram
from vfdl.providers.tts.cartesia import create as create_cartesia


def create_tts(overrides: dict | None = None):
    provider = (overrides or {}).get("tts_provider") or getenv("TTS_PROVIDER", "cartesia")
    provider = provider.lower()
    kw = {}
    if overrides and overrides.get("tts_api_key"):
        kw["api_key"] = overrides["tts_api_key"]
    if provider == "deepgram":
        return create_deepgram(**kw)
    if provider == "cartesia":
        return create_cartesia(**kw)
    raise ValueError(f"Unknown TTS_PROVIDER: {provider}")


def check_tts_config():
    try:
        create_tts()
        return True
    except Exception:
        return False
