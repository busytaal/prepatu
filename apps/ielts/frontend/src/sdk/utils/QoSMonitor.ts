import type { Transport, QoSSnapshot, QoSThresholds } from '../transports/Transport';

// ── Config ────────────────────────────────────────────────────────────────────

export interface QoSMonitorConfig {
  /** How often to send a ping (ms). Default 5000. */
  pingIntervalMs?: number;
  /** Rolling window size for RTT samples. Default 10. */
  rttWindowSize?: number;
  /** How often to evaluate audio delivery ratio (ms). Default 3000. */
  audioEvalIntervalMs?: number;
}

const DEFAULTS: Required<QoSMonitorConfig> = {
  pingIntervalMs:      5_000,
  rttWindowSize:       10,
  audioEvalIntervalMs: 3_000,
};

// ── QoSMonitor ────────────────────────────────────────────────────────────────

/**
 * Attaches to a Transport (typically WebSocketTransport) and continuously
 * measures quality metrics, emitting a QoSSnapshot on every update.
 *
 * Metrics measured:
 *   - RTT      : ping/pong round-trip time
 *   - avgRttMs : rolling average over last N samples
 *   - jitterMs : standard deviation of RTT window
 *   - responseLatencyMs : time from last sendAudio→silence to first inbound audio
 *   - audioDeliveryRatio: fraction of expected frames that actually arrived
 */
export class QoSMonitor {
  private cfg:          Required<QoSMonitorConfig>;
  private transport:    Transport;
  private snapshot:     QoSSnapshot;
  private rttWindow:    number[] = [];
  private pingTimer:    ReturnType<typeof setInterval> | null = null;
  private audioTimer:   ReturnType<typeof setInterval> | null = null;
  private pendingPings: Map<number, number> = new Map(); // ts → sendTime

  // Audio delivery tracking
  private audioFramesReceived:  number = 0;
  private audioFramesExpected:  number = 0;
  private audioFrameIntervalMs: number = 20; // assume 20 ms frames
  private lastAudioAt:          number | null = null;
  private windowStartMs:        number = Date.now();

  // Response latency tracking
  private lastSendAudioAt:      number | null = null;
  private awaitingResponse:     boolean = false;

  // Bound message handler (for cleanup)
  private _onMsg:    (msg: Record<string, unknown>) => void;
  private _onAudio:  (data: ArrayBuffer) => void;

  constructor(
    transport: Transport,
    public readonly onChange: (snapshot: QoSSnapshot) => void,
    config: QoSMonitorConfig = {},
  ) {
    this.transport = transport;
    this.cfg       = { ...DEFAULTS, ...config };
    this.snapshot  = this._blank();
    this._onMsg    = this._handleMessage.bind(this);
    this._onAudio  = this._handleAudio.bind(this);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    this.transport.on('onMessage', this._onMsg);
    this.transport.on('onAudio',   this._onAudio);

    this.pingTimer  = setInterval(() => this._sendPing(), this.cfg.pingIntervalMs);
    this.audioTimer = setInterval(() => this._evaluateAudio(), this.cfg.audioEvalIntervalMs);
    this._sendPing();
  }

  stop(): void {
    if (this.pingTimer)  clearInterval(this.pingTimer);
    if (this.audioTimer) clearInterval(this.audioTimer);
    this.pingTimer  = null;
    this.audioTimer = null;
    this.transport.off('onMessage', this._onMsg);
    this.transport.off('onAudio',   this._onAudio);
  }

  /** Current snapshot without waiting for the next update cycle. */
  current(): QoSSnapshot { return { ...this.snapshot }; }

  /**
   * Call this from the consumer every time it calls transport.sendAudio().
   * Enables response-latency measurement.
   */
  notifySendAudio(): void {
    this.lastSendAudioAt  = Date.now();
    this.awaitingResponse = true;
  }

  // ── Pure helpers (exported for use in TransportSwitcher) ──────────────────

