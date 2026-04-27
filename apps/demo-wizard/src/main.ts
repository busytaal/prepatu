/**
 * Prepatu Demo — Appointment Booking Voice Wizard
 *
 * This is the real-SDK version of the demo. It uses @prepatu/sdk directly,
 * exactly as a developer would in their own app.
 *
 * Run:
 *   npm install && npm run dev
 *
 * Then open http://localhost:5173, enter your API key + flow ID, and talk.
 */

import { Prepatu, PrepatuAgent } from '@prepatu/sdk';
import type { AgentMessage } from '@prepatu/sdk';
import './style.css';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const setupScreen  = document.getElementById('setup-screen')!;
const wizardScreen = document.getElementById('wizard-screen')!;
const setupError   = document.getElementById('setup-error')!;
const connectBtn   = document.getElementById('connect-btn') as HTMLButtonElement;

const orbRing   = document.getElementById('orb-ring')!;
const orbCore   = document.getElementById('orb-core')!;
const orbStatus = document.getElementById('orb-status')!;
const transcriptFeed = document.getElementById('transcript-feed')!;
const contentArea    = document.getElementById('content-area')!;
const debugFeed      = document.getElementById('debug-feed')!;
document.getElementById('debug-clear')?.addEventListener('click', () => { debugFeed.innerHTML = ''; });

// Step indicator elements
const bubbles = [1, 2, 3].map(n => document.getElementById(`bubble-${n}`)!);
const labels  = [1, 2, 3].map(n => document.getElementById(`label-${n}`)!);
const lines   = [1, 2].map(n => document.getElementById(`line-${n}`)!);

// ── State ─────────────────────────────────────────────────────────────────────

let agent:        PrepatuAgent | null = null;
let audioCtxIn:   AudioContext | null = null;
let audioCtxOut:  AudioContext | null = null;
let micStream:    MediaStream  | null = null;
let processor:    ScriptProcessorNode | null = null;
let nextPlayTime  = 0;
let sampleRateOut = 16000;
let artifactCount = 0;

// Cache of field values captured so far in this session.
// Survives form transitions so pre-existing captures are visible immediately
// when the same field appears again, and so the browser can paint them
// before the form switches to the next step.
const capturedValues: Record<string, string> = {};

// ── Connect ───────────────────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
  const apiKey    = (document.getElementById('api-key') as HTMLInputElement).value.trim();
  const flowId    = (document.getElementById('flow-id') as HTMLInputElement).value.trim();
  const cloudUrl  = (document.getElementById('cloud-url') as HTMLInputElement).value.trim();

  setupError.hidden = true;

  if (!apiKey || !flowId) {
    showError('API Key and Flow ID are both required.');
    return;
  }

  connectBtn.disabled    = true;
  connectBtn.textContent = 'Connecting…';

  try {
    // ── 1. Request mic before anything else so the permission prompt is
    //       clearly in context of the user's action. ──────────────────────
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    // ── 2. Create the agent — this POSTs /v1/sessions and gets ws_url ─────
    //
    //   That's all you need. The SDK handles:
    //     • Session token exchange
    //     • Correct WebSocket URL construction
    //     • Binary/JSON frame demuxing
    //     • status event mirroring
    //
    agent = await Prepatu.createAgent({
      apiKey,
      flowId,
      cloudApiUrl: cloudUrl || 'http://localhost:4000',
    });

    // ── 3. Wire up events before connecting ───────────────────────────────
    agent.on('status', (s) => { dbg('status', s, 'info'); handleStatus(s); });
    agent.on('audio',  handleAudio);
    agent.on('message', (msg) => { dbg(String(msg.type ?? 'frame'), msg, 'in'); handleMessage(msg); });
    agent.on('error',  (err: Error) => { dbg('error', err.message, 'info'); showError(err.message); });

    // ── 4. Open the WebSocket ─────────────────────────────────────────────
    await agent.connect();

    // ── 5. Start streaming mic audio ──────────────────────────────────────
    startMicCapture();

    // Show wizard
    setupScreen.hidden  = true;
    wizardScreen.hidden = false;

  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : String(err));
    connectBtn.disabled    = false;
    connectBtn.textContent = 'Connect & Start →';
    micStream?.getTracks().forEach(t => t.stop());
    micStream = null;
  }
});

// ── Message handler ───────────────────────────────────────────────────────────

function handleMessage(msg: AgentMessage): void {
  switch (msg.type) {

    case 'config':
      // Server tells us the audio sample rate — init playback context to match
      sampleRateOut = (msg.audio_sample_rate as number) || 16000;
      initPlayback();
      break;

    case 'transcript':
      if (msg.is_final) addTranscript(msg.role as string, msg.text as string);
      break;

    case 'artifact':
      handleArtifact(msg);
      break;

    case 'flow_variable': {
      // Fallback fill: fired by _set_variable at the same time as field_update.
      // Covers the case where field_update is dropped or the form isn't rendered yet.
      const fid  = String(msg.key ?? '');
      const fval = String(msg.value ?? '');
      if (fid) {
        capturedValues[fid] = fval;
        fillField(fid, fval);
      }
      break;
    }

    case 'error':
      addTranscript('system', `⚠ ${msg.message}`);
      break;
  }
}

