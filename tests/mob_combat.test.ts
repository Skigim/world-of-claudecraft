import { describe, expect, it } from "vitest";
import {
	combatProfileForMob,
	DEFAULT_MOB_COMBAT_PROFILE,
	effectiveMobMeleeRange,
	NYTHRAXIS_ADD_COMBAT_PROFILE,
	NYTHRAXIS_BOSS_COMBAT_PROFILE,
	scaledDefaultMobMeleeRange,
} from "../src/sim/mob_combat";
import { Sim } from "../src/sim/sim";
import type { Entity } from "../src/sim/types";
import { DT, dist2d, MELEE_RANGE } from "../src/sim/types";

function wildMobs(sim: Sim): Entity[] {
	return [...sim.entities.values()].filter(
		(e) => e.kind === "mob" && !e.dead && e.ownerId === null,
	);
}

describe("mob combat profiles", () => {
	it("keeps ordinary mobs on the scale-based melee range profile without behavior toggles", () => {
		const profile = combatProfileForMob("forest_wolf", 1.5);

		expect(profile).toEqual({
			...DEFAULT_MOB_COMBAT_PROFILE,
			meleeRange: scaledDefaultMobMeleeRange(1.5),
		});
		expect(profile.meleeRange).toBe(MELEE_RANGE + 1.5);
		expect("canLeash" in profile).toBe(false);
		expect("swingWhilePursuing" in profile).toBe(false);
		expect("immediateSwingOnEnterRange" in profile).toBe(false);
	});

	it("gives Nythraxis reach and pursuit tuning without one-off behavior flags", () => {
		expect(combatProfileForMob("nythraxis_scourge_of_thornpeak", 3.1)).toEqual(
			NYTHRAXIS_BOSS_COMBAT_PROFILE,
		);
		expect(NYTHRAXIS_BOSS_COMBAT_PROFILE.meleeRange).toBe(8);
		expect(NYTHRAXIS_BOSS_COMBAT_PROFILE.desiredRange).toBeLessThan(
			NYTHRAXIS_BOSS_COMBAT_PROFILE.meleeRange,
		);
		expect(NYTHRAXIS_BOSS_COMBAT_PROFILE.chaseSpeedMult).toBeGreaterThan(1);
		expect("canLeash" in NYTHRAXIS_BOSS_COMBAT_PROFILE).toBe(false);
	});

	it("gives Nythraxis adds shorter reach while sharing global pursuing combat semantics", () => {
		expect(combatProfileForMob("nythraxis_skeleton_warrior", 1.25)).toEqual(
			NYTHRAXIS_ADD_COMBAT_PROFILE,
		);
		expect(NYTHRAXIS_ADD_COMBAT_PROFILE.meleeRange).toBeLessThan(
			NYTHRAXIS_BOSS_COMBAT_PROFILE.meleeRange,
		);
		expect("swingWhilePursuing" in NYTHRAXIS_ADD_COMBAT_PROFILE).toBe(false);
		expect("immediateSwingOnEnterRange" in NYTHRAXIS_ADD_COMBAT_PROFILE).toBe(
			false,
		);
	});

	it("applies moving-target range grace consistently for all melee profiles", () => {
		expect(
			effectiveMobMeleeRange(DEFAULT_MOB_COMBAT_PROFILE, true, false),
		).toBe(
			DEFAULT_MOB_COMBAT_PROFILE.meleeRange +
				DEFAULT_MOB_COMBAT_PROFILE.movingRangeBonus,
		);
		expect(
			effectiveMobMeleeRange(NYTHRAXIS_BOSS_COMBAT_PROFILE, true, true),
		).toBe(
			NYTHRAXIS_BOSS_COMBAT_PROFILE.meleeRange +
				NYTHRAXIS_BOSS_COMBAT_PROFILE.movingRangeBonus,
		);
	});
});

describe("mob melee pursuit", () => {
	it("lets an ordinary mob swing and continue closing distance in the same tick", () => {
		const sim = new Sim({ seed: 7, playerClass: "warrior", autoEquip: true });
		const mob = wildMobs(sim)[0];
		const player = sim.player;
		const profile = combatProfileForMob(mob.templateId, mob.scale);

		mob.aiState = "chase";
		mob.aggroTargetId = player.id;
		mob.inCombat = true;
		mob.hostile = true;
		mob.swingTimer = 0;
		mob.pos = {
			x: player.pos.x + profile.meleeRange * 0.95,
			z: player.pos.z,
			y: player.pos.y,
		};
		mob.prevPos = { ...mob.pos };
		mob.spawnPos = { ...mob.pos };
		mob.leashAnchor = { ...mob.pos };
		player.prevPos = { ...player.pos };

		const beforeDistance = dist2d(mob.pos, player.pos);
		const events = sim.tick();

		expect(
			events.some(
				(e) =>
					e.type === "damage" &&
					e.sourceId === mob.id &&
					e.targetId === player.id,
			),
		).toBe(true);
		expect(dist2d(mob.pos, player.pos)).toBeLessThanOrEqual(
			beforeDistance - mob.moveSpeed * DT * 0.5,
		);
	});

	it("evades and resets to full health when it cannot make progress toward its target", () => {
		const sim = new Sim({ seed: 7, playerClass: "warrior", autoEquip: true });
		const mob = wildMobs(sim)[0];
		const player = sim.player;

		mob.aiState = "chase";
		mob.aggroTargetId = player.id;
		mob.inCombat = true;
		mob.hostile = true;
		mob.hp = Math.max(1, mob.maxHp - 10);
		mob.pos = { x: player.pos.x + 12, z: player.pos.z, y: player.pos.y };
		mob.prevPos = { ...mob.pos };
		mob.spawnPos = { ...mob.pos };
		mob.leashAnchor = { ...mob.pos };
		player.prevPos = { ...player.pos };

		const inner = sim as unknown as {
			moveToward(
				e: Entity,
				dest: Entity["pos"],
				speed: number,
				ignoreObstacles?: boolean,
			): boolean;
		};
		const realMoveToward = inner.moveToward.bind(sim);
		inner.moveToward = (e, dest, speed, ignoreObstacles) => {
			if (e.id === mob.id && mob.aiState !== "evade") return false;
			return realMoveToward(e, dest, speed, ignoreObstacles);
		};

		for (
			let i = 0;
			i < 80 && sim.entities.get(mob.id)!.aiState !== "evade";
			i++
		)
			sim.tick();
		expect(sim.entities.get(mob.id)!.aiState).toBe("evade");

		sim.tick();

		inner.moveToward = realMoveToward;
		expect(mob.aiState).toBe("idle");
		expect(mob.hp).toBe(mob.maxHp);
	});
});
