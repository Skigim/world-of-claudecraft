import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import { RenderBudgetGovernor, type RenderBudgetSample } from '../src/render/render_budget';

function sample(overrides: Partial<RenderBudgetSample> = {}): RenderBudgetSample {
  return {
    dt: 1,
    frameMs: 16,
    totalMs: 16,
    submitMs: 5,
    calls: 150,
    triangles: 250000,
    grassVisibleTufts: 900,
    grassVisibleChunks: 8,
    activeViews: 25,
    createdViews: 0,
    minRenderScale: 0.65,
    maxRenderScale: 1,
    ...overrides,
  };
}

describe('render budget governor', () => {
  it('leaves all scalers at full quality when disabled', () => {
    const governor = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled: false });
    governor.reset(1, 0.65, 1);

    const state = governor.update(sample({
      frameMs: 80,
      totalMs: 80,
      submitMs: 60,
      calls: 900,
      triangles: 2_000_000,
      grassVisibleTufts: 6_000,
    }));

    expect(state.mode).toBe('disabled');
    expect(state.levels).toEqual({ grass: 1, vfx: 1, resolution: 1 });
  });

  it('reduces grass first for non-urgent foliage pressure', () => {
    const governor = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled: true });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    const state = governor.update(sample({
      frameMs: 24,
      totalMs: 24,
      submitMs: 8,
      calls: 260,
      triangles: 500_000,
      grassVisibleTufts: 2_000,
    }));

    expect(state.mode).toBe('degrading');
    expect(state.reason).toBe('grass');
    expect(state.levels.grass).toBeLessThan(1);
    expect(state.levels.vfx).toBe(1);
    expect(state.levels.resolution).toBe(1);
  });

  it('drops resolution on urgent submit pressure', () => {
    const governor = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled: true });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    const state = governor.update(sample({
      frameMs: 72,
      totalMs: 72,
      submitMs: 55,
      calls: 500,
      triangles: 1_400_000,
      grassVisibleTufts: 3_000,
    }));

    expect(state.mode).toBe('degrading');
    expect(state.levels.grass).toBeLessThan(1);
    expect(state.levels.vfx).toBeLessThan(1);
    expect(state.levels.resolution).toBeLessThan(1);
  });

  it('does not reduce resolution below the runtime floor', () => {
    const governor = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled: true });
    governor.reset(0.7, 0.65, 1);

    let state = governor.update(sample({ dt: 0.6 }));
    for (let i = 0; i < 12; i++) {
      state = governor.update(sample({
        dt: 2,
        frameMs: 90,
        totalMs: 90,
        submitMs: 65,
        calls: 900,
        triangles: 2_200_000,
        grassVisibleTufts: 6_500,
      }));
    }

    expect(state.levels.resolution).toBeGreaterThanOrEqual(0.65);
  });

  it('recovers slowly after sustained stable frames', () => {
    const governor = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled: true });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));
    let state = governor.update(sample({
      frameMs: 80,
      totalMs: 80,
      submitMs: 55,
      calls: 600,
      triangles: 1_500_000,
      grassVisibleTufts: 4_000,
    }));
    const degradedResolution = state.levels.resolution;

    for (let i = 0; i < 12; i++) {
      state = governor.update(sample({
        dt: 1,
        frameMs: 13,
        totalMs: 13,
        submitMs: 4,
        calls: 100,
        triangles: 150_000,
        grassVisibleTufts: 500,
      }));
    }

    expect(state.levels.resolution).toBeGreaterThanOrEqual(degradedResolution);
    expect(state.levels.grass).toBeLessThanOrEqual(1);
  });
});
