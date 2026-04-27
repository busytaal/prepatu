import type {
  Transport,
  TransportCallbacks,
  TransportType,
  TransportStatus,
  SwitcherConfig,
  SwitchPhase,
  SwitchResult,
  QoSSnapshot,
  BotMessage,
} from './Transport';
import { QoSMonitor } from '../utils/QoSMonitor';

// ── TransportSwitcher ─────────────────────────────────────────────────────────
//
// Wraps a primary Transport, optionally pre-connecting a secondary Transport
// in the background and cutting over to it — silently, mid-conversation.
//
// The switcher exposes the same sendAudio / sendMessage / on / off surface as
// Transport so it can be dropped in as a transparent replacement.
//
// Switch lifecycle:
//   idle → preparing → ready → switching → done
//                                        ↘ failed   (primary continues)
//
// ─────────────────────────────────────────────────────────────────────────────

type EventMap = { [K in keyof TransportCallbacks]: Set<TransportCallbacks[K]> };

const DEFAULTS = {
  silenceGapMs:         300,
  upgradeTimeoutMs:    10_000,
  overlapMs:              100,
  keepWebSocketForData:  true,
} as const;

export class TransportSwitcher {
  private primary:   Transport;
  private secondary: Transport | null = null;
  private cfg:       Required<SwitcherConfig>;
  private phase:     SwitchPhase = 'idle';
  private qos:       QoSMonitor | null = null;
  private breachCount: number = 0;

  /** When the primary last received a binary audio frame (epoch ms). */
  private lastAudioAt: number | null = null;

  private events: EventMap = {
    onAudio:        new Set(),
    onTrack:        new Set(),
    onMessage:      new Set(),
    onStatusChange: new Set(),
    onError:        new Set(),
  };

  constructor(primary: Transport, config: SwitcherConfig) {
    this.primary = primary;
    this.cfg     = { ...DEFAULTS, ...config };
    this._bindPrimary(primary);
  }

  // ── Public — same surface as Transport ────────────────────────────────────

  get activeTransport(): Transport { return this.secondary?.status === 'connected' ? this.secondary : this.primary; }
  get currentPhase(): SwitchPhase  { return this.phase; }

  sendAudio(data: ArrayBuffer): void {
    this.lastAudioAt = Date.now();
    this.qos?.notifySendAudio();
    this.activeTransport.sendAudio(data);
  }

  sendMessage(msg: Record<string, unknown>): void {
    this.activeTransport.sendMessage(msg);
  }

  on<K extends keyof TransportCallbacks>(event: K, cb: TransportCallbacks[K]): void {
    (this.events[event] as Set<TransportCallbacks[K]>).add(cb);
  }

  off<K extends keyof TransportCallbacks>(event: K, cb: TransportCallbacks[K]): void {
    (this.events[event] as Set<TransportCallbacks[K]>).delete(cb);
  }

  // ── Public — switching API ─────────────────────────────────────────────────

