import { applyPlayerInputMovement } from '../sim/player_movement';
import { DT, type Entity, type MoveInput } from '../sim/types';
import type { RenderPose } from '../world_api';

const CORRECTION_SMOOTH_SECONDS = 0.16;
const CORRECTION_MAX_DECAY_DT_SECONDS = 1 / 30;
const PREDICTION_SEGMENT_MS = DT * 1000;
const MAX_PREDICTION_SEGMENT_MS = 250;
const PRESENTATION_IGNORE_DIST_SQ = 0.03 * 0.03;
const PRESENTATION_TELEPORT_DIST_SQ = 40 * 40;
const MAX_PENDING_COMMANDS = 80;

export interface MoveCommand {
  seq: number;
  localTick: number;
  moveInput: MoveInput;
  facing: number | null;
  sentAt: number;
}

export interface PredictionStepResult {
  before: RenderPose;
  after: RenderPose;
  predictedDist: number;
}

export interface PredictionReplayResult {
  pendingBefore: number;
  dropped: number;
  replayed: number;
  pendingAfter: number;
}

export interface PresentationCorrectionResult {
  renderCorrectionDist: number;
  anchorMode: 'dead' | 'none' | 'snap' | 'blend';
}

interface PresentationSegment {
  from: RenderPose;
  to: RenderPose;
  startedAt: number;
  durationMs: number;
}

function copyPos(dst: { x: number; y: number; z: number }, src: { x: number; y: number; z: number }): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

function cloneMoveInput(input: MoveInput): MoveInput {
  return {
    forward: input.forward,
    back: input.back,
    turnLeft: input.turnLeft,
    turnRight: input.turnRight,
    strafeLeft: input.strafeLeft,
    strafeRight: input.strafeRight,
    jump: input.jump,
  };
}

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function poseOf(e: Entity): RenderPose {
  return {
    pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
    facing: e.facing,
  };
}

function clonePose(pose: RenderPose): RenderPose {
  return {
    pos: { x: pose.pos.x, y: pose.pos.y, z: pose.pos.z },
    facing: pose.facing,
  };
}

function interpolatePose(a: RenderPose, b: RenderPose, t: number): RenderPose {
  const alpha = Math.max(0, Math.min(1, t));
  return {
    pos: {
      x: a.pos.x + (b.pos.x - a.pos.x) * alpha,
      y: a.pos.y + (b.pos.y - a.pos.y) * alpha,
      z: a.pos.z + (b.pos.z - a.pos.z) * alpha,
    },
    facing: a.facing + wrapAngle(b.facing - a.facing) * alpha,
  };
}

function poseDist(a: RenderPose | null, b: RenderPose): number {
  if (!a) return 0;
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
}

export class LocalPredictionController {
  private offsetX = 0;
  private offsetY = 0;
  private offsetZ = 0;
  private offsetFacing = 0;
  private lastPresentationAt = 0;
  private presentationInitialized = false;
  private predictionSegment: PresentationSegment | null = null;

  constructor(private readonly seed: number, private readonly pendingCommands: MoveCommand[] = []) {}

  get pendingCount(): number {
    return this.pendingCommands.length;
  }

  pendingSnapshot(): readonly MoveCommand[] {
    return this.pendingCommands;
  }

  makeCommand(seq: number, localTick: number, input: MoveInput, facing: number | null, sentAt: number): MoveCommand {
    return {
      seq,
      localTick,
      moveInput: cloneMoveInput(input),
      facing,
      sentAt,
    };
  }

  push(command: MoveCommand): void {
    this.pendingCommands.push(command);
    if (this.pendingCommands.length > MAX_PENDING_COMMANDS) {
      this.pendingCommands.splice(0, this.pendingCommands.length - MAX_PENDING_COMMANDS);
    }
  }

  applyCommand(e: Entity, command: MoveCommand, presentationAt?: number): PredictionStepResult {
    const before = poseOf(e);
    const segmentFrom = presentationAt === undefined ? null : this.basePose(e, presentationAt);
    copyPos(e.prevPos, e.pos);
    e.prevFacing = e.facing;
    if (command.facing !== null) e.facing = command.facing;
    applyPlayerInputMovement(e, command.moveInput, this.seed);
    const after = poseOf(e);
    if (presentationAt !== undefined && segmentFrom) this.extendPredictionSegment(segmentFrom, after, presentationAt);
    return {
      before,
      after,
      predictedDist: poseDist(before, after),
    };
  }

  replayFromAck(e: Entity, ack: number): PredictionReplayResult {
    const pendingBefore = this.pendingCommands.length;
    let write = 0;
    for (let read = 0; read < this.pendingCommands.length; read++) {
      const command = this.pendingCommands[read];
      if (command.seq > ack) this.pendingCommands[write++] = command;
    }
    this.pendingCommands.length = write;
    const pendingAfter = this.pendingCommands.length;
    const dropped = pendingBefore - pendingAfter;

    if (e.dead) {
      this.pendingCommands.length = 0;
      this.snapPresentationTo(e);
      return { pendingBefore, dropped, replayed: 0, pendingAfter: 0 };
    }

    for (const command of this.pendingCommands) this.applyCommand(e, command);
    return { pendingBefore, dropped, replayed: pendingAfter, pendingAfter };
  }

