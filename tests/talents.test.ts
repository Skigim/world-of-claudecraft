import { describe, expect, it } from 'vitest';
import {
  TALENTS, talentsFor, validateTalentTree, talentPointsAtLevel, FIRST_TALENT_LEVEL,
  validateAllocation, dormantNodes, computeTalentModifiers, emptyAllocation,
  exportBuild, importBuild, TALENT_BUILD_VERSION, MAX_LOADOUTS, type TalentAllocation,
} from '../src/sim/content/talents';
import { MAX_LEVEL, dist2d } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { terrainHeight } from '../src/sim/world';

const alloc = (over: Partial<TalentAllocation> = {}): TalentAllocation => ({ ...emptyAllocation(), ...over });

function warriorAtCap(seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior' });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function nearestMob(sim: Sim) {
  let best: any = null, bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

const effOf = (k: any, i = 0) => k.effects[i] as any;

describe('talent tree validation (load-time)', () => {
  it('every registered tree is structurally valid', () => {
    for (const ct of Object.values(TALENTS)) {
      expect(ct).toBeTruthy();
      expect(validateTalentTree(ct!)).toEqual([]);
    }
  });

  it('detects cycles in the requires graph', () => {
    const broken = {
      class: 'warrior' as const,
      specs: talentsFor('warrior')!.specs,
      nodes: [
        { id: 'a', tree: 'class' as const, kind: 'passive' as const, maxRank: 1, requires: ['b'], effect: {}, icon: '', name: 'A', description: '', row: 1, col: 0 },
        { id: 'b', tree: 'class' as const, kind: 'passive' as const, maxRank: 1, requires: ['a'], effect: {}, icon: '', name: 'B', description: '', row: 0, col: 0 },
      ],
    };
    expect(validateTalentTree(broken).some((e) => e.includes('cycle') || e.includes('not above'))).toBe(true);
  });

  it('flags prereqs that reference a missing node', () => {
    const broken = {
      class: 'warrior' as const,
      specs: talentsFor('warrior')!.specs,
      nodes: [
        { id: 'a', tree: 'class' as const, kind: 'passive' as const, maxRank: 1, requires: ['ghost'], effect: {}, icon: '', name: 'A', description: '', row: 1, col: 0 },
      ],
    };
    expect(validateTalentTree(broken).some((e) => e.includes('missing node'))).toBe(true);
  });
});

describe('point economy', () => {
  it('grants no points before the first talent level', () => {
    expect(talentPointsAtLevel(FIRST_TALENT_LEVEL - 1)).toBe(0);
    expect(talentPointsAtLevel(1)).toBe(0);
  });
  it('grants one point per level from the first talent level, 11 at cap', () => {
    expect(talentPointsAtLevel(FIRST_TALENT_LEVEL)).toBe(1);
    expect(talentPointsAtLevel(MAX_LEVEL)).toBe(MAX_LEVEL - FIRST_TALENT_LEVEL + 1);
    expect(talentPointsAtLevel(MAX_LEVEL)).toBe(11);
  });
});

describe('allocation rules (server-validated)', () => {
  it('accepts a simple in-budget allocation', () => {
    const a = alloc({ ranks: { war_toughness: 3, war_cruelty: 2 } });
    expect(validateAllocation('warrior', a, 11).ok).toBe(true);
  });

  it('rejects exceeding max rank', () => {
    const a = alloc({ ranks: { war_toughness: 4 } });
    expect(validateAllocation('warrior', a, 11)).toMatchObject({ ok: false });
  });

  it('rejects exceeding the point budget', () => {
    const a = alloc({ ranks: { war_toughness: 3, war_cruelty: 3 } });
    expect(validateAllocation('warrior', a, 5)).toMatchObject({ ok: false });
  });

  it('enforces connection prerequisites', () => {
    // war_imp_heroic_strike requires war_toughness
    const noPrereq = alloc({ ranks: { war_imp_heroic_strike: 1, war_cruelty: 1 } });
    expect(validateAllocation('warrior', noPrereq, 11).ok).toBe(false);
    const withPrereq = alloc({ ranks: { war_toughness: 1, war_imp_heroic_strike: 1 } });
    expect(validateAllocation('warrior', withPrereq, 11).ok).toBe(true);
  });

  it('enforces the cumulative points gate', () => {
    // war_tactical_choice needs 5 points spent above its row; with only 2 it fails
    const tooShallow = alloc({ ranks: { war_toughness: 2, war_tactical_choice: 1 }, choices: { war_tactical_choice: 'tc_cruelty' } });
    expect(validateAllocation('warrior', tooShallow, 11).ok).toBe(false);
    const deep = alloc({ ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 }, choices: { war_tactical_choice: 'tc_cruelty' } });
    expect(validateAllocation('warrior', deep, 11).ok).toBe(true);
  });

  it('requires a valid choice for choice nodes', () => {
    const noChoice = alloc({ ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 } });
    expect(validateAllocation('warrior', noChoice, 11).ok).toBe(false);
    const badChoice = alloc({ ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 }, choices: { war_tactical_choice: 'nope' } });
    expect(validateAllocation('warrior', badChoice, 11).ok).toBe(false);
  });

  it('rejects spec-tree points without the matching spec', () => {
    const a = alloc({ spec: null, ranks: { arms_imp_overpower: 1 } });
    expect(validateAllocation('warrior', a, 11).ok).toBe(false);
    const b = alloc({ spec: 'fury', ranks: { arms_imp_overpower: 1 } });
    expect(validateAllocation('warrior', b, 11).ok).toBe(false);
    const c = alloc({ spec: 'arms', ranks: { arms_imp_overpower: 1 } });
    expect(validateAllocation('warrior', c, 11).ok).toBe(true);
  });
});