// ── Artifacts — the wizard's rendering engine ─────────────────────────────────
//
// The server sends `artifact` messages when the flow transitions state.
// artifact_type tells us what to render:
//   "form"         → a form with labeled inputs for the current step
//   "card"         → a read-only summary or confirmation card
//   "field_update" → voice just filled one specific field
//
function handleArtifact(msg: AgentMessage): void {
  switch (msg.artifact_type) {

    case 'form':
      artifactCount++;
      updateStepIndicator(artifactCount);
      // Defer the DOM replacement to the next animation frame so the browser
      // can paint any field fills that arrived in the same message batch.
      requestAnimationFrame(() => renderForm(msg));
      break;

    case 'card':
      artifactCount++;
      renderCard(msg, artifactCount >= 4);
      updateStepIndicator(3);
      if (artifactCount >= 4) [1, 2, 3].forEach(markStepDone);
      break;

    case 'field_update': {
      // flow_engine auto-emit uses "value"; LLM send_artifact tool uses "field_value"
      const fid  = String(msg.field_id ?? '');
      const fval = String((msg.value ?? msg.field_value) ?? '');
      if (fid) capturedValues[fid] = fval;   // persist across form transitions
      fillField(fid, fval);
      break;
    }
  }
}

function renderForm(msg: AgentMessage): void {
  const fields = (msg.fields as Array<Record<string, string>> || [])
    .map(f => `
      <div class="form-field">
        <label for="field-${esc(f.id)}">${esc(f.label)}</label>
        <input id="field-${esc(f.id)}" type="${esc(f.type || 'text')}"
               placeholder="${esc(f.placeholder || '')}" autocomplete="off">
      </div>`)
    .join('');

  contentArea.innerHTML = `
    <p class="content-prompt">${esc(String(msg.prompt || ''))}</p>
    ${fields}
    <p class="field-hint">💡 Just speak — fields fill automatically from your voice.</p>
  `;

  // Pre-fill any fields the voice has already captured (handles the common case
  // where field_update and the form transition arrive in the same TCP batch).
  for (const [id, val] of Object.entries(capturedValues)) {
    const el = document.getElementById(`field-${id}`) as HTMLInputElement | null;
    if (el && !el.value) el.value = val;
  }
}

function renderCard(msg: AgentMessage, isDone: boolean): void {
  const text = String(msg.prompt || '').trim();
  const buttons = isDone ? '' : `
    <div class="confirm-row">
      <button class="btn-confirm" id="btn-confirm">✓ Confirm Booking</button>
      <button class="btn-restart" id="btn-restart">Start Over</button>
    </div>
    <p class="field-hint">Or just say "confirm" / "start over".</p>`;

  contentArea.innerHTML = `
    <div class="card-content${isDone ? ' done-card' : ''}">${esc(text)}</div>
    ${buttons}
  `;

  document.getElementById('btn-confirm')?.addEventListener('click', () =>
    agent?.send({ type: 'ui_event', action: 'confirm' })
  );
  document.getElementById('btn-restart')?.addEventListener('click', () =>
    agent?.send({ type: 'ui_event', action: 'restart' })
  );
}

function fillField(fieldId: string, value: string): void {
  const el = document.getElementById(`field-${fieldId}`) as HTMLInputElement | null;
  if (!el) return;
  el.value = value ?? '';
  el.classList.remove('voice-filled');
  void el.offsetWidth;
  el.classList.add('voice-filled');
  setTimeout(() => el.classList.remove('voice-filled'), 2000);
}

// ── Step indicator ────────────────────────────────────────────────────────────

function updateStepIndicator(active: number): void {
  bubbles.forEach((b, i) => {
    const s = i + 1;
    b.className = 'step-bubble';
    labels[i].className = 'step-label';
    if (s < active)      { markStepDone(s); }
    else if (s === active) { b.classList.add('active'); labels[i].classList.add('active'); }
    if (lines[i]) lines[i].className = s < active ? 'step-line done' : 'step-line';
  });
}

function markStepDone(s: number): void {
  const b = bubbles[s - 1];
  if (b) { b.className = 'step-bubble done'; b.textContent = '✓'; }
  const l = labels[s - 1];
  if (l) { l.className = 'step-label done'; }
}

// ── Voice orb ─────────────────────────────────────────────────────────────────

