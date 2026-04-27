/**
 * Mobile SDK types — mirrors frontend/src/sdk/types.ts so both can be unified
 * into a single published package when the SDK is extracted.
 */

export type VoiceAgentProfile = "default" | "direct" | "relay";

export type TransportConfig =
  | {
      type: "webrtc";
      profile?: VoiceAgentProfile;
      iceTransportPolicy?: RTCIceTransportPolicy;
      iceServersPath?: string;
      staticIceServers?: RTCIceServer[];
      refreshBufferMs?: number;
    }
  | {
      type: "websocket";
      /** Explicit ws:// or wss:// URL. If omitted, derived from BackendConfig.baseUrl + wsPath. */
      url?: string;
      /** Path appended to baseUrl when url is not set. Default: "/ws" */
      wsPath?: string;
    };

export type BackendConfig = {
  baseUrl: string;
  offerPath?: string;
  patchPath?: string;
  iceServersPath?: string;
  healthPath?: string;
  capabilitiesPath?: string;
  /** Path for the remote config endpoint. Default: "/config" */
  configPath?: string;
  headers?: Record<string, string>;
};

export type VoiceAgentConfig = {
  transport?: TransportConfig;
  backend: BackendConfig;
  /** Passed as query-string params — e.g. { interview_type: "full" } */
  metadata?: Record<string, string>;
  timeoutMs?: number;
  onLog?: (message: string) => void;
  /** Called with the remote MediaStream when the first WebRTC track arrives. */
  onTrack?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: VoiceAgentStatus) => void;
  onError?: (error: Error) => void;
  /** Called for every data-channel or WebSocket bot message. */
  onMessage?: (msg: BotMessage) => void;
};

export type VoiceAgentStatus = "idle" | "connecting" | "connected" | "failed";

export type VoiceAgentResponse = {
  pc_id: string;
  sdp: string;
  type: string;
};

/** Structured messages received over the bot data channel or WebSocket. */
export type BotMessage =
  | { type: "transcript"; id?: string; role: "user" | "assistant"; text: string }
  | { type: "status"; status: string }
  | { type: "artifact"; [key: string]: unknown }
  /**
   * Intent label — short LLM-generated summary of the current conversational
   * moment. Displayed prominently in the voice UI instead of the raw transcript.
   * e.g. { type: "intent", text: "Question" }
   */
  | { type: "intent"; text: string }
  | { type: string; [key: string]: unknown };

/** Subset of the server RemoteConfig that the client receives from GET /config. */
export type RemoteConfig = {
  transport:         "websocket" | "webrtc" | "auto";
  allow_upgrade:     boolean;
  pipeline_mode:     "stt_llm_tts" | "native_audio";
  vad_stop_secs:     number;
  client_vad_ui:     boolean;
  max_session_secs:  number;
  default_interview: string;
  qos_panel:         boolean;
  show_transcript:   boolean;
  maintenance:       boolean;
  maintenance_msg:   string;
  audio_sample_rate: number;
  audio_encoding:    string;
};