  /** Returns true if any upgrade threshold is breached. */
  static shouldUpgrade(
    snap: QoSSnapshot,
    t: QoSThresholds,
    consecutiveBreach: number,
  ): boolean {
    const required = t.consecutiveBreachCount ?? 3;
    if (consecutiveBreach < required) return false;

    const rttBreached =
      snap.avgRttMs !== null &&
      t.rttUpgradeMs !== undefined &&
      snap.avgRttMs > t.rttUpgradeMs;

    const latencyBreached =
      snap.responseLatencyMs !== null &&
      t.responseLatencyUpgradeMs !== undefined &&
      snap.responseLatencyMs > t.responseLatencyUpgradeMs;

    const audioBreached =
      snap.audioDeliveryRatio !== null &&
      t.audioDeliveryUpgradeRatio !== undefined &&
      snap.audioDeliveryRatio < t.audioDeliveryUpgradeRatio;

    return rttBreached || latencyBreached || audioBreached;
  }

  /** Returns true if we should downgrade back to WebSocket. */
  static shouldDowngrade(
    snap: QoSSnapshot,
    t: QoSThresholds,
    consecutiveBreach: number,
  ): boolean {
    const required = t.consecutiveBreachCount ?? 3;
    if (consecutiveBreach < required) return false;

    return (
      snap.avgRttMs !== null &&
      t.rttDowngradeMs !== undefined &&
      snap.avgRttMs > t.rttDowngradeMs
    );
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _sendPing(): void {
    const ts = Date.now();
    this.pendingPings.set(ts, ts);
    this.transport.sendMessage({ type: 'ping', ts });
  }

  private _handleMessage(msg: Record<string, unknown>): void {
    if (msg.type === 'pong') {
      const ts   = msg.ts as number | undefined;
      const sent = ts !== undefined ? this.pendingPings.get(ts) : undefined;
      this.pendingPings.delete(ts ?? -1);

      if (sent !== undefined) {
        const rtt = Date.now() - sent;
        this._addRtt(rtt);
      }
    }
  }

  private _handleAudio(_data: ArrayBuffer): void {
    const now = Date.now();
    this.audioFramesReceived++;
    this.lastAudioAt = now;

    if (this.awaitingResponse && this.lastSendAudioAt !== null) {
      const latency = now - this.lastSendAudioAt;
      this.snapshot = { ...this.snapshot, responseLatencyMs: latency, measuredAt: now };
      this.awaitingResponse = false;
      this.onChange({ ...this.snapshot });
    }
  }

  private _addRtt(rtt: number): void {
    this.rttWindow.push(rtt);
    if (this.rttWindow.length > this.cfg.rttWindowSize) this.rttWindow.shift();

    const avg    = this._mean(this.rttWindow);
    const jitter = this._stddev(this.rttWindow, avg);

    this.snapshot = {
      ...this.snapshot,
      rttMs:     rtt,
      avgRttMs:  avg,
      jitterMs:  jitter,
      measuredAt: Date.now(),
    };
    this.onChange({ ...this.snapshot });
  }

  private _evaluateAudio(): void {
    const windowMs  = Date.now() - this.windowStartMs;
    const expected  = Math.max(1, Math.floor(windowMs / this.audioFrameIntervalMs));
    const ratio     = Math.min(1, this.audioFramesReceived / expected);

    // Only emit a ratio if we actually expected some frames (server was talking)
    if (expected > 5) {
      this.snapshot = {
        ...this.snapshot,
        audioDeliveryRatio: ratio,
        measuredAt: Date.now(),
      };
      this.onChange({ ...this.snapshot });
    }

    // Reset window
    this.audioFramesReceived  = 0;
    this.audioFramesExpected  = 0;
    this.windowStartMs        = Date.now();
  }

  private _mean(arr: number[]): number {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private _stddev(arr: number[], mean: number): number {
    if (arr.length < 2) return 0;
    const variance = arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  }

  private _blank(): QoSSnapshot {
    return {
      rttMs:              null,
      avgRttMs:           null,
      jitterMs:           null,
      responseLatencyMs:  null,
      audioDeliveryRatio: null,
      measuredAt:         Date.now(),
    };
  }
}

// ── Re-export helpers for convenience ─────────────────────────────────────────

export const { shouldUpgrade, shouldDowngrade } = QoSMonitor;
