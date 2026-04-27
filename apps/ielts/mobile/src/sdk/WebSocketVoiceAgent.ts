/**
 * WebSocketVoiceAgent — WebSocket-based voice session for React Native.
 *
 * Uses the same wire protocol as the web SDK (binary PCM16 for audio,
 * JSON text frames for control messages).
 *
 * Audio capture: expo-av Audio.Recording with PCM16 linear encoding.
 * Audio playback: expo-audio AudioPlayer — reuses a single native MediaPlayer
 *   instance via replace(), eliminating the inter-chunk gap that caused choppiness
 *   when using expo-av Audio.Sound (which created a new MediaPlayer per chunk).
 *
 * NOTE — Android recording:
 *   Android's MediaRecorder cannot produce raw PCM16LE; it always writes a
 *   container format (MP4/AAC by default). The poll-and-delta approach therefore
 *   sends container bytes to the backend on Android, which Deepgram cannot decode
 *   as PCM. iOS works correctly because linearPCMBitDepth forces a real WAV file.
 *   A proper Android fix requires react-native-audio-record or a backend-side
 *   Deepgram encoding override (encoding='aac', container='mp4' params on the
 *   DeepgramSTTService).
 */

import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import type { AudioPlayer, AudioStatus } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

import type { BackendConfig, BotMessage, VoiceAgentStatus } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WebSocketVoiceAgentConfig {
  /** Explicit wss:// / ws:// URL.  If omitted, derived from backendConfig. */
  url?: string;
  /** wsPath appended to backendConfig.baseUrl (default: "/ws"). */
  wsPath?: string;
  backend: BackendConfig;
  metadata?: Record<string, string>;
  onLog?: (msg: string) => void;
  onConnectionStateChange?: (state: VoiceAgentStatus) => void;
  onMessage?: (msg: BotMessage) => void;
  onError?: (err: Error) => void;
}

// ── WAV header helper ───────────────────────────────────────────────────────

/**
 * Prepend a minimal 44-byte WAV header to a raw PCM16 LE mono buffer so
 * expo-av can decode it.  expo-av cannot play headerless PCM directly.
 */
function pcm16ToWav(pcm: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const numSamples = pcm.byteLength / 2; // 16-bit → 2 bytes per sample
  const wavBuf = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(wavBuf);

  const set = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };

  set(0,  "RIFF");
  view.setUint32(4,  36 + pcm.byteLength, true);      // ChunkSize
  set(8,  "WAVE");
  set(12, "fmt ");
  view.setUint32(16, 16, true);                        // Subchunk1Size (PCM)
  view.setUint16(20, 1,  true);                        // AudioFormat = PCM
  view.setUint16(22, 1,  true);                        // NumChannels = 1
  view.setUint32(24, sampleRate, true);                // SampleRate
  view.setUint32(28, sampleRate * 2, true);            // ByteRate
  view.setUint16(32, 2,  true);                        // BlockAlign
  view.setUint16(34, 16, true);                        // BitsPerSample = 16
  set(36, "data");
  view.setUint32(40, pcm.byteLength, true);            // Subchunk2Size

  new Uint8Array(wavBuf).set(new Uint8Array(pcm), 44);
  return wavBuf;
}

/**
 * Convert an ArrayBuffer to a base64 string (RN's btoa works on strings,
 * not buffers — we convert via a Uint8Array byte loop).
 */
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ── Class ───────────────────────────────────────────────────────────────────

export class WebSocketVoiceAgent {
  private cfg: Required<WebSocketVoiceAgentConfig>;
  private ws: WebSocket | null = null;
  private recording: Audio.Recording | null = null;
  private status: VoiceAgentStatus = "idle";
  private serverSampleRate = 16_000;
  private playQueue: ArrayBuffer[] = [];
  private playing = false;
  private chunkIndex = 0;
  // Single reusable player — replace() swaps the source without rebuilding
  // the native MediaPlayer, eliminating the inter-chunk gap.
  private _player: AudioPlayer | null = null;

