import { describe, expect, it } from "vitest";
import {
	FLEE_MAX_SPEED,
	InstanceLeashPolicy,
	MobRuntime,
	MURLOC_SOCIAL_PULL_RADIUS,
	WorldLeashPolicy,
} from "../src/sim/mob_behavior";
import type { Entity, MobTemplate } from "../src/sim/types";
import { RUN_SPEED } from "../src/sim/types";

function template(overrides: Partial<MobTemplate> = {}): MobTemplate {
	return {
		id: "test_mob",
		name: "Test Mob",
		minLevel: 1,
		maxLevel: 1,
		type: "humanoid",
		hpBase: 10,
		hpPerLevel: 1,
		dmgBase: 1,
		dmgPerLevel: 1,
		attackSpeed: 2,
		armorPerLevel: 1,
		moveSpeed: 7,
		aggroRadius: 10,
		loot: [],
		scale: 1,
		color: 0xffffff,
		...overrides,
	};
}

function entity(overrides: Partial<Entity> = {}): Entity {
	return {
		id: 1,
		kind: "mob",
		templateId: "test_mob",
		name: "Test Mob",
		level: 1,
		guild: "",
		pos: { x: 0, y: 0, z: 0 },
		prevPos: { x: 0, y: 0, z: 0 },
		facing: 0,
		prevFacing: 0,
		vx: 0,
		vz: 0,
		vy: 0,
		onGround: true,
		jumping: false,
		fallStartY: 0,
		hp: 10,
		maxHp: 10,
		resource: 0,
		maxResource: 0,
		resourceType: null,
		overheadEmoteId: null,
		overheadEmoteUntil: 0,
		overheadEmoteSeq: 0,
		stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
		weapon: { min: 1, max: 2, speed: 2 },
		attackPower: 0,
		rangedPower: 0,
		critChance: 0.05,
		dodgeChance: 0.05,
		moveSpeed: 7,
		hostile: true,
		targetId: null,
		autoAttack: false,
		swingTimer: 0,
		inCombat: false,
		combatTimer: 0,
		auras: [],
		ccDr: new Map(),
		castingAbility: null,
		castRemaining: 0,
		castTotal: 0,
		channeling: false,
		channelTickTimer: 0,
		channelTickEvery: 0,
		gcdRemaining: 0,
		cooldowns: new Map(),
		queuedOnSwing: null,
		fiveSecondRule: 0,
		comboPoints: 0,
		comboTargetId: null,
		overpowerUntil: -1,
		potionCooldownUntil: -1,
		chargeTargetId: null,
		chargeTimeLeft: 0,
		chargePath: [],
		followTargetId: null,
		savedMana: 0,
		sitting: false,
		eating: null,
		drinking: null,
		aiState: "idle",
		tappedById: null,
		threat: new Map(),
		forcedTargetId: null,
		forcedTargetTimer: 0,
		ownerId: null,
		allegiance: null,
		petMode: "defensive",
		petTauntTimer: 0,
		petPath: [],
		petPathCooldown: 0,
		pulseTimer: 0,
		stompTimer: 0,
		stoneskinTimer: 0,
		terrifyTimer: 0,
		detonateTimer: Infinity,
		mendTimer: 0,
		wardTimer: 0,
		rallyTimer: 0,
		warcryTimer: 0,
		firedSummons: 0,
		summonedIds: [],
		enraged: false,
		healedThisPull: false,
		spawnPos: { x: 0, y: 0, z: 0 },
		leashAnchor: null,
		pursuitStallTimer: 0,
		evadeStall: 0,
		fleeTimer: 0,
		fleeReturnTimer: 0,
		hasFled: false,
		wanderTarget: null,
		wanderTimer: 0,
		aggroTargetId: null,
		respawnTimer: 0,
		corpseTimer: 0,
		lootable: false,
		loot: null,
		xpValue: 0,
		questIds: [],
		vendorItems: [],
		objectItemId: null,
		dungeonId: null,
		dead: false,
		scale: 1,
		color: 0xffffff,
		skinCatalog: "class",
		skin: 0,
		...overrides,
	};
}

describe("MobRuntime", () => {
	it("wraps authored mob behavior without mutating content data", () => {
		const mob = entity({
			allegiance: "gravecaller_cult",
			moveSpeed: RUN_SPEED * 2,
		});
		const runtime = new MobRuntime(
			mob,
			template({
				aggression: "neutral",
				willFlee: true,
				allegiance: "template_faction",
				type: "murloc",
			}),
		);

		expect(runtime.aggression).toBe("neutral");
		expect(runtime.willFlee).toBe(true);
		expect(runtime.allegiance).toBe("gravecaller_cult");
		expect(runtime.socialPullRadius).toBe(MURLOC_SOCIAL_PULL_RADIUS);
		expect(runtime.fleeMoveSpeed(2)).toBe(FLEE_MAX_SPEED);
	});

	it("uses template allegiance when runtime allegiance is unset", () => {
		const runtime = new MobRuntime(
			entity(),
			template({ allegiance: "template_faction" }),
		);

		expect(runtime.allegiance).toBe("template_faction");
		expect(
			runtime.sameAllegiance(
				new MobRuntime(
					entity({ id: 2, allegiance: "template_faction" }),
					template(),
				),
			),
		).toBe(true);
	});
});

describe("mob leash policies", () => {
	it("world mobs reset when they exceed their leash anchor", () => {
		const mob = entity({
			pos: { x: 50, y: 0, z: 0 },
			spawnPos: { x: 0, y: 0, z: 0 },
		});
		const policy = new WorldLeashPolicy();

		expect(
			policy.shouldReset(
				new MobRuntime(mob, template()),
				entity({ id: 2 }),
				mob.spawnPos,
			),
		).toBe(true);
	});

	it("instance mobs ignore distance leash and reset only when target leaves the instance", () => {
		const mob = entity({
			dungeonId: "crypt",
			pos: { x: 1000, y: 0, z: 0 },
			spawnPos: { x: 1000, y: 0, z: 0 },
		});
		const targetInside = entity({
			id: 2,
			kind: "player",
			pos: { x: 1005, y: 0, z: 0 },
		});
		const targetOutside = entity({
			id: 3,
			kind: "player",
			pos: { x: 0, y: 0, z: 0 },
		});
		const policy = new InstanceLeashPolicy(600, (x) =>
			x > 600 ? { id: "crypt" } : null,
		);

		expect(
			policy.shouldReset(new MobRuntime(mob, template()), targetInside, {
				x: 0,
				y: 0,
				z: 0,
			}),
		).toBe(false);
		expect(
			policy.shouldReset(new MobRuntime(mob, template()), targetOutside, {
				x: 0,
				y: 0,
				z: 0,
			}),
		).toBe(true);
	});
});
