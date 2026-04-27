// Central configuration — edit SERVER_URL to point at your backend.
// For local dev on Android over Wi-Fi, use your PC LAN IP.

export const SERVER_URL = "http://192.168.1.65:8000";
export const WS_BASE    = SERVER_URL.replace(/^https/, "wss").replace(/^http/, "ws");
