// ── Transport-agnostic VoiceAgent ─────────────────────────────────────────────
//
// This file is the public entry point for the SDK. It wraps any Transport
// (WebSocketTransport, WebRTCTransport, or a TransportSwitcher) with:
//   • mic capture (getUserMedia)
//   • audio playback (<audio> element for WebRTC track; AudioContext for PCM)
//   • session status tracking
//   • message routing
//
// Convenience factories:
//   VoiceAgent.withWebSocket(config)
//   VoiceAgent.withWebRTC(config)
//
// For seamless WS→WebRTC upgrade, wrap a TransportSwitcher:
//   const switcher = new TransportSwitcher(ws, { triggers: ['qos'] });
//   const agent = new VoiceAgent({ transport: switcher, ... });
//
// ─────────────────────────────────────────────────────────────────────────────

import type { Transport, BotMessage, SessionStatus, QoSSnapshot } from './transports/Transport';
import { WebSocketTransport }  from './transports/WebSocketTransport';
import { WebRTCTransport }     from './transports/WebRTCTransport';
import type { WebSocketTransportConfig } from './transports/WebSocketTransport';
import type { WebRTCTransportConfig }    from './transports/WebRTCTransport';

// "Switcher-compatible" — anything that exposes sendAudio/sendMessage/on/off
// without necessarily implementing the full Transport interface.
type TransportLike = Pick<Transport, 'sendAudio' | 'sendMessage' | 'on' | 'off'>;

export interface VoiceAgentOptions {
  transport:  Transport | TransportLike;
  onMessage?: (msg: BotMessage) => void;
  onStatus?:  (status: SessionStatus) => void;
  onQoS?:     (snapshot: QoSSnapshot) => void;
  onError?:   (error: Error) => void;
  onLog?:     (msg: string) => void;
}

function defaultLog(message: string) {
  console.log('[VoiceAgent]', message);
}

export class VoiceAgent {
  private transport:   Transport | TransportLike;
  private opts:        VoiceAgentOptions;
  private status:      SessionStatus = 'idle';
  private mic:         MediaStream | null = null;
  private processor:   ScriptProcessorNode | null = null;
  private captureCtx:  AudioContext | null = null;  // mic capture (16 kHz)
  private audioCtx:    AudioContext | null = null;  // playback
  private audioEl:     HTMLAudioElement | null = null;
  private playbackMsd: MediaStreamAudioDestinationNode | null = null;
  private micActive:   boolean = false;
  private nextPlayTime: number = 0;
  private pcmSampleRate: number = 16_000;

  constructor(opts: VoiceAgentOptions) {
    this.transport = opts.transport;
    this.opts      = opts;
    this._bindTransport();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      // Only call connect() if the transport is a proper Transport
      if ('connect' in this.transport) {
        await (this.transport as Transport).connect();
      }
      await this._acquireMic();
      this.setStatus('connected');
    } catch (err) {
      this.setStatus('error');
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  disconnect(): void {
    this._stopMic();
    this._stopPlayback();
    if ('disconnect' in this.transport) {
      (this.transport as Transport).disconnect();
    }
    this.setStatus('ended');
  }

  /** Mute / unmute the microphone without disconnecting. */
  setMicEnabled(enabled: boolean): void {
    this.mic?.getAudioTracks().forEach(t => { t.enabled = enabled; });
  }

  /** Send a raw control message over the active transport. */
  sendMessage(msg: Record<string, unknown>): void {
    this.transport.sendMessage(msg);
  }

  // ── Static factories ───────────────────────────────────────────────────────

  static withWebSocket(transportConfig: WebSocketTransportConfig, opts: Omit<VoiceAgentOptions, 'transport'>): VoiceAgent {
    return new VoiceAgent({ transport: new WebSocketTransport(transportConfig), ...opts });
  }

  static withWebRTC(transportConfig: WebRTCTransportConfig, opts: Omit<VoiceAgentOptions, 'transport'>): VoiceAgent {
    return new VoiceAgent({ transport: new WebRTCTransport(transportConfig), ...opts });
  }

  // ── Private — transport event binding ─────────────────────────────────────

  private _bindTransport(): void {
    this.transport.on('onMessage', (msg: Record<string, unknown>) => {
      // Handle audio config from server
      if (msg['type'] === 'config') {
        if (typeof msg['audio_sample_rate'] === 'number') {
          this.pcmSampleRate = msg['audio_sample_rate'] as number;
        }
        return;
      }
      const bmsg = msg as BotMessage;
      if (bmsg.type === 'status') {
        const s = (bmsg as Extract<BotMessage, { type: 'status' }>).status;
        if (s === 'listening') this.setStatus('listening');
        else if (s === 'speaking') this.setStatus('speaking');
      }
      if (bmsg.type === '_qos') {
        this.opts.onQoS?.(msg as unknown as QoSSnapshot);
        return; // internal metric, don't surface to onMessage
      }
      this.opts.onMessage?.(bmsg);
    });

    this.transport.on('onAudio', (data: ArrayBuffer) => {
      this._playPcm(data);
    });

    this.transport.on('onTrack', (stream: MediaStream) => {
      this._playTrack(stream);
    });

    this.transport.on('onStatusChange', (s) => {
      if (s === 'connected')  this.setStatus('connected');
      if (s === 'failed')     this.setStatus('error');
      if (s === 'closed')     this.setStatus('ended');
    });

    this.transport.on('onError', (err: Error) => {
      this.opts.onError?.(err);
    });
  }

  // ── Private — mic ──────────────────────────────────────────────────────────

  private async _acquireMic(): Promise<void> {
    if (this.mic) return;
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      video: false,
    });

