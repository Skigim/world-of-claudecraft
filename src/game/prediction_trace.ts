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

export interface PredictionTraceTelemetry {
  enabled: true;
  seconds: number;
  events: number;
  params: Record<string, string>;
  eventCounts: Record<string, number>;
  summary: TraceData;
  largestDisplaySteps: Array<Record<string, unknown>>;
  recentEvents?: PredictionTraceEvent[];
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

function eventCounts(events: PredictionTraceEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  return counts;
}

function valueCounts(events: PredictionTraceEvent[], type: string, key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (event.type !== type) continue;
    const value = event.data[key];
    if (typeof value !== 'string' || value === '') continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numericValue(data: TraceData, key: string): number {
  const value = data[key];
  return finiteNumber(value) ? value : 0;
}

function classifyFrameStall(data: TraceData): string | null {
  const frameDtMs = numericValue(data, 'frameDtMs');
  if (frameDtMs < 33) return null;
  const longTaskMax = numericValue(data, 'longTaskMax');
  const renderMain = Math.max(
    numericValue(data, 'mainRendererP95'),
    numericValue(data, 'rphTotalP95'),
    numericValue(data, 'rphSubmitP95'),
  );
  const ackLag = numericValue(data, 'ackLag');
  const pendingInputs = numericValue(data, 'pendingInputs');
  const lastSnapAge = numericValue(data, 'lastSnapAge');
  if (longTaskMax >= 50 || longTaskMax >= frameDtMs * 0.65) return 'browser-long-task';
  if (renderMain >= 18 || renderMain >= frameDtMs * 0.5) return 'render-main';
  if (ackLag >= 8 || pendingInputs >= 8) return 'prediction-backlog';
  if (lastSnapAge >= 180) return 'snapshot-gap';
  return 'frame-budget';
}

function nearestBefore(events: PredictionTraceEvent[], type: string, at: number): PredictionTraceEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.at <= at && event.type === type) return event;
  }
  return null;
}

function importantEvent(event: PredictionTraceEvent): boolean {
  if (event.type !== 'frame') return true;
  const frameMs = event.data.frameDtMs;
  const step = event.data.displayStep;
  const camStep = event.data.camYawStep;
  return (typeof event.data.stallKind === 'string')
    || (finiteNumber(frameMs) && frameMs >= 33)
    || (finiteNumber(step) && step >= 0.35)
    || (finiteNumber(camStep) && camStep >= 0.35);
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

function compactTraceData(data: TraceData): TraceData {
  const out: TraceData = {};
  let count = 0;
  for (const [key, value] of Object.entries(data)) {
    if (count >= 48) break;
    if (typeof value === 'number') out[key] = Number.isFinite(value) ? round(value) : null;
    else if (typeof value === 'string') out[key] = value.slice(0, 120);
    else if (typeof value === 'boolean' || value === null) out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 12);
    else if (value && typeof value === 'object') out[key] = value;
    count++;
  }
  return out;
}

function compactEvent(event: PredictionTraceEvent): PredictionTraceEvent {
  return {
    at: event.at,
    type: event.type,
    data: compactTraceData(event.data),
  };
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
    const frameData: TraceData = { ...data, displayStep: round(displayStep), camYawStep: round(camYawStep) };
    const stallKind = classifyFrameStall(frameData);
    if (stallKind) frameData.stallKind = stallKind;
    this.push({ at: round(browserNow() - this.startedAt), type: 'frame', data: frameData });
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
      frameStalls: valueCounts(this.events, 'frame', 'stallKind'),
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

  telemetry(includeRecentEvents = false): PredictionTraceTelemetry | null {
    if (!this.enabled || this.events.length === 0) return null;
    const frames = this.events.filter((event) => event.type === 'frame');
    const largestDisplaySteps = [...frames]
      .filter((event) => finiteNumber(event.data.displayStep))
      .sort((a, b) => Number(b.data.displayStep) - Number(a.data.displayStep))
      .slice(0, 12)
      .map((event) => {
        const rec = nearestBefore(this.events, 'snapshot-reconcile', event.at);
        return {
          at: event.at,
          frameDtMs: event.data.frameDtMs,
          stallKind: event.data.stallKind ?? null,
          displayStep: event.data.displayStep,
          camYawStep: event.data.camYawStep,
          alpha: event.data.alpha,
          lastSnapAge: event.data.lastSnapAge,
          input: {
            f: event.data.moveForward ?? 0,
            b: event.data.moveBack ?? 0,
            sl: event.data.strafeLeft ?? 0,
            sr: event.data.strafeRight ?? 0,
          },
          display: { x: event.data.displayX, y: event.data.displayY, z: event.data.displayZ },
          entity: { x: event.data.entityX, y: event.data.entityY, z: event.data.entityZ },
          msSinceReconcile: rec ? round(event.at - rec.at) : null,
          lastCorrection: rec?.data.renderCorrectionDist ?? null,
          lastAckLag: rec?.data.ackLag ?? null,
          lastPredictionMode: rec?.data.predictionMode ?? null,
        };
      });
    const telemetry: PredictionTraceTelemetry = {
      enabled: true,
      seconds: round((browserNow() - this.startedAt) / 1000),
      events: this.events.length,
      params: queryParams(),
      eventCounts: eventCounts(this.events),
      summary: this.summary(),
      largestDisplaySteps,
    };
    if (includeRecentEvents) {
      telemetry.recentEvents = this.events
        .filter(importantEvent)
        .slice(-240)
        .map(compactEvent);
    }
    return telemetry;
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