describe('dormant-not-destroyed dependents', () => {
  it('marks a dependent dormant when its prereq is refunded, keeping its ranks', () => {
    const built = alloc({ ranks: { war_toughness: 1, war_imp_heroic_strike: 2 } });
    expect(dormantNodes('warrior', built).size).toBe(0);
    // refund the upstream node (war_toughness) but keep the dependent's ranks
    const refunded = alloc({ ranks: { war_imp_heroic_strike: 2 } });
    const dormant = dormantNodes('warrior', refunded);
    expect(dormant.has('war_imp_heroic_strike')).toBe(true);
    expect(refunded.ranks.war_imp_heroic_strike).toBe(2); // not destroyed
    // re-adding the prereq clears dormancy
    const restored = alloc({ ranks: { war_toughness: 1, war_imp_heroic_strike: 2 } });
    expect(dormantNodes('warrior', restored).has('war_imp_heroic_strike')).toBe(false);
  });

  it('precompute ignores dormant spec nodes (wrong spec)', () => {
    const mods = computeTalentModifiers('warrior', alloc({ spec: 'fury', ranks: { arms_imp_overpower: 2 } }));
    expect(mods.abilities.overpower).toBeUndefined();
  });
});

describe('precomputed modifiers', () => {
  it('folds passive stat ranks into a flat struct', () => {
    const mods = computeTalentModifiers('warrior', alloc({ ranks: { war_toughness: 3, war_cruelty: 2 } }));
    expect(mods.stats.armorPct).toBeCloseTo(0.12); // 0.04 * 3
    expect(mods.stats.crit).toBeCloseTo(0.02);     // 0.01 * 2
  });

  it('applies the chosen option of a choice node only', () => {
    const base = alloc({ ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 }, choices: { war_tactical_choice: 'tc_bladed_armor' } });
    const mods = computeTalentModifiers('warrior', base);
    expect(mods.stats.apPct).toBeCloseTo(0.12);
    expect(mods.stats.dodge).toBe(0); // the dodge option was not chosen
  });

  it('grants the spec signature ability + mastery when a spec is chosen', () => {
    const mods = computeTalentModifiers('warrior', alloc({ spec: 'arms' }));
    expect(mods.spec).toBe('arms');
    expect(mods.role).toBe('dps');
    expect(mods.grants.some((g) => g.ability === 'mortal_strike')).toBe(true);
    expect(mods.global.meleeDmgPct).toBeCloseTo(0.10); // Sharpened Blades mastery
  });

  it('accumulates per-ability modifiers across ranks', () => {
    const mods = computeTalentModifiers('warrior', alloc({ spec: 'arms', ranks: { arms_imp_overpower: 2 } }));
    expect(mods.abilities.overpower.dmgPct).toBeCloseTo(0.50); // 0.25 * 2
  });
});