  /**
   * Pre-connect a secondary transport in the background.
   * Does NOT switch yet — call upgrade() after this resolves.
   */
  async prepare(secondary: Transport): Promise<void> {
    if (this.phase !== 'idle') throw new Error(`Cannot prepare: phase is ${this.phase}`);
    this.phase     = 'preparing';
    this.secondary = secondary;

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('prepare timeout')), this.cfg.upgradeTimeoutMs),
    );

    try {
      await Promise.race([secondary.connect(), timeout]);
      this._bindSecondary(secondary);
      this.phase = 'ready';
    } catch (err) {
      secondary.disconnect();
      this.secondary = null;
      this.phase = 'idle';
      throw err;
    }
  }

  /**
   * Manually trigger the cut from primary → secondary.
   * Secondary must be prepared first (via prepare() or auto-detected as ready).
   */
  async upgrade(): Promise<SwitchResult> {
    return this._executeCut('manual');
  }

  /**
   * Shorthand: prepare + upgrade in one call.
   */
  async upgradeTo(secondary: Transport): Promise<SwitchResult> {
    await this.prepare(secondary);
    return this.upgrade();
  }

  /**
   * Attach a QoS monitor to the primary transport.
   * If 'qos' is in cfg.triggers, the switcher will auto-upgrade
   * when thresholds are breached and a secondary is ready.
   */
  enableQoS(monitorConfig?: { pingIntervalMs?: number; rttWindowSize?: number }): void {
    if (this.qos) return; // already running
    this.qos = new QoSMonitor(this.primary, this._onQoSSnapshot.bind(this), monitorConfig);
    this.qos.start();
  }

  disableQoS(): void {
    this.qos?.stop();
    this.qos = null;
    this.breachCount = 0;
  }

  destroy(): void {
    this.disableQoS();
    this.primary.disconnect();
    this.secondary?.disconnect();
  }

  // ── Private — event forwarding ─────────────────────────────────────────────

  private _bindPrimary(t: Transport): void {
    t.on('onAudio',        (data)   => { this.lastAudioAt = Date.now(); this.emit('onAudio', data); });
    t.on('onTrack',        (stream) => this.emit('onTrack', stream));
    t.on('onMessage',      (msg)    => this._handleMessage(t, msg));
    t.on('onStatusChange', (s)      => this.emit('onStatusChange', s));
    t.on('onError',        (err)    => this.emit('onError', err));
  }

  private _bindSecondary(t: Transport): void {
    // Secondary forwards audio/track only — we'll cut over on upgrade
    t.on('onError', (err) => {
      // Secondary failed before we switched → abort
      if (this.secondary === t && this.phase !== 'done') {
        this.secondary = null;
        this.phase = 'idle';
        this.emit('onError', new Error(`Secondary transport error: ${err.message}`));
      }
    });
  }

  private _handleMessage(from: Transport, msg: Record<string, unknown>): void {
    // "switch-now" signal from server
    if (
      msg.type === 'switch-now' &&
      this.cfg.triggers.includes('server-signal') &&
      this.phase === 'ready' &&
      from === this.primary
    ) {
      void this._executeCut('server-signal');
      return;
    }

    // Broadcast all other messages as BotMessage
    this.emit('onMessage', msg as BotMessage);
  }

  // ── Private — QoS auto-switch ──────────────────────────────────────────────

  private _onQoSSnapshot(snap: QoSSnapshot): void {
    this.emit('onMessage', { type: '_qos', ...snap } as unknown as BotMessage);

    if (!this.cfg.triggers.includes('qos') || !this.cfg.qosThresholds) return;

    const shouldUp = QoSMonitor.shouldUpgrade(snap, this.cfg.qosThresholds, this.breachCount);
    if (shouldUp) {
      this.breachCount++;
    } else {
      this.breachCount = 0;
    }

    if (shouldUp && this.phase === 'ready') {
      void this._executeCut('qos');
    }
  }

  // ── Private — the actual cut ───────────────────────────────────────────────

  private async _executeCut(trigger: string): Promise<SwitchResult> {
    if (this.phase !== 'ready' || !this.secondary) {
      return { success: false, from: this.primary.type, to: 'webrtc', gapMs: 0, reason: `Phase is ${this.phase}` };
    }

    // Wait for silence gap to avoid cutting mid-word
    const silenceMs = this.cfg.silenceGapMs;
    if (silenceMs > 0) {
      await this._waitForSilence(silenceMs);
    }

    const from:       TransportType = this.primary.type;
    const to:         TransportType = this.secondary.type;
    const cutStartMs: number        = Date.now();

    this.phase = 'switching';

    // Overlap window — both transports "active" simultaneously for a moment
    const secondary = this.secondary;
    secondary.on('onAudio',   (data)   => this.emit('onAudio', data));
    secondary.on('onTrack',   (stream) => this.emit('onTrack', stream));
    secondary.on('onMessage', (msg)    => this.emit('onMessage', msg as BotMessage));

    await this._sleep(this.cfg.overlapMs);

    // Cut — stop forwarding from primary
    const gapMs = Date.now() - cutStartMs;

    // Decide whether to keep primary alive for data channel
    const keepPrimary =
      this.cfg.keepWebSocketForData &&
      from === 'websocket' &&
      to === 'webrtc';

    if (!keepPrimary) {
      this.primary.disconnect();
    }

    this.primary   = secondary;
    this.secondary = null;
    this.phase     = 'done';
    this.breachCount = 0;

    // Restart QoS on the new primary if it was enabled
    if (this.qos) {
      this.qos.stop();
      this.qos = new QoSMonitor(this.primary, this._onQoSSnapshot.bind(this));
      this.qos.start();
    }

    return { success: true, from, to, gapMs, reason: trigger };
  }

  private async _waitForSilence(ms: number): Promise<void> {
    const deadline = Date.now() + 3_000; // max 3 s wait
    return new Promise((resolve) => {
      const check = () => {
        const silent =
          this.lastAudioAt === null ||
          Date.now() - this.lastAudioAt > ms;

        if (silent || Date.now() > deadline) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private emit<K extends keyof TransportCallbacks>(
    event: K,
    ...args: Parameters<TransportCallbacks[K]>
  ): void {
    for (const cb of this.events[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }
}
