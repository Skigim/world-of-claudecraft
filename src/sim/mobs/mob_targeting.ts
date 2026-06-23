import { MOBS } from "../data";
import { MobRuntime, sameAllegiance, socialPullRadius } from "../mob_behavior";
import {
	MELEE_SWITCH_MULT,
	RANGED_SWITCH_MULT,
	addThreat,
	stealthDetectionRadius,
} from "../threat";
import type { Entity, MobTemplate, Vec3 } from "../types";
import { DT, MELEE_RANGE, dist2d } from "../types";

export interface MobSpatialIndex {
	forEachInRadius(
		x: number,
		z: number,
		radius: number,
		visit: (entity: Entity, distanceSquared: number) => void,
	): void;
}

export interface MobTargetingContext {
	entities: Map<number, Entity>;
	grid: MobSpatialIndex;
	playerGrid: MobSpatialIndex;
	templateFor(templateId: string): MobTemplate | undefined;
	isTrivialTo(mob: Entity, player: Entity): boolean;
	nythraxisAddFallbackTarget(add: Entity): Entity | null;
	scheduleNythraxisAddDespawnIfBossReset(add: Entity): boolean;
}

export class MobTargeting {
	constructor(private readonly ctx: MobTargetingContext) {}

	/** Highest-threat living attacker on the table; prunes stale entries. */
	highestThreatTarget(mob: Entity): Entity | null {
		let best: Entity | null = null;
		let bestThreat = -1;
		for (const [id, threat] of mob.threat) {
			const entity = this.ctx.entities.get(id);
			if (!entity || entity.dead) {
				mob.threat.delete(id);
				continue;
			}
			if (threat > bestThreat) {
				bestThreat = threat;
				best = entity;
			}
		}
		return best;
	}

	// When a mob's target dies/leaves it swings to its next-highest-threat
	// attacker. With no living threat left, it evades home instead of grabbing a
	// nearby bystander who never acted on the mob.
	retargetMob(mob: Entity): void {
		const next = this.highestThreatTarget(mob);
		if (next) {
			mob.aggroTargetId = next.id;
			mob.aiState = "chase";
			mob.inCombat = true;
			mob.despawnTimer = undefined;
			return;
		}
		const nythraxisFallback = this.ctx.nythraxisAddFallbackTarget(mob);
		if (nythraxisFallback) {
			mob.aggroTargetId = nythraxisFallback.id;
			mob.aiState = "chase";
			mob.inCombat = true;
			mob.despawnTimer = undefined;
			addThreat(mob, nythraxisFallback.id, 1);
			return;
		}
		if (this.ctx.scheduleNythraxisAddDespawnIfBossReset(mob)) return;
		mob.aggroTargetId = null;
		mob.aiState = "evade";
	}

	// Classic pull-over rules, applied every AI tick while fighting: an attacker
	// takes aggro past 110% of the current target's threat in melee range of
	// the mob, or past 130% at range. A taunt forces the target outright.
	updateMobTarget(mob: Entity): void {
		if (mob.forcedTargetTimer > 0) {
			mob.forcedTargetTimer -= DT;
			const forced =
				mob.forcedTargetId !== null
					? this.ctx.entities.get(mob.forcedTargetId)
					: null;
			if (forced && !forced.dead) {
				mob.aggroTargetId = forced.id;
				return;
			}
		}
		if (mob.forcedTargetTimer <= 0) mob.forcedTargetId = null;
		const current =
			mob.aggroTargetId !== null
				? this.ctx.entities.get(mob.aggroTargetId)
				: null;
		if (!current || current.dead) {
			const next = this.highestThreatTarget(mob);
			if (next) mob.aggroTargetId = next.id;
			return;
		}
		const currentThreat = mob.threat.get(current.id) ?? 0;
		let best = current;
		let bestThreat = currentThreat;
		for (const [id, threat] of mob.threat) {
			if (id === current.id || threat <= bestThreat) continue;
			const entity = this.ctx.entities.get(id);
			if (!entity || entity.dead) {
				mob.threat.delete(id);
				continue;
			}
			const inMelee = dist2d(mob.pos, entity.pos) <= MELEE_RANGE * 1.2;
			const needed =
				currentThreat * (inMelee ? MELEE_SWITCH_MULT : RANGED_SWITCH_MULT);
			if (threat > needed) {
				best = entity;
				bestThreat = threat;
			}
		}
		if (best !== current) mob.aggroTargetId = best.id;
	}

	aggroMob(mob: Entity, target: Entity, social: boolean): void {
		if (
			mob.dead ||
			mob.aiState === "evade" ||
			mob.aiState === "chase" ||
			mob.aiState === "attack" ||
			mob.aiState === "flee"
		)
			return;
		this.seedAggro(mob, target);
		if (!social) return;

		const pullRadius = socialPullRadius(this.ctx.templateFor(mob.templateId));
		this.ctx.grid.forEachInRadius(
			mob.pos.x,
			mob.pos.z,
			pullRadius,
			(candidate, distanceSquared) => {
				if (
					candidate.kind === "mob" &&
					candidate.id !== mob.id &&
					!candidate.dead &&
					candidate.hostile &&
					candidate.aiState === "idle" &&
					candidate.ownerId === null &&
					sameAllegiance(mob, candidate) &&
					distanceSquared < pullRadius * pullRadius
				) {
					this.seedAggro(candidate, target);
				}
			},
		);
	}

	nearestLivingPlayer(
		pos: Vec3,
		maxDist: number,
	): { e: Entity; d: number } | null {
		let best: Entity | null = null;
		let bestDistanceSquared = maxDist * maxDist;
		this.ctx.playerGrid.forEachInRadius(pos.x, pos.z, maxDist, (entity, d2) => {
			if (!entity.dead && d2 < bestDistanceSquared) {
				bestDistanceSquared = d2;
				best = entity;
			}
		});
		return best ? { e: best, d: Math.sqrt(bestDistanceSquared) } : null;
	}

	detectAggroTarget(mob: Entity, scanRadius = 25): Entity | null {
		const template = this.ctx.templateFor(mob.templateId);
		if (new MobRuntime(mob, template).aggression !== "aggressive") return null;
		return this.detectPlayerInAggroRadius(mob, scanRadius, true);
	}

	detectPlayerInAggroRadius(
		mob: Entity,
		scanRadius = 25,
		ignoreTrivial = false,
	): Entity | null {
		const template =
			this.ctx.templateFor(mob.templateId) ?? MOBS[mob.templateId];
		if (!template) return null;
		let detected: Entity | null = null;
		let detectedDistance = Infinity;
		this.ctx.playerGrid.forEachInRadius(
			mob.pos.x,
			mob.pos.z,
			scanRadius,
			(player, d2) => {
				if (player.dead) return;
				if (ignoreTrivial && this.ctx.isTrivialTo(mob, player)) return;
				let radius = Math.max(
					4,
					Math.min(20, template.aggroRadius + (mob.level - player.level) * 1.5),
				);
				if (player.auras.some((a) => a.kind === "stealth"))
					radius = stealthDetectionRadius(mob, player, radius);
				const distance = Math.sqrt(d2);
				if (distance < radius && distance < detectedDistance) {
					detected = player;
					detectedDistance = distance;
				}
			},
		);
		return detected;
	}

	private seedAggro(mob: Entity, target: Entity): void {
		mob.aiState = "chase";
		mob.aggroTargetId = target.id;
		mob.inCombat = true;
		mob.leashAnchor = { ...mob.pos };
		addThreat(mob, target.id, 1);
	}
}