    // For WebSocket transport, stream raw PCM to sendAudio
    if ('type' in this.transport && (this.transport as Transport).type === 'websocket') {
      this._startPcmStreaming();
    }
    // For WebRTC, the transport owns mic through RTCPeerConnection — no extra work needed
    this.micActive = true;
    this.log('Microphone acquired');
  }

  private _startPcmStreaming(): void {
    const SAMPLE_RATE = 16_000;
    const transport = this.transport;

    // Inline AudioWorklet processor as a Blob URL — runs on dedicated audio
    // thread so onaudioprocess never drops frames due to main-thread jank.
    const workletCode = `
      class PcmSenderProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0]?.[0];
          if (!ch || ch.length === 0) return true;
          const pcm = new Int16Array(ch.length);
          for (let i = 0; i < ch.length; i++) {
            pcm[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767)));
          }
          this.port.postMessage(pcm.buffer, [pcm.buffer]);
          return true;
        }
      }
      registerProcessor('pcm-sender', PcmSenderProcessor);
    `;
    const blobUrl = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.captureCtx = ctx;

    ctx.audioWorklet.addModule(blobUrl).then(() => {
      URL.revokeObjectURL(blobUrl);
      if (!this.mic) return; // disconnected before worklet loaded

      const source = ctx.createMediaStreamSource(this.mic);
      const workletNode = new AudioWorkletNode(ctx, 'pcm-sender', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
      });

      workletNode.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        transport.sendAudio(ev.data);
      };

      // Worklet output must be connected to destination for the node to
      // stay active — route through zero-gain so mic is never heard.
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(ctx.destination);

      this.log('AudioWorklet mic streaming started');
    }).catch((err: unknown) => {
      this.log('AudioWorklet failed (${(err as Error).message}), falling back to ScriptProcessor');
      URL.revokeObjectURL(blobUrl);
      this._startPcmStreamingLegacy(ctx);
    });
  }

  /** ScriptProcessorNode fallback (runs on main thread). */
  private _startPcmStreamingLegacy(ctx: AudioContext): void {
    this.captureCtx = ctx;
    const source    = ctx.createMediaStreamSource(this.mic!);
    const processor = ctx.createScriptProcessor(512, 1, 1);
    this.processor  = processor;

    processor.onaudioprocess = (ev) => {
      const f32 = ev.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        pcm[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
      }
      this.transport.sendAudio(pcm.buffer);
    };

    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);
  }

  private _stopMic(): void {
    this.processor?.disconnect();
    this.processor = null;
    this.captureCtx?.close();
    this.captureCtx = null;
    this.mic?.getTracks().forEach(t => t.stop());
    this.mic = null;
    this.micActive = false;
  }

  // ── Private — playback ─────────────────────────────────────────────────────

  /** Play a WebRTC MediaStream (track event). */
  private _playTrack(stream: MediaStream): void {
    if (!this.audioEl) {
      this.audioEl = document.createElement('audio');
      this.audioEl.autoplay = true;
      this.audioEl.style.display = 'none';
      document.body.appendChild(this.audioEl);
    }
    this.audioEl.srcObject = stream;
  }

  /** Play a PCM16 ArrayBuffer (WebSocket binary frame). */
  private _playPcm(data: ArrayBuffer): void {
    // Lazily create AudioContext for playback.
    // Output is routed through a MediaStreamDestination → <audio> element so
    // the browser's AEC (on the getUserMedia mic stream) has a reference to
    // what's being played and can cancel it from the mic input.
    if (!this.audioCtx) {
      const ctx = new AudioContext();
      this.audioCtx = ctx;
      this.nextPlayTime = 0;

      // Create a MediaStreamDestination so the output is an actual MediaStream.
      // Feed that stream into an <audio> element — the browser's AEC on the mic
      // then sees this as the "loudspeaker reference" and cancels it.
      const msd = ctx.createMediaStreamDestination();
      this.playbackMsd = msd;

      if (!this.audioEl) {
        this.audioEl = document.createElement('audio');
        this.audioEl.autoplay = true;
        this.audioEl.style.display = 'none';
        document.body.appendChild(this.audioEl);
      }
      this.audioEl.srcObject = msd.stream;
    }
    const ctx = this.audioCtx;

    const pcm = new Int16Array(data);
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;

    const buf = ctx.createBuffer(1, f32.length, this.pcmSampleRate);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Connect to MSD (played through <audio>) instead of ctx.destination directly
    src.connect(this.playbackMsd!);

    // Schedule chunks back-to-back; never overlap, never gap.
    const startTime = Math.max(ctx.currentTime, this.nextPlayTime);
    src.start(startTime);
    this.nextPlayTime = startTime + buf.duration;
  }

  private _stopPlayback(): void {
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }
    this.playbackMsd = null;
    this.nextPlayTime = 0;
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private setStatus(s: SessionStatus): void {
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private log(msg: string): void {
    (this.opts.onLog ?? defaultLog)(msg);
  }
}

