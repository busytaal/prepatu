/**
 * fetchRemoteConfig — fetch the runtime feature flags from the backend.
 *
 * Calls GET /config (the public subset) and returns a typed RemoteConfig.
 * Returns null on network error so callers can fall back to defaults gracefully.
 */
import type { RemoteConfig } from "./types";

export async function fetchRemoteConfig(
  baseUrl: string,
  configPath = "/config",
): Promise<RemoteConfig | null> {
  try {
    const res = await fetch(`${baseUrl}${configPath}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as RemoteConfig;
  } catch {
    return null;
  }
}
