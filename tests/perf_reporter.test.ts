import { beforeEach, describe, expect, it } from 'vitest';
import { Settings } from '../src/game/settings';
import type { PerfSnapshot } from '../src/game/perf';
import { perfReporterInternalsForTest } from '../src/game/perf_reporter';

function installBrowserGlobals(): void {
  const map = new Map<string, string>();
  (globalThis as any).__APP_VERSION__ = '0.9.0';
  (globalThis as any).__APP_BUILD_ID__ = 'testbuild';
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
  (globalThis as any).location = { search: '?perfScenario=bench_dense_foliage' };
  (globalThis as any).window = { innerWidth: 1440, innerHeight: 900 };
}

function renderDiagnostics() {
  return {
    enabled: false,
    totalObjects: 0,
    estimatedDraws: 0,
    estimatedTriangles: 0,
    estimatedPoints: 0,
    programs: 0,
    programDelta: 0,
    textures: 0,
    textureDelta: 0,
    newMaterials: [],
    firstVisibleObjects: [],
    categories: {},
  };
}

function snapshot(): PerfSnapshot {
  return {
    seconds: 80,
    frames: 4800,
    fps: 60,
    frameMs: { avg: 16.6, p50: 16, p95: 19, p99: 28, max: 52, long50: 1 },
    windows: {
      last10s: { seconds: 10, frames: 600, fps: 60, frameMs: { avg: 16.6, p50: 16, p95: 18, p99: 24, max: 40, long50: 0 } },
      last30s: { seconds: 30, frames: 1800, fps: 60, frameMs: { avg: 16.6, p50: 16, p95: 19, p99: 28, max: 52, long50: 1 } },
    },
    mainMs: { renderer: { count: 1, avg: 5, p95: 5, max: 5 } },
    renderer: {
      tier: 'high',
      autoGovernor: true,
      budget: {
        targetFps: 60,
        minRenderScaleDesktop: 0.7,
        minRenderScaleMobile: 0.6,
        maxRenderScale: 1,
        dropFrameMs: 22,
        urgentFrameMs: 32,
        recoverFrameMs: 15,
        dropStep: 0.1,
        urgentDropStep: 0.15,
        recoverStep: 0.05,
        recoverStableSeconds: 7,
        cooldownSeconds: 1.35,
      },
      renderScale: 1,
      effectiveRenderScale: 0.9,
      renderBudget: {
        enabled: true,
        mode: 'stable',
        reason: 'stable',
        pressure: 0.4,
        frameMsEma: 16.7,
        submitMsEma: 1,
        stableSeconds: 0,
        cooldownSeconds: 0,
        levels: { grass: 1, vfx: 1, resolution: 0.9 },
        caps: {
          targetCalls: 330,
          urgentCalls: 500,
          targetTriangles: 1100000,
          urgentTriangles: 1750000,
          targetGrassTufts: 2850,
          urgentGrassTufts: 4500,
          minGrassLevel: 0.6,
          minVfxLevel: 0.68,
        },
      },
      pixelRatio: 1.5,
      width: 1440,
      height: 900,
      calls: 500,
      triangles: 300000,
      textures: 80,
      programs: 30,
      views: 40,
      foliage: {
        grassEnabled: true,
        grassQuality: 1,
        grassActiveRadius: 82,
        grassChunks: 48,
        grassReadyChunks: 48,
        grassVisibleChunks: 42,
        grassQueuedChunks: 0,
        grassTufts: 12000,
        grassVisibleTufts: 9800,
        grassBuiltChunks: 52,
        grassDisposedChunks: 4,
        grassLastBuildMs: 1.2,
        grassBuildMs: 55,
        grassCacheLimit: 96,
      },
      glVendor: 'Apple',
      glRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)',
      contextLost: 0,
      contextRestored: 0,
      phaseMs: {
        setup: { count: 1, avg: 1, p95: 1, max: 1 },
        entities: { count: 1, avg: 1, p95: 1, max: 1 },
        world: { count: 1, avg: 1, p95: 1, max: 1 },
        nameplates: { count: 1, avg: 1, p95: 1, max: 1 },
        submit: { count: 1, avg: 1, p95: 1, max: 1 },
        total: { count: 1, avg: 5, p95: 5, max: 5 },
      },
      renderDiagnostics: renderDiagnostics(),
    },
    hud: null,
    assets: { preload: { tasks: 0, waitMs: 0, complete: true }, byType: {}, files: [] },
    network: null,
    input: {
      intents: 0,
      lastKind: '',
      lastIntentAge: -1,
      intentToFrame: { count: 0, avg: 0, p95: 0, max: 0 },
      intentToSend: { count: 0, avg: 0, p95: 0, max: 0 },
      sendToEcho: { count: 0, avg: 0, p95: 0, max: 0 },
      intentToVisible: { count: 0, avg: 0, p95: 0, max: 0 },
    },
    browser: {
      longTasks: { count: 2, totalMs: 120, avg: 60, p95: 80, max: 80, lastAge: 1000 },
      memory: { usedJSHeapSize: 1, totalJSHeapSize: 2, jsHeapSizeLimit: 3, usedMB: 100, limitMB: 4096 },
      visibilityState: 'visible',
    },
    device: {
      dpr: 2,
      viewport: '1440x900',
      mobileTouch: false,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      hardwareConcurrency: 12,
      deviceMemory: 8,
      maxTouchPoints: 0,
    },
  };
}