  renderPose(e: Entity, now: number): RenderPose {
    if (!this.presentationInitialized) {
      this.presentationInitialized = true;
      this.lastPresentationAt = now;
      this.offsetX = 0;
      this.offsetY = 0;
      this.offsetZ = 0;
      this.offsetFacing = 0;
    } else {
      this.decay(now);
    }
    const base = this.basePose(e, now);
    return {
      pos: {
        x: base.pos.x + this.offsetX,
        y: base.pos.y + this.offsetY,
        z: base.pos.z + this.offsetZ,
      },
      facing: base.facing + this.offsetFacing,
    };
  }

  reconcilePresentation(e: Entity, displayedBefore: RenderPose | null, now: number): PresentationCorrectionResult {
    if (e.dead) {
      this.snapPresentationTo(e, now);
      return { renderCorrectionDist: 0, anchorMode: 'dead' };
    }

    const predicted = poseOf(e);
    this.snapPredictionSegmentTo(predicted);
    const renderCorrectionDist = poseDist(displayedBefore, predicted);
    if (!displayedBefore) {
      this.snapPresentationTo(e, now);
      return { renderCorrectionDist, anchorMode: 'snap' };
    }

    const dx = displayedBefore.pos.x - predicted.pos.x;
    const dy = displayedBefore.pos.y - predicted.pos.y;
    const dz = displayedBefore.pos.z - predicted.pos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq <= PRESENTATION_IGNORE_DIST_SQ) {
      this.snapPresentationTo(e, now);
      return { renderCorrectionDist, anchorMode: 'none' };
    }
    if (distSq >= PRESENTATION_TELEPORT_DIST_SQ) {
      this.snapPresentationTo(e, now);
      return { renderCorrectionDist, anchorMode: 'snap' };
    }

    this.presentationInitialized = true;
    this.lastPresentationAt = now;
    this.offsetX = dx;
    this.offsetY = dy;
    this.offsetZ = dz;
    this.offsetFacing = wrapAngle(displayedBefore.facing - predicted.facing);
    return { renderCorrectionDist, anchorMode: 'blend' };
  }

  snapPresentationTo(e: Entity, now = this.lastPresentationAt): void {
    this.presentationInitialized = true;
    this.lastPresentationAt = now;
    this.offsetX = 0;
    this.offsetY = 0;
    this.offsetZ = 0;
    this.offsetFacing = 0;
    this.snapPredictionSegmentTo(poseOf(e));
  }

  private basePose(e: Entity, now: number): RenderPose {
    const segment = this.predictionSegment;
    if (!segment) return poseOf(e);
    if (segment.durationMs <= 0) return clonePose(segment.to);
    const alpha = (now - segment.startedAt) / segment.durationMs;
    if (alpha >= 1) return clonePose(segment.to);
    if (alpha <= 0) return clonePose(segment.from);
    return interpolatePose(segment.from, segment.to, alpha);
  }

  private extendPredictionSegment(from: RenderPose, to: RenderPose, now: number): void {
    const active = this.predictionSegment;
    const remaining = active ? Math.max(0, active.startedAt + active.durationMs - now) : 0;
    this.predictionSegment = {
      from: clonePose(from),
      to: clonePose(to),
      startedAt: now,
      durationMs: Math.min(MAX_PREDICTION_SEGMENT_MS, Math.max(PREDICTION_SEGMENT_MS, remaining + PREDICTION_SEGMENT_MS)),
    };
  }

  private snapPredictionSegmentTo(pose: RenderPose): void {
    this.predictionSegment = {
      from: clonePose(pose),
      to: clonePose(pose),
      startedAt: this.lastPresentationAt,
      durationMs: PREDICTION_SEGMENT_MS,
    };
  }

  private decay(now: number): void {
    const dt = Math.max(0, Math.min(0.25, (now - this.lastPresentationAt) / 1000));
    this.lastPresentationAt = now;
    if (dt <= 0) return;
    const decayDt = Math.min(dt, CORRECTION_MAX_DECAY_DT_SECONDS);
    const keep = Math.exp(-decayDt / CORRECTION_SMOOTH_SECONDS);
    this.offsetX *= keep;
    this.offsetY *= keep;
    this.offsetZ *= keep;
    this.offsetFacing *= keep;
    if (Math.abs(this.offsetX) < 0.0005) this.offsetX = 0;
    if (Math.abs(this.offsetY) < 0.0005) this.offsetY = 0;
    if (Math.abs(this.offsetZ) < 0.0005) this.offsetZ = 0;
    if (Math.abs(this.offsetFacing) < 0.0005) this.offsetFacing = 0;
  }
}
