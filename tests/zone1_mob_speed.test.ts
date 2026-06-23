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