describe('build strings (import/export)', () => {
  it('round-trips an allocation exactly', () => {
    const a = alloc({ spec: 'prot', ranks: { prot_toughness: 3, prot_choice: 1 }, choices: { prot_choice: 'pc_last_stand' } });
    const str = exportBuild('warrior', a);
    const imported = importBuild(str);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.cls).toBe('warrior');
      expect(imported.alloc).toEqual(a);
    }
  });

  it('rejects a malformed string', () => {
    expect(importBuild('not-base64-$$$').ok).toBe(false);
    expect(importBuild('').ok).toBe(false);
  });

  it('rejects a version-mismatched string', () => {
    const a = alloc({ spec: 'arms', ranks: { arms_imp_overpower: 1 } });
    const good = exportBuild('warrior', a);
    // hand-craft a payload with a future version
    const future = Buffer.from(JSON.stringify({ v: TALENT_BUILD_VERSION + 1, c: 'warrior', s: 'arms', r: {}, h: {} })).toString('base64');
    expect(importBuild(future)).toMatchObject({ ok: false });
    expect(importBuild(good).ok).toBe(true); // sanity: the current version still imports
  });
});

describe('Sim integration — passive talents (Phase 1)', () => {
  it('applies a passive stat talent through recalcPlayerStats and reverts on respec', () => {
    const sim = warriorAtCap();
    const critBefore = sim.player.critChance;
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 3 } }))).toBe(true);
    expect(sim.player.critChance).toBeCloseTo(critBefore + 0.03); // +1% per rank
    expect(sim.respec()).toBe(true);
    expect(sim.player.critChance).toBeCloseTo(critBefore); // clean revert
    expect(sim.talentPoints().spent).toBe(0);
  });

  it('applies an armor-percent talent multiplicatively', () => {
    const sim = warriorAtCap();
    const armorBefore = sim.player.stats.armor;
    expect(sim.applyTalents(alloc({ ranks: { war_toughness: 3 } }))).toBe(true); // +12% armor
    expect(sim.player.stats.armor).toBeCloseTo(Math.round(armorBefore * 1.12), 0);
  });

  it('rejects an over-budget allocation server-side', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(10); // exactly 1 point
    expect(sim.talentPoints().total).toBe(1);
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 3 } }))).toBe(false);
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 1 } }))).toBe(true);
  });

  it('locks respec/allocation in combat', () => {
    const sim = warriorAtCap();
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 2 } }))).toBe(true);
    sim.player.inCombat = true;
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 3 } }))).toBe(false);
    expect(sim.respec()).toBe(false);
    expect(sim.talentPoints().spent).toBe(2); // unchanged
  });

  it('persists talents across serialize -> addPlayer (JSONB round-trip, no migration)', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms', ranks: { war_cruelty: 2, arms_imp_overpower: 2 } }));
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.talents).toBeTruthy();

    const sim2 = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Reloaded', { state });
    const meta = sim2.meta(pid)!;
    expect(meta.talents.spec).toBe('arms');
    expect(meta.talents.ranks.war_cruelty).toBe(2);
    expect(meta.talents.ranks.arms_imp_overpower).toBe(2);
    // and the precomputed struct is rebuilt on load
    expect(meta.talentMods.abilities.overpower.dmgPct).toBeCloseTo(0.5);
  });

  it('switching spec prunes the old spec tree but keeps the class tree', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms', ranks: { war_cruelty: 2, arms_imp_overpower: 2 } }));
    expect(sim.setSpec('fury')).toBe(true);
    const meta = sim.meta(sim.playerId)!;
    expect(meta.talents.spec).toBe('fury');
    expect(meta.talents.ranks.arms_imp_overpower).toBeUndefined(); // pruned
    expect(meta.talents.ranks.war_cruelty).toBe(2); // class tree kept
  });
});

