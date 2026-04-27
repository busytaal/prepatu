/**
 * QoSCharts — real-time sparkline charts for QoS metrics.
 *
 * Renders 4 canvases into a container element showing rolling time-series for:
 *   • RTT (ms)
 *   • Jitter (ms)
 *   • Response Latency (ms)
 *   • Audio Delivery (%)
 *
 * Each chart has two series:
 *   • websocket  — blue  (#3c8fff)
 *   • webrtc     — orange (#ff8c42)
 *
 * Usage:
 *   const charts = new QoSCharts(containerEl, { maxPoints: 60 });
 *   charts.push('websocket',  snapshot);
 *   charts.push('webrtc',     snapshot);
 *   charts.destroy();   // cleans up RAF loop
 */

import type { QoSSnapshot } from '../transports/Transport';

export type SeriesKey = 'websocket' | 'webrtc';

interface ChartDef {
  label:    string;
  unit:     string;
  getValue: (s: QoSSnapshot) => number | null;
  maxY:     number;      // soft ceiling — auto-scales above this
  canvas:   HTMLCanvasElement;
  ctx:      CanvasRenderingContext2D;
}

interface Point { t: number; v: number }

const COLORS: Record<SeriesKey, string> = {
  websocket: '#3c8fff',
  webrtc:    '#ff8c42',
};

const GRID_COLOR  = '#1a2e50';
const LABEL_COLOR = '#5a7ca0';
const BG_COLOR    = '#050c18';

export class QoSCharts {
  private maxPoints:  number;
  private series:     Record<SeriesKey, Record<string, Point[]>>;
  private charts:     ChartDef[];
  private rafId:      number | null = null;
  private dirty = true;

