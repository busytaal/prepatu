/**
 * Stable device identifier — generated once on first launch and persisted
 * in AsyncStorage.  This is not a real identity; it's a best-effort
 * per-install handle used to gate programmatic flows (e.g. onboarding)
 * before authentication exists.
 *
 * Once login is added, the device_id will be replaced by the user's JWT sub.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import uuid from "react-native-uuid";

const STORAGE_KEY = "@prepatu/device_id";

let _cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (_cached) return _cached;

  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    _cached = stored;
    return stored;
  }

  const fresh = uuid.v4() as string;
  await AsyncStorage.setItem(STORAGE_KEY, fresh);
  _cached = fresh;
  return fresh;
}