describe('Sim integration — active talents & ability modifiers (Phase 3)', () => {
  it('grants spec signature + active-node abilities into the known set', () => {
    const sim = warriorAtCap();
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(false);
    expect(sim.applyTalents(alloc({ spec: 'arms' }))).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(true); // Arms signature

    // Fury whirlwind is an active node (gate: 2 points above row 1 -> fury_cruelty 2)
    expect(sim.applyTalents(alloc({ spec: 'fury', ranks: { fury_cruelty: 2, fury_whirlwind: 1 } }))).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'whirlwind')).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'bloodthirst')).toBe(true);  // Fury signature
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(false); // Arms signature gone
  });

  it('gates specialization choice to the first talent level', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(5);
    expect(sim.setSpec('arms')).toBe(false);
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(false);
  });

  it('snapshot-locks Overpower damage before/after Improved Overpower (+ Arms mastery)', () => {
    const baseBonus = effOf(abilitiesKnownAt('warrior', 20).find((k) => k.def.id === 'overpower')).bonus;
    const mods = computeTalentModifiers('warrior', alloc({ spec: 'arms', ranks: { arms_imp_overpower: 2 } }));
    const buffed = effOf(abilitiesKnownAt('warrior', 20, mods).find((k) => k.def.id === 'overpower')).bonus;
    // Arms mastery (+10% melee) + Improved Overpower r2 (+50%) => x1.60
    expect(buffed).toBe(Math.round(baseBonus * 1.6));
    expect(buffed).toBeGreaterThan(baseBonus);
    // shared content data must NOT be mutated by the modifier pass
    const baseAgain = effOf(abilitiesKnownAt('warrior', 20).find((k) => k.def.id === 'overpower')).bonus;
    expect(baseAgain).toBe(baseBonus);
  });

  it('snapshot-locks Heroic Strike cost before/after Improved Heroic Strike', () => {
    const baseCost = abilitiesKnownAt('warrior', 20).find((k) => k.def.id === 'heroic_strike')!.cost;
    const mods = computeTalentModifiers('warrior', alloc({ ranks: { war_toughness: 1, war_imp_heroic_strike: 2 } }));
    const cost = abilitiesKnownAt('warrior', 20, mods).find((k) => k.def.id === 'heroic_strike')!.cost;
    expect(cost).toBe(Math.round(baseCost * 0.8)); // -20%
  });

  it('applies cooldown and cast-time modifiers', () => {
    const taunt = abilitiesKnownAt('warrior', 20, computeTalentModifiers('warrior',
      alloc({ spec: 'prot', ranks: { prot_choice: 1 }, choices: { prot_choice: 'pc_imp_taunt' } }))
    ).find((k) => k.def.id === 'taunt')!;
    expect(taunt.cooldown).toBeCloseTo(10 * 0.8); // Improved Taunt -20% -> 8s

    const slam = abilitiesKnownAt('warrior', 20, computeTalentModifiers('warrior',
      alloc({ spec: 'arms', ranks: { arms_imp_slam: 2 } }))
    ).find((k) => k.def.id === 'slam')!;
    expect(slam.castTime).toBeCloseTo(1.5 * 0.5); // Improved Slam r2 -50% -> 0.75s
  });

  it('a choice node applies only the chosen option ability mod', () => {
    const baseMin = effOf(abilitiesKnownAt('warrior', 20).find((k) => k.def.id === 'cleave')).min;
    const sweeping = effOf(abilitiesKnownAt('warrior', 20, computeTalentModifiers('warrior',
      alloc({ spec: 'arms', ranks: { arms_choice: 1 }, choices: { arms_choice: 'ac_sweeping' } }))
    ).find((k) => k.def.id === 'cleave')).min;
    const impale = effOf(abilitiesKnownAt('warrior', 20, computeTalentModifiers('warrior',
      alloc({ spec: 'arms', ranks: { arms_choice: 1 }, choices: { arms_choice: 'ac_impale' } }))
    ).find((k) => k.def.id === 'cleave')).min;
    expect(sweeping).toBe(Math.round(baseMin * 1.4)); // arms mastery .10 + sweeping .30
    expect(impale).toBe(Math.round(baseMin * 1.1));   // arms mastery only; impale is crit
  });

  it('tank-role Vengeance Mastery multiplies generated threat (+30%)', () => {
    const sunderThreat = (vengeance: boolean): number => {
      const sim = new Sim({ seed: 3, playerClass: 'warrior' });
      sim.setPlayerLevel(20);
      if (vengeance) expect(sim.setSpec('prot')).toBe(true); // grants Vengeance (+30% threat)
      const mob = nearestMob(sim);
      sim.player.pos.x = mob.pos.x;
      sim.player.pos.z = mob.pos.z - 3;
      sim.player.pos.y = terrainHeight(sim.player.pos.x, sim.player.pos.z, sim.cfg.seed);
      sim.player.facing = Math.atan2(mob.pos.x - sim.player.pos.x, mob.pos.z - sim.player.pos.z);
      sim.player.resource = 100;
      sim.targetEntity(mob.id);
      sim.castAbility('sunder_armor');
      return mob.threat.get(sim.playerId) ?? 0;
    };
    const base = sunderThreat(false);
    const venge = sunderThreat(true);
    expect(base).toBeGreaterThan(0);
    // ~+30% (a tiny constant "seed" threat on combat entry isn't multiplied, so
    // assert the band rather than the exact ratio): clearly boosted, not doubled.
    expect(venge / base).toBeGreaterThan(1.25);
    expect(venge / base).toBeLessThan(1.31);
  });
});

