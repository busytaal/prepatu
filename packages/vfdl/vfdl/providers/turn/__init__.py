from os import getenv

from vfdl.providers.turn.cloudflare import fetch_ice_servers as fetch_cloudflare_ice_servers
from vfdl.providers.turn.static import fetch_ice_servers as fetch_static_ice_servers


class TurnProvider:
    def __init__(self, provider_name: str, fetch_func):
        self.provider_name = provider_name
        self._fetch_func = fetch_func

    def fetch_ice_servers(self):
        return self._fetch_func()

    def check_config(self) -> bool:
        if self.provider_name == "cloudflare":
            return bool(getenv("TURN_KEY_ID") or getenv("CLOUDFLARE_TURN_KEY_ID")) and bool(getenv("TURN_API_TOKEN") or getenv("CLOUDFLARE_TURN_API_TOKEN"))

        if getenv("ICE_SERVERS_JSON"):
            return True
        if getenv("STUN_SERVER"):
            return True
        if getenv("TURN_SERVER") and getenv("TURN_USERNAME") and getenv("TURN_PASSWORD"):
            return True
        return False


def get_turn_provider():
    provider = getenv("TURN_PROVIDER", "static").lower()
    if provider == "cloudflare":
        return TurnProvider("cloudflare", fetch_cloudflare_ice_servers)
    return TurnProvider("static", fetch_static_ice_servers)
