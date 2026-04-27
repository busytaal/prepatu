from vfdl.providers.llm import create_llm
from vfdl.providers.stt import create_stt
from vfdl.providers.tts import create_tts
from vfdl.providers.turn import get_turn_provider

__all__ = ["create_stt", "create_tts", "create_llm", "get_turn_provider"]

# ProviderOverrides is a plain dict with any of these optional keys:
#   stt_provider, stt_api_key
#   llm_provider, llm_api_key, llm_model
#   tts_provider, tts_api_key
# When a key is present its value overrides the corresponding env var.
