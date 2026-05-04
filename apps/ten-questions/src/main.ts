import { Prepatu, PrepatuAgent } from '@prepatu/sdk';
import type { AgentMessage } from '@prepatu/sdk';
import './style.css';

// ── DOM ───────────────────────────────────────────────────────────────────────

const setupScreen  = document.getElementById('setup-screen')!;
const gameScreen   = document.getElementById('game-screen')!;
const setupError   = document.getElementById('setup-error')!;
const connectBtn   = document.getElementById('connect-btn') as HTMLButtonElement;

const orbRing      = document.getElementById('orb-ring')!;
const orbCore      = document.getElementById('orb-core')!;
const orbStatus    = document.getElementById('orb-status')!;
const gameCard     = document.getElementById('game-card')!;
const questionPips = document.getElementById('question-pips')!;
const scoreCount   = document.getElementById('score-count')!;
const transcriptFeed = document.getElementById('transcript-feed')!;
const debugFeed    = document.getElementById('debug-feed')!;

document.getElementById('debug-clear')?.addEventListener('click', () => { debugFeed.innerHTML = ''; });

// ── State ─────────────────────────────────────────────────────────────────────

let agent:       PrepatuAgent | null = null;
let audioCtxIn:  AudioContext | null = null;
let audioCtxOut: AudioContext | null = null;
let micStream:   MediaStream  | null = null;
let processor:   ScriptProcessorNode | null = null;
let nextPlayTime = 0;
let sampleRateOut = 16000;

// Track flow variables from the server
const vars: Record<string, string> = {};

// Init pips
buildPips();

// ── Connect ───────────────────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
  const apiKey   = (document.getElementById('api-key') as HTMLInputElement).value.trim();
  const flowId   = (document.getElementById('flow-id') as HTMLInputElement).value.trim();
  const cloudUrl = (document.getElementById('cloud-url') as HTMLInputElement).value.trim();

  setupError.hidden = true;

  if (!apiKey || !flowId) {
    showError('API Key and Flow ID are required.');
    return;
  }

  connectBtn.disabled    = true;
  connectBtn.textContent = 'Connecting…';

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    agent = await Prepatu.createAgent({
      apiKey,
      flowId,
      cloudApiUrl: cloudUrl || 'https://api.prepatu.com',
    });

    agent.on('status',  (s) => { dbg('status', s, 'info'); handleStatus(s); });
    agent.on('audio',   handleAudio);
    agent.on('message', (msg) => { dbg(String(msg.type ?? 'frame'), msg, 'in'); handleMessage(msg); });
    agent.on('error',   (err: Error) => { dbg('error', err.message, 'info'); showError(err.message); });

    await agent.connect();
    startMicCapture();

    setupScreen.hidden = true;
    gameScreen.hidden  = false;

  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : String(err));
    connectBtn.disabled    = false;
    connectBtn.textContent = 'Start Game →';
    micStream?.getTracks().forEach(t => t.stop());
    micStream = null;
  }
});

// ── Message handler ───────────────────────────────────────────────────────────

function handleMessage(msg: AgentMessage): void {
  switch (msg.type) {

    case 'config':
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
      const key = String(msg.key ?? '');
      const val = String(msg.value ?? '');
      if (key) {
        vars[key] = val;
        // Live-update the score card if questions_asked changes
        if (key === 'questions_asked') updatePips(Number(val));
      }
      break;
    }

    case 'error':
      addTranscript('system', `⚠ ${msg.message}`);
      break;
  }
}

// ── Artifact renderer ─────────────────────────────────────────────────────────

function handleArtifact(msg: AgentMessage): void {
  if (msg.artifact_type !== 'card') return;
  renderCard(String(msg.prompt ?? ''));
}

function renderCard(prompt: string): void {
  // Detect win/loss/done states from the card content for styling
  const lower = prompt.toLowerCase();
  const cls = lower.includes('you got it') || lower.includes('🎉') ? 'state-won'
    : lower.includes('out of questions') || lower.includes('😅') ? 'state-lost'
    : lower.includes('thanks for playing') ? 'state-done'
    : '';

  gameCard.className = `game-card ${cls}`;
  gameCard.innerHTML = `<div class="card-text">${esc(prompt)}</div>`;
}