beforeEach(() => installBrowserGlobals());

describe('perf reporter payload', () => {
  it('summarizes renderer performance without copying the full user agent', () => {
    const settings = new Settings();
    const body = perfReporterInternalsForTest.payloadFromSnapshot(snapshot(), settings, 'sess1', 42)!;

    expect(body.releaseVersion).toBe('0.9.0');
    expect(body.buildId).toBe('testbuild');
    expect(body.graphicsPreset).toBe('auto');
    expect(body.gfxTier).toBe('high');
    expect(body.autoGovernor).toBe(true);
    expect(body.effectiveRenderScale).toBe(0.9);
    expect(body.browserFamily).toBe('safari');
    expect(body.osFamily).toBe('macos');
    expect(body.glRendererBucket).toBe('apple-m3-pro');
    expect(body.source).toBe('benchmark');
    expect(body.zoneOrScenario).toBe('bench_dense_foliage');
    expect(JSON.stringify(body.rawSummary)).not.toContain('Safari/605');
  });

  it('keeps local dev trace frames and long-task correlation in raw summary', () => {
    const settings = new Settings();
    const snap = snapshot();
    snap.devTrace = {
      enabled: true,
      worstFrameLimit: 40,
      minFrameMs: 33,
      frames: [{
        atMs: 1200,
        frameMs: 80,
        scoreMs: 80,
        reasons: ['frame-gap'],
        mainMs: { renderer: 20, hud: 2, events: 0, sim: 0 },
        renderer: {
          calls: 200,
          triangles: 300000,
          textures: 80,
          programs: 30,
          views: 40,
          renderScale: 1,
          effectiveRenderScale: 0.9,
          renderBudget: {
            enabled: true,
            mode: 'stable',
            reason: 'stable',
            pressure: 0.4,
            frameMsEma: 16.7,
            submitMsEma: 1,
            stableSeconds: 0,
            cooldownSeconds: 0,
            levels: { grass: 1, vfx: 1, resolution: 0.9 },
            caps: {
              targetCalls: 330,
              urgentCalls: 500,
              targetTriangles: 1100000,
              urgentTriangles: 1750000,
              targetGrassTufts: 2850,
              urgentGrassTufts: 4500,
              minGrassLevel: 0.6,
              minVfxLevel: 0.68,
            },
          },
          pixelRatio: 1.5,
          width: 1440,
          height: 900,
          foliage: {
            grassEnabled: true,
            grassQuality: 1,
            grassActiveRadius: 82,
            grassChunks: 48,
            grassReadyChunks: 48,
            grassVisibleChunks: 42,
            grassQueuedChunks: 0,
            grassTufts: 12000,
            grassVisibleTufts: 9800,
            grassBuiltChunks: 52,
            grassDisposedChunks: 4,
            grassLastBuildMs: 1.2,
            grassBuildMs: 55,
            grassCacheLimit: 96,
          },
          lastFrame: null,
        },
        browser: { longTaskCount: 1, longTaskTotalMs: 70, longTaskLastAgeMs: 15, memoryUsedMb: 100 },
        network: null,
      }],
      spans: [{
        atMs: 1190,
        startMs: 1110,
        endMs: 1190,
        durationMs: 80,
        name: 'net.applySnapshot',
        kind: 'external',
        detail: { ents: 42 },
      }],
      longTasks: [{
        startMs: 1100,
        endMs: 1170,
        durationMs: 70,
        name: 'self',
        entryType: 'longtask',
        attribution: [],
        nearestFrameAtMs: 1200,
        nearestFrameMs: 80,
        nearestFrameDeltaMs: 65,
        nearestSpanName: 'net.applySnapshot',
        nearestSpanMs: 80,
        nearestSpanDeltaMs: 0,
      }],
    };

    const body = perfReporterInternalsForTest.payloadFromSnapshot(snap, settings, 'sess1', 42)!;

    const rawSummary = body.rawSummary as {
      devTrace: {
        frames: Array<{ renderer: { calls: number } }>;
        spans: Array<{ name: string; detail?: { ents?: number } }>;
        longTasks: Array<{ nearestFrameMs?: number }>;
      };
    };
    expect(rawSummary.devTrace.frames[0].renderer.calls).toBe(200);
    expect(rawSummary.devTrace.spans[0].name).toBe('net.applySnapshot');
    expect(rawSummary.devTrace.spans[0].detail?.ents).toBe(42);
    expect(rawSummary.devTrace.longTasks[0].nearestFrameMs).toBe(80);
    expect((body.rawSummary as { rendererFoliage?: { grassVisibleChunks?: number } }).rendererFoliage?.grassVisibleChunks).toBe(42);
    expect((body.rawSummary as { rendererBudget?: { levels?: { grass?: number } } }).rendererBudget?.levels?.grass).toBe(1);
    expect((body.rawSummary as { rendererDiagnostics?: { enabled?: boolean } }).rendererDiagnostics?.enabled).toBe(false);
  });
});
