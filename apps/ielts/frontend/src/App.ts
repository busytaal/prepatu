import { VoiceAgent }             from './sdk/VoiceAgent';
import { WebSocketTransport }      from './sdk/transports/WebSocketTransport';
import { WebRTCTransport }         from './sdk/transports/WebRTCTransport';
import { TransportSwitcher }       from './sdk/transports/TransportSwitcher';
import { QoSMonitor }              from './sdk/utils/QoSMonitor';
import { QoSCharts }               from './sdk/utils/QoSCharts';
import type { Transport, QoSSnapshot, SwitchPhase } from './sdk/transports/Transport';
import type { WebSocketTransportConfig } from './sdk/transports/WebSocketTransport';
import type { WebRTCTransportConfig }    from './sdk/transports/WebRTCTransport';

// ── Tiny DOM helpers ──────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string>> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined) e.setAttribute(k, v); });
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(label: string, cls = ''): HTMLButtonElement {
  const b = el('button', { class: `dbg-btn ${cls}`.trim() });
  b.textContent = label;
  return b;
}

function input(placeholder: string, value = ''): HTMLInputElement {
  const i = el('input', { class: 'dbg-input', placeholder });
  i.value = value;
  return i;
}

function badge(text: string, cls: string): HTMLSpanElement {
  const s = el('span', { class: `badge badge-${cls}` });
  s.textContent = text;
  return s;
}

// ── Main app ──────────────────────────────────────────────────────────────────

