import { describe, expect, it } from 'vitest';
import {
  parseHotbarActions, placeAbilityOnSlot, placeItemOnSlot, syncHotbarActions,
} from '../src/ui/hotbar';

const abilityIds = new Set(['fireball', 'frost_armor', 'arcane_intellect', 'polymorph', 'shared_id']);
const itemIds = new Set(['baked_bread', 'spring_water', 'shared_id']);
const abilityExists = (id: string) => abilityIds.has(id);
const itemExists = (id: string) => itemIds.has(id);

describe('hotbar action parsing', () => {
  it('migrates legacy ability strings and drops duplicate abilities', () => {
    const actions = parseHotbarActions(
      ['fireball', 'frost_armor', 'fireball', 'baked_bread'],
      5,
      abilityExists,
      itemExists,
    );

    expect(actions).toEqual([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'frost_armor' },
      null,
      null,
      null,
    ]);
  });

  it('keeps item and ability actions distinct even when ids overlap', () => {
    const actions = parseHotbarActions(
      [{ type: 'ability', id: 'shared_id' }, { type: 'item', id: 'shared_id' }],
      2,
      abilityExists,
      itemExists,
    );

    expect(actions).toEqual([
      { type: 'ability', id: 'shared_id' },
      { type: 'item', id: 'shared_id' },
    ]);
  });
});

describe('hotbar action placement', () => {
  it('places a spellbook ability onto the target action slot', () => {
    const slots = [
      { type: 'ability' as const, id: 'fireball' },
      { type: 'ability' as const, id: 'frost_armor' },
      { type: 'ability' as const, id: 'arcane_intellect' },
      null,
    ];

    const next = placeAbilityOnSlot(slots, 'polymorph', 1);

    expect(next).toEqual([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'polymorph' },
      { type: 'ability', id: 'arcane_intellect' },
      null,
    ]);
    expect(slots).toEqual([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'frost_armor' },
      { type: 'ability', id: 'arcane_intellect' },
      null,
    ]);
  });

  it('swaps instead of duplicating when the spellbook ability is already on the bar', () => {
    const slots = [
      { type: 'ability' as const, id: 'fireball' },
      { type: 'ability' as const, id: 'frost_armor' },
      { type: 'ability' as const, id: 'arcane_intellect' },
      null,
    ];

    const next = placeAbilityOnSlot(slots, 'arcane_intellect', 0);

    expect(next).toEqual([
      { type: 'ability', id: 'arcane_intellect' },
      { type: 'ability', id: 'frost_armor' },
      { type: 'ability', id: 'fireball' },
      null,
    ]);
  });

  it('places a food item on an occupied action slot without removing other item shortcuts', () => {
    const slots = [
      { type: 'item' as const, id: 'baked_bread' },
      { type: 'ability' as const, id: 'fireball' },
      null,
    ];

    const next = placeItemOnSlot(slots, 'baked_bread', 1);

    expect(next).toEqual([
      { type: 'item', id: 'baked_bread' },
      { type: 'item', id: 'baked_bread' },
      null,
    ]);
  });

  it('keeps item shortcuts when learned abilities resync', () => {
    const slots = [
      { type: 'item' as const, id: 'spring_water' },
      { type: 'ability' as const, id: 'fireball' },
      null,
    ];

    const synced = syncHotbarActions(slots, ['fireball', 'polymorph']);

    expect(synced.actions).toEqual([
      { type: 'item', id: 'spring_water' },
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'polymorph' },
    ]);
    expect(synced.changed).toBe(true);
  });
});
