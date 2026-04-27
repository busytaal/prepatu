/**
 * VoiceSessionContext — one persistent assistant voice session shared across
 * Home / History / Profile (and any future ambient screens).
 *
 * Key properties:
 *  - Single WebSocket connection that survives screen navigation.
 *    Navigating between ambient screens is instantaneous — no reconnect delay.
 *  - Global kill switch: `dismissVoice()` disables voice app-wide.
 *  - Screens register artifact handlers with `registerArtifactHandler` inside
 *    a `useFocusEffect` so the right screen receives events.
 *  - Interview / Practice / Onboarding screens call `suspendGlobal()` /
 *    `resumeGlobal()` to pause this session while they run their own.
 *
 * Usage in ambient screens:
 *   const { status, intent, voiceEnabled, dismissVoice, registerArtifactHandler } = useGlobalVoice();
 *   useFocusEffect(useCallback(() => {
 *     registerArtifactHandler(myHandler);
 *     return () => registerArtifactHandler(null);
 *   }, [myHandler, registerArtifactHandler]));
 *
 * Usage in exclusive screens (interview, practice, onboarding):
 *   const { suspendGlobal, resumeGlobal } = useGlobalVoice();
 *   useEffect(() => { suspendGlobal(); return () => resumeGlobal(); }, []);
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { SERVER_URL, WS_BASE } from "../config";
import { VoiceAgent } from "../sdk/VoiceAgent";
import { WebSocketVoiceAgent } from "../sdk/WebSocketVoiceAgent";
import { fetchRemoteConfig } from "../sdk/remoteConfig";
import { getDeviceId } from "../utils/deviceId";
import type { BotMessage } from "../sdk/types";
import type { Artifact } from "../types/artifacts";
import type { SessionStatus } from "../hooks/useVoiceSession";

type AnyAgent = VoiceAgent | WebSocketVoiceAgent;

export interface GlobalVoiceContextValue {
  status:                   SessionStatus;
  intent:                   string | null;
  voiceEnabled:             boolean;
  /** Disconnect and permanently disable voice for this app session. */
  dismissVoice:             () => void;
  /** Register the handler that receives artifact events for the focused screen.
   *  Pass null to unregister (screen blurred). */
  registerArtifactHandler:  (handler: ((a: Artifact) => void) | null) => void;
  sendUIEvent:              (action: string, data?: Record<string, unknown>) => void;
  /** Called by interview/practice/onboarding screens on mount — stops the global session. */
  suspendGlobal:            () => void;
  /** Called by interview/practice/onboarding screens on unmount — restarts the global session. */
  resumeGlobal:             () => void;
}

const VoiceSessionContext = createContext<GlobalVoiceContextValue | null>(null);

export function useGlobalVoice(): GlobalVoiceContextValue {
  const ctx = useContext(VoiceSessionContext);
  if (!ctx) throw new Error("useGlobalVoice must be used inside VoiceSessionProvider");
  return ctx;
}

interface ProviderProps {
  children: React.ReactNode;
  /**
   * Set to true once onboarding is complete. The global session only connects
   * when this is true, preventing overlap with the onboarding session.
   */
  enabled: boolean;
}

