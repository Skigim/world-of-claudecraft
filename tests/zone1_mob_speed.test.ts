import { describe, expect, it } from "vitest";
import { ZONE1_MOBS } from "../src/sim/content/zone1";
import { RUN_SPEED } from "../src/sim/types";

describe("Eastbrook Vale mob movement speed", () => {
	it("keeps starter-zone mobs slower than players, except Mogger", () => {
		for (const mob of Object.values(ZONE1_MOBS)) {
			if (mob.petRole) continue;
			if (mob.id === "mogger") {
				expect(mob.moveSpeed).toBe(RUN_SPEED);
				continue;
			}
			expect(mob.moveSpeed).toBeLessThan(RUN_SPEED);
		}
	});
});

describe("Eastbrook Vale mob behavior authoring", () => {
	it("marks harmless starter wildlife as neutral instead of relying only on zero aggro radius", () => {
		expect(ZONE1_MOBS.brightwood_hare.aggression).toBe("neutral");
		expect(ZONE1_MOBS.spotted_fawn.aggression).toBe("neutral");
	});

	it("keeps starter wolves and boars neutral, non-fleeing, and unaffiliated", () => {
		for (const id of [
			"forest_wolf",
			"old_greyjaw",
			"wild_boar",
			"elder_bristleback",
		] as const) {
			expect(ZONE1_MOBS[id].aggression).toBe("neutral");
			expect(ZONE1_MOBS[id].willFlee).toBe(false);
			expect(ZONE1_MOBS[id].allegiance).toBeUndefined();
		}
	});

	it("makes starter humanoid camps hostile, fleeing, and socially allied", () => {
		expect(ZONE1_MOBS.tunnel_rat.aggression).toBeUndefined();
		expect(ZONE1_MOBS.tunnel_rat.willFlee).toBe(true);
		expect(ZONE1_MOBS.tunnel_rat.allegiance).toBe("tunnel_rats");

		expect(ZONE1_MOBS.vale_bandit.aggression).toBeUndefined();
		expect(ZONE1_MOBS.vale_bandit.willFlee).toBe(true);
		expect(ZONE1_MOBS.vale_bandit.allegiance).toBe("vale_bandits");
	});

	it("makes starter murlocs hostile, fleeing, and socially allied", () => {
		expect(ZONE1_MOBS.mudfin_murloc.aggression).toBeUndefined();
		expect(ZONE1_MOBS.mudfin_murloc.willFlee).toBe(true);
		expect(ZONE1_MOBS.mudfin_murloc.allegiance).toBe("mudfin_murlocs");
	});
});
