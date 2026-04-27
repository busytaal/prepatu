from os import getenv
from pipecat.services.cartesia.tts import CartesiaTTSService


def create(**overrides):
    api_key = overrides.get("api_key") or getenv("TTS_API_KEY") or getenv("CARTESIA_API_KEY", "")
    if not api_key:
        raise ValueError("TTS_API_KEY or CARTESIA_API_KEY must be set for Cartesia TTS")

    voice = overrides.get("voice") or getenv("TTS_VOICE")
    if not voice:
        raise ValueError("TTS_VOICE must be set for Cartesia TTS")

    return CartesiaTTSService(
        api_key=api_key,
        settings=CartesiaTTSService.Settings(
            voice=voice,
        ),
    )