// ── Legacy export shim ────────────────────────────────────────────────────────
// Old code imported VoiceAgentConfig from './types'. Re-export the new type
// under the same name so existing imports don't break immediately.
export type { VoiceAgentOptions as VoiceAgentConfig };

// ── Legacy class preserved for old direct-WebRTC usage (deprecated) ────────────
// REMOVE in next major version. Use VoiceAgent.withWebRTC() instead.

import type {
  BackendConfig,
  DiagnosticsReport,
  TransportConfig,
  VoiceAgentConfig as LegacyVoiceAgentConfig,
  VoiceAgentProfile,
  VoiceAgentResponse,
} from './types';

const DEFAULT_OFFER_PATH = '/offer';
const DEFAULT_ICE_PATH = '/ice-servers';
const DEFAULT_PATCH_PATH = '/offer';
const DEFAULT_HEALTH_PATH = '/health';
const DEFAULT_CAPABILITIES_PATH = '/capabilities';
const DEFAULT_REFRESH_BUFFER_MS = 15000;

function filterIceServersForDirect(iceServers: RTCIceServer[]) {
  return iceServers
    .map(server => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      const filtered = urls.filter(
        url => !String(url).startsWith('turn:') && !String(url).startsWith('turns:')
      );
      return filtered.length ? { ...server, urls: filtered } : null;
    })
    .filter(Boolean) as RTCIceServer[];
}

function nowMs() {
  return Date.now();
}

/** @deprecated Use VoiceAgent.withWebRTC() instead. */
export class LegacyVoiceAgent {
  private config: LegacyVoiceAgentConfig;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private pcId: string | null = null;
  private status: 'idle' | 'connecting' | 'connected' | 'failed' = 'idle';
  private cachedIceServers: RTCIceServer[] | null = null;
  private iceServersExpiresAt: number | null = null;
  private backendCapabilities: unknown | null = null;