export function VoiceSessionProvider({ children, enabled }: ProviderProps) {
  const [status,       setStatus]       = useState<SessionStatus>("idle");
  const [intent,       setIntent]       = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [suspended,    setSuspended]    = useState(false);

  const agentRef       = useRef<AnyAgent | null>(null);
  const connectingRef  = useRef(false);
  const handlerRef     = useRef<((a: Artifact) => void) | null>(null);

  // ── Message handler — stable (no onArtifact in deps) ──────────────────────
  const handleMessage = useCallback((msg: BotMessage) => {
    const raw = msg as Record<string, unknown>;
    if (msg.type === "status") {
      const s = raw.status as string;
      if (s === "listening")      setStatus("listening");
      else if (s === "speaking")  setStatus("speaking");
      else if (s === "connected") setStatus("connected");
    } else if (msg.type === "intent") {
      setIntent(raw.text as string);
    } else if (msg.type === "artifact") {
      const artifactType = (raw.artifact_type as string) ?? "card";
      const normalized   = { ...raw, type: artifactType } as unknown as Artifact;
      if (artifactType === "intent" && typeof raw.text === "string") {
        setIntent(raw.text as string);
      }
      handlerRef.current?.(normalized);
    }
  }, []); // intentionally empty deps — uses only refs and setters

  // ── Core connect / disconnect ──────────────────────────────────────────────
  const doConnect = useCallback(async () => {
    if (agentRef.current || connectingRef.current) return; // guard against double-connect
    connectingRef.current = true;
    setStatus("connecting");

    try {
      const cfg      = await fetchRemoteConfig(SERVER_URL);
      if (cfg?.maintenance) { setStatus("maintenance"); return; }

      const deviceId = await getDeviceId();
      const transport    = cfg?.transport ?? "websocket";
      const isLoopback   = /https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(SERVER_URL);
      const useWS        = transport === "websocket" || transport === "auto" || (isLoopback && transport === "webrtc");

      if (useWS) {
        const agent = new WebSocketVoiceAgent({
          url:      `${WS_BASE}/ws`,
          backend:  { baseUrl: SERVER_URL },
          metadata: { mode: "assistant", device_id: deviceId },
          onConnectionStateChange: (state) => {
            if (state === "connected") setStatus("listening");
            else if (state === "failed") setStatus("error");
            else setStatus("connecting");
          },
          onMessage: handleMessage,
          onError:   (err) => { console.error("[GlobalVoice]", err); setStatus("error"); },
          onLog:     (log) => console.log("[GlobalVoice WS]", log),
        });
        agentRef.current = agent;
        await agent.start();
      } else {
        const agent = new VoiceAgent({
          backend:  { baseUrl: SERVER_URL },
          metadata: { mode: "assistant", device_id: deviceId },
          onConnectionStateChange: (state) => {
            if (state === "connected") setStatus("listening");
            else if (state === "failed") setStatus("error");
            else setStatus("connecting");
          },
          onMessage: handleMessage,
          onError:   (err) => { console.error("[GlobalVoice]", err); setStatus("error"); },
        });
        agentRef.current = agent;
        await agent.start();
      }
    } catch (err) {
      console.error("[GlobalVoice] connect failed", err);
      setStatus("error");
    } finally {
      connectingRef.current = false;
    }
  }, [handleMessage]);

  const doDisconnect = useCallback(() => {
    agentRef.current?.stop();
    agentRef.current    = null;
    connectingRef.current = false;
    setStatus("idle");
    setIntent(null);
  }, []);

  // ── Reactive: connect / disconnect based on flags ─────────────────────────
  useEffect(() => {
    if (enabled && voiceEnabled && !suspended) {
      void doConnect();
    } else {
      doDisconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, voiceEnabled, suspended]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { agentRef.current?.stop(); agentRef.current = null; };
  }, []);

  // ── Public API ─────────────────────────────────────────────────────────────
  const dismissVoice = useCallback(() => {
    doDisconnect();
    setVoiceEnabled(false);
  }, [doDisconnect]);

  const registerArtifactHandler = useCallback(
    (handler: ((a: Artifact) => void) | null) => { handlerRef.current = handler; },
    [],
  );

  const sendUIEvent = useCallback(
    (action: string, data?: Record<string, unknown>) => {
      if (agentRef.current && "sendUIEvent" in agentRef.current) {
        (agentRef.current as WebSocketVoiceAgent).sendUIEvent(action, data);
      }
    },
    [],
  );

  const suspendGlobal = useCallback(() => setSuspended(true),  []);
  const resumeGlobal  = useCallback(() => setSuspended(false), []);

  return (
    <VoiceSessionContext.Provider
      value={{
        status,
        intent,
        voiceEnabled,
        dismissVoice,
        registerArtifactHandler,
        sendUIEvent,
        suspendGlobal,
        resumeGlobal,
      }}
    >
      {children}
    </VoiceSessionContext.Provider>
  );
}
