import type { GfxRuntimeBudget, GfxTier } from './gfx';

export type RenderBudgetMode = 'disabled' | 'stable' | 'degrading' | 'recovering';
export type RenderBudgetReason = 'disabled' | 'startup' | 'stable' | 'frame' | 'submit' | 'draw' | 'grass' | 'recover';

export interface RenderBudgetLevels {
  grass: number;
  vfx: number;
  resolution: number;
}

export interface RenderBudgetCaps {
  targetCalls: number;
  urgentCalls: number;
  targetTriangles: number;
  urgentTriangles: number;
  targetGrassTufts: number;
  urgentGrassTufts: number;
  minGrassLevel: number;
  minVfxLevel: number;
}

export interface RenderBudgetState {
  enabled: boolean;
  mode: RenderBudgetMode;
  reason: RenderBudgetReason;
  pressure: number;
  frameMsEma: number;
  submitMsEma: number;
  stableSeconds: number;
  cooldownSeconds: number;
  levels: RenderBudgetLevels;
  caps: RenderBudgetCaps;
}

export interface RenderBudgetSample {
  dt: number;
  frameMs: number;
  totalMs: number;
  submitMs: number;
  calls: number;
  triangles: number;
  grassVisibleTufts: number;
  grassVisibleChunks: number;
  activeViews: number;
  createdViews: number;
  minRenderScale: number;
  maxRenderScale: number;
}

export interface RenderBudgetGovernorOptions {
  tier: GfxTier;
  budget: GfxRuntimeBudget;
  enabled: boolean;
}

