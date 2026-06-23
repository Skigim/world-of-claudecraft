// Fleeing is authored per mob/situation. A fleeing mob panics at low HP instead
// of fighting to the death: it runs from its attacker for a few seconds, rallies
// nearby same-allegiance allies, then recovers its nerve. It flees only once per pull.
import { describe, expect, it } from "vitest";
import { MOBS } from "../src/sim/data";
import { Sim } from "../src/sim/sim";
import type { Entity } from "../src/sim/types";
import { DT, dist2d, RUN_SPEED } from "../src/sim/types";

function makeSim() {
	return new Sim({ seed: 42, playerClass: "warrior", autoEquip: true });
}

function wildMobs(sim: Sim): Entity[] {
	return [...sim.entities.values()].filter(
		(e) => e.kind === "mob" && !e.dead && e.ownerId === null,
	);
}

// Put a wild mob into an active fight with the player at low HP, as a chosen template.
function engageLowHp(
	sim: Sim,
	mob: Entity,
	templateId: string,
	hpFrac: number,
) {
	mob.templateId = templateId;
	mob.allegiance = MOBS[templateId]?.allegiance ?? null;
	mob.hostile = true;
	mob.maxHp = 1000;
	mob.hp = Math.round(mob.maxHp * hpFrac);
	mob.auras = [];
	mob.enraged = false;
	mob.hasFled = false;
	mob.fleeTimer = 0;
	mob.fleeReturnTimer = 0;
	mob.pos = {
		x: sim.player.pos.x + 3,
		z: sim.player.pos.z,
		y: sim.player.pos.y,
	};
	mob.prevPos = { ...mob.pos };
	mob.spawnPos = { ...mob.pos };
	mob.leashAnchor = { ...mob.pos };
	mob.aiState = "attack";
	mob.aggroTargetId = sim.playerId;
	mob.inCombat = true;
}

function moveEntityToward(e: Entity, target: Entity, step: number) {
	const dx = target.pos.x - e.pos.x;
	const dz = target.pos.z - e.pos.z;
	const d = Math.hypot(dx, dz);
	if (d <= 0) return;
	const s = Math.min(step, d);
	e.pos.x += (dx / d) * s;
	e.pos.z += (dz / d) * s;
	e.prevPos = { ...e.pos };
}