  constructor(config: WebSocketVoiceAgentConfig) {
    this.cfg = {
      url:      config.url ?? "",
      wsPath:   config.wsPath ?? "/ws",
      backend:  config.backend,
      metadata: config.metadata ?? {},
      onLog:                   config.onLog                   ?? ((m) => console.log("[WS]", m)),
      onConnectionStateChange: config.onConnectionStateChange ?? (() => {}),
      onMessage:               config.onMessage               ?? (() => {}),
      onError:                 config.onError                 ?? (() => {}),
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.log("Starting WebSocket session");
    this.updateStatus("connecting");
    await this._configureAudioSession();
    this._openWebSocket();
  }

  stop(): void {
    this.log("Stopping");
    this._stopRecording();
    this.ws?.close();
    this.ws = null;
    this.playQueue = [];
    this.playing = false;
    if (this._player) {
      this._player.remove();
      this._player = null;
    }
    this.updateStatus("idle");
  }

  sendUIEvent(action: string, data?: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "ui_event", action, data }));
    } else {
      this.log("Cannot send UI event: control WebSocket is not open");
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  private _buildUrl(): string {
    if (this.cfg.url) return this._appendMetadata(this.cfg.url);
    const base = this.cfg.backend.baseUrl.replace(/^http/, "ws");
    return this._appendMetadata(`${base}${this.cfg.wsPath}`);
  }

  private _appendMetadata(url: string): string {
    const entries = Object.entries(this.cfg.metadata).filter(
      ([, value]) => value !== undefined && value !== null && String(value).length > 0
    );
    if (!entries.length) return url;

    const [base, existing] = url.split("?", 2);
    const params = new URLSearchParams(existing ?? "");
    for (const [key, value] of entries) {
      params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private _openWebSocket(): void {
    const url = this._buildUrl();
    this.log(`Connecting: ${url}`);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.log("WebSocket open");
      this.updateStatus("connected");
      this._startRecording();
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // PCM16 audio from TTS pipeline
        this._enqueueAudio(event.data);
      } else if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;
          this._handleJson(msg);
        } catch {
          this.log(`Non-JSON frame: ${event.data}`);
        }
      }
    };

    ws.onerror = (e) => {
      const details = (() => {
        try {
          return JSON.stringify(e);
        } catch {
          return String(e);
        }
      })();
      const err = new Error(`WebSocket error (url=${url}, readyState=${ws.readyState})`);
      this.log(`WebSocket error: ${details} (url=${url}, readyState=${ws.readyState})`);
      this.cfg.onError(err);
      this.updateStatus("failed");
    };

    ws.onclose = (event) => {
      this.log(
        `WebSocket closed: code=${event.code} reason=${event.reason || ""} wasClean=${event.wasClean}`
      );
      this._stopRecording();
      if (this.status !== "idle") this.updateStatus("failed");
    };
  }

  private _handleJson(msg: Record<string, unknown>): void {
    if (msg["type"] === "config") {
      if (typeof msg["audio_sample_rate"] === "number") {
        this.serverSampleRate = msg["audio_sample_rate"] as number;
        this.log(`Sample rate: ${this.serverSampleRate} Hz`);
      }
      return; // config is internal — don't surface to onMessage
    }
    // ping → pong
    if (msg["type"] === "ping") {
      this.ws?.send(JSON.stringify({ type: "pong", ts: msg["ts"], server_ts: Date.now() }));
      return;
    }
    this.cfg.onMessage(msg as BotMessage);
  }

  // ── Audio capture (expo-av Recording) ─────────────────────────────────────

  private async _configureAudioSession(): Promise<void> {
    // expo-audio's setAudioModeAsync uses the unified API (SDK 54+).
    await setAudioModeAsync({
      allowsRecording:           true,   // iOS: enables mic whilst playing
      playsInSilentMode:         true,   // iOS: play through silent switch
      interruptionMode:          "doNotMix",
      shouldRouteThroughEarpiece: false, // Android: use speaker not earpiece
    });
    this.log("Audio session configured");
  }

  private async _startRecording(): Promise<void> {
    try {
      const { status: permStatus } = await Audio.requestPermissionsAsync();
      if (permStatus !== "granted") {
        throw new Error("Microphone permission denied");
      }

      // LINEAR16 PCM — 16 kHz, mono.
      // expo-av supports this via a custom RecordingOptions object.
      const recordingOptions: Audio.RecordingOptions = {
        android: {
          extension:          ".wav",
          outputFormat:       Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder:       Audio.AndroidAudioEncoder.DEFAULT,
          sampleRate:         16_000,
          numberOfChannels:   1,
          bitRate:            256_000,
        },
        ios: {
          extension:          ".wav",
          audioQuality:       Audio.IOSAudioQuality.HIGH,
          sampleRate:         16_000,
          numberOfChannels:   1,
          bitRate:            256_000,
          linearPCMBitDepth:  16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat:   false,
        },
        web: {
          mimeType: "audio/wav",
          bitsPerSecond: 256_000,
        },
      };

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(recordingOptions);

      // Stream chunks every 100 ms via onRecordingStatusUpdate
      rec.setOnRecordingStatusUpdate((s) => {
        if (!s.isRecording) return;
        // expo-av doesn't stream raw PCM — we poll the partial file every N ms
        // and send the delta bytes.  See _pollAndSendDelta below.
      });

      await rec.startAsync();
      this.recording = rec;
      this.log("Recording started");

      // Poll for incremental PCM data every 100 ms
      this._pollLoop();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.cfg.onError(e);
      this.log(`Recording failed: ${e.message}`);
    }
  }

  /** Repeatedly read the recording file URI and send new bytes to server. */
  private _lastFileSize = 0;
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;

  private _pollLoop(): void {
    if (!this.recording || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this._pollTimer = setTimeout(async () => {
      await this._pollAndSendDelta();
      this._pollLoop();
    }, 100);
  }

  private async _pollAndSendDelta(): Promise<void> {
    if (!this.recording || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      const uri = this.recording.getURI();
      if (!uri) return;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.size === undefined) return;

      const newBytes = info.size - this._lastFileSize;
      if (newBytes <= 0) return;

      // Read only the delta (new bytes appended since last poll).
      // FileSystem.readAsStringAsync supports position + length.
      const HEADER_BYTES = 44; // WAV header — skip on the very first read
      const skipHeader = this._lastFileSize === 0 ? HEADER_BYTES : 0;
      const position = this._lastFileSize + skipHeader;
      const length   = newBytes - skipHeader;
      if (length <= 0) { this._lastFileSize = info.size; return; }

      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        position,
        length,
      });

      // Decode base64 → ArrayBuffer and send as binary frame
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      this.ws.send(raw);
      this._lastFileSize = info.size;
    } catch {
      // transient — ignore
    }
  }

  private async _stopRecording(): Promise<void> {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
    this._lastFileSize = 0;

    if (!this.recording) return;
    try {
      await this.recording.stopAndUnloadAsync();
    } catch {
      // already stopped
    }
    this.recording = null;
    this.log("Recording stopped");
  }

  // ── Audio playback (expo-av Sound) ─────────────────────────────────────────

  private _enqueueAudio(pcm: ArrayBuffer): void {
    this.playQueue.push(pcm);
    if (!this.playing) this._drainQueue();
  }

  private async _drainQueue(): Promise<void> {
    if (this.playQueue.length === 0) { this.playing = false; return; }
    this.playing = true;
    // Drain *all* currently queued chunks into one concatenated PCM buffer so
    // they are played as a single WAV file — eliminates the inter-chunk gaps
    // that cause choppy audio when many small frames arrive at once.
    const chunks = this.playQueue.splice(0);
    const totalBytes = chunks.reduce((n, c) => n + c.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    await this._playChunk(combined.buffer);
    this._drainQueue();
  }

  private async _playChunk(pcm: ArrayBuffer): Promise<void> {
    try {
      const wav    = pcm16ToWav(pcm, this.serverSampleRate);
      const b64    = bufferToBase64(wav);
      // Unique filename per batch — never overwrites an active file.
      const tmpUri = `${FileSystem.cacheDirectory}pvp_chunk_${this.chunkIndex++}.wav`;

      await FileSystem.writeAsStringAsync(tmpUri, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await new Promise<void>((resolve) => {
        const cleanup = () => {
          FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
          resolve();
        };

        if (!this._player) {
          // First call: create the persistent player. Wait for isLoaded before
          // calling play() so we don't start on an unready player.
          this._player = createAudioPlayer({ uri: tmpUri });
          const loadSub = this._player.addListener("playbackStatusUpdate", (s: AudioStatus) => {
            if (!s.isLoaded) return;
            loadSub.remove();
            const finSub = this._player!.addListener("playbackStatusUpdate", (s2: AudioStatus) => {
              if (s2.didJustFinish) { finSub.remove(); cleanup(); }
            });
            this._player!.play();
          });
        } else {
          // Subsequent calls: replace() swaps the source on the existing native
          // MediaPlayer — no reconstruction overhead, no gap between chunks.
          const finSub = this._player.addListener("playbackStatusUpdate", (s: AudioStatus) => {
            if (s.didJustFinish) { finSub.remove(); cleanup(); }
          });
          this._player.replace({ uri: tmpUri });
          this._player.play();
        }
      });
    } catch (err) {
      this.log(`Playback error: ${String(err)}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private updateStatus(s: VoiceAgentStatus): void {
    this.status = s;
    this.cfg.onConnectionStateChange(s);
  }

  private log(msg: string): void {
    this.cfg.onLog(msg);
  }
}
