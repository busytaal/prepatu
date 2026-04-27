import json
from os import getenv


def fetch_ice_servers():
    ice_servers_json = getenv("ICE_SERVERS_JSON")
    if ice_servers_json:
        try:
            parsed = json.loads(ice_servers_json)
            if isinstance(parsed, list):
                return {"iceServers": [s for s in parsed if isinstance(s, dict)], "ttlSeconds": None}
        except json.JSONDecodeError:
            pass

    servers = []
    stun_server = getenv("STUN_SERVER")
    turn_server = getenv("TURN_SERVER")
    turn_username = getenv("TURN_USERNAME")
    turn_password = getenv("TURN_PASSWORD")

    if stun_server:
        servers.append({"urls": [stun_server]})
    if turn_server and turn_username and turn_password:
        servers.append(
            {
                "urls": [turn_server],
                "username": turn_username,
                "credential": turn_password,
            }
        )
    return {"iceServers": servers, "ttlSeconds": None}
