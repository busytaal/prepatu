/**
 * useVoiceSession — React hook wrapping the mobile VoiceAgent SDK.
 *
 * On connect it fetches GET /config from the backend to pick the right
 * transport (WebSocket or WebRTC) and apply any runtime feature flags before
 * starting the session.  Screens never need to know which transport is active.
 *
 * When the SDK is published as a standalone package this file simply swaps
 * the import path — the screens don't change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SERVER_URL, WS_BASE } from "../config";
import { VoiceAgent } from "../sdk/VoiceAgent";
import { WebSocketVoiceAgent } from "../sdk/WebSocketVoiceAgent";
import { fetchRemoteConfig } from "../sdk/remoteConfig";
import { getDeviceId } from "../utils/deviceId";
import type { BotMessage, RemoteConfig } from "../sdk/types";
import type { Artifact, TranscriptEntry } from "../types/artifacts";

export type SessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "speaking"
  | "listening"
  | "error"
  | "ended"
  | "maintenance";

interface UseVoiceSessionOptions {
  sessionId?: string;
  mode?: "assistant" | "interview" | "onboarding" | "program";
  interviewType?: string;
  programId?: string;
  onStatusChange?: (status: SessionStatus) => void;
  /** Called whenever the bot pushes an artifact message. */
  onArtifact?: (artifact: Artifact) => void;
}

type AnyAgent = VoiceAgent | WebSocketVoiceAgent;

