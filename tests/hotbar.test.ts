import { describe, expect, it } from 'vitest';
import { placeAbilityOnSlot } from '../src/ui/hotbar';

describe('hotbar ability placement', () => {
  it('places a spellbook ability onto the target action slot', () => {
    const slots = ['fireball', 'frost_armor', 'arcane_intellect', null];

    const next = placeAbilityOnSlot(slots, 'polymorph', 1);

    expect(next).toEqual(['fireball', 'polymorph', 'arcane_intellect', null]);
    expect(slots).toEqual(['fireball', 'frost_armor', 'arcane_intellect', null]);
  });

  it('swaps instead of duplicating when the spellbook ability is already on the bar', () => {
    const slots = ['fireball', 'frost_armor', 'arcane_intellect', null];

    const next = placeAbilityOnSlot(slots, 'arcane_intellect', 0);

    expect(next).toEqual(['arcane_intellect', 'frost_armor', 'fireball', null]);
  });
});
