import { resolveMovement } from './colliders';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from './pathfind';
import { DT, Entity, MoveInput, RUN_SPEED, TURN_SPEED, normAngle } from './types';
import { groundHeight, WATER_LEVEL } from './world';

export const BACKPEDAL_MULT = 0.65;
export const GRAVITY = 16;
export const JUMP_VELOCITY = 6; // apex = v^2/2g ~= 1.125 yd
export const FALL_SAFE_DISTANCE = 12;
export const MAX_CLIMB_SLOPE = PLAYER_MAX_CLIMB_SLOPE;
export const SWIM_SURFACE_Y = WATER_LEVEL - 0.75;
export const SWIM_DEPTH = PLAYER_SWIM_DEPTH;
export const SWIM_SPEED_MULT = 0.65;
export const BODY_RADIUS = PLAYER_BODY_RADIUS;

export interface PlayerMovementHooks {
  standUp?(): void;
  cancelCast?(): void;
  fallDamage?(amount: number): void;
}

export interface PlayerMovementResult {
  wantsMove: boolean;
  moved: boolean;
  fallDamage: number;
}

export function playerIsStunned(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'stun' || a.kind === 'incapacitate' || a.kind === 'polymorph');
}

export function playerIsRooted(e: Entity): boolean {
  return playerIsStunned(e) || e.auras.some((a) => a.kind === 'root');
}

export function playerMoveSpeedMult(e: Entity): number {
  let slow = 1, speed = 1;
  for (const a of e.auras) {
    if (a.kind === 'slow' || a.kind === 'stealth') slow = Math.min(slow, a.value);
    if (a.kind === 'buff_speed') speed = Math.max(speed, a.value);
  }
  return slow * speed;
}

export function playerIsSwimming(e: Entity, seed: number): boolean {
  return groundHeight(e.pos.x, e.pos.z, seed) < WATER_LEVEL - SWIM_DEPTH
    && e.pos.y <= SWIM_SURFACE_Y + 0.15;
}