export function useVoiceSession({
  mode = "interview",
  interviewType = "part1",
  programId,
  onStatusChange,
  onArtifact,
}: UseVoiceSessionOptions) {
  const [status, setStatus]         = useState<SessionStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [intent, setIntent]         = useState<string | null>(null);
  const [micMuted, setMicMuted]     = useState(false);
  const [spkMuted, setSpkMuted]     = useState(false);
  const [remoteConfig, setRemoteConfig] = useState<RemoteConfig | null>(null);
  const agentRef = useRef<AnyAgent | null>(null);
  const connectingRef = useRef(false); // guard: prevent concurrent connect() calls

  const updateStatus = useCallback(
    (s: SessionStatus) => {
      setStatus(s);
      onStatusChange?.(s);
    },
    [onStatusChange]
  );

  const handleMessage = useCallback(
    (msg: BotMessage) => {
      if (msg.type === "transcript") {
        const m = msg as Extract<BotMessage, { type: "transcript" }>;
        setTranscript((prev) => [
          ...prev,
          {
            id:        m.id ?? String(Date.now()),
            role:      m.role === "user" ? "user" : "assistant",
            text:      m.text,
            timestamp: Date.now(),
          },
        ]);
      } else if (msg.type === "status") {
        const s = (msg as Extract<BotMessage, { type: "status" }>).status;
        if (s === "listening") updateStatus("listening");
        else if (s === "speaking") updateStatus("speaking");
      } else if (msg.type === "intent") {
        const m = msg as Extract<BotMessage, { type: "intent" }>;
        setIntent(m.text);
      } else if (msg.type === "artifact") {
        // Normalize backend shape: {type:"artifact", artifact_type:"navigate", ...}
        // → Artifact union shape:  {type:"navigate", ...}
        const raw = msg as Record<string, unknown>;
        const artifactType = (raw.artifact_type as string) ?? "card";
        const normalized = { ...raw, type: artifactType } as unknown as Artifact;
        // Also surface intent text separately so the UI label updates
        if (artifactType === "intent" && typeof raw.text === "string") {
          setIntent(raw.text);
        }
        onArtifact?.(normalized);
      }
    },
    [onArtifact, updateStatus]
  );

  const connect = useCallback(async () => {
    if (agentRef.current || connectingRef.current) return; // already connected or connecting
    connectingRef.current = true;
    console.log("[useVoiceSession] Connecting voice session with mode", mode, "and interview type", interviewType);
    updateStatus("connecting");



    // 1. Fetch remote config — determines which transport to use.
    const cfg = await fetchRemoteConfig(SERVER_URL);
    console.log("[useVoiceSession] Fetched remote config", cfg);
    // setRemoteConfig(cfg);

    const deviceId =  "sfsdfsdfsdfsdf";
    console.log("[useVoiceSession] Device ID:", deviceId);

    if (cfg?.maintenance) {
      console.log("[useVoiceSession] Maintenance mode — aborting");
      updateStatus("maintenance");
      return;
    }

    // 2. Resolve transport: explicit config → auto fallback to WS.
    // WebRTC media doesn't traverse adb reverse (TCP port tunnel), so when
    // backend is loopback we force WebSocket mode for local-device debugging.
    const transport = cfg?.transport ?? "websocket";
    const isLoopbackBackend = /https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(SERVER_URL);
    const forceWsForLoopback = isLoopbackBackend && transport === "webrtc";
    const useWS = transport === "websocket" || transport === "auto" || forceWsForLoopback;
    console.log(
      `[useVoiceSession] transport=${transport} useWS=${useWS}` +
      (forceWsForLoopback ? " (forced for loopback backend)" : "")
    );

    if (useWS) {
      // ── WebSocket transport ──────────────────────────────────────────────
      const wsUrl = `${WS_BASE}/ws`;
      const agent = new WebSocketVoiceAgent({
        url:      wsUrl,
        backend:  { baseUrl: SERVER_URL },
        metadata: { mode, interview_type: interviewType, device_id: deviceId, ...(programId ? { program_id: programId } : {}) },
        onConnectionStateChange: (state) => {
          if (state === "connected") updateStatus("listening");
          else if (state === "failed") updateStatus("error");
          else updateStatus("connecting");
        },
        onMessage: handleMessage,
        onError: (err) => {
          console.error("[WebSocketVoiceAgent]", err);
          updateStatus("error");
        },
        onLog: (msg) => console.log("[WS]", msg),
      });
      agentRef.current = agent;
      try {
        await agent.start();
      } catch (err) {
        console.error("[useVoiceSession] WS connect failed", err);
        updateStatus("error");
      }
    } else {
      // ── WebRTC transport ─────────────────────────────────────────────────
      const agent = new VoiceAgent({
        backend:  { baseUrl: SERVER_URL },
        metadata: { mode, interview_type: interviewType, device_id: deviceId, ...(programId ? { program_id: programId } : {}) },
        onConnectionStateChange: (state) => {
          if (state === "connected") updateStatus("listening");
          else if (state === "failed") updateStatus("error");
          else updateStatus("connecting");
        },
        onMessage: handleMessage,
        onError: (err) => {
          console.error("[VoiceAgent]", err);
          updateStatus("error");
        },
      });
      agentRef.current = agent;
      try {
        console.log("[useVoiceSession] Calling agent.start()");
        await agent.start();
        console.log("[useVoiceSession] agent.start() resolved");
      } catch (err) {
        console.error("[useVoiceSession] WebRTC connect failed", err);
        updateStatus("error");
      }
    }
  }, [interviewType, updateStatus, handleMessage]);

  const disconnect = useCallback(() => {
    const currentMode = agentRef.current
      ? (agentRef.current as { config?: { metadata?: { mode?: string; interview_type?: string } } })
          .config?.metadata?.mode ?? mode
      : mode;
    agentRef.current?.stop();
    agentRef.current     = null;
    connectingRef.current = false;
    setIntent(null);
    updateStatus("ended");
    // Record session completion in background for LLM context
    getDeviceId().then((deviceId) => {
      fetch(`${SERVER_URL}/user-context`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          device_id:  deviceId,
          event_type: "session_completed",
          data:       { mode: currentMode, interview_type: interviewType },
        }),
      }).catch(() => {});
    });
  }, [mode, interviewType, updateStatus]);

  const toggleMicMute  = useCallback(() => setMicMuted((v) => !v), []);
  const toggleSpkMute  = useCallback(() => setSpkMuted((v) => !v), []);

  useEffect(() => {
    return () => {
      agentRef.current?.stop();
      agentRef.current = null;
    };
  }, []);

  const sendUIEvent = useCallback((action: string, data?: Record<string, unknown>) => {
    if (agentRef.current && "sendUIEvent" in agentRef.current) {
      agentRef.current.sendUIEvent(action, data);
    }
  }, []);

  return {
    status,
    transcript,
    intent,
    micMuted,
    spkMuted,
    toggleMicMute,
    toggleSpkMute,
    remoteConfig,
    connect,
    disconnect,
    sendUIEvent,
  };
}