describe('Sim integration — loadouts & build strings (Phase 4)', () => {
  it('saves and switches loadouts, restoring talents + spec + bar', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms', ranks: { arms_imp_overpower: 2 } }));
    expect(sim.saveLoadout('Arms PvE', ['mortal_strike', 'overpower', null])).toBe(0);
    sim.applyTalents(alloc({ spec: 'prot', ranks: { prot_toughness: 3 } }));
    expect(sim.saveLoadout('Prot Tank', ['shield_slam', 'taunt'])).toBe(1);
    expect(sim.loadouts.length).toBe(2);

    expect(sim.switchLoadout(0)).toBe(true);
    expect(sim.talents.spec).toBe('arms');
    expect(sim.talents.ranks.arms_imp_overpower).toBe(2);
    expect(sim.talentSpec).toBe('arms');
    expect(sim.activeLoadout).toBe(0);
    expect(sim.loadouts[0].bar).toEqual(['mortal_strike', 'overpower', null]); // action bar travels with the build
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(true);     // restored spec granted its signature
  });

  it('locks loadout switching in combat', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms' }));
    sim.saveLoadout('A', []);
    sim.player.inCombat = true;
    expect(sim.switchLoadout(0)).toBe(false);
  });

  it('deletes a loadout and repairs the active index', () => {
    const sim = warriorAtCap();
    sim.saveLoadout('one', []);
    sim.saveLoadout('two', []);
    expect(sim.deleteLoadout(0)).toBe(true);
    expect(sim.loadouts.length).toBe(1);
    expect(sim.loadouts[0].name).toBe('two');
  });

  it('caps loadouts at MAX_LOADOUTS', () => {
    const sim = warriorAtCap();
    for (let i = 0; i < MAX_LOADOUTS; i++) expect(sim.saveLoadout('L' + i, [])).toBe(i);
    expect(sim.saveLoadout('overflow', [])).toBe(-1);
  });

  it('imports a build string and re-validates it server-side on apply', () => {
    const author = warriorAtCap();
    author.applyTalents(alloc({ spec: 'prot', ranks: { prot_toughness: 3, prot_anticipation: 2 } }));
    const str = exportBuild('warrior', author.talents);

    const target = warriorAtCap(11);
    const imported = importBuild(str);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(target.applyTalents(imported.alloc)).toBe(true);
    expect(target.talents.spec).toBe('prot');
    expect(target.talents.ranks.prot_toughness).toBe(3);

    // the SAME build is rejected for a character without the points (server-side)
    const lowbie = new Sim({ seed: 5, playerClass: 'warrior' });
    lowbie.setPlayerLevel(10); // only 1 point
    expect(lowbie.applyTalents(imported.ok ? imported.alloc : alloc())).toBe(false);
  });
});
