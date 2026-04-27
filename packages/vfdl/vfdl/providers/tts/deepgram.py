from os import getenv
from pipecat.services.deepgram.tts import DeepgramTTSService


def create(**overrides):
    api_key = overrides.get("api_key") or getenv("TTS_API_KEY") or getenv("DEEPGRAM_API_KEY", "")
    if not api_key:
        raise ValueError("TTS_API_KEY or DEEPGRAM_API_KEY must be set for Deepgram TTS")

    voice = overrides.get("voice") or getenv("TTS_VOICE", "aura-2-thalia-en")

    return DeepgramTTSService(
        api_key=api_key,
        settings=DeepgramTTSService.Settings(
            voice=voice,
        ),
    )