const CAPS_BY_TIER: Record<GfxTier, RenderBudgetCaps> = {
  low: {
    targetCalls: 220,
    urgentCalls: 340,
    targetTriangles: 650_000,
    urgentTriangles: 1_100_000,
    targetGrassTufts: 1_450,
    urgentGrassTufts: 2_350,
    minGrassLevel: 0.42,
    minVfxLevel: 0.5,
  },
  medium: {
    targetCalls: 260,
    urgentCalls: 400,
    targetTriangles: 850_000,
    urgentTriangles: 1_350_000,
    targetGrassTufts: 2_000,
    urgentGrassTufts: 3_200,
    minGrassLevel: 0.5,
    minVfxLevel: 0.58,
  },
  high: {
    targetCalls: 330,
    urgentCalls: 500,
    targetTriangles: 1_100_000,
    urgentTriangles: 1_750_000,
    targetGrassTufts: 2_850,
    urgentGrassTufts: 4_500,
    minGrassLevel: 0.6,
    minVfxLevel: 0.68,
  },
  ultra: {
    targetCalls: 460,
    urgentCalls: 680,
    targetTriangles: 1_800_000,
    urgentTriangles: 2_700_000,
    targetGrassTufts: 4_500,
    urgentGrassTufts: 6_800,
    minGrassLevel: 0.78,
    minVfxLevel: 0.86,
  },
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function positiveRatio(value: number, target: number): number {
  if (!Number.isFinite(value) || value <= 0 || target <= 0) return 0;
  return value / target;
}

function copyLevels(levels: RenderBudgetLevels): RenderBudgetLevels {
  return {
    grass: round2(levels.grass),
    vfx: round2(levels.vfx),
    resolution: round2(levels.resolution),
  };
}

function copyCaps(caps: RenderBudgetCaps): RenderBudgetCaps {
  return { ...caps };
}

export class RenderBudgetGovernor {
  private readonly budget: GfxRuntimeBudget;
  private readonly enabled: boolean;
  private readonly caps: RenderBudgetCaps;
  private mode: RenderBudgetMode;
  private reason: RenderBudgetReason;
  private pressure = 0;
  private frameMsEma = 16.7;
  private submitMsEma = 0;
  private stableSeconds = 0;
  private cooldownSeconds = 0;
  private levels: RenderBudgetLevels = { grass: 1, vfx: 1, resolution: 1 };

  constructor(options: RenderBudgetGovernorOptions) {
    this.budget = options.budget;
    this.enabled = options.enabled;
    this.caps = CAPS_BY_TIER[options.tier];
    this.mode = options.enabled ? 'stable' : 'disabled';
    this.reason = options.enabled ? 'startup' : 'disabled';
  }

  reset(renderScale: number, minRenderScale: number, maxRenderScale: number): RenderBudgetState {
    const scale = Math.min(Math.max(renderScale, minRenderScale), maxRenderScale);
    this.levels = { grass: 1, vfx: 1, resolution: round2(scale) };
    this.frameMsEma = 16.7;
    this.submitMsEma = 0;
    this.stableSeconds = 0;
    this.cooldownSeconds = this.enabled ? 0.5 : 0;
    this.pressure = 0;
    this.mode = this.enabled ? 'stable' : 'disabled';
    this.reason = this.enabled ? 'startup' : 'disabled';
    return this.state();
  }

  state(): RenderBudgetState {
    return {
      enabled: this.enabled,
      mode: this.mode,
      reason: this.reason,
      pressure: round2(this.pressure),
      frameMsEma: round2(this.frameMsEma),
      submitMsEma: round2(this.submitMsEma),
      stableSeconds: round2(this.stableSeconds),
      cooldownSeconds: round2(this.cooldownSeconds),
      levels: copyLevels(this.levels),
      caps: copyCaps(this.caps),
    };
  }

  update(sample: RenderBudgetSample): RenderBudgetState {
    if (!Number.isFinite(sample.dt) || sample.dt <= 0) return this.state();
    const frameMs = Math.min(250, Math.max(0, sample.frameMs));
    const totalMs = Math.min(250, Math.max(0, sample.totalMs));
    const submitMs = Math.min(250, Math.max(0, sample.submitMs));
    const frameCost = Math.max(frameMs, totalMs);
    this.frameMsEma += (frameCost - this.frameMsEma) * 0.08;
    this.submitMsEma += (submitMs - this.submitMsEma) * 0.12;

    if (!this.enabled) {
      this.mode = 'disabled';
      this.reason = 'disabled';
      this.pressure = 0;
      return this.state();
    }

    const minRenderScale = Math.min(sample.maxRenderScale, Math.max(0.5, sample.minRenderScale));
    const maxRenderScale = Math.max(minRenderScale, Math.min(1, sample.maxRenderScale));
    this.levels.resolution = Math.min(maxRenderScale, Math.max(minRenderScale, this.levels.resolution));

    if (this.cooldownSeconds > 0) {
      this.cooldownSeconds = Math.max(0, this.cooldownSeconds - sample.dt);
    }

    const framePressure = Math.max(
      positiveRatio(this.frameMsEma, this.budget.dropFrameMs),
      positiveRatio(totalMs, this.budget.dropFrameMs),
    );
    const submitPressure = Math.max(
      positiveRatio(this.submitMsEma, Math.max(8, this.budget.dropFrameMs * 0.58)),
      positiveRatio(submitMs, Math.max(8, this.budget.dropFrameMs * 0.58)),
    );
    const drawPressure = Math.max(
      positiveRatio(sample.calls, this.caps.targetCalls),
      positiveRatio(sample.triangles, this.caps.targetTriangles),
    );
    const grassPressure = positiveRatio(sample.grassVisibleTufts, this.caps.targetGrassTufts);
    this.pressure = Math.max(framePressure, submitPressure, drawPressure, grassPressure);

    const urgent = frameMs >= this.budget.urgentFrameMs
      || totalMs >= this.budget.urgentFrameMs
      || submitMs >= Math.max(12, this.budget.urgentFrameMs * 0.58)
      || sample.calls >= this.caps.urgentCalls
      || sample.triangles >= this.caps.urgentTriangles
      || sample.grassVisibleTufts >= this.caps.urgentGrassTufts;
    const overBudget = this.pressure >= 1
      || this.frameMsEma >= this.budget.dropFrameMs
      || totalMs >= this.budget.dropFrameMs
      || submitMs >= Math.max(8, this.budget.dropFrameMs * 0.58);

    if (overBudget && this.cooldownSeconds <= 0) {
      const changed = this.degrade(urgent, minRenderScale);
      if (changed) {
        this.stableSeconds = 0;
        this.mode = 'degrading';
        this.reason = sample.grassVisibleTufts >= this.caps.targetGrassTufts
          ? 'grass'
          : submitPressure >= framePressure && submitPressure >= drawPressure
            ? 'submit'
            : drawPressure >= framePressure
              ? 'draw'
              : 'frame';
        this.cooldownSeconds = urgent ? this.budget.cooldownSeconds * 0.55 : this.budget.cooldownSeconds;
        return this.state();
      }
    }

    const canRecover = this.frameMsEma <= this.budget.recoverFrameMs
      && totalMs <= this.budget.recoverFrameMs
      && submitMs <= Math.max(8, this.budget.recoverFrameMs * 0.7)
      && sample.calls <= this.caps.targetCalls * 0.9
      && sample.triangles <= this.caps.targetTriangles * 0.9
      && sample.grassVisibleTufts <= this.caps.targetGrassTufts * 0.9;

    if (canRecover) {
      this.stableSeconds += sample.dt;
      if (this.stableSeconds >= this.budget.recoverStableSeconds && this.cooldownSeconds <= 0) {
        const changed = this.recover(maxRenderScale);
        if (changed) {
          this.mode = 'recovering';
          this.reason = 'recover';
          this.stableSeconds = 0;
          this.cooldownSeconds = this.budget.cooldownSeconds * 1.5;
          return this.state();
        }
      }
    } else {
      this.stableSeconds = 0;
    }

    this.mode = 'stable';
    this.reason = 'stable';
    return this.state();
  }

  private degrade(urgent: boolean, minRenderScale: number): boolean {
    let changed = false;
    const grassStep = urgent ? 0.16 : 0.1;
    if (this.levels.grass > this.caps.minGrassLevel) {
      this.levels.grass = Math.max(this.caps.minGrassLevel, round2(this.levels.grass - grassStep));
      changed = true;
    }

    const vfxStep = urgent ? 0.12 : 0.07;
    const grassDone = this.levels.grass <= this.caps.minGrassLevel + 0.001;
    if ((urgent || grassDone) && this.levels.vfx > this.caps.minVfxLevel) {
      this.levels.vfx = Math.max(this.caps.minVfxLevel, round2(this.levels.vfx - vfxStep));
      changed = true;
    }

    const resolutionStep = urgent ? this.budget.urgentDropStep : this.budget.dropStep;
    const vfxDone = this.levels.vfx <= this.caps.minVfxLevel + 0.001;
    if ((urgent || (grassDone && vfxDone)) && this.levels.resolution > minRenderScale) {
      this.levels.resolution = Math.max(minRenderScale, round2(this.levels.resolution - resolutionStep));
      changed = true;
    }
    return changed;
  }

  private recover(maxRenderScale: number): boolean {
    if (this.levels.resolution < maxRenderScale) {
      this.levels.resolution = Math.min(maxRenderScale, round2(this.levels.resolution + this.budget.recoverStep));
      return true;
    }
    if (this.levels.vfx < 1) {
      this.levels.vfx = Math.min(1, round2(this.levels.vfx + 0.05));
      return true;
    }
    if (this.levels.grass < 1) {
      this.levels.grass = Math.min(1, round2(this.levels.grass + 0.05));
      return true;
    }
    return false;
  }
}
