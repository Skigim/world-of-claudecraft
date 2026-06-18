import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  configureMaskedDoubleSidedVegetationMaterial,
  forcedTierFromSearch, graphicsPresetLabel, isConstrainedBrowser, isWeakIntegratedGpu,
  shouldUseAutoGovernor, tierFromHints, GFX_BUDGETS, type GfxRuntimeHints,
} from '../src/render/gfx';

const desktop: GfxRuntimeHints = {
  search: '',
  maxTouchPoints: 0,
  coarsePointer: false,
  narrowViewport: false,
};

describe('graphics tier resolution', () => {
  it('honors explicit URL tier overrides', () => {
    expect(forcedTierFromSearch('?lowgfx')).toBe('low');
    expect(forcedTierFromSearch('?gfx=low')).toBe('low');
    expect(forcedTierFromSearch('?gfx=medium')).toBe('medium');
    expect(forcedTierFromSearch('?gfx=high')).toBe('high');
    expect(forcedTierFromSearch('?gfx=ultra')).toBe('ultra');
    expect(forcedTierFromSearch('?gfx=banana')).toBe(null);
  });

  it('treats phone-class and low-memory browsers as constrained', () => {
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1, coarsePointer: true })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1, narrowViewport: true })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, deviceMemory: 4 })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1 })).toBe(false);
    expect(isConstrainedBrowser(desktop)).toBe(false);
  });

  it('drops automatic constrained and software sessions to low while preserving forced high', () => {
    expect(tierFromHints(desktop, false)).toBe('high');
    expect(tierFromHints(desktop, true)).toBe('low');
    expect(tierFromHints({ ...desktop, maxTouchPoints: 1, coarsePointer: true }, false)).toBe('low');
    expect(tierFromHints({ ...desktop, search: '?gfx=high', maxTouchPoints: 1, coarsePointer: true }, false)).toBe('high');
    expect(tierFromHints({ ...desktop, search: '?gfx=ultra' }, true)).toBe('ultra');
  });

  it('honors persisted presets when the URL does not force a tier', () => {
    expect(tierFromHints({ ...desktop, graphicsPreset: 1 }, false)).toBe('low');
    expect(tierFromHints({ ...desktop, graphicsPreset: 2 }, false)).toBe('medium');
    expect(tierFromHints({ ...desktop, graphicsPreset: 3 }, false)).toBe('high');
    expect(tierFromHints({ ...desktop, graphicsPreset: 4 }, false)).toBe('ultra');
    expect(tierFromHints({ ...desktop, graphicsPreset: 5 }, false)).toBe('high');
    expect(tierFromHints({ ...desktop, search: '?gfx=low', graphicsPreset: 3 }, false)).toBe('low');
  });

  it('labels presets and runs the budget governor unless Ultra or URL-forced', () => {
    expect(graphicsPresetLabel(undefined)).toBe('auto');
    expect(graphicsPresetLabel(1)).toBe('low');
    expect(graphicsPresetLabel(2)).toBe('medium');
    expect(graphicsPresetLabel(3)).toBe('high');
    expect(graphicsPresetLabel(4)).toBe('ultra');
    expect(graphicsPresetLabel(5)).toBe('advanced');
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 0 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: undefined })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 1 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 2 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 3 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 4 })).toBe(false);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 5 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '?gfx=low', graphicsPreset: 0 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '?gfx=high', graphicsPreset: 0 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '?gfx=ultra', graphicsPreset: 4 })).toBe(false);
    expect(shouldUseAutoGovernor({ search: '?governor=0', graphicsPreset: 1 })).toBe(false);
  });

  it('keeps every quality tier bounded by explicit runtime budgets', () => {
    for (const [tier, budget] of Object.entries(GFX_BUDGETS)) {
      expect(budget.targetFps).toBeGreaterThanOrEqual(30);
      expect(budget.maxRenderScale).toBeLessThanOrEqual(1);
      expect(budget.minRenderScaleDesktop).toBeGreaterThanOrEqual(0.5);
      expect(budget.minRenderScaleMobile).toBeGreaterThanOrEqual(0.5);
      expect(budget.dropFrameMs).toBeLessThan(budget.urgentFrameMs);
      expect(budget.recoverFrameMs).toBeLessThan(budget.dropFrameMs);
      expect(tier).toMatch(/^(low|medium|high|ultra)$/);
    }
  });

  it('treats older Intel integrated GPUs as constrained in auto mode', () => {
    expect(isWeakIntegratedGpu('ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics 655)')).toBe(true);
    expect(isWeakIntegratedGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M2)')).toBe(false);
    expect(tierFromHints({ ...desktop, gpuRenderer: 'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655)' }, false)).toBe('low');
  });

  it('keeps masked double-sided vegetation off the transparent blended path', () => {
    const mat = configureMaskedDoubleSidedVegetationMaterial(new THREE.MeshBasicMaterial({
      alphaTest: 0.3,
      transparent: true,
    }));

    expect(mat.alphaTest).toBe(0.3);
    expect(mat.side).toBe(THREE.DoubleSide);
    expect(mat.transparent).toBe(false);
    expect(mat.forceSinglePass).toBe(true);
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(true);
  });
});