// ── Pips (question counter) ───────────────────────────────────────────────────

function buildPips(): void {
  questionPips.innerHTML = Array.from({ length: 10 }, (_, i) =>
    `<div class="pip" id="pip-${i + 1}"></div>`
  ).join('');
}

function updatePips(used: number): void {
  scoreCount.textContent = `${used} / 10`;
  for (let i = 1; i <= 10; i++) {
    const pip = document.getElementById(`pip-${i}`)!;
    pip.className = 'pip' + (i <= used ? ' used' : '');
  }
}

// ── Orb ───────────────────────────────────────────────────────────────────────

const ORB_ICON  = { idle: '🎯', listening: '👂', speaking: '🗣', connecting: '⏳', connected: '🎯', disconnected: '🎯', error: '⚠' } as const;
const ORB_LABEL = { idle: 'Ready', listening: 'Listening…', speaking: 'Speaking…', connecting: 'Connecting…', connected: 'Connected', disconnected: 'Disconnected', error: 'Error' } as const;

function handleStatus(status: string): void {
  const s = status as keyof typeof ORB_ICON;
  orbRing.className  = `orb-ring ${s}`;
  orbCore.className  = `orb-core ${s}`;
  orbCore.textContent = ORB_ICON[s] ?? '🎯';
  orbStatus.className = `orb-status ${s}`;
  orbStatus.textContent = ORB_LABEL[s] ?? status;
}

// ── Transcript ────────────────────────────────────────────────────────────────

function addTranscript(role: string, text: string): void {
  document.querySelector('.transcript-placeholder')?.remove();
  const line = document.createElement('div');
  line.className = 'transcript-line';
  line.innerHTML =
    `<span class="transcript-role ${role}">${role === 'user' ? 'You' : 'AI'}</span>` +
    `<span class="transcript-text">${esc(text)}</span>`;
  transcriptFeed.appendChild(line);
  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

// ── Audio: mic → sendAudio ────────────────────────────────────────────────────

function startMicCapture(): void {
  if (!micStream || !agent) return;
  audioCtxIn = new AudioContext({ sampleRate: 16000 });
  const source = audioCtxIn.createMediaStreamSource(micStream);
  processor    = audioCtxIn.createScriptProcessor(512, 1, 1);

  processor.onaudioprocess = (e) => {
    const f32 = e.inputBuffer.getChannelData(0);
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    agent?.sendAudio(i16.buffer);
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

// ── Audio: agent → playback ───────────────────────────────────────────────────

function initPlayback(): void {
  if (audioCtxOut) return;
  audioCtxOut  = new AudioContext({ sampleRate: sampleRateOut });
  nextPlayTime = 0;
}

function handleAudio(buffer: ArrayBuffer): void {
  if (!audioCtxOut) initPlayback();
  const i16 = new Int16Array(buffer);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / (i16[i] < 0 ? 0x8000 : 0x7FFF);

  const buf = audioCtxOut!.createBuffer(1, f32.length, sampleRateOut);
  buf.copyToChannel(f32, 0);
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
  audioCtxOut  = null;
  nextPlayTime = 0;

  Object.keys(vars).forEach(k => delete vars[k]);
  updatePips(0);
  gameCard.className = 'game-card';
  gameCard.innerHTML = '<div class="loading-state"><div class="spinner"></div> Connecting…</div>';
  transcriptFeed.innerHTML = '<div class="transcript-placeholder">Conversation will appear here…</div>';

  gameScreen.hidden  = true;
  setupScreen.hidden = false;
  connectBtn.disabled    = false;
  connectBtn.textContent = 'Start Game →';
}

// ── Debug ─────────────────────────────────────────────────────────────────────

function dbg(label: string, data: unknown, kind: 'in' | 'out' | 'info' = 'in'): void {
  const row = document.createElement('div');
  row.className = `dbg-row dbg-${kind}`;
  const ts   = new Date().toISOString().slice(11, 23);
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
