/**
 * VoiceAgent (mobile) — React Native WebRTC client for the Prepatu backend.
 *
 * Mirrors the shape of frontend/src/sdk/VoiceAgent.ts so both can be unified
 * into a single published package when the SDK is extracted.
 *
 * Key differences from the web SDK:
 *  - Uses react-native-webrtc instead of the browser WebRTC API.
 *  - Microphone access is via react-native-webrtc's getUserMedia shim —
 *    no expo-av needed for the WebRTC audio path (the MediaStream goes
 *    directly into the peer connection).
 *  - Bot audio arrives as a remote track and needs to be rendered with
 *    react-native-webrtc's RTCView or an InCallManager bridge. The SDK
 *    surfaces it via onTrack so the app layer can decide how to play it.
 *  - Bot text messages (transcript, artifacts) arrive over a WebRTC
 *    data channel named "bot-messages".
 */

import {
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  type MediaStream,
} from "react-native-webrtc";
import { Platform, PermissionsAndroid } from "react-native";

import type {
  BackendConfig,
  BotMessage,
  TransportConfig,
  VoiceAgentConfig,
  VoiceAgentResponse,
  VoiceAgentStatus,
} from "./types";

const DEFAULT_OFFER_PATH       = "/offer";
const DEFAULT_ICE_PATH         = "/ice-servers";
const DEFAULT_PATCH_PATH       = "/offer";
const DEFAULT_HEALTH_PATH      = "/health";
const DEFAULT_CAPABILITIES_PATH = "/capabilities";
const DEFAULT_REFRESH_BUFFER_MS = 15_000;

function nowMs() { return Date.now(); }

function filterDirect(iceServers: RTCIceServer[]): RTCIceServer[] {
  return iceServers
    .map((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls as string];
      const filtered = urls.filter(
        (u) => !u.startsWith("turn:") && !u.startsWith("turns:")
      );
      return filtered.length ? { ...s, urls: filtered } : null;
    })
    .filter(Boolean) as RTCIceServer[];
}

const DEFAULT_WS_PATH = "/ws";

/** Derive a ws:// / wss:// URL from an http:// / https:// base URL. */
function toWsBase(baseUrl: string): string {
  return baseUrl.replace(/^https/, "wss").replace(/^http/, "ws");
}

