/**
 * useSessionTracking — tracks wall-clock time spent in each agent mode.
 *
 * Starts a timer when status becomes "listening" / "speaking" / "connected",
 * stops when "ended" / "error" / component unmounts.
 *
 * Persists completed sessions to AsyncStorage (key: "session_log") as a
 * JSON array.  On each session end it also attempts to POST the record to
 * GET /sessions (piggy-backed as a no-op read is fine, but we POST a
 * client-side event if the backend ever grows a /sessions/client-events
 * endpoint).
 *
 * Returned `elapsed` reflects the live wall-clock seconds for the current
 * session (useful for UI timers).
 */
import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SERVER_URL } from "../config";
import type { SessionStatus } from "./useVoiceSession";

interface Options {
  mode:   "assistant" | "interview";
  status: SessionStatus;
}

interface SessionRecord {
  id:           string;
  mode:         "assistant" | "interview";
  started_at:   number; // unix ms
  ended_at:     number; // unix ms
  duration_secs: number;
}

const STORAGE_KEY = "prepatu_session_log";
const ACTIVE_STATUSES: SessionStatus[] = ["connected", "listening", "speaking"];

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useSessionTracking({ mode, status }: Options) {
  const [elapsed, setElapsed] = useState(0);

  const sessionIdRef  = useRef<string | null>(null);
  const startedAtRef  = useRef<number | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Start tracking when session becomes active ─────────────────────────────
  useEffect(() => {
    const isActive = ACTIVE_STATUSES.includes(status);

    if (isActive && sessionIdRef.current === null) {
      sessionIdRef.current = uuid();
      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current!) / 1000));
      }, 1000);
    }

    if (!isActive && sessionIdRef.current !== null) {
      // Session ended — flush record.
      _flush(mode, sessionIdRef.current, startedAtRef.current!);
      sessionIdRef.current = null;
      startedAtRef.current = null;
      setElapsed(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      // Safety: clear timer on re-render without ending.
    };
  }, [status, mode]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (sessionIdRef.current !== null && startedAtRef.current !== null) {
        _flush(mode, sessionIdRef.current, startedAtRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { elapsed };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function _flush(
  mode:      "assistant" | "interview",
  sessionId: string,
  startedAt: number,
) {
  const endedAt = Date.now();
  const record: SessionRecord = {
    id:            sessionId,
    mode,
    started_at:    startedAt,
    ended_at:      endedAt,
    duration_secs: Math.round((endedAt - startedAt) / 1000),
  };

  // Persist locally
  try {
    const raw  = await AsyncStorage.getItem(STORAGE_KEY);
    const log: SessionRecord[] = raw ? JSON.parse(raw) : [];
    log.push(record);
    // Keep last 500 entries
    if (log.length > 500) log.splice(0, log.length - 500);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch (e) {
    console.warn("[useSessionTracking] AsyncStorage write failed", e);
  }

  // Best-effort POST to backend client-events endpoint (fire & forget)
  try {
    await fetch(`${SERVER_URL}/sessions/client-events`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(record),
    });
  } catch {
    // Backend endpoint is optional — ignore failures silently.
  }
}

/**
 * Retrieve all locally stored session records (useful for analytics screen).
 */
export async function getSessionLog(): Promise<SessionRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