export function applyPlayerInputMovement(
  p: Entity,
  inp: MoveInput,
  seed: number,
  hooks: PlayerMovementHooks = {},
): PlayerMovementResult {
  let moved = false;
  let fallDamage = 0;

  // Convention: facing f points along (sin f, cos f); the camera sits behind
  // the player, so screen-right is the world vector (-cos f, sin f).
  // Turning right therefore decreases facing.
  if (!playerIsStunned(p)) {
    const before = p.facing;
    if (inp.turnLeft) p.facing = normAngle(p.facing + TURN_SPEED * DT);
    if (inp.turnRight) p.facing = normAngle(p.facing - TURN_SPEED * DT);
    moved = moved || before !== p.facing;
  }

  let mx = 0, mz = 0; // local: z forward, x strafe-right
  if (inp.forward) mz += 1;
  if (inp.back) mz -= 1;
  if (inp.strafeLeft) mx -= 1;
  if (inp.strafeRight) mx += 1;

  const wantsMove = mx !== 0 || mz !== 0 || inp.jump;
  if (wantsMove && p.sitting) hooks.standUp?.();

  const rooted = playerIsRooted(p);
  const hasMoveInput = mx !== 0 || mz !== 0;
  const moving = hasMoveInput && !rooted;
  const swimming = playerIsSwimming(p, seed);
  let wishX = 0, wishZ = 0, wishSpeed = 0;
  if (moving) {
    if (p.castingAbility) hooks.cancelCast?.();
    const len = Math.hypot(mx, mz);
    mx /= len; mz /= len;
    let speed = RUN_SPEED * playerMoveSpeedMult(p);
    if (mz < 0) speed *= BACKPEDAL_MULT;
    if (swimming) speed *= SWIM_SPEED_MULT;
    // world = forward * mz + right * mx, with right = (-cos f, sin f)
    const sin = Math.sin(p.facing), cos = Math.cos(p.facing);
    const wx = mz * sin - mx * cos;
    const wz = mz * cos + mx * sin;
    wishX = wx;
    wishZ = wz;
    wishSpeed = speed;
  }

  const movingOnGround = moving && (p.onGround || swimming);
  if (movingOnGround || (!p.onGround && (p.vx !== 0 || p.vz !== 0))) {
    const stepX = movingOnGround ? wishX * wishSpeed : p.vx;
    const stepZ = movingOnGround ? wishZ * wishSpeed : p.vz;
    let nx = p.pos.x + stepX * DT;
    let nz = p.pos.z + stepZ * DT;
    // cliffs and the world rim are walls, not ramps
    if (p.onGround && !swimming) {
      const h0 = groundHeight(p.pos.x, p.pos.z, seed);
      const h1 = groundHeight(nx, nz, seed);
      const run = Math.hypot(nx - p.pos.x, nz - p.pos.z);
      if (h1 > h0 && run > 1e-5 && (h1 - h0) / run > MAX_CLIMB_SLOPE) {
        nx = p.pos.x;
        nz = p.pos.z;
        if (!p.onGround) { p.vx = 0; p.vz = 0; }
      }
    }
    // While airborne from a jump, pass through fences for the whole arc.
    // Walking off a ledge still collides with fences.
    const clearFences = !p.onGround && p.jumping;
    const beforeX = p.pos.x, beforeZ = p.pos.z;
    const resolved = resolveMovement(seed, p.pos.x, p.pos.z, nx, nz, BODY_RADIUS, clearFences);
    p.pos.x = resolved.x;
    p.pos.z = resolved.z;
    moved = moved || beforeX !== p.pos.x || beforeZ !== p.pos.z;
    if (!p.onGround && (resolved.x !== nx || resolved.z !== nz)) {
      p.vx = (resolved.x - p.prevPos.x) / DT;
      p.vz = (resolved.z - p.prevPos.z) / DT;
    }
  }

  // Vertical: jumping, gravity, swimming, fall damage
  const ground = groundHeight(p.pos.x, p.pos.z, seed);
  const deepWater = ground < WATER_LEVEL - SWIM_DEPTH;
  if (deepWater && p.pos.y <= SWIM_SURFACE_Y + 0.05) {
    const beforeY = p.pos.y;
    p.pos.y = SWIM_SURFACE_Y;
    p.vy = 0;
    p.vx = 0;
    p.vz = 0;
    p.onGround = true;
    p.jumping = false;
    p.fallStartY = p.pos.y;
    moved = moved || beforeY !== p.pos.y;
    if (inp.jump && !rooted) {
      // small hop to climb onto shores and docks
      p.vy = JUMP_VELOCITY * 0.7;
      p.vx = wishX * wishSpeed;
      p.vz = wishZ * wishSpeed;
      p.onGround = false;
      p.jumping = true;
    }
    return { wantsMove, moved, fallDamage };
  }
  if (inp.jump && p.onGround && !rooted) {
    p.vy = JUMP_VELOCITY;
    p.vx = wishX * wishSpeed;
    p.vz = wishZ * wishSpeed;
    p.onGround = false;
    p.jumping = true;
    p.fallStartY = p.pos.y;
  }
  if (!p.onGround) {
    const beforeY = p.pos.y;
    p.vy -= GRAVITY * DT;
    p.pos.y += p.vy * DT;
    moved = moved || beforeY !== p.pos.y;
    p.fallStartY = Math.max(p.fallStartY, p.pos.y);
    if (deepWater && p.pos.y <= SWIM_SURFACE_Y) {
      p.pos.y = SWIM_SURFACE_Y;
      p.vy = 0;
      p.vx = 0;
      p.vz = 0;
      p.onGround = true;
      p.jumping = false;
      p.fallStartY = p.pos.y;
      return { wantsMove, moved, fallDamage };
    }
    if (p.pos.y <= ground) {
      p.pos.y = ground;
      p.vy = 0;
      p.vx = 0;
      p.vz = 0;
      p.onGround = true;
      p.jumping = false;
      const drop = p.fallStartY - ground;
      if (drop > FALL_SAFE_DISTANCE) {
        fallDamage = Math.round(p.maxHp * (drop - FALL_SAFE_DISTANCE) * 0.07);
        if (fallDamage > 0) hooks.fallDamage?.(fallDamage);
      }
      p.fallStartY = ground;
    }
  } else if (ground < p.pos.y - 0.4) {
    p.onGround = false;
    p.jumping = false;
    p.vx = 0;
    p.vz = 0;
    p.vy = 0;
    p.fallStartY = p.pos.y;
  } else {
    const beforeY = p.pos.y;
    p.pos.y = ground;
    p.fallStartY = ground;
    moved = moved || beforeY !== p.pos.y;
  }

  return { wantsMove, moved, fallDamage };
}
