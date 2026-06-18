type TraceData = Record<string, unknown>;

export interface PredictionTraceEvent {
  at: number;
  type: string;
  data: TraceData;
}

interface NumericSummary {
  count: number;
  avg: number;
  p95: number;
  max: number;
}

interface FrameState {
  x: number;
  y: number;
  z: number;
  camYaw: number;
}

const MAX_EVENTS = 20_000;
const OVERLAY_INTERVAL_MS = 500;

function browserNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function summarize(values: number[]): NumericSummary {
  if (values.length === 0) return { count: 0, avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    avg: round(total / values.length),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}

function numericEvents(events: PredictionTraceEvent[], type: string, key: string): number[] {
  const out: number[] = [];
  for (const event of events) {
    if (event.type !== type) continue;
    const value = event.data[key];
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  }
  return out;
}

function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function queryParams(): Record<string, string> {
  if (typeof location === 'undefined') return {};
  return Object.fromEntries(new URLSearchParams(location.search));
}

function localStorageGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function traceEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  const params = new URLSearchParams(location.search);
  return params.has('predictTrace')
    || params.has('predictionTrace')
    || params.has('tracePrediction')
    || localStorageGet('woc_prediction_trace') === '1';
}

export class PredictionTrace {
  readonly enabled = traceEnabled();
  private startedAt = browserNow();
  private events: PredictionTraceEvent[] = [];
  private overlay: HTMLDivElement | null = null;
  private lastOverlayAt = 0;
  private lastFrame: FrameState | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.wocPredictionTrace = this;
    }
    if (this.enabled && typeof document !== 'undefined') {
      if (document.body) this.mountOverlay();
      else document.addEventListener('DOMContentLoaded', () => this.mountOverlay(), { once: true });
    }
  }

  reset(): void {
    this.startedAt = browserNow();
    this.events = [];
    this.lastFrame = null;
    this.renderOverlay(true);
  }

  record(type: string, data: TraceData = {}): void {
    if (!this.enabled) return;
    this.push({ at: round(browserNow() - this.startedAt), type, data });
  }

  recordFrame(data: TraceData & { displayX: number; displayY: number; displayZ: number; camYaw: number }): void {
    if (!this.enabled) return;
    const frame: FrameState = { x: data.displayX, y: data.displayY, z: data.displayZ, camYaw: data.camYaw };
    const displayStep = this.lastFrame
      ? Math.hypot(frame.x - this.lastFrame.x, frame.y - this.lastFrame.y, frame.z - this.lastFrame.z)
      : 0;
    const camYawStep = this.lastFrame ? Math.abs(angleDelta(frame.camYaw, this.lastFrame.camYaw)) : 0;
    this.lastFrame = frame;
    this.push({ at: round(browserNow() - this.startedAt), type: 'frame', data: { ...data, displayStep: round(displayStep), camYawStep: round(camYawStep) } });
  }

  summary(): TraceData {
    const snapshots = this.events.filter((event) => event.type === 'snapshot-reconcile');
    const worstCorrections = [...snapshots]
      .sort((a, b) => Number(b.data.renderCorrectionDist ?? 0) - Number(a.data.renderCorrectionDist ?? 0))
      .slice(0, 12)
      .map((event) => ({
        at: event.at,
        tick: event.data.tick,
        ack: event.data.ack,
        ackLag: event.data.ackLag,
        pendingAfter: event.data.pendingAfter,
        replayed: event.data.replayed,
        renderCorrectionDist: event.data.renderCorrectionDist,
        serverDeltaDist: event.data.serverDeltaDist,
        replayDeltaDist: event.data.replayDeltaDist,
        anchorMode: event.data.anchorMode,
      }));
    return {
      seconds: round((browserNow() - this.startedAt) / 1000),
      events: this.events.length,
      params: queryParams(),
      upstreamDelay: summarize(numericEvents(this.events, 'socket-send-scheduled', 'delayMs')),
      downstreamDelay: summarize(numericEvents(this.events, 'socket-receive-scheduled', 'delayMs')),
      predictedDist: summarize(numericEvents(this.events, 'input-predict', 'predictedDist')),
      renderCorrectionDist: summarize(numericEvents(this.events, 'snapshot-reconcile', 'renderCorrectionDist')),
      serverDeltaDist: summarize(numericEvents(this.events, 'snapshot-reconcile', 'serverDeltaDist')),
      replayDeltaDist: summarize(numericEvents(this.events, 'snapshot-reconcile', 'replayDeltaDist')),
      ackLag: summarize(numericEvents(this.events, 'snapshot-reconcile', 'ackLag')),
      pendingAfter: summarize(numericEvents(this.events, 'snapshot-reconcile', 'pendingAfter')),
      displayStep: summarize(numericEvents(this.events, 'frame', 'displayStep')),
      camYawStep: summarize(numericEvents(this.events, 'frame', 'camYawStep')),
      alpha: summarize(numericEvents(this.events, 'frame', 'alpha')),
      worstCorrections,
    };
  }

  report(): { createdAt: string; url: string | null; summary: TraceData; events: PredictionTraceEvent[] } {
    return {
      createdAt: new Date().toISOString(),
      url: typeof location === 'undefined' ? null : location.href,
      summary: this.summary(),
      events: [...this.events],
    };
  }

  copy(): void {
    const text = JSON.stringify(this.report(), null, 2);
    void navigator.clipboard?.writeText(text).catch(() => {
      console.info('World of ClaudeCraft prediction trace:', text);
    });
  }

  download(filename = 'woc-prediction-trace.json'): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
      console.info('World of ClaudeCraft prediction trace:', this.report());
      return;
    }
    const blob = new Blob([JSON.stringify(this.report(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private push(event: PredictionTraceEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.renderOverlay();
  }

  private mountOverlay(): void {
    if (this.overlay || typeof document === 'undefined' || !document.body) return;
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = [
      'position:fixed',
      'left:8px',
      'bottom:8px',
      'z-index:2147483647',
      'min-width:260px',
      'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'color:#e0f2fe',
      'background:rgba(2,8,18,0.86)',
      'border:1px solid rgba(56,189,248,0.45)',
      'border-radius:6px',
      'padding:8px',
      'white-space:pre',
      'cursor:pointer',
      'box-shadow:0 8px 28px rgba(0,0,0,0.35)',
    ].join(';');
    this.overlay.title = 'Click to download prediction trace JSON';
    this.overlay.addEventListener('click', () => this.download());
    document.body.appendChild(this.overlay);
    this.renderOverlay(true);
  }

  private renderOverlay(force = false): void {
    if (!this.overlay) return;
    const now = browserNow();
    if (!force && now - this.lastOverlayAt < OVERLAY_INTERVAL_MS) return;
    this.lastOverlayAt = now;
    const summary = this.summary();
    const correction = summary.renderCorrectionDist as NumericSummary;
    const displayStep = summary.displayStep as NumericSummary;
    const camStep = summary.camYawStep as NumericSummary;
    const ackLag = summary.ackLag as NumericSummary;
    const pending = summary.pendingAfter as NumericSummary;
    this.overlay.textContent = [
      `prediction trace ${summary.seconds}s  events ${summary.events}`,
      `corr p95 ${correction.p95} max ${correction.max}`,
      `frame step p95 ${displayStep.p95} max ${displayStep.max}`,
      `cam step p95 ${camStep.p95} max ${camStep.max}`,
      `ack lag p95 ${ackLag.p95} max ${ackLag.max}  pending max ${pending.max}`,
      'click: download json',
    ].join('\n');
  }
}

declare global {
  interface Window {
    wocPredictionTrace?: PredictionTrace;
  }
}

export const predictionTrace = new PredictionTrace();
