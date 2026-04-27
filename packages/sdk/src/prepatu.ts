// ── Prepatu SDK — main entry point ────────────────────────────────────────────
//
// One-liner usage:
//
//   Managed (no Python needed):
//     const agent = await Prepatu.createAgent({ apiKey: 'pk_live_...' });
//
//   Self-hosted:
//     const agent = await Prepatu.createAgent({ backendUrl: 'http://localhost:8000' });
//
// The agent object exposes connect() / disconnect() and mirrors the wire
// protocol events (onMessage, onStatus). Internally it resolves the correct
// transport (WebSocket or WebRTC) and, in managed mode, handles session
// token exchange with the cloud API.

import { isLocalhost, printSignupHint } from './localhost';
import { CloudClient }                  from './cloud-client';
import type { SessionStartResponse }    from './cloud-client';

export { CloudClient } from './cloud-client';
export { isLocalhost, printSignupHint } from './localhost';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentMessage = Record<string, unknown>;
export type AgentStatus  = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface AgentEventMap {
  message:    (msg: AgentMessage)    => void;
  status:     (s: AgentStatus)       => void;
  error:      (e: Error)             => void;
  /** Raw PCM16 audio chunk from the TTS engine. Feed directly to an AudioContext. */
  audio:      (buffer: ArrayBuffer)  => void;
}

// ── Init options ──────────────────────────────────────────────────────────────

/** Managed mode: SDK connects to Prepatu cloud. */
interface ManagedOptions {
  apiKey:      string;
  flowId?:     string;
  metadata?:   Record<string, string>;
  cloudApiUrl?: string;
}

/** Self-hosted mode: SDK connects to a vfdl backend directly. */
interface SelfHostedOptions {
  backendUrl:  string;
  metadata?:   Record<string, string>;
}

export type PrepatuAgentOptions = ManagedOptions | SelfHostedOptions;

function isManagedOptions(o: PrepatuAgentOptions): o is ManagedOptions {
  return 'apiKey' in o;
}

// ── PrepatuAgent ──────────────────────────────────────────────────────────────

export class PrepatuAgent {
  private ws:            WebSocket | null = null;
  private status:        AgentStatus = 'idle';
  private sessionToken:  string | null = null;
  private sessionStart:  number | null = null;
  private cloud:         CloudClient | null = null;
  private handlers:      Partial<{ [K in keyof AgentEventMap]: Set<AgentEventMap[K]> }> = {};

  /** @internal — use Prepatu.createAgent() */
  constructor(
    /** The final WebSocket URL to connect to. In managed mode this is the ws_url
     *  returned by the cloud session endpoint (token already embedded in the path).
     *  In self-hosted mode this is options.backendUrl. */
    private readonly wsUrl: string,
    private readonly sessionInfo: SessionStartResponse | null,
    cloudClient: CloudClient | null,
  ) {
    this.cloud        = cloudClient;
    this.sessionToken = sessionInfo?.session_token ?? null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this._setStatus('connecting');
    this.sessionStart = Date.now();

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        this._setStatus('connected');
        resolve();
      };

      ws.onerror = () => {
        const err = new Error('[prepatu] WebSocket connection failed');
        this._emit('error', err);
        this._setStatus('error');
        reject(err);
      };

      ws.onclose = () => {
        this._setStatus('disconnected');
        void this._reportUsage();
      };

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          // Raw PCM16 audio from the TTS engine
          this._emit('audio', ev.data);
          return;
        }
        try {
          const msg = JSON.parse(ev.data as string) as AgentMessage;
          // Mirror status messages as the typed 'status' event for convenience
          if (typeof msg.status === 'string') {
            this._emit('status', msg.status as AgentStatus);
          }
          this._emit('message', msg);
        } catch {
          // malformed frame — ignore
        }
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  send(msg: AgentMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Send a raw PCM16 audio chunk to the voice pipeline (microphone data). */
  sendAudio(buffer: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    }
  }

  on<K extends keyof AgentEventMap>(event: K, cb: AgentEventMap[K]): this {
    if (!this.handlers[event]) this.handlers[event] = new Set() as never;
    (this.handlers[event] as Set<AgentEventMap[K]>).add(cb);
    return this;
  }

  off<K extends keyof AgentEventMap>(event: K, cb: AgentEventMap[K]): this {
    (this.handlers[event] as Set<AgentEventMap[K]> | undefined)?.delete(cb);
    return this;
  }

  getBalance() {
    return this.cloud?.getBalance() ?? Promise.reject(new Error('Not in managed mode'));
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _setStatus(s: AgentStatus) {
    this.status = s;
    this._emit('status', s);
  }

  private _emit<K extends keyof AgentEventMap>(event: K, ...args: Parameters<AgentEventMap[K]>): void {
    const handlers = this.handlers[event] as Set<(...a: unknown[]) => void> | undefined;
    handlers?.forEach((h) => h(...args));
  }

  private async _reportUsage(): Promise<void> {
    if (!this.cloud || !this.sessionToken || !this.sessionStart) return;
    const duration = Math.round((Date.now() - this.sessionStart) / 1000);
    try {
      await this.cloud.endSession(this.sessionToken, duration);
    } catch {
      // best-effort — don't throw on cleanup
    }
  }
}

// ── Prepatu namespace ─────────────────────────────────────────────────────────

export const Prepatu = {
  /**
   * Create and configure a voice agent in one call.
   *
   * Managed:     `Prepatu.createAgent({ apiKey: 'pk_live_...' })`
   * Self-hosted: `Prepatu.createAgent({ backendUrl: 'http://localhost:8000' })`
   *
   * In both cases the returned agent still needs `.connect()` called to open
   * the WebSocket. This lets you attach event listeners first.
   */
  async createAgent(options: PrepatuAgentOptions): Promise<PrepatuAgent> {
    if (isManagedOptions(options)) {
      const cloud   = new CloudClient(options.apiKey, options.cloudApiUrl);
      const session = await cloud.startSession(options.flowId, options.metadata);
      // ws_url already contains the session token in the path — connect directly
      return new PrepatuAgent(session.ws_url, session, cloud);
    }

    // Self-hosted path
    if (isLocalhost() && !('apiKey' in options)) {
      printSignupHint();
    }

    return new PrepatuAgent(options.backendUrl, null, null);
  },

  /** Direct access to the cloud API (for balance checks, key management, etc.) */
  cloud(apiKey: string, cloudApiUrl?: string): CloudClient {
    return new CloudClient(apiKey, cloudApiUrl);
  },
};
