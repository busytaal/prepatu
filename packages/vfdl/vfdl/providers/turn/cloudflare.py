import json
import urllib.error
import urllib.request
from os import getenv


def fetch_ice_servers():
    key_id = getenv("TURN_KEY_ID") or getenv("CLOUDFLARE_TURN_KEY_ID")
    api_token = getenv("TURN_API_TOKEN") or getenv("CLOUDFLARE_TURN_API_TOKEN")
    ttl_seconds = int(getenv("TURN_TTL_SECONDS", getenv("CLOUDFLARE_TURN_TTL_SECONDS", "3600")))

    if not key_id or not api_token:
        raise ValueError("TURN_KEY_ID and TURN_API_TOKEN must be set for Cloudflare TURN")

    url = f"https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"
    payload = json.dumps({"ttl": ttl_seconds}).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Cloudflare-TURN-Client/1.0",
        "Connection": "close",
    }
    request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    try:
        with opener.open(request, timeout=15) as response:
            body = response.read().decode("utf-8")
            data = json.loads(body)
            ice_servers = data.get("iceServers", [])
            ttl = data.get("ttlSeconds") or ttl_seconds
            return {
                "iceServers": ice_servers,
                "ttlSeconds": ttl,
            }
    except urllib.error.HTTPError as e:
        raise RuntimeError(
            f"Cloudflare TURN fetch HTTP error: {e.code} {e.reason} {e.read().decode('utf-8', errors='ignore')}"
        )
    except Exception as e:
        raise RuntimeError(f"Cloudflare TURN fetch failed: {e}")