describe("willFlee mobs flee at low HP", () => {
	it("a low-HP willFlee mob panics and enters the flee state", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		engageLowHp(sim, mob, "gravecaller_cultist", 0.15);

		sim.tick();

		expect(sim.entities.get(mob.id)!.aiState).toBe("flee");
		expect(mob.hasFled).toBe(true);
	});

	it("a healthy willFlee mob stands and fights above the threshold", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		engageLowHp(sim, mob, "gravecaller_cultist", 0.5);

		sim.tick();

		expect(sim.entities.get(mob.id)!.aiState).toBe("attack");
	});

	it("runs AWAY from its attacker while fleeing", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		engageLowHp(sim, mob, "gravecaller_cultist", 0.1);

		const before = dist2d(mob.pos, sim.player.pos);
		for (let i = 0; i < 10; i++) sim.tick();

		expect(mob.aiState === "flee" || mob.hasFled).toBe(true);
		expect(dist2d(mob.pos, sim.player.pos)).toBeGreaterThan(before);
	});

	it("does not flee faster than 90% of normal player run speed", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		engageLowHp(sim, mob, "gravecaller_cultist", 0.1);
		mob.moveSpeed = RUN_SPEED * 2;

		sim.tick();
		expect(mob.aiState).toBe("flee");
		const before = { ...mob.pos };

		sim.tick();

		expect(dist2d(before, mob.pos)).toBeLessThanOrEqual(
			RUN_SPEED * 0.9 * DT + 1e-6,
		);
	});

	it("stays in the pull instead of evade-resetting when the player chases a fleeing mob", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		engageLowHp(sim, mob, "gravecaller_cultist", 0.1);
		mob.moveSpeed = RUN_SPEED * 2;

		sim.tick();
		expect(mob.aiState).toBe("flee");

		for (let i = 0; i < 20 * 6; i++) {
			moveEntityToward(sim.player, mob, RUN_SPEED * DT);
			sim.tick();
			if (mob.aiState === "attack") break;
		}

		expect(mob.aiState).toBe("attack");
		expect(mob.hp).toBeLessThan(mob.maxHp);
		expect(mob.hasFled).toBe(true);
	});

	it("re-engages instead of evade-resetting when fleeing reaches the leash edge", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		engageLowHp(sim, mob, "gravecaller_cultist", 0.1);
		mob.leashAnchor = { x: mob.pos.x - 44.9, z: mob.pos.z, y: mob.pos.y };
		sim.player.pos = { x: mob.pos.x - 20, z: mob.pos.z, y: mob.pos.y };

		sim.tick();
		expect(mob.aiState).toBe("flee");

		sim.tick();

		expect(mob.aiState).toBe("chase");
		expect(mob.hp).toBeLessThan(mob.maxHp);
		expect(mob.hasFled).toBe(true);

		sim.tick();

		expect(mob.aiState).not.toBe("evade");
		expect(mob.hp).toBeLessThan(mob.maxHp);
	});

	it("calls a nearby same-allegiance ally into the fight when it flees", () => {
		const sim = makeSim();
		const mobs = wildMobs(sim);
		const fleer = mobs[0];
		const ally = mobs.find((m) => m.id !== fleer.id)!;
		engageLowHp(sim, fleer, "gravecaller_cultist", 0.12);
		// an idle ally in the same faction standing right next to the fleer
		ally.templateId = "forest_wolf";
		fleer.allegiance = "gravecaller_cult";
		ally.allegiance = "gravecaller_cult";
		ally.hostile = true;
		ally.dead = false;
		ally.aiState = "idle";
		ally.aggroTargetId = null;
		ally.pos = { x: fleer.pos.x + 2, z: fleer.pos.z, y: fleer.pos.y };
		ally.prevPos = { ...ally.pos };

		sim.tick();

		expect(sim.entities.get(ally.id)!.aggroTargetId).toBe(sim.playerId);
		expect(sim.entities.get(ally.id)!.aiState).toBe("chase");
	});

	it("does not call unaffiliated or different-allegiance mobs for help", () => {
		const sim = makeSim();
		const mobs = wildMobs(sim);
		const fleer = mobs[0];
		const bystander = mobs.find((m) => m.id !== fleer.id)!;
		const previousAggression = MOBS.forest_wolf.aggression;
		MOBS.forest_wolf.aggression = "neutral";
		engageLowHp(sim, fleer, "gravecaller_cultist", 0.12);
		fleer.allegiance = "gravecaller_cult";
		bystander.templateId = "forest_wolf";
		bystander.allegiance = null;
		bystander.hostile = true;
		bystander.dead = false;
		bystander.aiState = "idle";
		bystander.aggroTargetId = null;
		bystander.pos = { x: fleer.pos.x + 2, z: fleer.pos.z, y: fleer.pos.y };
		bystander.prevPos = { ...bystander.pos };

		sim.tick();

		expect(sim.entities.get(bystander.id)!.aggroTargetId).toBeNull();
		expect(sim.entities.get(bystander.id)!.aiState).toBe("idle");
		MOBS.forest_wolf.aggression = previousAggression;
	});

	it("recovers its nerve after the flee window and re-engages", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		engageLowHp(sim, mob, "gravecaller_cultist", 0.1);
		// keep the player on top of the mob so it never outruns the leash
		sim.tick();
		expect(mob.aiState).toBe("flee");

		for (let i = 0; i < 200; i++) {
			sim.player.pos = { ...mob.pos }; // shadow it so it stays leashed
			sim.tick();
			if (mob.aiState === "attack") break;
		}
		expect(mob.aiState).toBe("attack");
	});

	it("flees only once per pull", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		engageLowHp(sim, mob, "gravecaller_cultist", 0.1);
		sim.tick();
		expect(mob.aiState).toBe("flee");

		// force it back to fighting, then drop it low again — it must NOT flee a 2nd time
		mob.aiState = "attack";
		mob.fleeTimer = 0;
		mob.hp = Math.round(mob.maxHp * 0.05);
		sim.player.pos = { ...mob.pos };
		sim.tick();

		expect(mob.aiState).not.toBe("flee");
	});
});

describe("willFlee false mobs never flee", () => {
	it("a low-HP willFlee false mob fights to the death", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		engageLowHp(sim, mob, "forest_wolf", 0.05);

		sim.tick();

		expect(sim.entities.get(mob.id)!.aiState).not.toBe("flee");
	});

	it("an elite mob can still flee when the template explicitly opts in", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		const previous = MOBS.tidebound_acolyte.willFlee;
		const previousHeal = MOBS.tidebound_acolyte.desperateHeal;
		MOBS.tidebound_acolyte.willFlee = true;
		MOBS.tidebound_acolyte.desperateHeal = undefined;
		engageLowHp(sim, mob, "tidebound_acolyte", 0.05); // humanoid, elite

		sim.tick();

		expect(sim.entities.get(mob.id)!.aiState).toBe("flee");
		MOBS.tidebound_acolyte.willFlee = previous;
		MOBS.tidebound_acolyte.desperateHeal = previousHeal;
	});
});

describe("mob aggression", () => {
	it("neutral mobs do not proximity aggro", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		const previous = MOBS.forest_wolf.aggression;
		MOBS.forest_wolf.aggression = "neutral";
		mob.templateId = "forest_wolf";
		mob.pos = {
			x: sim.player.pos.x + 1,
			z: sim.player.pos.z,
			y: sim.player.pos.y,
		};
		mob.prevPos = { ...mob.pos };

		sim.tick();

		expect(mob.aiState).toBe("idle");
		expect(mob.aggroTargetId).toBeNull();
		MOBS.forest_wolf.aggression = previous;
	});

	it("aggressive mobs proximity aggro", () => {
		const sim = makeSim();
		const mob = wildMobs(sim)[0];
		const previous = MOBS.forest_wolf.aggression;
		MOBS.forest_wolf.aggression = "aggressive";
		mob.templateId = "forest_wolf";
		mob.pos = {
			x: sim.player.pos.x + 1,
			z: sim.player.pos.z,
			y: sim.player.pos.y,
		};
		mob.prevPos = { ...mob.pos };

		sim.tick();

		expect(mob.aiState).toBe("chase");
		expect(mob.aggroTargetId).toBe(sim.playerId);
		MOBS.forest_wolf.aggression = previous;
	});
});
