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

export type VoiceAgentConfig = {
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
  healthStatus?: any;
  capabilities?: any;
  details: string[];
};