  constructor(config: LegacyVoiceAgentConfig) {
    const defaultTransport = {
      type: 'webrtc' as const,
      profile: 'default' as const,
      iceServersPath: DEFAULT_ICE_PATH,
      refreshBufferMs: DEFAULT_REFRESH_BUFFER_MS,
    };

    const defaultBackend = {
      baseUrl: '',
      offerPath: DEFAULT_OFFER_PATH,
      patchPath: DEFAULT_PATCH_PATH,
      iceServersPath: DEFAULT_ICE_PATH,
      healthPath: DEFAULT_HEALTH_PATH,
      capabilitiesPath: DEFAULT_CAPABILITIES_PATH,
    };

    this.config = {
      ...config,
      audioConstraints: config.audioConstraints ?? { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      timeoutMs: config.timeoutMs ?? 15000,
      transport: { ...defaultTransport, ...(config.transport ?? {}) },
      backend: { ...defaultBackend, ...config.backend },
      metadata: config.metadata ?? {},
    };
  }

  public async start() {
    this.log('Starting voice agent');
    this.updateStatus('connecting');
    await this.acquireLocalMedia();

    try {
      const capabilities = await this.fetchBackendCapabilities();
      this.backendCapabilities = capabilities;
      this.log(`Backend capabilities detected: ${JSON.stringify(capabilities)}`);
    } catch (err) {
      this.log(`Unable to fetch backend capabilities: ${(err as Error).message}`);
    }

    const iceServers = await this.getIceServers();
    const options = this.buildPeerConnectionOptions(iceServers);

    this.pc = new RTCPeerConnection(options);
    this.setupPeerConnection();

    this.localStream?.getTracks().forEach(track => this.pc?.addTrack(track, this.localStream as MediaStream));

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.log('Created local offer');

    const response = await this.sendOffer(offer.sdp ?? '', offer.type ?? 'offer');
    this.pcId = response.pc_id;
    await this.pc.setRemoteDescription({ type: response.type as RTCSdpType, sdp: response.sdp });
    this.log(`Remote answer applied, pc_id=${this.pcId}`);
  }

  public stop() {
    this.log('Stopping voice agent');
    if (this.pc) { this.pc.close(); this.pc = null; }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    this.pcId = null;
    this.updateStatus('idle');
  }

  public setProfile(profile: VoiceAgentProfile) {
    if (!this.config.transport) return;
    this.config.transport.profile = profile;
    this.log(`Profile set to ${profile}`);
  }

  public async diagnostics(): Promise<DiagnosticsReport> {
    const details: string[] = [];
    let transportReady = false;
    let backendReady = false;
    let iceServersCount = 0;
    let healthStatus: unknown = null;
    let capabilities: unknown = null;

    try {
      const iceServers = await this.getIceServers(true);
      iceServersCount = iceServers.length;
      transportReady = iceServersCount > 0;
      details.push(`ICE servers loaded: ${iceServersCount}`);
    } catch (err) {
      details.push(`ICE server fetch failed: ${(err as Error).message}`);
    }

    try {
      const health = await this.fetchBackendHealth();
      backendReady = health.ok;
      healthStatus = health;
      details.push(`Backend health: ${health.ok ? 'ok' : 'not ok'}`);
    } catch (err) {
      details.push(`Health check failed: ${(err as Error).message}`);
    }

    try {
      capabilities = await this.fetchBackendCapabilities();
      if (capabilities) { details.push('Backend capabilities loaded'); }
    } catch (err) {
      details.push(`Capabilities check failed: ${(err as Error).message}`);
    }

    return { ok: transportReady && backendReady, transportReady, backendReady, iceServersCount, healthStatus, capabilities, details };
  }

  private async acquireLocalMedia() {
    if (this.localStream) return;
    this.log('Requesting microphone access');
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: this.config.audioConstraints ?? true,
      video: false,
    });
    this.log('Microphone granted');
  }

  private async getIceServers(forceRefresh = false) {
    const transport = this.getTransportConfig();
    if (transport.staticIceServers && transport.staticIceServers.length > 0) {
      this.log('Using static ICE servers from transport config');
      return this.translateProfile(transport.staticIceServers);
    }

    if (!forceRefresh && this.cachedIceServers && this.iceServersExpiresAt) {
      const buffer = transport.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS;
      if (nowMs() + buffer < this.iceServersExpiresAt) {
        this.log('Using cached ICE servers until refresh time');
        return this.translateProfile(this.cachedIceServers);
      }
      this.log('Cached ICE servers are stale; refreshing now');
    }

    const iceServersResponse = await this.fetchIceServersFromBackend();
    this.cachedIceServers = iceServersResponse.iceServers;
    this.iceServersExpiresAt = iceServersResponse.expiresAt || null;
    return this.translateProfile(this.cachedIceServers);
  }

  private translateProfile(iceServers: RTCIceServer[]) {
    const transport = this.getTransportConfig();
    if (transport.profile === 'direct') {
      const filtered = filterIceServersForDirect(iceServers);
      this.log(`Direct profile filters out TURN entries; base servers=${filtered.length}`);
      return filtered;
    }
    return iceServers;
  }

  private async fetchIceServersFromBackend() {
    const backend = this.getBackendConfig();
    const path = backend.iceServersPath ?? this.getTransportConfig().iceServersPath ?? DEFAULT_ICE_PATH;
    const url = `${backend.baseUrl}${path}`;
    this.log(`Fetching ICE servers from ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(backend.headers ?? {}) },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ICE servers: ${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    const iceServers = (payload.iceServers ?? []) as RTCIceServer[];
    this.log(`Received ${iceServers.length} ICE server entries`);

    const ttlSeconds = typeof payload.ttlSeconds === 'number' ? payload.ttlSeconds : undefined;
    const expiresAt = typeof payload.expiresAt === 'number'
      ? payload.expiresAt
      : ttlSeconds
      ? nowMs() + ttlSeconds * 1000
      : undefined;

    return {
      iceServers,
      expiresAt,
    };
  }

  private buildPeerConnectionOptions(iceServers: RTCIceServer[]) {
    const transport = this.getTransportConfig();
    const config: RTCConfiguration = { iceServers };
    if (transport.iceTransportPolicy) {
      config.iceTransportPolicy = transport.iceTransportPolicy;
      this.log(`Applying transport ICE policy: ${transport.iceTransportPolicy}`);
    } else if (transport.profile === 'relay') {
      config.iceTransportPolicy = 'relay';
      this.log('Using relay-only ICE transport policy');
    }
    return config;
  }

  private setupPeerConnection() {
    if (!this.pc) return;

    this.pc.onicecandidate = event => {
      if (!event.candidate || !this.pcId) return;
      this.log(`Local ICE candidate: ${event.candidate.type} ${event.candidate.protocol}`);
      void this.sendIcePatch([event.candidate.toJSON()]);
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState ?? 'unknown';
      this.log(`Connection state changed: ${state}`);
      this.updateStatus(state === 'connected' ? 'connected' : state === 'failed' ? 'failed' : 'connecting');
    };

    this.pc.ontrack = event => {
      this.log('Remote track event received');
      if (event.streams.length > 0) {
        this.config.onTrack?.(event.streams[0]);
      }
    };
  }

  private async sendOffer(sdp: string, type: string) {
    const backend = this.getBackendConfig();
    const url = `${backend.baseUrl}${backend.offerPath ?? DEFAULT_OFFER_PATH}`;
    const params = new URLSearchParams(this.config.metadata ?? {});
    const query = params.toString() ? `?${params.toString()}` : '';
    this.log(`Sending offer to ${url}${query}`);
    const response = await fetch(`${url}${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(backend.headers ?? {}),
      },
      body: JSON.stringify({ sdp, type }),
    });
    if (!response.ok) {
      throw new Error(`Offer request failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as VoiceAgentResponse;
    return data;
  }

  private async sendIcePatch(candidates: RTCIceCandidateInit[]) {
    if (!this.pcId) return;
    const backend = this.getBackendConfig();
    const url = `${backend.baseUrl}${backend.patchPath ?? DEFAULT_PATCH_PATH}/${encodeURIComponent(this.pcId)}`;
    this.log(`Patching ${candidates.length} ICE candidate(s) to ${url}`);
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(backend.headers ?? {}),
      },
      body: JSON.stringify({ candidates }),
    });
    if (!response.ok) {
      this.log(`ICE patch failed: ${response.status} ${response.statusText}`);
    }
  }

  private async fetchBackendHealth() {
    const backend = this.getBackendConfig();
    const path = backend.healthPath ?? DEFAULT_HEALTH_PATH;
    const url = `${backend.baseUrl}${path}`;
    this.log(`Checking backend health at ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(backend.headers ?? {}) },
    });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const payload = await response.json();
    return { ok: true, status: payload };
  }

  private async fetchBackendCapabilities() {
    const backend = this.getBackendConfig();
    const path = backend.capabilitiesPath ?? DEFAULT_CAPABILITIES_PATH;
    const url = `${backend.baseUrl}${path}`;
    this.log(`Fetching backend capabilities from ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(backend.headers ?? {}) },
    });
    if (!response.ok) {
      throw new Error(`Capabilities request failed: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  }

  private getTransportConfig(): TransportConfig {
    return this.config.transport ?? { type: 'webrtc', profile: 'default', iceServersPath: DEFAULT_ICE_PATH, refreshBufferMs: DEFAULT_REFRESH_BUFFER_MS };
  }

  private getBackendConfig(): BackendConfig {
    return this.config.backend;
  }

  private updateStatus(state: 'idle' | 'connecting' | 'connected' | 'failed') {
    this.status = state;
    this.config.onConnectionStateChange?.(state);
  }

  private log(message: string) {
    (this.config.onLog ?? defaultLog)(message);
  }
}
