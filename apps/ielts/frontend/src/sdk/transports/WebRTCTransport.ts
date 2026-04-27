import type {
  Transport,
  TransportCallbacks,
  TransportStatus,
  TransportType,
  VoiceAgentResponse,
} from './Transport';

export interface WebRTCTransportConfig {
  baseUrl:             string;
  offerPath?:          string;
  patchPath?:          string;
  iceServersPath?:     string;
  metadata?:           Record<string, string>;
  iceTransportPolicy?: RTCIceTransportPolicy;
  /** Static ICE servers — skips the /ice-servers fetch if provided. */
  staticIceServers?:   RTCIceServer[];
  headers?:            Record<string, string>;
  refreshBufferMs?:    number;
  timeoutMs?:          number;
}

type EventMap = { [K in keyof TransportCallbacks]: Set<TransportCallbacks[K]> };

const DEFAULTS = {
  offerPath:       '/offer',
  patchPath:       '/offer',
  iceServersPath:  '/ice-servers',
  metadata:        {} as Record<string, string>,
  headers:         {} as Record<string, string>,
  refreshBufferMs: 15_000,
  timeoutMs:       15_000,
} as const;

export class WebRTCTransport implements Transport {
  readonly type: TransportType = 'webrtc';

  private _status: TransportStatus = 'idle';
  private cfg:     Required<WebRTCTransportConfig>;
  private pc:      RTCPeerConnection | null = null;
  private stream:  MediaStream | null = null;
  private pcId:    string | null = null;
  private dc:      RTCDataChannel | null = null;
  private cachedIce:      RTCIceServer[] | null = null;
  private iceExpiresAt:   number | null = null;
  private events: EventMap = {
    onAudio:        new Set(),
    onTrack:        new Set(),
    onMessage:      new Set(),
    onStatusChange: new Set(),
    onError:        new Set(),
  };

  constructor(config: WebRTCTransportConfig) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  get status(): TransportStatus { return this._status; }

  // ── Transport interface ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      await this._acquireMic();
      const ice = await this._getIceServers();
      this._createPeerConnection(ice);
      const offer  = await this.pc!.createOffer();
      await this.pc!.setLocalDescription(offer);
      const answer = await this._sendOffer(offer.sdp!, offer.type);
      this.pcId = answer.pc_id;
      await this.pc!.setRemoteDescription({ type: answer.type as RTCSdpType, sdp: answer.sdp });
    } catch (err) {
      this.setStatus('failed');
      this.emit('onError', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  disconnect(): void {
    this.dc?.close();
    this.dc = null;
    this.pc?.close();
    this.pc = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.pcId = null;
    this.setStatus('closed');
  }

  /** No-op — audio flows through the media track. */
  sendAudio(_data: ArrayBuffer): void {}

  sendMessage(msg: Record<string, unknown>): void {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(msg));
    }
  }

  on<K extends keyof TransportCallbacks>(event: K, cb: TransportCallbacks[K]): void {
    (this.events[event] as Set<TransportCallbacks[K]>).add(cb);
  }

  off<K extends keyof TransportCallbacks>(event: K, cb: TransportCallbacks[K]): void {
    (this.events[event] as Set<TransportCallbacks[K]>).delete(cb);
  }

  // ── Private — media ────────────────────────────────────────────────────

  private async _acquireMic(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      video: false,
    });
  }

  // ── Private — peer connection ──────────────────────────────────────────

  private _createPeerConnection(iceServers: RTCIceServer[]): void {
    const cfg: RTCConfiguration = { iceServers };
    if (this.cfg.iceTransportPolicy) cfg.iceTransportPolicy = this.cfg.iceTransportPolicy;

    this.pc = new RTCPeerConnection(cfg);
    this.stream!.getTracks().forEach(t => this.pc!.addTrack(t, this.stream!));

    // Data channel for bot JSON messages
    this.dc = this.pc.createDataChannel('bot-messages');
    this.dc.onmessage = (ev) => {
      try { this.emit('onMessage', JSON.parse(ev.data as string)); } catch { /**/ }
    };

    this.pc.ontrack = (ev) => {
      if (ev.streams.length) this.emit('onTrack', ev.streams[0]);
    };

    this.pc.onicecandidate = (ev) => {
      if (!ev.candidate || !this.pcId) return;
      void this._patchIce([ev.candidate.toJSON()]);
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      if (state === 'connected')  this.setStatus('connected');
      else if (state === 'failed') { this.setStatus('failed'); this.emit('onError', new Error('RTCPeerConnection failed')); }
    };
  }

  // ── Private — signalling ───────────────────────────────────────────────

  private async _sendOffer(sdp: string, type: string): Promise<VoiceAgentResponse> {
    const qs  = new URLSearchParams(this.cfg.metadata).toString();
    const url = `${this.cfg.baseUrl}${this.cfg.offerPath}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...this.cfg.headers },
      body:    JSON.stringify({ sdp, type }),
    });
    if (!res.ok) throw new Error(`Offer failed: ${res.status}`);
    return res.json() as Promise<VoiceAgentResponse>;
  }

  private async _patchIce(candidates: RTCIceCandidateInit[]): Promise<void> {
    if (!this.pcId) return;
    const url = `${this.cfg.baseUrl}${this.cfg.patchPath}/${encodeURIComponent(this.pcId)}`;
    await fetch(url, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.cfg.headers },
      body:    JSON.stringify({ candidates }),
    }).catch(() => { /* non-fatal */ });
  }

  // ── Private — ICE servers ──────────────────────────────────────────────

  private async _getIceServers(): Promise<RTCIceServer[]> {
    if (this.cfg.staticIceServers?.length) return this.cfg.staticIceServers;
    if (this.cachedIce && this.iceExpiresAt && Date.now() + this.cfg.refreshBufferMs < this.iceExpiresAt) {
      return this.cachedIce;
    }
    const url = `${this.cfg.baseUrl}${this.cfg.iceServersPath}`;
    const res = await fetch(url, { headers: { Accept: 'application/json', ...this.cfg.headers } });
    if (!res.ok) throw new Error(`ICE fetch failed: ${res.status}`);
    const payload = await res.json() as { iceServers?: RTCIceServer[]; ttlSeconds?: number };
    this.cachedIce      = payload.iceServers ?? [];
    this.iceExpiresAt   = payload.ttlSeconds ? Date.now() + payload.ttlSeconds * 1000 : null;
    return this.cachedIce;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private setStatus(s: TransportStatus): void {
    this._status = s;
    this.emit('onStatusChange', s);
  }

  private emit<K extends keyof TransportCallbacks>(
    event: K,
    ...args: Parameters<TransportCallbacks[K]>
  ): void {
    for (const cb of this.events[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }
}