export function createApp() {
  // ── State ─────────────────────────────────────────────────────────────────
  let primaryTransport: Transport | null = null;
  let secondaryTransport: Transport | null = null;
  let switcher: TransportSwitcher | null = null;
  let standaloneQoS: QoSMonitor | null = null;
  let agent: VoiceAgent | null = null;
  let charts: QoSCharts | null = null;

  // ── Root ──────────────────────────────────────────────────────────────────
  const root = el('div', { class: 'dbg-root' });

  // Header
  const header = el('div', { class: 'dbg-header' });
  const headerTitle = el('h1', { class: 'dbg-title' }, 'Prepatu SDK Debug');
  const headerStatus = el('div', { class: 'dbg-header-status' });
  const primaryBadge    = badge('primary: idle',   'idle');
  const sessionBadge    = badge('session: none',   'idle');
  const switcherBadge   = badge('switcher: —',     'idle');
  headerStatus.append(primaryBadge, sessionBadge, switcherBadge);
  header.append(headerTitle, headerStatus);

  // Two-column body
  const body = el('div', { class: 'dbg-body' });
  const leftCol  = el('div', { class: 'dbg-col dbg-col-left' });
  const rightCol = el('div', { class: 'dbg-col dbg-col-right' });
  body.append(leftCol, rightCol);
  root.append(header, body);

  // ── Left column ── Config + Actions ───────────────────────────────────────

  // — Transport mode —
  const modeSection = el('section', { class: 'dbg-section' });
  modeSection.append(el('h2', { class: 'dbg-section-title' }, 'Transport Mode'));

  const modeSelect = el('select', { class: 'dbg-input' });
  [
    ['webrtc',   'WebRTC only'],
    ['ws',       'WebSocket only'],
    ['switcher', 'WS → WebRTC (Switcher)'],
  ].forEach(([v, t]) => {
    const o = el('option', { value: v }, t);
    modeSelect.appendChild(o);
  });
  modeSection.append(el('label', { class: 'dbg-label' }, 'Mode'), modeSelect);
  leftCol.appendChild(modeSection);

  // — Connection config —
  const cfgSection = el('section', { class: 'dbg-section' });
  cfgSection.append(el('h2', { class: 'dbg-section-title' }, 'Connection Config'));

  const baseUrlIn  = input('Base URL (HTTP)', 'http://localhost:8000');
  const wsUrlIn    = input('WebSocket URL', 'ws://localhost:8000/ws');
  const metaIn     = input('Metadata JSON', '{"interview_type":"idle"}');

  cfgSection.append(
    el('label', { class: 'dbg-label' }, 'Backend base URL'), baseUrlIn,
    el('label', { class: 'dbg-label' }, 'WebSocket URL'),    wsUrlIn,
    el('label', { class: 'dbg-label' }, 'Metadata (JSON)'),  metaIn,
  );
  leftCol.appendChild(cfgSection);

  // — QoS thresholds —
  const qosSection = el('section', { class: 'dbg-section' });
  qosSection.append(el('h2', { class: 'dbg-section-title' }, 'QoS Thresholds'));
  const rttUpIn      = input('RTT upgrade ms', '250');
  const rttDownIn    = input('RTT downgrade ms', '400');
  const breachIn     = input('Consecutive breaches', '3');
  qosSection.append(
    el('label', { class: 'dbg-label' }, 'avg RTT upgrade (ms)'),   rttUpIn,
    el('label', { class: 'dbg-label' }, 'avg RTT downgrade (ms)'), rttDownIn,
    el('label', { class: 'dbg-label' }, 'Consecutive breaches'),   breachIn,
  );
  leftCol.appendChild(qosSection);

  // — Primary transport actions —
  const actSection = el('section', { class: 'dbg-section' });
  actSection.append(el('h2', { class: 'dbg-section-title' }, 'Actions'));

  const connectBtn    = btn('Connect');
  const disconnectBtn = btn('Disconnect', 'danger');
  const pingBtn       = btn('Send Ping');
  const muteBtn       = btn('Mute Mic');
  let muted = false;

  const msgIn    = input('JSON message…', '{"type":"ping","ts":0}');
  const sendMsgBtn = btn('Send JSON');

  actSection.append(connectBtn, disconnectBtn, pingBtn, muteBtn, el('hr', { class: 'dbg-divider' }), el('label', { class: 'dbg-label' }, 'Raw message'), msgIn, sendMsgBtn);
  leftCol.appendChild(actSection);

  // — Switcher actions (shown only in switcher mode) —
  const swSection = el('section', { class: 'dbg-section dbg-section-hidden', id: 'sw-section' });
  swSection.append(el('h2', { class: 'dbg-section-title' }, 'Transport Switcher'));

  const prepareBtn  = btn('Prepare WebRTC');
  const upgradeBtn  = btn('Upgrade now →');
  const qosAutoChk  = el('input', { type: 'checkbox', id: 'qos-auto', class: 'dbg-check' }) as HTMLInputElement;
  const qosAutoLbl  = el('label', { for: 'qos-auto', class: 'dbg-label-inline' }, ' QoS auto-upgrade');
  const swPhaseEl   = el('div', { class: 'dbg-metric-row' });
  swPhaseEl.innerHTML = '<span class="dbg-metric-key">Phase</span><span class="dbg-metric-val" id="sw-phase">idle</span>';

  swSection.append(prepareBtn, upgradeBtn, el('div', { class: 'dbg-row' }, ''), swPhaseEl);
  // Append checkbox row
  const qosRow = el('div', { class: 'dbg-row' });
  qosRow.append(qosAutoChk, qosAutoLbl);
  swSection.insertBefore(qosRow, swPhaseEl);
  leftCol.appendChild(swSection);

  // Toggle switcher section visibility
  modeSelect.addEventListener('change', () => {
    const isSwitcher = modeSelect.value === 'switcher';
    swSection.classList.toggle('dbg-section-hidden', !isSwitcher);
  });

  // ── Right column ── QoS panel + event log ─────────────────────────────────

  // — QoS Charts —
  const chartsSection = el('section', { class: 'dbg-section' });
  chartsSection.append(el('h2', { class: 'dbg-section-title' }, 'QoS Charts'));
  const chartsContainer = el('div', { class: 'dbg-charts-container' });
  chartsSection.appendChild(chartsContainer);
  rightCol.appendChild(chartsSection);

  // — QoS live metrics —
  const qosPanel = el('section', { class: 'dbg-section' });
  qosPanel.append(el('h2', { class: 'dbg-section-title' }, 'Live QoS Metrics'));

  function metricRow(key: string, id: string) {
    const row = el('div', { class: 'dbg-metric-row' });
    row.append(el('span', { class: 'dbg-metric-key' }, key), el('span', { class: 'dbg-metric-val', id }));
    return row;
  }
  qosPanel.append(
    metricRow('RTT',              'q-rtt'),
    metricRow('Avg RTT',          'q-avg'),
    metricRow('Jitter',           'q-jitter'),
    metricRow('Response latency', 'q-latency'),
    metricRow('Audio delivery',   'q-audio'),
    metricRow('Measured at',      'q-ts'),
  );
  rightCol.appendChild(qosPanel);

  function updateQoS(s: QoSSnapshot, seriesHint?: 'websocket' | 'webrtc') {
    const fmt = (n: number | null, unit = 'ms') => n == null ? '—' : `${Math.round(n)}${unit}`;
    (document.getElementById('q-rtt')     as HTMLElement).textContent = fmt(s.rttMs);
    (document.getElementById('q-avg')     as HTMLElement).textContent = fmt(s.avgRttMs);
    (document.getElementById('q-jitter')  as HTMLElement).textContent = fmt(s.jitterMs);
    (document.getElementById('q-latency') as HTMLElement).textContent = fmt(s.responseLatencyMs);
    (document.getElementById('q-audio')   as HTMLElement).textContent =
      s.audioDeliveryRatio == null ? '—' : `${(s.audioDeliveryRatio * 100).toFixed(1)}%`;
    (document.getElementById('q-ts')      as HTMLElement).textContent =
      s.measuredAt ? new Date(s.measuredAt).toLocaleTimeString() : '—';
    (document.getElementById('sw-phase')  as HTMLElement).textContent = switcher?.currentPhase ?? '—';

    // Push to charts
    if (charts) {
      const series = seriesHint ?? (primaryTransport?.type === 'webrtc' ? 'webrtc' : 'websocket');
      charts.push(series, s);
    }
  }

  // — Transport state panel —
  const statePanel = el('section', { class: 'dbg-section' });
  statePanel.append(el('h2', { class: 'dbg-section-title' }, 'Transport State'));

  function stateRow(label: string, id: string) {
    const row = el('div', { class: 'dbg-metric-row' });
    row.append(el('span', { class: 'dbg-metric-key' }, label), el('span', { class: 'dbg-metric-val', id }));
    return row;
  }
  statePanel.append(
    stateRow('Primary type',    'st-primary-type'),
    stateRow('Primary status',  'st-primary-status'),
    stateRow('Secondary type',  'st-secondary-type'),
    stateRow('Secondary status','st-secondary-status'),
    stateRow('Session status',  'st-session'),
    stateRow('Active transport','st-active'),
  );
  rightCol.appendChild(statePanel);

  function updateStatePanel() {
    const g = (id: string) => document.getElementById(id) as HTMLElement;
    g('st-primary-type').textContent    = primaryTransport?.type ?? '—';
    g('st-primary-status').textContent  = primaryTransport?.status ?? '—';
    g('st-secondary-type').textContent  = secondaryTransport?.type ?? '—';
    g('st-secondary-status').textContent = secondaryTransport?.status ?? '—';
    g('st-active').textContent          = switcher ? switcher.activeTransport?.type ?? '—' : (primaryTransport?.type ?? '—');
  }

  // — Event log —
  const logSection = el('section', { class: 'dbg-section dbg-section-log' });
  logSection.append(el('h2', { class: 'dbg-section-title' }, 'Event Log'));
  const clearLogBtn = btn('Clear', 'secondary small');
  logSection.appendChild(clearLogBtn);
  const logEl = el('pre', { class: 'dbg-log' }, '');
  logSection.appendChild(logEl);
  rightCol.appendChild(logSection);

  let logBuffer: string[] = [];
  function log(msg: string, kind: 'info' | 'warn' | 'error' | 'qos' = 'info') {
    const prefix = { info: '·', warn: '⚠', error: '✕', qos: '↯' }[kind];
    const line   = `${new Date().toLocaleTimeString()} ${prefix} ${msg}`;
    logBuffer.unshift(line);
    if (logBuffer.length > 200) logBuffer.pop();
    logEl.textContent = logBuffer.join('\n');
  }
  clearLogBtn.addEventListener('click', () => { logBuffer = []; logEl.textContent = ''; });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function parseMetadata(): Record<string, string> {
    try { return JSON.parse(metaIn.value.trim()) as Record<string, string>; }
    catch { return { interview_type: 'idle' }; }
  }

  function updateBadge(
    b: HTMLSpanElement,
    text: string,
    cls: 'idle' | 'connecting' | 'connected' | 'error' | 'warn',
  ) {
    b.textContent  = text;
    b.className    = `badge badge-${cls}`;
  }

  function buildWsTransport(): WebSocketTransport {
    const cfg: WebSocketTransportConfig = { url: wsUrlIn.value.trim(), timeoutMs: 10_000 };
    const t = new WebSocketTransport(cfg);
    t.on('onStatusChange', s => {
      log(`WebSocket status → ${s}`);
      updateBadge(primaryBadge, `ws: ${s}`, s === 'connected' ? 'connected' : s === 'failed' ? 'error' : 'connecting');
      updateStatePanel();
    });
    t.on('onMessage', msg => {
      if ((msg as { type?: string }).type === '_qos') return; // filtered internally
      log(`← ${JSON.stringify(msg)}`);
    });
    t.on('onAudio', data => log(`← audio frame ${data.byteLength}B`, 'qos'));
    t.on('onError', err => log(`WS error: ${err.message}`, 'error'));
    return t;
  }

  function buildRtcTransport(): WebRTCTransport {
    const cfg: WebRTCTransportConfig = {
      baseUrl: baseUrlIn.value.trim(),
      metadata: parseMetadata(),
    };
    const t = new WebRTCTransport(cfg);
    t.on('onStatusChange', s => {
      log(`WebRTC status → ${s}`);
      updateStatePanel();
    });
    t.on('onMessage', msg => log(`← ${JSON.stringify(msg)}`));
    t.on('onTrack',   _stream => log('← remote audio track received'));
    t.on('onError',   err => log(`WebRTC error: ${err.message}`, 'error'));
    return t;
  }

  function buildSwitcher(primary: Transport): TransportSwitcher {
    const thresholds = {
      rttUpgradeMs:          parseInt(rttUpIn.value)   || 250,
      rttDowngradeMs:        parseInt(rttDownIn.value) || 400,
      consecutiveBreachCount: parseInt(breachIn.value)  || 3,
    };
    const triggers: ('qos' | 'manual' | 'server-signal')[] =
      qosAutoChk.checked ? ['manual', 'qos'] : ['manual'];

    const sw = new TransportSwitcher(primary, { triggers, qosThresholds: thresholds });
    sw.on('onMessage', msg => {
      if ((msg as { type?: string }).type === '_qos') {
        updateQoS(msg as unknown as QoSSnapshot);
        return;
      }
      log(`← ${JSON.stringify(msg)}`);
    });
    sw.on('onAudio',   data   => log(`← audio ${data.byteLength}B`, 'qos'));
    sw.on('onTrack',   _s     => log('← remote track (WebRTC)'));
    sw.on('onStatusChange', s => {
      updateBadge(primaryBadge, `primary: ${s}`, s === 'connected' ? 'connected' : 'idle');
      updateStatePanel();
    });
    sw.on('onError', err => log(`Switcher error: ${err.message}`, 'error'));
    return sw;
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  connectBtn.addEventListener('click', async () => {
    if (agent) { log('Already connected — disconnect first.', 'warn'); return; }

    const mode = modeSelect.value as 'webrtc' | 'ws' | 'switcher';
    log(`Connecting in mode: ${mode}`);

    try {
      if (mode === 'webrtc') {
        primaryTransport = buildRtcTransport();
        agent = new VoiceAgent({
          transport: primaryTransport,
          onStatus:  s => { (document.getElementById('st-session') as HTMLElement).textContent = s; updateBadge(sessionBadge, `session: ${s}`, s === 'connected' ? 'connected' : s === 'error' ? 'error' : 'idle'); },
          onMessage: msg => log(`msg: ${JSON.stringify(msg)}`),
          onError:   err => log(`agent error: ${err.message}`, 'error'),
          onLog:     msg => log(msg),
        });
        await agent.connect();
        // Attach standalone QoS monitor (WebSocket transport needed for ping/pong — skipped for pure WebRTC)
        log('Connected via WebRTC');

      } else if (mode === 'ws') {
        primaryTransport = buildWsTransport();
        agent = new VoiceAgent({
          transport: primaryTransport,
          onStatus:  s => { (document.getElementById('st-session') as HTMLElement).textContent = s; updateBadge(sessionBadge, `session: ${s}`, s === 'connected' ? 'connected' : s === 'error' ? 'error' : 'idle'); },
          onMessage: msg => {
            if ((msg as { type?: string }).type === '_qos') return;
            log(`msg: ${JSON.stringify(msg)}`);
          },
          onQoS:     snap => updateQoS(snap, 'websocket'),
          onError:   err => log(`agent error: ${err.message}`, 'error'),
          onLog:     msg => log(msg),
        });
        // Attach external QoS monitor so metrics panel shows data
        standaloneQoS = new QoSMonitor(primaryTransport, snap => { updateQoS(snap, 'websocket'); updateStatePanel(); });
        charts = new QoSCharts(chartsContainer, { maxPoints: 60 });
        await agent.connect();
        standaloneQoS.start();
        log('Connected via WebSocket');

      } else {
        // Switcher: WS primary, WebRTC secondary
        primaryTransport   = buildWsTransport();
        secondaryTransport = buildRtcTransport();
        switcher = buildSwitcher(primaryTransport);
        updateBadge(switcherBadge, 'switcher: idle', 'idle');

        if (qosAutoChk.checked) {
          switcher.enableQoS();
          log('QoS auto-upgrade enabled');
        }

        // Agent wraps the switcher (duck-typed)
        agent = new VoiceAgent({
          transport: switcher as unknown as Transport,
          onStatus:  s => { (document.getElementById('st-session') as HTMLElement).textContent = s; updateBadge(sessionBadge, `session: ${s}`, s === 'connected' ? 'connected' : s === 'error' ? 'error' : 'idle'); },
          onMessage: msg => { if ((msg as { type?: string }).type !== '_qos') log(`msg: ${JSON.stringify(msg)}`); },
          onQoS:     snap => {
            const activeType = switcher?.activeTransport?.type === 'webrtc' ? 'webrtc' : 'websocket';
            updateQoS(snap, activeType);
          },
          onError:   err => log(`agent error: ${err.message}`, 'error'),
          onLog:     msg => log(msg),
        });
        charts = new QoSCharts(chartsContainer, { maxPoints: 60 });

        // Connect to WS first — agent.connect() calls transport.connect() which only exists on proper Transports
        await (primaryTransport as Transport).connect();
        await agent.connect();
        log('Connected (primary: WebSocket)');
      }

      updateStatePanel();
    } catch (err: unknown) {
      log(`Connect failed: ${(err as Error).message ?? err}`, 'error');
    }
  });

  // ── Disconnect ────────────────────────────────────────────────────────────

  disconnectBtn.addEventListener('click', () => {
    standaloneQoS?.stop();
    standaloneQoS = null;
    charts?.destroy();
    charts = null;
    // clear container for next session
    while (chartsContainer.firstChild) chartsContainer.removeChild(chartsContainer.firstChild);
    switcher?.destroy();
    switcher = null;
    agent?.disconnect();
    agent = null;
    primaryTransport   = null;
    secondaryTransport = null;
    updateBadge(primaryBadge,   'primary: idle',   'idle');
    updateBadge(sessionBadge,  'session: none',   'idle');
    updateBadge(switcherBadge, 'switcher: —',     'idle');
    updateStatePanel();
    log('Disconnected');
  });

  // ── Ping ──────────────────────────────────────────────────────────────────

  pingBtn.addEventListener('click', () => {
    const ts  = Date.now();
    const msg = { type: 'ping', ts };
    if (switcher)          switcher.sendMessage(msg);
    else if (primaryTransport) primaryTransport.sendMessage(msg);
    else { log('Not connected', 'warn'); return; }
    log(`→ ping ts=${ts}`);
    standaloneQoS?.notifySendAudio(); // use same channel to measure response if WS
  });

  // ── Mute ──────────────────────────────────────────────────────────────────

  muteBtn.addEventListener('click', () => {
    if (!agent) { log('Not connected', 'warn'); return; }
    muted = !muted;
    agent.setMicEnabled(!muted);
    muteBtn.textContent = muted ? 'Unmute Mic' : 'Mute Mic';
    log(`Mic ${muted ? 'muted' : 'unmuted'}`);
  });

  // ── Send JSON ─────────────────────────────────────────────────────────────

  sendMsgBtn.addEventListener('click', () => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(msgIn.value.trim()); }
    catch { log('Invalid JSON in message field', 'warn'); return; }
    if (switcher)              switcher.sendMessage(msg);
    else if (primaryTransport) primaryTransport.sendMessage(msg);
    else { log('Not connected', 'warn'); return; }
    log(`→ ${JSON.stringify(msg)}`);
  });

  // ── Switcher — prepare + upgrade ─────────────────────────────────────────

  prepareBtn.addEventListener('click', async () => {
    if (!switcher || !secondaryTransport) { log('Switcher not active', 'warn'); return; }
    log('Preparing WebRTC transport in background…');
    updateBadge(switcherBadge, 'switcher: preparing', 'connecting');
    try {
      await switcher.prepare(secondaryTransport);
      updateBadge(switcherBadge, 'switcher: ready', 'connected');
      log('WebRTC transport ready — call Upgrade now');
    } catch (err: unknown) {
      updateBadge(switcherBadge, 'switcher: failed', 'error');
      log(`Prepare failed: ${(err as Error).message}`, 'error');
    }
    updateStatePanel();
  });

  upgradeBtn.addEventListener('click', async () => {
    if (!switcher) { log('Switcher not active', 'warn'); return; }
    log('Upgrading to WebRTC…');
    updateBadge(switcherBadge, 'switcher: switching', 'warn');
    try {
      const result = await switcher.upgrade();
      if (result.success) {
        updateBadge(switcherBadge, `switcher: ${result.from}→${result.to} ✓`, 'connected');
        log(`Upgraded ${result.from}→${result.to} gap=${result.gapMs}ms`);
      } else {
        updateBadge(switcherBadge, 'switcher: failed', 'error');
        log(`Upgrade failed: ${result.reason}`, 'error');
      }
    } catch (err: unknown) {
      log(`Upgrade error: ${(err as Error).message}`, 'error');
    }
    updateStatePanel();
  });

  return root;
}

