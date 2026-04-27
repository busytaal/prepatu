import type {
  Transport,
  TransportCallbacks,
  TransportStatus,
  TransportType,
} from './Transport';

export interface WebSocketTransportConfig {
  /** Full WebSocket URL, e.g. ws://192.168.1.x:8000/ws?interview_type=idle */
  url:        string;
  protocols?: string[];
  timeoutMs?: number;
}

type EventMap = { [K in keyof TransportCallbacks]: Set<TransportCallbacks[K]> };

export class WebSocketTransport implements Transport {
  readonly type: TransportType = 'websocket';

  private _status: TransportStatus = 'idle';
  private ws:       WebSocket | null = null;
  private config:   Required<WebSocketTransportConfig>;
  private events:   EventMap = {
    onAudio:        new Set(),
    onTrack:        new Set(),
    onMessage:      new Set(),
    onStatusChange: new Set(),
    onError:        new Set(),
  };

  constructor(config: WebSocketTransportConfig) {
    this.config = {
      protocols: [],
      timeoutMs: 10_000,
      ...config,
    };
  }

  get status(): TransportStatus { return this._status; }

  // ── Transport interface ──────────────────────────────────────────────────

  connect(): Promise<void> {
    if (this._status === 'connected' || this._status === 'connecting') {
      return Promise.resolve();
    }
    this.setStatus('connecting');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.close();
        this.setStatus('failed');
        reject(new Error('WebSocket connection timeout'));
      }, this.config.timeoutMs);

      const ws = new WebSocket(this.config.url, this.config.protocols);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        clearTimeout(timeout);
        this.setStatus('connected');
        resolve();
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.emit('onAudio', event.data);
        } else if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data) as Record<string, unknown>;
            this.emit('onMessage', msg);
          } catch {
            // non-JSON — ignore
          }
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        const err = new Error('WebSocket error');
        this.emit('onError', err);
        this.setStatus('failed');
        reject(err);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        if (this._status !== 'failed') this.setStatus('closed');
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }

  sendAudio(data: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  sendMessage(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  on<K extends keyof TransportCallbacks>(event: K, cb: TransportCallbacks[K]): void {
    (this.events[event] as Set<TransportCallbacks[K]>).add(cb);
  }

  off<K extends keyof TransportCallbacks>(event: K, cb: TransportCallbacks[K]): void {
    (this.events[event] as Set<TransportCallbacks[K]>).delete(cb);
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