const ORB_EMOJI  = { idle: '🎙', listening: '👂', speaking: '🗣', connecting: '⏳', connected: '🎙', disconnected: '🎙', error: '⚠' } as const;
const ORB_LABEL  = { idle: 'Idle', listening: 'Listening…', speaking: 'Speaking…', connecting: 'Connecting…', connected: 'Connected', disconnected: 'Disconnected', error: 'Error' } as const;

function handleStatus(status: string): void {
  const s = status as keyof typeof ORB_EMOJI;
  orbRing.className  = `orb-ring ${s}`;
  orbCore.className  = `orb-core ${s}`;
  orbCore.textContent = ORB_EMOJI[s] ?? '🎙';
  orbStatus.className = `orb-status ${s}`;
  orbStatus.textContent = ORB_LABEL[s] ?? status;
}

// ── Transcript ────────────────────────────────────────────────────────────────

function addTranscript(role: string, text: string): void {
  const placeholder = transcriptFeed.querySelector('.transcript-placeholder');
  placeholder?.remove();

  const line = document.createElement('div');
  line.className = 'transcript-line';
  line.innerHTML = `
    <span class="transcript-role ${role}">${role === 'user' ? 'You' : 'AI'}</span>
    <span class="transcript-text">${esc(text)}</span>`;
  transcriptFeed.appendChild(line);
  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

// ── Audio: mic capture → agent.sendAudio() ────────────────────────────────────
//
// Float32 samples from the AudioContext → Int16 PCM → agent.sendAudio()
// The SDK's sendAudio() sends the raw ArrayBuffer over the WebSocket.
//
function startMicCapture(): void {
  if (!micStream || !agent) return;
  audioCtxIn = new AudioContext({ sampleRate: 16000 });
  const source  = audioCtxIn.createMediaStreamSource(micStream);
  processor     = audioCtxIn.createScriptProcessor(512, 1, 1);

  processor.onaudioprocess = (e) => {
    const float32 = e.inputBuffer.getChannelData(0);
    const int16   = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    agent?.sendAudio(int16.buffer);
  };

  const silent = audioCtxIn.createGain();
  silent.gain.value = 0;
  source.connect(processor);
  processor.connect(silent);
  silent.connect(audioCtxIn.destination);
}

function stopMicCapture(): void {
  processor?.disconnect();
  audioCtxIn?.close();
  micStream?.getTracks().forEach(t => t.stop());
  processor = null; audioCtxIn = null; micStream = null;
}

// ── Audio: agent audio event → playback ───────────────────────────────────────
//
// agent.on('audio', handleAudio) fires for every PCM16 binary frame from TTS.
// We decode Int16 → Float32 and schedule each chunk gaplessly.
//
function initPlayback(): void {
  if (audioCtxOut) return;
  audioCtxOut = new AudioContext({ sampleRate: sampleRateOut });
  nextPlayTime = 0;
}

function handleAudio(buffer: ArrayBuffer): void {
  if (!audioCtxOut) initPlayback();

  const int16   = new Int16Array(buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
  }

  const buf = audioCtxOut!.createBuffer(1, float32.length, sampleRateOut);
  buf.copyToChannel(float32, 0);

  const src = audioCtxOut!.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtxOut!.destination);

  const when = Math.max(audioCtxOut!.currentTime, nextPlayTime);
  src.start(when);
  nextPlayTime = when + buf.duration;
}

// ── Disconnect ────────────────────────────────────────────────────────────────

document.getElementById('btn-disconnect')?.addEventListener('click', disconnect);

function disconnect(): void {
  agent?.disconnect();
  agent = null;
  stopMicCapture();
  audioCtxOut?.close().catch(() => {});
  audioCtxOut = null;

  wizardScreen.hidden = true;
  setupScreen.hidden  = false;
  connectBtn.disabled    = false;
  connectBtn.textContent = 'Connect & Start →';

  artifactCount = 0;
  nextPlayTime  = 0;
  Object.keys(capturedValues).forEach(k => delete capturedValues[k]);
  updateStepIndicator(1);
  contentArea.innerHTML = '<div class="loading-state"><div class="spinner"></div> Connecting to voice agent…</div>';
  transcriptFeed.innerHTML = '<div class="transcript-placeholder">Conversation will appear here…</div>';
}

// ── Debug panel ──────────────────────────────────────────────────────────────

function dbg(label: string, data: unknown, kind: 'in' | 'out' | 'info' = 'in'): void {
  const row = document.createElement('div');
  row.className = `dbg-row dbg-${kind}`;
  const ts = new Date().toISOString().slice(11, 23);
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  row.innerHTML =
    `<span class="dbg-ts">${ts}</span>` +
    `<span class="dbg-label">${esc(label)}</span>` +
    `<pre class="dbg-body">${esc(body)}</pre>`;
  debugFeed.appendChild(row);
  debugFeed.scrollTop = debugFeed.scrollHeight;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function showError(msg: string): void {
  setupError.textContent = msg;
  setupError.hidden = false;
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
