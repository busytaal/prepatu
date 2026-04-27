// ── Transport interface ───────────────────────────────────────────────────────

export type TransportStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'closed';
export type TransportType   = 'websocket' | 'webrtc';

export interface TransportCallbacks {
  onAudio:        (data: ArrayBuffer) => void;
  /** onTrack fires for WebRTC only — the browser plays the MediaStream natively. */
  onTrack:        (stream: MediaStream) => void;
  onMessage:      (msg: Record<string, unknown>) => void;
  onStatusChange: (status: TransportStatus) => void;
  onError:        (error: Error) => void;
}

export interface Transport {
  readonly type:   TransportType;
  readonly status: TransportStatus;

  connect():    Promise<void>;
  disconnect(): void;

  /**
   * Send raw PCM16 audio to the server.
   * WebSocket: transmitted as a binary frame.
   * WebRTC:    no-op — audio flows through the media track automatically.
   */
  sendAudio(data: ArrayBuffer): void;

  /** Send a JSON control message to the server. */
  sendMessage(msg: Record<string, unknown>): void;

  on<K extends keyof TransportCallbacks>(event: K, cb: TransportCallbacks[K]): void;
  off<K extends keyof TransportCallbacks>(event: K, cb: TransportCallbacks[K]): void;
}

// ── QoS ──────────────────────────────────────────────────────────────────────

/**
 * A snapshot of transport quality metrics — updated continuously while
 * the transport is connected.
 *
 * All time values are in milliseconds.
 */
export interface QoSSnapshot {
  /** Measured round-trip time via ping/pong (WebSocket) or RTCP (WebRTC). */
  rttMs: number | null;
  /** Rolling average of the last N RTT samples. */
  avgRttMs: number | null;
  /** Jitter — standard deviation of RTT over the sampling window. */
  jitterMs: number | null;
  /** Time from user stop-speaking to first bot audio frame received. */
  responseLatencyMs: number | null;
  /**
   * Fraction of expected audio frames that arrived on time (0–1).
   * 1.0 = all frames on time. Below 0.9 = noticeable degradation.
   */
  audioDeliveryRatio: number | null;
  /** Timestamp (epoch ms) of the last metric update. */
  measuredAt: number;
}

/** Thresholds that, when crossed, can trigger an automatic transport switch. */
export interface QoSThresholds {
  /** Upgrade to WebRTC when avg RTT exceeds this on WebSocket (ms). Default 250. */
  rttUpgradeMs?:        number;
  /** Downgrade to WebSocket when avg RTT exceeds this on WebRTC (ms). Default 400. */
  rttDowngradeMs?:      number;
  /** Upgrade when response latency exceeds this (ms). Default 800. */
  responseLatencyUpgradeMs?: number;
  /** Upgrade when audio delivery ratio drops below this. Default 0.85. */
  audioDeliveryUpgradeRatio?: number;
  /**
   * How many consecutive samples must breach a threshold before acting.
   * Prevents flapping on transient spikes. Default 3.
   */
  consecutiveBreachCount?: number;
}

// ── TransportSwitcher ─────────────────────────────────────────────────────────

export type SwitchTrigger =
  | 'manual'          // Consumer calls switcher.upgrade() / switcher.downgrade()
  | 'qos'             // Automatic — driven by QoSMonitor crossing a threshold
  | 'server-signal';  // Server sends { type: "switch-now" } over WebSocket

export type SwitchPhase =
  | 'idle'       // No switch in progress
  | 'preparing'  // Secondary transport connecting in background
  | 'ready'      // Secondary connected, waiting for trigger
  | 'switching'  // Overlap window — both transports active
  | 'done'       // Switch completed
  | 'failed';    // Switch failed — primary continues unchanged

export interface SwitchResult {
  success:   boolean;
  from:      TransportType;
  to:        TransportType;
  /** Measured audio gap during the cut, in ms (0 if no gap detected). */
  gapMs:     number;
  reason?:   string;
}

export interface SwitcherConfig {
  /**
   * What causes the actual cut from primary to secondary.
   * Multiple triggers can be active at once.
   */
  triggers: SwitchTrigger[];

  qosThresholds?: QoSThresholds;

  /**
   * ms of silence required before switching (for trigger="manual" or "qos").
   * Prevents switching mid-utterance. Default 300.
   */
  silenceGapMs?: number;

  /** Max ms to wait for the secondary transport to connect. Default 10000. */
  upgradeTimeoutMs?: number;

  /**
   * Duration of the overlap window where both transports receive.
   * Higher = safer (less chance of a gap) but wastes bandwidth. Default 100.
   */
  overlapMs?: number;

  /**
   * Keep the WebSocket connected for JSON messages (transcripts, artifacts)
   * even after WebRTC takes over audio. Default true.
   */
  keepWebSocketForData?: boolean;
}

// ── VoiceAgent ────────────────────────────────────────────────────────────────

export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'speaking'
  | 'error'
  | 'ended';

export type BotMessage =
  | { type: 'transcript'; id?: string; role: 'user' | 'assistant'; text: string }
  | { type: 'status';     status: string }
  | { type: 'artifact';   [key: string]: unknown }
  | { type: 'pong';       ts?: number; server_ts?: number }
  | { type: string;       [key: string]: unknown };

export interface VoiceAgentConfig {
  transport:  Transport;
  onMessage?: (msg: BotMessage) => void;
  onStatus?:  (status: SessionStatus) => void;
  onQoS?:     (snapshot: QoSSnapshot) => void;
  onError?:   (error: Error) => void;
  onLog?:     (msg: string) => void;
}

// ── Legacy types (kept for backward compat with existing VoiceAgent.ts) ───────

export type VoiceAgentProfile = 'default' | 'direct' | 'relay';

export type TransportConfig = {
  type: 'webrtc';
  profile?: VoiceAgentProfile;
  iceTransportPolicy?: RTCIceTransportPolicy;
  iceServersPath?: string;
  staticIceServers?: RTCIceServer[];
  refreshBufferMs?: number;
};

export type BackendVoiceConfig = {
  healthPath?: string;
  capabilitiesPath?: string;
  sttPath?: string;
  ttsPath?: string;
  voiceModel?: string;
  voiceName?: string;
  headers?: Record<string, string>;
};

export type BackendConfig = BackendVoiceConfig & {
  baseUrl: string;
  offerPath?: string;
  patchPath?: string;
  iceServersPath?: string;
};

export type LegacyVoiceAgentConfig = {
  transport?: TransportConfig;
  backend: BackendConfig;
  metadata?: Record<string, string>;
  audioConstraints?: MediaTrackConstraints;
  timeoutMs?: number;
  onLog?: (message: string) => void;
  onTrack?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: string) => void;
  onError?: (error: Error) => void;
};

export type VoiceAgentResponse = {
  pc_id: string;
  sdp: string;
  type: string;
};

export type DiagnosticsReport = {
  ok: boolean;
  transportReady: boolean;
  backendReady: boolean;
  iceServersCount: number;
  healthStatus?: unknown;
  capabilities?: unknown;
  details: string[];
};