  constructor(
    private container: HTMLElement,
    opts: { maxPoints?: number } = {},
  ) {
    this.maxPoints = opts.maxPoints ?? 60;

    this.series = {
      websocket: { rtt: [], jitter: [], latency: [], audio: [] },
      webrtc:    { rtt: [], jitter: [], latency: [], audio: [] },
    };

    this.charts = this._buildCharts();
    this._renderStatic();
    this._scheduleRedraw();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Push a new snapshot for a given series. */
  push(series: SeriesKey, snap: QoSSnapshot): void {
    const t = snap.measuredAt ?? Date.now();
    const s = this.series[series];

    const push = (arr: Point[], v: number | null) => {
      if (v == null) return;
      arr.push({ t, v });
      if (arr.length > this.maxPoints) arr.shift();
    };

    push(s['rtt'],     snap.rttMs);
    push(s['jitter'],  snap.jitterMs);
    push(s['latency'], snap.responseLatencyMs);
    push(s['audio'],   snap.audioDeliveryRatio != null ? snap.audioDeliveryRatio * 100 : null);
    this.dirty = true;
  }

  /** Remove all data points. */
  clear(): void {
    for (const s of Object.values(this.series)) {
      for (const arr of Object.values(s)) arr.length = 0;
    }
    this.dirty = true;
  }

  /** Stop the RAF loop and remove canvases. */
  destroy(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.charts.forEach(c => c.canvas.remove());
  }

  // ── Build DOM ──────────────────────────────────────────────────────────────

  private _buildCharts(): ChartDef[] {
    const defs: Omit<ChartDef, 'canvas' | 'ctx'>[] = [
      { label: 'RTT',               unit: 'ms', getValue: s => s.rttMs,              maxY: 300  },
      { label: 'Jitter',            unit: 'ms', getValue: s => s.jitterMs,           maxY: 50   },
      { label: 'Response Latency',  unit: 'ms', getValue: s => s.responseLatencyMs,  maxY: 500  },
      { label: 'Audio Delivery',    unit: '%',  getValue: s => s.audioDeliveryRatio != null ? s.audioDeliveryRatio * 100 : null, maxY: 100 },
    ];

    // Legend row
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:16px;padding:4px 0 8px;';
    (['websocket', 'webrtc'] as SeriesKey[]).forEach(k => {
      const dot = document.createElement('span');
      dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[k]};margin-right:5px;flex-shrink:0;`;
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:11px;color:#8ab0d8;display:flex;align-items:center;';
      lbl.append(dot, k);
      legend.appendChild(lbl);
    });
    this.container.appendChild(legend);

    return defs.map((def): ChartDef => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;margin-bottom:12px;';

      const title = document.createElement('div');
      title.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5a7ca0;margin-bottom:4px;';
      title.textContent = def.label;

      const canvas = document.createElement('canvas');
      canvas.width  = 600;
      canvas.height = 80;
      canvas.style.cssText = 'width:100%;height:80px;display:block;border-radius:6px;';

      wrap.append(title, canvas);
      this.container.appendChild(wrap);

      const ctx = canvas.getContext('2d')!;
      return { ...def, canvas, ctx };
    });
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  private _scheduleRedraw(): void {
    const tick = () => {
      if (this.dirty) {
        this._redrawAll();
        this.dirty = false;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private _renderStatic(): void {
    this._redrawAll();
  }

  private _redrawAll(): void {
    const keyMap: Record<string, string> = {
      'RTT':              'rtt',
      'Jitter':           'jitter',
      'Response Latency': 'latency',
      'Audio Delivery':   'audio',
    };

    for (const chart of this.charts) {
      const seriesKey = keyMap[chart.label];
      const wsData  = this.series['websocket'][seriesKey];
      const rtcData = this.series['webrtc'][seriesKey];
      this._drawChart(chart, wsData, rtcData);
    }
  }

  private _drawChart(
    chart: ChartDef,
    wsData: Point[],
    rtcData: Point[],
  ): void {
    const { ctx, canvas, maxY, unit, label } = chart;
    const W = canvas.width;
    const H = canvas.height;

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    // Determine Y ceiling (auto-scale above default max)
    const allVals = [...wsData, ...rtcData].map(p => p.v);
    const dataMax = allVals.length > 0 ? Math.max(...allVals) : 0;
    const yMax    = Math.max(dataMax * 1.15, maxY);

    // Grid lines (3 horizontal)
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth   = 0.5;
    for (let i = 1; i <= 3; i++) {
      const y = H - (i / 4) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();

      // Y-axis label
      const val = (yMax * i / 4).toFixed(unit === '%' ? 0 : 0);
      ctx.fillStyle   = LABEL_COLOR;
      ctx.font        = '9px Menlo, Consolas, monospace';
      ctx.textAlign   = 'left';
      ctx.fillText(`${val}${unit}`, 3, y - 2);
    }

    // Vertical "now" line (rightmost)
    ctx.strokeStyle = '#1e3358';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(W - 1, 0); ctx.lineTo(W - 1, H); ctx.stroke();

    // Determine time window from the union of both series
    const allTimes = [...wsData, ...rtcData].map(p => p.t);
    if (allTimes.length === 0) {
      this._drawEmptyLabel(ctx, W, H, label);
      return;
    }
    const tMax = Math.max(...allTimes);
    const tMin = tMax - this.maxPoints * 1000; // 1 s per point slot

    const toX = (t: number) => ((t - tMin) / (tMax - tMin)) * (W - 2);
    const toY = (v: number) => H - (v / yMax) * H * 0.92 - 4;

    // Draw each series
    ([ ['websocket', wsData], ['webrtc', rtcData] ] as [SeriesKey, Point[]][]).forEach(([key, data]) => {
      if (data.length < 2) {
        // Draw single dot if only one point
        if (data.length === 1) {
          ctx.beginPath();
          ctx.arc(toX(data[0].t), toY(data[0].v), 3, 0, Math.PI * 2);
          ctx.fillStyle = COLORS[key];
          ctx.fill();
        }
        return;
      }

      // Filled area
      ctx.beginPath();
      ctx.moveTo(toX(data[0].t), H);
      data.forEach(p => ctx.lineTo(toX(p.t), toY(p.v)));
      ctx.lineTo(toX(data[data.length - 1].t), H);
      ctx.closePath();
      ctx.fillStyle = `${COLORS[key]}22`; // 13% opacity fill
      ctx.fill();

      // Line
      ctx.beginPath();
      ctx.moveTo(toX(data[0].t), toY(data[0].v));
      data.slice(1).forEach(p => ctx.lineTo(toX(p.t), toY(p.v)));
      ctx.strokeStyle = COLORS[key];
      ctx.lineWidth   = 1.5;
      ctx.lineJoin    = 'round';
      ctx.stroke();

      // Latest value dot
      const last = data[data.length - 1];
      ctx.beginPath();
      ctx.arc(toX(last.t), toY(last.v), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[key];
      ctx.fill();

      // Latest value label
      const txt = unit === '%' ? `${last.v.toFixed(1)}%` : `${Math.round(last.v)}ms`;
      ctx.fillStyle = COLORS[key];
      ctx.font      = '10px Menlo, Consolas, monospace';
      ctx.textAlign = key === 'websocket' ? 'right' : 'left';
      const lx = Math.min(Math.max(toX(last.t), 24), W - 24);
      ctx.fillText(txt, lx, toY(last.v) - 6);
    });
  }

  private _drawEmptyLabel(ctx: CanvasRenderingContext2D, W: number, H: number, label: string): void {
    ctx.fillStyle = '#2a3e60';
    ctx.font      = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${label} — no data yet`, W / 2, H / 2 + 4);
  }
}