/** Generate a random UUID (client-side, RFC 4122 v4). */
function randomUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class VoiceAgent {
  private config: Required<VoiceAgentConfig>;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private pcId: string | null = null;
  private status: VoiceAgentStatus = "idle";
  private cachedIceServers: RTCIceServer[] | null = null;
  private iceServersExpiresAt: number | null = null;
  private dataChannel: ReturnType<RTCPeerConnection["createDataChannel"]> | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  /** Session ID shared between the WebRTC offer and the WS control channel. */
  private sessionId: string = randomUUID();
  /** Persistent WebSocket for JSON control messages (transcript, status, intent). */
  private controlWs: WebSocket | null = null;

  constructor(config: VoiceAgentConfig) {
    const defaultTransport: TransportConfig = {
      type: "webrtc",
      profile: "default",
      iceServersPath: DEFAULT_ICE_PATH,
      refreshBufferMs: DEFAULT_REFRESH_BUFFER_MS,
    };
    const defaultBackend: BackendConfig = {
      baseUrl: "",
      offerPath: DEFAULT_OFFER_PATH,
      patchPath: DEFAULT_PATCH_PATH,
      iceServersPath: DEFAULT_ICE_PATH,
      healthPath: DEFAULT_HEALTH_PATH,
      capabilitiesPath: DEFAULT_CAPABILITIES_PATH,
    };
    this.config = {
      transport: { ...defaultTransport, ...(config.transport ?? {}) },
      backend:   { ...defaultBackend,   ...config.backend },
      metadata:  config.metadata  ?? {},
      timeoutMs: config.timeoutMs ?? 15_000,
      onLog:                 config.onLog                 ?? ((m) => console.log("[VoiceAgent]", m)),
      onTrack:               config.onTrack               ?? (() => {}),
      onConnectionStateChange: config.onConnectionStateChange ?? (() => {}),
      onError:               config.onError               ?? (() => {}),
      onMessage:             config.onMessage             ?? (() => {}),
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  public async start() {
    this.log("Starting");
    this.updateStatus("connecting");

    // 1. Open the control WebSocket FIRST so the backend registers it before
    //    the WebRTC offer arrives (the offer's on_connection closure looks it up).
    await this._openControlChannel();

    // 2. Acquire mic and negotiate WebRTC audio.
    await this.acquireLocalMedia();

    const iceServers = await this.getIceServers();
    const pcConfig = this.buildPcConfig(iceServers);
    this.pc = new RTCPeerConnection(pcConfig);
    this.setupPeerConnection();

    // Data channel kept for fallback; primary messages arrive over controlWs.
    this.dataChannel = this.pc.createDataChannel("bot-messages");
    this.setupDataChannel();

    this.localStream
      ?.getTracks()
      .forEach((track) => this.pc!.addTrack(track, this.localStream!));

    const offer = await this.pc.createOffer({});
    await this.pc.setLocalDescription(offer);
    this.log("Local offer created");

    const response = await this.sendOffer(
      (offer as RTCSessionDescription).sdp ?? "",
      offer.type
    );
    this.pcId = response.pc_id;
    if (this.pendingIceCandidates.length) {
      const queued = [...this.pendingIceCandidates];
      this.pendingIceCandidates = [];
      this.log(`Flushing ${queued.length} queued ICE candidate(s)`);
      void this.patchIce(queued);
    }
    await this.pc.setRemoteDescription(
      new RTCSessionDescription({ type: response.type as RTCSdpType, sdp: response.sdp })
    );
    this.log(`Remote answer applied, pc_id=${this.pcId}`);
  }

  public stop() {
    this.log("Stopping");
    this.controlWs?.close();
    this.controlWs = null;
    this.dataChannel?.close();
    this.dataChannel = null;
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.pcId = null;
    this.pendingIceCandidates = [];
    this.updateStatus("idle");
  }

  public sendUIEvent(action: string, data?: Record<string, unknown>) {
    if (this.controlWs && this.controlWs.readyState === WebSocket.OPEN) {
      this.controlWs.send(JSON.stringify({ type: "ui_event", action, data }));
    } else {
      this.log("Cannot send UI event: control WebSocket is not open");
    }
  }

  // ── Private — control WebSocket channel ────────────────────────────────────

  /**
   * Open the control WebSocket and wait until the server acknowledges it
   * (first JSON message received).  The session_id links it to the WebRTC offer.
   */
  private _openControlChannel(): Promise<void> {
    return new Promise((resolve, reject) => {
      const base   = toWsBase(this.config.backend.baseUrl);
      const mode   = this.config.metadata.mode ?? "interview";
      const itType = this.config.metadata.interview_type ?? "part1";
      const devId  = this.config.metadata.device_id ?? "";
      const params = new URLSearchParams({
        mode:           "control",
        session_id:     this.sessionId,
        interview_type: itType,
        role_mode:      mode,
        ...(devId ? { device_id: devId } : {}),
      });
      const url = `${base}${DEFAULT_WS_PATH}?${params.toString()}`;
      this.log(`Control WS: ${url}`);

      const ws = new WebSocket(url);
      this.controlWs = ws;

      const timeout = setTimeout(() => {
        reject(new Error("Control channel connect timeout"));
        ws.close();
      }, this.config.timeoutMs);

      ws.onmessage = (event) => {
        // First message confirms registration — resolve the promise.
        // Subsequent messages are routed to onMessage.
        try {
          const msg = JSON.parse(event.data as string);
          clearTimeout(timeout);
          resolve();
          this.config.onMessage(msg as BotMessage);
        } catch {
          clearTimeout(timeout);
          resolve();
        }
        // Re-bind onmessage for subsequent frames
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data as string) as BotMessage;
            this.config.onMessage(m);
          } catch { /* ignore non-JSON */ }
        };
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        this.log("Control WS error");
        // Don't reject — fall through to pure WebRTC data channel
        resolve();
      };

      ws.onclose = () => {
        this.log("Control WS closed");
        if (this.status !== "idle") this.updateStatus("failed");
      };
    });
  }

  // ── Private — media ────────────────────────────────────────────────────────

  private async acquireLocalMedia() {
    if (this.localStream) return;

    // Android requires a runtime permission request before getUserMedia works.
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: "Microphone Permission",
          message: "Prepatu needs microphone access to conduct voice sessions.",
          buttonPositive: "Allow",
        }
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error("Microphone permission denied");
      }
    }

    this.log("Requesting microphone");
    this.localStream = (await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    })) as unknown as MediaStream;
    this.log("Microphone granted");
  }

  // ── Private — ICE servers ──────────────────────────────────────────────────

  private async getIceServers(forceRefresh = false): Promise<RTCIceServer[]> {
    const transport = this.config.transport as any;
    if (transport.staticIceServers?.length) {
      return this.applyProfile(transport.staticIceServers);
    }
    if (!forceRefresh && this.cachedIceServers && this.iceServersExpiresAt) {
      const buffer = transport.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS;
      if (nowMs() + buffer < this.iceServersExpiresAt) {
        return this.applyProfile(this.cachedIceServers);
      }
      this.log("ICE servers stale — refreshing");
    }
    const { iceServers, expiresAt } = await this.fetchIceServers();
    this.cachedIceServers = iceServers;
    this.iceServersExpiresAt = expiresAt ?? null;
    return this.applyProfile(iceServers);
  }

  private applyProfile(servers: RTCIceServer[]): RTCIceServer[] {
    const transport = this.config.transport as any;
    if (transport.profile === "direct") return filterDirect(servers);
    return servers;
  }

  private async fetchIceServers(): Promise<{ iceServers: RTCIceServer[]; expiresAt?: number }> {
    const { backend } = this.config;
    const url = `${backend.baseUrl}${backend.iceServersPath ?? DEFAULT_ICE_PATH}`;
    this.log(`Fetching ICE servers: ${url}`);
    const res = await fetch(url, { headers: { Accept: "application/json", ...(backend.headers ?? {}) } });
    if (!res.ok) throw new Error(`ICE servers fetch failed: ${res.status}`);
    const payload = await res.json();
    const iceServers: RTCIceServer[] = payload.iceServers ?? [];
    const ttl: number | undefined = payload.ttlSeconds;
    const expiresAt = payload.expiresAt ?? (ttl ? nowMs() + ttl * 1000 : undefined);
    this.log(`Received ${iceServers.length} ICE server(s)`);
    return { iceServers, expiresAt };
  }

  // ── Private — peer connection ──────────────────────────────────────────────

  private buildPcConfig(iceServers: RTCIceServer[]): RTCConfiguration {
    const transport = this.config.transport as any;
    const cfg: RTCConfiguration = { iceServers };
    if (transport.iceTransportPolicy) cfg.iceTransportPolicy = transport.iceTransportPolicy;
    else if (transport.profile === "relay") cfg.iceTransportPolicy = "relay";
    return cfg;
  }

  private setupPeerConnection() {
    const pc = this.pc as any;

    pc.onicecandidate = (event: any) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON() as RTCIceCandidateInit;
      if (!this.pcId) {
        this.pendingIceCandidates.push(candidate);
        return;
      }
      this.log(`ICE candidate: ${event.candidate.type} ${event.candidate.protocol}`);
      void this.patchIce([candidate]);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState ?? "unknown";
      this.log(`Connection state: ${state}`);
      const mapped: VoiceAgentStatus =
        state === "connected" ? "connected" :
        state === "failed"    ? "failed"    :
        "connecting";
      this.updateStatus(mapped);
    };

    pc.ontrack = (event: any) => {
      this.log("Remote track received");
      if (event.streams && event.streams.length) this.config.onTrack(event.streams[0]);
    };
  }

  private setupDataChannel() {
    const dc = this.dataChannel as any;
    dc.onmessage = (event: any) => {
      try {
        const msg = JSON.parse(event.data) as BotMessage;
        this.config.onMessage(msg);
      } catch {
        // non-JSON frame — ignore
      }
    };
    dc.onerror = (err: unknown) => this.log(`Data channel error: ${String(err)}`);
  }

  // ── Private — signalling ───────────────────────────────────────────────────

  private async sendOffer(sdp: string, type: string): Promise<VoiceAgentResponse> {
    const { backend, metadata } = this.config;
    // Include session_id so the backend can find the paired control channel
    const qs = new URLSearchParams({ ...metadata, session_id: this.sessionId }).toString();
    const url = `${backend.baseUrl}${backend.offerPath ?? DEFAULT_OFFER_PATH}${qs ? `?${qs}` : ""}`;
    this.log(`POST ${url}`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(backend.headers ?? {}),
      },
      body: JSON.stringify({ sdp, type }),
    });
    if (!res.ok) throw new Error(`Offer failed: ${res.status} ${res.statusText}`);
    return (await res.json()) as VoiceAgentResponse;
  }

  private async patchIce(candidates: RTCIceCandidateInit[]) {
    if (!this.pcId) return;
    const { backend } = this.config;
    const url = `${backend.baseUrl}${backend.patchPath ?? DEFAULT_PATCH_PATH}/${encodeURIComponent(this.pcId)}`;
    this.log(`PATCH ICE (${candidates.length}) → ${url}`);
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(backend.headers ?? {}),
      },
      body: JSON.stringify({ candidates }),
    });
    if (!res.ok) this.log(`ICE PATCH failed: ${res.status}`);
  }

  // ── Private — helpers ──────────────────────────────────────────────────────

  private updateStatus(s: VoiceAgentStatus) {
    this.status = s;
    this.config.onConnectionStateChange(s);
  }

  private log(msg: string) {
    this.config.onLog(msg);
  }
}
