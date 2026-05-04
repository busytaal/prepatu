from os import getenv
from pipecat.services.deepgram.stt import DeepgramSTTService


def create(**overrides):
    api_key = overrides.get("api_key") or overrides.get("stt_api_key") or getenv("STT_API_KEY") or getenv("DEEPGRAM_API_KEY", "")
    if not api_key:
        raise ValueError("STT_API_KEY or DEEPGRAM_API_KEY must be set for Deepgram STT")
    return DeepgramSTTService(api_key=api_key)
