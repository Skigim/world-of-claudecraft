import { describe, expect, it } from 'vitest';
import {
  manifestUrls,
  manifestUrlsForGraphics,
  visibleAttachmentsForGraphics,
  VISUALS,
} from '../src/render/characters/manifest';

describe('character visual manifest', () => {
  it('uses the custom boar death clip without relying on a speed override', () => {
    expect(VISUALS.mob_boar.clips.death).toBe('Dying');
    expect(VISUALS.mob_boar.deathTimeScale).toBeUndefined();
  });

  it('keeps held weapons and props available on low graphics', () => {
    const allWeaponUrls = manifestUrls().filter((url) => url.startsWith('models/weapons/'));
    expect(allWeaponUrls.length).toBeGreaterThan(0);
    expect(manifestUrlsForGraphics(false)).toEqual(expect.arrayContaining(allWeaponUrls));
    expect(visibleAttachmentsForGraphics(VISUALS.player_warrior).map((a) => a.url))
      .toContain('models/weapons/sword_1handed.glb');
    expect(visibleAttachmentsForGraphics(VISUALS.player_rogue).map((a) => a.url))
      .toEqual(['models/weapons/dagger.glb', 'models/weapons/dagger.glb']);
  });
});
