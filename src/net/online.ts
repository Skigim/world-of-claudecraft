// Online play: REST auth client + WebSocket world mirror.

import { NPCS, abilitiesKnownAt } from '../sim/data';
import { computeQuestState, ResolvedAbility } from '../sim/sim';
import {
  cloneAllocation, computeTalentModifiers, emptyAllocation, talentPointsAtLevel, pointsSpent,
  type TalentAllocation, type SavedLoadout, type Role,
} from '../sim/content/talents';
import {
  DT, Entity, EquipSlot, InvSlot, MoveInput, PlayerClass, QuestProgress, QuestState, SimEvent,
  emptyMoveInput,
} from '../sim/types';
import { normalizeMoveFacing, sanitizeMoveInput } from '../sim/move_input';
import { LocalPredictionController, type MoveCommand, type PredictionAckCoverage } from './prediction';
import { predictionTrace } from '../game/prediction_trace';
import { isOverheadEmoteId, type ArenaInfo, type CharacterSearchResult, type DuelInfo, type FriendInfo, type IWorld, type LeaderboardEntry, type MarketInfo, type OverheadEmoteId, type PartyInfo, type PresenceStatus, type RenderPose, type SocialInfo, type TradeInfo } from '../world_api';

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

export interface CharacterSummary {
  id: number;
  name: string;
  class: PlayerClass;
  level: number;
  skin: number;
  online: boolean;
  forceRename: boolean;
}

export function buildWebSocketUrl(protocol: string, host: string): string {
  const proto = protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${host}/ws`;
}

export function buildWebSocketAuthMessage(token: string, characterId: number): { t: 'auth'; token: string; character: number } {
  return { t: 'auth', token, character: characterId };
}

type ClientTraceSink = (
  name: string,
  startMs: number,
  durationMs: number,
  detail?: Record<string, unknown>,
) => void;

export type RealmType = 'Normal' | 'PvP' | 'RP' | 'RP-PvP';

export interface RealmEntry {
  name: string;
  url: string;
  type: RealmType;
}

export interface RealmDirectory {
  current: string;
  realms: RealmEntry[];
  characters: Record<string, number>; // realm name -> how many characters you have
}

// A published GitHub release, as surfaced by the server's /api/releases proxy
// for the home-page "News & Updates" view. Body is raw release-note markdown.
export interface ReleaseEntry {
  id: number;
  tag: string;
  name: string;
  body: string;
  url: string;
  prerelease: boolean;
  publishedAt: string; // ISO 8601
}

export class Api {
  token: string | null = null;
  username: string | null = null;
  realm: string | null = null;
  // base origin for realm-scoped calls (characters, search, ws). '' = the page
  // origin; set to another realm's origin when the player picks a realm
  base = '';

  setRealm(url: string): void {
    this.base = url || '';
  }

  // The realm directory is always read from the page's own server. Sending the
  // token (when logged in) also returns per-realm character counts.
  async realms(): Promise<RealmDirectory> {
    try {
      const res = await fetch('/api/realms', { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
      if (!res.ok) return { current: '', realms: [], characters: {} };
      const d = await res.json();
      return { current: d.current ?? '', realms: d.realms ?? [], characters: d.characters ?? {} };
    } catch {
      return { current: '', realms: [], characters: {} };
    }
  }

  // Live status for a realm (population + reachability), for the realm picker.
  async realmStatus(url: string): Promise<{ online: boolean; players: number }> {
    try {
      const res = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { online: false, players: 0 };
      const d = await res.json();
      return { online: true, players: d.players_online ?? 0 };
    } catch {
      return { online: false, players: 0 };
    }
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
    return data;
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(this.base + path, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
    return data;
  }

  private async delete(path: string, body: unknown): Promise<any> {
    const res = await fetch(this.base + path, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
    return data;
  }

  async register(username: string, password: string, turnstileToken = ''): Promise<void> {
    const data = await this.post('/api/register', { username, password, turnstileToken });
    this.token = data.token;
    this.username = data.username;
  }

  async login(username: string, password: string, turnstileToken = ''): Promise<void> {
    const data = await this.post('/api/login', { username, password, turnstileToken });
    this.token = data.token;
    this.username = data.username;
  }

  async characters(): Promise<CharacterSummary[]> {
    const data = await this.get('/api/characters');
    if (typeof data.realm === 'string') this.realm = data.realm;
    return data.characters;
  }

  async createCharacter(name: string, cls: PlayerClass, skin = 0): Promise<void> {
    await this.post('/api/characters', { name, class: cls, skin });
  }

  async renameCharacter(characterId: number, name: string): Promise<void> {
    await this.post(`/api/characters/${characterId}/rename`, { name });
  }

  async deleteCharacter(characterId: number, name: string): Promise<void> {
    await this.delete(`/api/characters/${characterId}`, { name });
  }

  async reportPlayer(reporterCharacterId: number, targetPid: number, reason: string, details: string): Promise<void> {
    await this.post('/api/reports', { reporterCharacterId, targetPid, reason, details });
  }

  async reportPlayerByName(reporterCharacterId: number, targetCharacterName: string, reason: string, details: string): Promise<void> {
    await this.post('/api/reports', { reporterCharacterId, targetCharacterName, reason, details });
  }

  async projectStats(): Promise<{ accounts_created: number; players_online: number; realm: string }> {
    return this.get('/api/project-stats');
  }

  // Lifetime-XP leaderboard for the home page. 'global' ranks across all realms.
  async leaderboard(scope: 'realm' | 'global' = 'global', limit = 100): Promise<LeaderboardEntry[]> {
    try {
      const data = await this.get(`/api/leaderboard?scope=${scope}&metric=lifetimeXp&limit=${limit}`);
      return data.leaders ?? [];
    } catch {
      return [];
    }
  }

  // News & Updates feed for the home page, mirrored from GitHub Releases by the
  // server. Not realm-scoped — always read from the page's own origin.
  async releases(limit = 20): Promise<ReleaseEntry[]> {
    try {
      const res = await fetch(`/api/releases?limit=${limit}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.releases ?? [];
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// World mirror
// ---------------------------------------------------------------------------

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function copyPos(dst: { x: number; y: number; z: number }, src: { x: number; y: number; z: number }): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

function traceRound(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function tracePose(e: Entity | null | undefined): Record<string, unknown> | null {
  if (!e) return null;
  return {
    x: traceRound(e.pos.x),
    y: traceRound(e.pos.y),
    z: traceRound(e.pos.z),
    f: traceRound(e.facing),
    prevX: traceRound(e.prevPos.x),
    prevY: traceRound(e.prevPos.y),
    prevZ: traceRound(e.prevPos.z),
    prevF: traceRound(e.prevFacing),
    vx: traceRound(e.vx),
    vy: traceRound(e.vy),
    vz: traceRound(e.vz),
    onGround: e.onGround,
    fallStartY: traceRound(e.fallStartY),
  };
}

function traceWirePose(w: any): Record<string, unknown> | null {
  if (!w) return null;
  return {
    x: traceRound(Number(w.x ?? 0)),
    y: traceRound(Number(w.y ?? 0)),
    z: traceRound(Number(w.z ?? 0)),
    f: traceRound(Number(w.f ?? 0)),
    vx: typeof w.vx === 'number' ? traceRound(w.vx) : null,
    vy: typeof w.vy === 'number' ? traceRound(w.vy) : null,
    vz: typeof w.vz === 'number' ? traceRound(w.vz) : null,
    onGround: w.og === undefined ? null : !!w.og,
    fallStartY: typeof w.fy === 'number' ? traceRound(w.fy) : null,
  };
}

function traceRenderPose(p: RenderPose | null): Record<string, unknown> | null {
  if (!p) return null;
  return {
    x: traceRound(p.pos.x),
    y: traceRound(p.pos.y),
    z: traceRound(p.pos.z),
    f: traceRound(p.facing),
  };
}

function tracePoseDist(a: Record<string, unknown> | null, b: Record<string, unknown> | null): number {
  if (!a || !b) return 0;
  const ax = Number(a.x), ay = Number(a.y), az = Number(a.z);
  const bx = Number(b.x), by = Number(b.y), bz = Number(b.z);
  if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) return 0;
  return traceRound(Math.hypot(ax - bx, ay - by, az - bz));
}

function traceInput(input: MoveInput): Record<string, number> {
  return {
    f: input.forward ? 1 : 0,
    b: input.back ? 1 : 0,
    tl: input.turnLeft ? 1 : 0,
    tr: input.turnRight ? 1 : 0,
    sl: input.strafeLeft ? 1 : 0,
    sr: input.strafeRight ? 1 : 0,
    j: input.jump ? 1 : 0,
  };
}

function tracePayload(payload: string): Record<string, unknown> {
  try {
    const msg = JSON.parse(payload);
    if (typeof msg !== 'object' || msg === null) return {};
    return {
      t: typeof msg.t === 'string' ? msg.t : null,
      cmd: typeof msg.cmd === 'string' ? msg.cmd : null,
      seq: typeof msg.seq === 'number' ? msg.seq : null,
      tick: typeof msg.tick === 'number' ? Math.floor(msg.tick) : null,
      ack: typeof msg.self?.ack === 'number' ? Math.floor(msg.self.ack) : null,
      ackh: typeof msg.self?.ackh === 'number' ? Math.floor(msg.self.ackh) : null,
      pmv: typeof msg.self?.pmv === 'string' ? msg.self.pmv : null,
      selfX: typeof msg.self?.x === 'number' ? traceRound(msg.self.x) : null,
      selfY: typeof msg.self?.y === 'number' ? traceRound(msg.self.y) : null,
      selfZ: typeof msg.self?.z === 'number' ? traceRound(msg.self.z) : null,
      ents: Array.isArray(msg.ents) ? msg.ents.length : null,
      keep: Array.isArray(msg.keep) ? msg.keep.length : null,
    };
  } catch {
    return {};
  }
}

const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sk', 'dgn', 'sc', 'c'] as const;

function wireId(w: unknown): number | null {
  if (typeof w !== 'object' || w === null) return null;
  const id = (w as { id?: unknown }).id;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}

function hasWireIdentity(w: unknown): boolean {
  return typeof w === 'object' && w !== null && (w as { k?: unknown }).k !== undefined;
}

function withPreviousWireIdentity(previousFull: Record<string, unknown>, currentLite: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const key of ENTITY_IDENTITY_KEYS) {
    if (previousFull[key] !== undefined) merged[key] = previousFull[key];
  }
  for (const [key, value] of Object.entries(currentLite)) merged[key] = value;
  return merged;
}

interface PredictionReplayResult {
  pendingBefore: number;
  dropped: number;
  heldCovered: number;
  replayed: number;
  pendingAfter: number;
  effectiveAck: number;
  capped: number;
  renderCorrectionDist: number;
  replayDeltaDist: number;
  anchorMode: 'dead' | 'none' | 'snap' | 'blend';
  correctionSmoothMs: number;
  inputMode: PredictionInputMode;
  leadTicks: number;
}

type PredictionMovementMode = 'normal' | 'server';
type PredictionInputMode = 'moving' | 'idle';
type TransportLane = 'movement' | 'action' | 'social' | 'system';

const MAX_LOCAL_PREDICTION_LEAD_TICKS = 8;
const IDLE_STOP_RESEND_MS = 90;

const ACTION_COMMANDS = new Set([
  'cast', 'castSlot', 'target', 'tab', 'targetNearestFriendly', 'tabFriendly',
  'attack', 'stopattack', 'interact', 'loot', 'pickup', 'release',
  'pet_attack', 'pet_taunt', 'pet_revive', 'pet_abandon', 'pet_rename',
]);

const SOCIAL_COMMANDS = new Set([
  'chat', 'emote', 'party_invite', 'party_accept', 'party_leave', 'guild_invite',
  'guild_accept', 'guild_leave', 'trade_request', 'trade_accept', 'trade_cancel',
  'duel_request', 'duel_accept', 'duel_forfeit',
]);

function predictionAckCoverageFromWire(s: any): PredictionAckCoverage | undefined {
  if (typeof s?.ackh !== 'number' || !Number.isFinite(s.ackh) || s.ackh <= 0) return undefined;
  const heldTicks = Math.floor(s.ackh);
  if (heldTicks <= 0) return undefined;
  const heldFacing = typeof s.ackf === 'number' && Number.isFinite(s.ackf) ? s.ackf : null;
  return {
    heldTicks,
    heldInput: sanitizeMoveInput(s.ackmi),
    heldFacing,
  };
}

function predictionMovementModeFromWire(raw: unknown): PredictionMovementMode {
  return raw === 'charge' || raw === 'follow' || raw === 'fear' ? 'server' : 'normal';
}

interface LaggedSocketFrame {
  payload: string;
  deliveryAt: number;
  lane?: TransportLane;
}

interface NetLagConfig {
  upstreamMs: number;
  downstreamMs: number;
  jitterMs: number;
}

const NO_NET_LAG: NetLagConfig = { upstreamMs: 0, downstreamMs: 0, jitterMs: 0 };

function numberParam(params: URLSearchParams, keys: string[]): number | null {
  for (const key of keys) {
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readNetLagConfig(): NetLagConfig {
  if (typeof location === 'undefined') return NO_NET_LAG;
  const params = new URLSearchParams(location.search);
  const rtt = Math.max(0, numberParam(params, ['netRtt', 'netLag']) ?? 0);
  const upstreamMs = Math.max(0, numberParam(params, ['netUp', 'netUpstream']) ?? rtt / 2);
  const downstreamMs = Math.max(0, numberParam(params, ['netDown', 'netDownstream']) ?? rtt / 2);
  const jitterMs = Math.max(0, numberParam(params, ['netJitter']) ?? 0);
  return { upstreamMs, downstreamMs, jitterMs };
}

function lagDelayMs(baseMs: number, jitterMs: number): number {
  if (baseMs <= 0 && jitterMs <= 0) return 0;
  const jitter = jitterMs > 0 ? (Math.random() * 2 - 1) * jitterMs : 0;
  return Math.max(0, baseMs + jitter);
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isIdleMoveInput(input: MoveInput): boolean {
  return !input.forward
    && !input.back
    && !input.turnLeft
    && !input.turnRight
    && !input.strafeLeft
    && !input.strafeRight
    && !input.jump;
}

function transportLaneForCommand(payload: Record<string, unknown>): TransportLane {
  const cmd = typeof payload.cmd === 'string' ? payload.cmd : '';
  if (ACTION_COMMANDS.has(cmd)) return 'action';
  if (SOCIAL_COMMANDS.has(cmd)) return 'social';
  return 'system';
}

function orderedLagDelayMs(baseMs: number, jitterMs: number, nextDeliveryAt: number): { delayMs: number; deliveryAt: number } {
  const now = nowMs();
  const deliveryAt = Math.max(now + lagDelayMs(baseMs, jitterMs), nextDeliveryAt);
  return { delayMs: Math.max(0, deliveryAt - now), deliveryAt };
}

// A single position update never moves an entity more than a few yards by
// walking; anything past this is a teleport (arena pit, dungeon portal,
// graveyard release). Those are snapped, not interpolated — see applyWire.
const TELEPORT_SNAP_DIST_SQ = 40 * 40;

function blankEntity(id: number): Entity {
  return {
    id, kind: 'mob', templateId: '', name: '', level: 1, mendTimer: 0,
    pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, facing: 0, prevFacing: 0,
    vx: 0, vz: 0, vy: 0, onGround: true, jumping: false, fallStartY: 0,
    hp: 1, maxHp: 1, resource: 0, maxResource: 0, resourceType: null,
    overheadEmoteId: null, overheadEmoteUntil: 0, overheadEmoteSeq: 0,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    attackPower: 0, rangedPower: 0, critChance: 0.05, dodgeChance: 0.05, moveSpeed: 7, hostile: false,
    targetId: null, autoAttack: false, swingTimer: 0,
    inCombat: false, combatTimer: 99,
    auras: [], ccDr: new Map(), castingAbility: null, castRemaining: 0, castTotal: 0,
    channeling: false, channelTickTimer: 0, channelTickEvery: 0,
    gcdRemaining: 0, cooldowns: new Map(), queuedOnSwing: null, fiveSecondRule: 99,
    comboPoints: 0, comboTargetId: null, overpowerUntil: -1, potionCooldownUntil: -1, savedMana: 0,
    chargeTargetId: null, chargeTimeLeft: 0, chargePath: [], followTargetId: null,
    sitting: false, eating: null, drinking: null,
    aiState: 'idle', tappedById: null, pulseTimer: 0, stompTimer: 0, detonateTimer: Infinity, firedSummons: 0, summonedIds: [], enraged: false, healedThisPull: false,
    threat: new Map(), forcedTargetId: null, forcedTargetTimer: 0, ownerId: null, petMode: 'defensive', petTauntTimer: 0,
    spawnPos: { x: 0, y: 0, z: 0 }, leashAnchor: null, evadeStall: 0, fleeTimer: 0, hasFled: false, wanderTarget: null, wanderTimer: 0,
    aggroTargetId: null, respawnTimer: 0, corpseTimer: 0, lootable: false, loot: null,
    xpValue: 0, questIds: [], vendorItems: [], objectItemId: null, dungeonId: null,
    dead: false, scale: 1, color: 0xffffff, skin: 0,
  };
}

export class ClientWorld implements IWorld {
  cfg: { seed: number; playerClass: PlayerClass };
  entities = new Map<number, Entity>();
  playerId = -1;
  moveInput: MoveInput = emptyMoveInput();
  inventory: InvSlot[] = [];
  vendorBuyback: InvSlot[] = [];
  equipment: Partial<Record<EquipSlot, string>> = {};
  copper = 0;
  xp = 0;
  // Post-cap progression (Max-Level XP Overflow), mirrored from snapshot self.
  lifetimeXp = 0;
  prestigeRank = 0;
  unlockedMilestones: string[] = [];
  known: ResolvedAbility[] = [];
  // Talents & Specializations, mirrored from snapshot self (display + staging).
  talents: TalentAllocation = emptyAllocation();
  talentSpec: string | null = null;
  talentRole: Role | null = null;
  loadouts: SavedLoadout[] = [];
  activeLoadout = -1;
  questLog = new Map<string, QuestProgress>();
  questsDone = new Set<string>();
  partyInfo: PartyInfo | null = null;
  tradeInfo: TradeInfo | null = null;
  duelInfo: DuelInfo | null = null;
  socialInfo: SocialInfo | null = null;
  arenaInfo: ArenaInfo | null = null;
  marketInfo: MarketInfo | null = null;
  markers: Record<number, number> = {}; // entityId -> markerId, mirrored from the self-wire
  realm = '';
  // bumped whenever a fresh social snapshot lands, so an open panel re-renders
  private socialDirty = false;
  // snapshot interpolation
  lastSnapAt = 0;
  snapInterval = 50; // ms, adapts to measured cadence
  // camera follow for keyboard turns applied by the main loop
  pendingFacingDelta = 0;
  connected = false;
  onDisconnect: ((reason: string) => void) | null = null;
  readonly characterId: number;

  private ws: WebSocket;
  private readonly token: string;
  private readonly base: string;
  private eventQueue: SimEvent[] = [];
  // inventory deltas arrive in snapshots, separate from the event frames the
  // HUD redraws on — the frame loop polls this so open panels re-render
  private invChanged = false;
  // Soft (cosmetic) profanity terms the server sends in `hello` and pushes via
  // `censor` frames when an admin edits the list. The HUD drains these to mask
  // chat locally when the player's filter is on. Hard words never arrive here.
  profanityWords: string[] = [];
  private profanityDirty = false;
  private pendingQuestCommands = new Map<string, 'accept' | 'turnin'>();
  private mouselookFacing: number | null = null;
  private sendTimer: number | undefined;
  private lastInputSentAt = 0;
  private lastIdleStopSentAt = 0;
  private lastInputSig = '';
  private inputSeq = 0;
  private pendingInputSeqSentAt = new Map<number, number>();
  private ackedInputSeq = 0;
  private inputEchoSamples: number[] = [];
  private traceSink: ClientTraceSink | null = null;
  private pendingPredictions: MoveCommand[] = [];
  private predictionController: LocalPredictionController | null = null;
  private predictionAccumulator = 0;
  private predictionMovementMode: PredictionMovementMode = 'normal';
  private localPredictionTick = 0;
  private optimisticCommandSeq = 0;
  private lastSnapshotTick = -1;
  private queuedSnapshot: any | null = null;
  private netLag: NetLagConfig = NO_NET_LAG;
  private lagTimers = new Set<ReturnType<typeof setTimeout>>();
  private upstreamQueue: LaggedSocketFrame[] = [];
  private downstreamQueue: LaggedSocketFrame[] = [];
  private upstreamTimer: ReturnType<typeof setTimeout> | null = null;
  private downstreamTimer: ReturnType<typeof setTimeout> | null = null;
  private nextUpstreamDeliveryAt = 0;
  private nextDownstreamDeliveryAt = 0;

  constructor(token: string, characterId: number, cls: PlayerClass, base = '') {
    this.characterId = characterId;
    this.token = token;
    this.base = base;
    this.cfg = { seed: 20061, playerClass: cls };
    // when a realm was picked, connect to that realm's origin; otherwise the
    // page's own host
    const wsUrl = base
      ? base.replace(/^http/, 'ws') + '/ws'
      : buildWebSocketUrl(location.protocol, location.host);
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify(buildWebSocketAuthMessage(token, characterId)));
    };
    this.netLag = readNetLagConfig();
    this.ws.onmessage = (ev) => this.receiveSocketMessage(String(ev.data));
    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this.sendTimer);
      this.clearLagTimers();
      this.onDisconnect?.('Connection to the server was lost.');
    };
    // Fallback keepalive so held input cannot go stale if rendering is paused.
    // The normal 20Hz movement stream is sent by stepPrediction().
    this.sendTimer = window.setInterval(() => {
      const now = performance.now();
      if (now - this.lastInputSentAt > 250) this.predictLocalTick(now);
    }, 250);
  }

  close(): void {
    clearInterval(this.sendTimer);
    this.clearLagTimers();
    this.ws.onclose = null;
    this.ws.close();
  }

  setTraceSink(sink: ClientTraceSink | null): void {
    this.traceSink = sink;
  }

  get player(): Entity {
    return this.entities.get(this.playerId) ?? blankEntity(-1);
  }

  renderPoseFor(entityId: number, _alpha: number, now: number): RenderPose | null {
    if (entityId !== this.playerId) return null;
    const e = this.entities.get(this.playerId);
    if (!e) return null;
    return this.prediction().renderPose(e, now);
  }

  drainEvents(): SimEvent[] {
    const out = this.eventQueue;
    this.eventQueue = [];
    return out;
  }

  setMoveInput(input: unknown, facing?: unknown): void {
    Object.assign(this.moveInput, sanitizeMoveInput(input));
    if (arguments.length > 1) this.setMouselookFacing(facing);
  }

  setMouselookFacing(facing: unknown): void {
    this.mouselookFacing = normalizeMoveFacing(facing);
  }

  private prediction(): LocalPredictionController {
    return this.predictionController ??= new LocalPredictionController(this.cfg.seed, this.pendingPredictions);
  }

  flushInput(now = performance.now()): boolean {
    const sig = this.inputSignature();
    if (sig === this.lastInputSig) return false;
    if (now - this.lastInputSentAt < 16) return false;
    return this.predictLocalTick(now);
  }

  consumeInputEchoSamples(): number[] {
    const samples = this.inputEchoSamples ?? [];
    this.inputEchoSamples = [];
    return samples;
  }

  // -----------------------------------------------------------------------
  // Socket
  // -----------------------------------------------------------------------

  private clearLagTimers(): void {
    for (const timer of this.lagTimers ?? []) clearTimeout(timer);
    this.lagTimers?.clear();
    this.upstreamTimer = null;
    this.downstreamTimer = null;
    this.upstreamQueue = [];
    this.downstreamQueue = [];
  }

  private sendSocketPayload(payload: string, lane: TransportLane = 'system'): void {
    const lag = this.netLag ?? NO_NET_LAG;
    const { delayMs, deliveryAt } = orderedLagDelayMs(lag.upstreamMs, lag.jitterMs, this.nextUpstreamDeliveryAt ?? 0);
    this.nextUpstreamDeliveryAt = deliveryAt;
    predictionTrace.record('socket-send-scheduled', {
      ...tracePayload(payload),
      lane,
      delayMs: traceRound(delayMs),
      upstreamMs: lag.upstreamMs,
      jitterMs: lag.jitterMs,
    });
    if (delayMs <= 0 && this.upstreamQueue.length === 0) {
      predictionTrace.record('socket-send-delivered', { ...tracePayload(payload), lane });
      this.ws.send(payload);
      return;
    }
    this.upstreamQueue.push({ payload, deliveryAt, lane });
    this.scheduleLagDelivery('up');
  }

  private receiveSocketMessage(raw: string): void {
    const lag = this.netLag ?? NO_NET_LAG;
    const { delayMs, deliveryAt } = orderedLagDelayMs(lag.downstreamMs, lag.jitterMs, this.nextDownstreamDeliveryAt ?? 0);
    this.nextDownstreamDeliveryAt = deliveryAt;
    predictionTrace.record('socket-receive-scheduled', {
      ...tracePayload(raw),
      delayMs: traceRound(delayMs),
      downstreamMs: lag.downstreamMs,
      jitterMs: lag.jitterMs,
    });
    if (delayMs <= 0 && this.downstreamQueue.length === 0) {
      predictionTrace.record('socket-receive-delivered', tracePayload(raw));
      this.onMessage(raw);
      return;
    }
    this.downstreamQueue.push({ payload: raw, deliveryAt });
    this.scheduleLagDelivery('down');
  }

  private scheduleLagDelivery(direction: 'up' | 'down'): void {
    const queue = direction === 'up' ? this.upstreamQueue : this.downstreamQueue;
    if (queue.length === 0) return;
    if (direction === 'up' ? this.upstreamTimer : this.downstreamTimer) return;
    const delay = Math.max(0, queue[0].deliveryAt - nowMs());
    const timer = setTimeout(() => {
      this.lagTimers?.delete(timer);
      if (direction === 'up') this.upstreamTimer = null;
      else this.downstreamTimer = null;
      this.deliverLagQueue(direction);
    }, delay);
    if (direction === 'up') this.upstreamTimer = timer;
    else this.downstreamTimer = timer;
    (this.lagTimers ??= new Set()).add(timer);
  }

  private deliverLagQueue(direction: 'up' | 'down'): void {
    const queue = direction === 'up' ? this.upstreamQueue : this.downstreamQueue;
    const now = nowMs() + 0.5;
    while (queue.length > 0 && queue[0].deliveryAt <= now) {
      const frame = queue.shift()!;
      if (direction === 'up') {
        if (this.ws.readyState === WebSocket.OPEN) {
          predictionTrace.record('socket-send-delivered', { ...tracePayload(frame.payload), lane: frame.lane ?? 'system' });
          this.ws.send(frame.payload);
        }
      } else {
        predictionTrace.record('socket-receive-delivered', tracePayload(frame.payload));
        this.onMessage(frame.payload);
      }
    }
    this.scheduleLagDelivery(direction);
  }

  private inputSignature(): string {
    const mi = this.moveInput;
    const facing = this.mouselookFacing === null ? '' : Math.round(this.mouselookFacing * 10000).toString();
    return [
      mi.forward ? 1 : 0, mi.back ? 1 : 0,
      mi.turnLeft ? 1 : 0, mi.turnRight ? 1 : 0,
      mi.strafeLeft ? 1 : 0, mi.strafeRight ? 1 : 0,
      mi.jump ? 1 : 0, facing,
    ].join(',');
  }

  private sendMoveCommand(command: MoveCommand, sig = this.inputSignature()): void {
    const mi = command.moveInput;
    const msg: Record<string, unknown> = {
      t: 'input',
      seq: command.seq,
      mi: {
        f: mi.forward ? 1 : 0, b: mi.back ? 1 : 0,
        tl: mi.turnLeft ? 1 : 0, tr: mi.turnRight ? 1 : 0,
        sl: mi.strafeLeft ? 1 : 0, sr: mi.strafeRight ? 1 : 0,
        j: mi.jump ? 1 : 0,
      },
    };
    if (command.facing !== null) msg.facing = command.facing;
    predictionTrace.record('input-send', {
      seq: command.seq,
      input: traceInput(mi),
      facing: command.facing === null ? null : traceRound(command.facing),
    });
    this.sendSocketPayload(JSON.stringify(msg), 'movement');
    this.lastInputSentAt = command.sentAt;
    this.lastInputSig = sig;
    this.pendingInputSeqSentAt.set(command.seq, command.sentAt);
    if (this.pendingInputSeqSentAt.size > 120) {
      const stale = command.seq - 120;
      for (const seq of this.pendingInputSeqSentAt.keys()) {
        if (seq <= stale) this.pendingInputSeqSentAt.delete(seq);
      }
    }
  }

  flushQueuedSnapshot(): boolean {
    const snap = this.queuedSnapshot;
    this.queuedSnapshot = null;
    if (!snap) return false;
    const start = performance.now();
    this.applySnapshot(snap);
    this.markTrace('net.applySnapshot', start, {
      ents: Array.isArray(snap.ents) ? snap.ents.length : 0,
      keep: Array.isArray(snap.keep) ? snap.keep.length : 0,
      hasSelf: !!snap.self,
      entities: this.entities.size,
      snapInterval: this.snapInterval,
    });
    return true;
  }

  stepPrediction(frameDt: number, now = performance.now()): boolean {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) return false;
    const dt = Math.max(0, Math.min(0.25, frameDt));
    this.predictionAccumulator += dt;
    let predicted = false;
    while (this.predictionAccumulator >= DT) {
      predicted = this.predictLocalTick(now) || predicted;
      this.predictionAccumulator -= DT;
    }
    return predicted;
  }

  private canSendCommand(): boolean {
    return this.connected && this.ws.readyState === WebSocket.OPEN;
  }

  private cmd(payload: Record<string, unknown>): void {
    if (!this.canSendCommand()) return;
    const lane = transportLaneForCommand(payload);
    this.applyOptimisticCommand(payload, lane);
    this.sendSocketPayload(JSON.stringify({ t: 'cmd', ...payload }), lane);
  }

  /** Raw WS command — used by dev scripts and browser console when online. */
  devCmd(payload: Record<string, unknown>): void {
    this.cmd(payload);
  }

  predictionTraceState(): Record<string, unknown> {
    const ackLag = Math.max(0, (this.inputSeq ?? 0) - (this.ackedInputSeq ?? 0));
    return {
      inputSeq: this.inputSeq ?? 0,
      ackedInputSeq: this.ackedInputSeq ?? 0,
      ackLag,
      pendingInputs: (this.pendingPredictions ?? []).length,
      predictionMode: this.predictionMovementMode,
    };
  }

  private currentPredictionInputMode(): PredictionInputMode {
    return isIdleMoveInput(this.moveInput) && this.mouselookFacing === null ? 'idle' : 'moving';
  }

  private applyOptimisticCommand(payload: Record<string, unknown>, lane: TransportLane): void {
    if (lane !== 'action') return;
    const command = typeof payload.cmd === 'string' ? payload.cmd : '';
    const optimisticId = ++this.optimisticCommandSeq;
    const player = this.entities.get(this.playerId);
    let applied: string | null = null;

    if (player && command === 'attack') {
      const target = player.targetId === null ? null : this.entities.get(player.targetId);
      if (target && !target.dead) {
        player.autoAttack = true;
        applied = 'autoAttack';
      }
    } else if (player && command === 'stopattack') {
      player.autoAttack = false;
      player.queuedOnSwing = null;
      applied = 'stopAutoAttack';
    } else if (player && command === 'cast' && typeof payload.ability === 'string') {
      const ability = this.known.find((known) => known.def.id === payload.ability);
      if (ability?.def.onNextSwing) {
        player.queuedOnSwing = player.queuedOnSwing === payload.ability ? null : payload.ability;
        const target = player.targetId === null ? null : this.entities.get(player.targetId);
        if (target && !target.dead) player.autoAttack = true;
        applied = 'queuedOnSwing';
      }
    }

    predictionTrace.record('optimistic-command', {
      id: optimisticId,
      lane,
      command,
      applied,
      ability: typeof payload.ability === 'string' ? payload.ability : null,
      targetId: player?.targetId ?? null,
    });
  }

  private markTrace(name: string, startMs: number, detail?: Record<string, unknown>): void {
    this.traceSink?.(name, startMs, performance.now() - startMs, detail);
  }

  private renderedPose(e: Entity, alpha: number): RenderPose {
    const a = Math.max(0, alpha);
    const facingAlpha = Math.min(1, a);
    return {
      pos: {
        x: e.prevPos.x + (e.pos.x - e.prevPos.x) * a,
        y: e.prevPos.y + (e.pos.y - e.prevPos.y) * a,
        z: e.prevPos.z + (e.pos.z - e.prevPos.z) * a,
      },
      facing: e.prevFacing + wrapAngle(e.facing - e.prevFacing) * facingAlpha,
    };
  }

  private hasPredictableMovement(input: MoveInput, e: Entity): boolean {
    return !!(input.forward || input.back || input.turnLeft || input.turnRight || input.strafeLeft || input.strafeRight || input.jump)
      || !e.onGround
      || e.vx !== 0
      || e.vz !== 0
      || e.vy !== 0;
  }

  private predictTick(frame: MoveCommand, now: number): number {
    const e = this.entities.get(this.playerId);
    if (!e || e.dead) return 0;
    return this.prediction().applyCommand(e, frame, now).predictedDist;
  }

  private recordInputSkip(reason: string, now: number, detail: Record<string, unknown> = {}): void {
    const e = this.entities.get(this.playerId);
    predictionTrace.record('input-skip', {
      reason,
      predictionMode: this.predictionMovementMode,
      connected: this.connected,
      readyState: this.ws?.readyState ?? null,
      inputSeq: this.inputSeq ?? 0,
      ackedInputSeq: this.ackedInputSeq ?? 0,
      pending: (this.pendingPredictions ?? []).length,
      lastInputAgeMs: traceRound(now - (this.lastInputSentAt ?? now)),
      input: traceInput(this.moveInput),
      facing: this.mouselookFacing === null ? null : traceRound(this.mouselookFacing),
      player: tracePose(e),
      ...detail,
    });
  }

  private predictLocalTick(now: number): boolean {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) {
      this.recordInputSkip('socket-not-open', now);
      return false;
    }
    const e = this.entities.get(this.playerId);
    if (!e) {
      this.recordInputSkip('missing-player', now);
      return false;
    }
    if (e.dead) {
      this.recordInputSkip('dead-player', now);
      return false;
    }
    const mi = this.moveInput;
    const facing = this.mouselookFacing;
    const sig = this.inputSignature();
    const inputChanged = sig !== this.lastInputSig;
    const hasPredictableMovement = this.hasPredictableMovement(mi, e);
    const inputMode = this.currentPredictionInputMode();
    const leadTicks = Math.max(0, (this.inputSeq ?? 0) - (this.ackedInputSeq ?? 0));
    if (!hasPredictableMovement && facing === null && !inputChanged) {
      if ((this.pendingPredictions ?? []).length > 0) {
        if (now - (this.lastIdleStopSentAt ?? 0) >= IDLE_STOP_RESEND_MS) {
          const frame = this.prediction().makeCommand(++this.inputSeq, ++this.localPredictionTick, mi, facing, now);
          this.lastIdleStopSentAt = now;
          this.sendMoveCommand(frame, sig);
          predictionTrace.record('input-predict', {
            seq: frame.seq,
            localTick: frame.localTick,
            predictionMode: 'idle-stop',
            inputMode,
            leadTicks,
            leadCapped: leadTicks >= MAX_LOCAL_PREDICTION_LEAD_TICKS,
            input: traceInput(mi),
            facing: null,
            inputChanged,
            hasPredictableMovement,
            ackedInputSeq: this.ackedInputSeq ?? 0,
            pendingBefore: (this.pendingPredictions ?? []).length,
            pending: (this.pendingPredictions ?? []).length,
            predictedDist: 0,
            accumulator: traceRound(this.predictionAccumulator),
            before: tracePose(e),
            after: tracePose(e),
            now: traceRound(now),
          });
          return true;
        }
        this.recordInputSkip('idle-with-pending', now, { inputChanged, hasPredictableMovement, inputMode, leadTicks });
      }
      return false;
    }
    const prediction = this.prediction();
    const frame = prediction.makeCommand(++this.inputSeq, ++this.localPredictionTick, mi, facing, now);
    const beforePrediction = tracePose(e);
    const serverDrivenMovement = this.predictionMovementMode === 'server';
    const leadAfterSend = Math.max(0, frame.seq - (this.ackedInputSeq ?? 0));
    const leadCapped = !serverDrivenMovement && leadTicks >= MAX_LOCAL_PREDICTION_LEAD_TICKS;
    const pendingBefore = (this.pendingPredictions ?? []).length;
    let predictedDist = 0;
    if (!serverDrivenMovement) {
      prediction.push(frame);
    }
    if (!serverDrivenMovement && !leadCapped) {
      predictedDist = this.predictTick(frame, now);
    }
    this.sendMoveCommand(frame, sig);
    if (inputMode === 'idle') this.lastIdleStopSentAt = now;
    const afterPrediction = tracePose(e);
    predictionTrace.record('input-predict', {
      seq: frame.seq,
      localTick: frame.localTick,
      predictionMode: serverDrivenMovement ? 'server' : (leadCapped ? 'lead-capped' : 'client'),
      inputMode,
      leadTicks: leadAfterSend,
      leadCapped,
      input: traceInput(mi),
      facing: facing === null ? null : traceRound(facing),
      inputChanged,
      hasPredictableMovement,
      ackedInputSeq: this.ackedInputSeq ?? 0,
      pendingBefore,
      pending: (this.pendingPredictions ?? []).length,
      predictedDist: traceRound(predictedDist),
      accumulator: traceRound(this.predictionAccumulator),
      before: beforePrediction,
      after: afterPrediction,
      now: traceRound(now),
    });
    return true;
  }

  private replayPendingInputs(
    e: Entity,
    ack: number,
    coverage: PredictionAckCoverage | undefined,
    renderedBefore: RenderPose | null,
    preReplayPose: Record<string, unknown> | null,
    now: number,
  ): PredictionReplayResult {
    const replay = this.prediction().replayFromAck(e, ack, coverage, MAX_LOCAL_PREDICTION_LEAD_TICKS);
    const afterReplayPose = tracePose(e);
    const inputMode = this.currentPredictionInputMode();
    const leadTicks = Math.max(0, (this.inputSeq ?? 0) - replay.effectiveAck);
    const correction = this.prediction().reconcilePresentation(e, renderedBefore, now, { inputMode, leadTicks });
    return {
      pendingBefore: replay.pendingBefore,
      dropped: replay.dropped,
      heldCovered: replay.heldCovered,
      replayed: replay.replayed,
      pendingAfter: replay.pendingAfter,
      effectiveAck: replay.effectiveAck,
      capped: replay.capped,
      renderCorrectionDist: traceRound(correction.renderCorrectionDist),
      replayDeltaDist: tracePoseDist(preReplayPose, afterReplayPose),
      anchorMode: correction.anchorMode,
      correctionSmoothMs: correction.correctionSmoothMs,
      inputMode,
      leadTicks,
    };
  }

  private acceptServerDrivenMovement(
    e: Entity,
    ack: number,
    renderedBefore: RenderPose | null,
    preReplayPose: Record<string, unknown> | null,
    now: number,
  ): PredictionReplayResult {
    const pendingBefore = this.pendingPredictions.length;
    this.pendingPredictions.length = 0;
    const afterReplayPose = tracePose(e);
    const renderCorrectionDist = tracePoseDist(traceRenderPose(renderedBefore), afterReplayPose);
    this.prediction().snapPresentationTo(e, now);
    return {
      pendingBefore,
      dropped: pendingBefore,
      heldCovered: 0,
      replayed: 0,
      pendingAfter: 0,
      effectiveAck: ack,
      capped: 0,
      renderCorrectionDist,
      replayDeltaDist: tracePoseDist(preReplayPose, afterReplayPose),
      anchorMode: renderedBefore ? 'snap' : 'none',
      correctionSmoothMs: 0,
      inputMode: 'moving',
      leadTicks: Math.max(0, (this.inputSeq ?? 0) - ack),
    };
  }

  private onMessage(raw: string): void {
    const parseStart = performance.now();
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.markTrace('net.ws.parse', parseStart, { bytes: raw.length, ok: false });
      return;
    }
    this.markTrace('net.ws.parse', parseStart, { bytes: raw.length, type: typeof msg.t === 'string' ? msg.t : 'unknown' });
    if (msg.t === 'hello') {
      const start = performance.now();
      this.playerId = msg.pid;
      this.cfg.seed = msg.seed;
      if (typeof msg.realm === 'string') this.realm = msg.realm;
      if (Array.isArray(msg.softWords)) {
        this.profanityWords = msg.softWords.filter((w: unknown): w is string => typeof w === 'string');
        this.profanityDirty = true;
      }
      this.connected = true;
      this.markTrace('net.hello', start, { softWords: this.profanityWords.length, realm: this.realm });
      return;
    }
    if (msg.t === 'censor') {
      const start = performance.now();
      // live word-list update pushed after an admin edits the filter
      this.profanityWords = Array.isArray(msg.words)
        ? msg.words.filter((w: unknown): w is string => typeof w === 'string')
        : [];
      this.profanityDirty = true;
      this.markTrace('net.censor', start, { words: this.profanityWords.length });
      return;
    }
    if (msg.t === 'error') {
      this.connected = false;
      this.onDisconnect?.(msg.error ?? 'rejected by server');
      return;
    }
    if (msg.t === 'events') {
      const start = performance.now();
      for (const ev of msg.list) this.eventQueue.push(ev as SimEvent);
      this.markTrace('net.events.enqueue', start, { events: Array.isArray(msg.list) ? msg.list.length : 0 });
      return;
    }
    if (msg.t === 'social') {
      const start = performance.now();
      this.socialInfo = { friends: msg.friends ?? [], blocks: msg.blocks ?? [], guild: msg.guild ?? null };
      this.socialDirty = true;
      this.markTrace('net.social', start, {
        friends: Array.isArray(msg.friends) ? msg.friends.length : 0,
        blocks: Array.isArray(msg.blocks) ? msg.blocks.length : 0,
        guildMembers: Array.isArray(msg.guild?.members) ? msg.guild.members.length : 0,
      });
      return;
    }
    if (msg.t === 'socialpos') {
      const start = performance.now();
      // live position refresh for friends/guildmates (drives the world map);
      // merge into the existing roster in place — snapshots own online/offline.
      if (this.socialInfo && Array.isArray(msg.list)) {
        const byId = new Map<number, { x: number; z: number; zone: string; status: PresenceStatus }>();
        for (const e of msg.list) byId.set(e.id, e);
        const apply = (arr: FriendInfo[]) => {
          for (const m of arr) {
            const u = byId.get(m.id);
            if (u) { m.x = u.x; m.z = u.z; m.zone = u.zone; m.status = u.status; m.online = true; }
          }
        };
        apply(this.socialInfo.friends);
        if (this.socialInfo.guild) apply(this.socialInfo.guild.members);
      }
      this.markTrace('net.socialpos', start, { rows: Array.isArray(msg.list) ? msg.list.length : 0 });
      return;
    }
    if (msg.t === 'snap') {
      this.queueSnapshot(msg);
    }
  }

  private queueSnapshot(snap: any): void {
    const tick = typeof snap.tick === 'number' && Number.isFinite(snap.tick) ? Math.floor(snap.tick) : null;
    const queuedTick = typeof this.queuedSnapshot?.tick === 'number' && Number.isFinite(this.queuedSnapshot.tick)
      ? Math.floor(this.queuedSnapshot.tick)
      : null;
    if (tick !== null && queuedTick !== null && tick < queuedTick) {
      predictionTrace.record('snapshot-drop', { tick, queuedTick });
      return;
    }
    this.queuedSnapshot = this.queuedSnapshot ? this.mergeQueuedSnapshot(this.queuedSnapshot, snap) : snap;
    predictionTrace.record('snapshot-queued', {
      tick,
      queuedTick,
      ack: typeof snap.self?.ack === 'number' ? Math.floor(snap.self.ack) : null,
    });
  }

  private mergeQueuedSnapshot(previous: any, next: any): any {
    const merged = {
      ...next,
      self: previous.self && next.self ? { ...previous.self, ...next.self } : (next.self ?? previous.self),
    };
    const previousFull = new Map<number, Record<string, unknown>>();
    for (const w of Array.isArray(previous.ents) ? previous.ents : []) {
      const id = wireId(w);
      if (id !== null && hasWireIdentity(w)) previousFull.set(id, w as Record<string, unknown>);
    }

    const ents: unknown[] = [];
    const included = new Set<number>();
    for (const w of Array.isArray(next.ents) ? next.ents : []) {
      const id = wireId(w);
      if (id === null) {
        ents.push(w);
        continue;
      }
      const prev = previousFull.get(id);
      ents.push(prev && !hasWireIdentity(w)
        ? withPreviousWireIdentity(prev, w as Record<string, unknown>)
        : w);
      included.add(id);
    }

    const keep: number[] = [];
    for (const id of Array.isArray(next.keep) ? next.keep : []) {
      if (typeof id !== 'number' || included.has(id)) continue;
      const prev = previousFull.get(id);
      if (prev) {
        ents.push(prev);
        included.add(id);
      } else {
        keep.push(id);
      }
    }
    merged.ents = ents;
    if (keep.length > 0) merged.keep = keep;
    else delete merged.keep;
    return merged;
  }

  consumeSocialChanged(): boolean {
    const v = this.socialDirty;
    this.socialDirty = false;
    return v;
  }

  consumeProfanityChanged(): boolean {
    const v = this.profanityDirty;
    this.profanityDirty = false;
    return v;
  }

  private applySnapshot(snap: any): void {
    if (typeof snap.tick === 'number' && Number.isFinite(snap.tick)) {
      const tick = Math.floor(snap.tick);
      if (tick < (this.lastSnapshotTick ?? -1)) {
        predictionTrace.record('snapshot-drop', { tick, lastSnapshotTick: this.lastSnapshotTick ?? -1 });
        return;
      }
      this.lastSnapshotTick = tick;
    }
    const now = performance.now();
    // the interpolation alpha the render loop reached on its last frame
    // (same formula and caps as main.ts); used below to re-anchor the new
    // interpolation segment at the pose currently on screen
    const contAlpha = this.lastSnapAt > 0
      ? Math.min(1.25, (now - this.lastSnapAt) / Math.max(20, this.snapInterval))
      : 1;
    const prevSelf = this.entities.get(this.playerId);
    const renderedSelfBefore = prevSelf
      ? (this.predictionController ? this.prediction().renderPose(prevSelf, now) : this.renderedPose(prevSelf, contAlpha))
      : null;
    const selfBeforeSnapshot = tracePose(prevSelf);
    const renderedSelfTrace = renderedSelfBefore ? {
      x: traceRound(renderedSelfBefore.pos.x),
      y: traceRound(renderedSelfBefore.pos.y),
      z: traceRound(renderedSelfBefore.pos.z),
      f: traceRound(renderedSelfBefore.facing),
    } : null;
    if (this.lastSnapAt > 0) {
      const gap = now - this.lastSnapAt;
      if (gap > 5 && gap < 500) this.snapInterval = this.snapInterval * 0.9 + gap * 0.1;
    }
    this.lastSnapAt = now;

    const seen = new Set<number>();
    const prevSelfFacing = prevSelf?.facing;
    let addedEntities = 0;
    let fullRecords = 0;
    let liteRecords = 0;
    let skippedLiteRecords = 0;
    let teleportSnaps = 0;

    const applyWire = (w: any): Entity | null => {
      let e = this.entities.get(w.id);
      // identity fields ride only in "full" records: first sight and changes
      const hasIdentity = w.k !== undefined;
      if (hasIdentity) fullRecords++;
      else liteRecords++;
      if (!e) {
        // a lite record for an entity we never met would render as a
        // half-initialized ghost; skip it (the server sends identity first)
        if (!hasIdentity) {
          skippedLiteRecords++;
          return null;
        }
        e = blankEntity(w.id);
        e.pos = { x: w.x, y: w.y, z: w.z };
        copyPos(e.prevPos, e.pos);
        e.facing = w.f;
        e.prevFacing = w.f;
        this.entities.set(w.id, e);
        addedEntities++;
      }
      if (hasIdentity) {
        e.kind = w.k;
        e.templateId = w.tid;
        e.name = w.nm;
        e.level = w.lv;
        e.skin = w.sk ?? 0;
        e.scale = w.sc ?? 1;
        e.color = w.c ?? 0xffffff;
        e.dungeonId = w.dgn ?? null;
        e.objectItemId = w.obj ?? null;
        if (e.kind === 'npc') {
          const def = NPCS[e.templateId];
          e.questIds = def ? [...def.questIds] : [];
          e.vendorItems = def?.vendorItems ? [...def.vendorItems] : [];
        }
      }
      // interpolation bases: re-anchor at the pose the renderer last drew,
      // not at the previous server pose — when a frame extrapolated past the
      // last update, restarting from the server pose snapped entities
      // backwards every snapshot (visible rubber-banding while running).
      // Non-self entities are drawn on their per-entity clock (renderer.sync),
      // so the continuation alpha comes from that same clock; self stays on
      // the global snapshot clock the camera follow uses.
      const prevUpdatedAt = e.netUpdatedAt;
      const prevInterval = e.netInterval;
      const entAlpha = w.id !== this.playerId && prevUpdatedAt !== undefined && prevInterval !== undefined
        ? Math.min(1.25, (now - prevUpdatedAt) / Math.max(20, prevInterval))
        : contAlpha;
      const entFacingAlpha = Math.min(1, entAlpha);
      // per-entity update clock: distant entities are sent below snapshot
      // rate, so each one interpolates over its own measured cadence. Only
      // gaps within the slowest legitimate cadence count — records also
      // pause while an entity's state is unchanged, and folding an idle
      // period into the estimate would smear its next steps in slow motion
      if (prevUpdatedAt !== undefined) {
        const gap = now - prevUpdatedAt;
        if (gap > 5 && gap < 450) {
          e.netInterval = prevInterval === undefined ? gap : prevInterval * 0.7 + gap * 0.3;
        }
      }
      e.netUpdatedAt = now;
      // A teleport (arena pit, dungeon portal, graveyard release) jumps an
      // entity far further than any single walking update could. Interpolating
      // across that gap streaks it across the map — and when its per-entity
      // interpolation clock isn't established yet, the renderer falls back to
      // the global alpha and the entity sticks at its old pose until its next
      // real update (e.g. taking damage). Snap both poses to the destination so
      // it appears exactly where the server placed it.
      const teleDx = w.x - e.pos.x, teleDz = w.z - e.pos.z;
      const wasDead = e.dead;
      const wasLootable = e.lootable;
      const previousHp = e.hp;
      const nowDead = !!w.dead;
      if ((wasDead && !nowDead) || teleDx * teleDx + teleDz * teleDz > TELEPORT_SNAP_DIST_SQ) {
        e.prevPos = { x: w.x, y: w.y, z: w.z };
        e.prevFacing = w.f;
        teleportSnaps++;
      } else {
        e.prevPos = {
          x: e.prevPos.x + (e.pos.x - e.prevPos.x) * entAlpha,
          y: e.prevPos.y + (e.pos.y - e.prevPos.y) * entAlpha,
          z: e.prevPos.z + (e.pos.z - e.prevPos.z) * entAlpha,
        };
        e.prevFacing = e.prevFacing + wrapAngle(e.facing - e.prevFacing) * entFacingAlpha;
      }
      e.pos.x = w.x; e.pos.y = w.y; e.pos.z = w.z;
      e.facing = w.f;
      e.hp = w.hp;
      e.maxHp = w.mhp;
      e.overheadEmoteId = isOverheadEmoteId(w.emo) ? w.emo : null;
      e.overheadEmoteUntil = e.overheadEmoteId ? Number.POSITIVE_INFINITY : 0;
      if (typeof w.emoSeq === 'number') e.overheadEmoteSeq = w.emoSeq;
      e.dead = nowDead;
      e.lootable = !!w.loot;
      e.hostile = !!w.h;
      e.castingAbility = w.cast ?? null;
      e.castRemaining = w.castRem ?? 0;
      e.castTotal = w.castTot ?? 0;
      e.channeling = !!w.chan;
      e.sitting = !!w.sit;
      e.aggroTargetId = w.aggro ?? null;
      e.tappedById = w.tap ?? null;
      e.ownerId = w.own ?? null;
      e.petMode = w.pm ?? 'defensive';
      e.petTauntTimer = w.pt ?? 0;
      e.threat = new Map(w.thr ?? []);
      e.auras = (w.auras ?? []).map((a: any) => ({
        id: a.id, name: a.name, kind: a.kind, remaining: a.rem, duration: a.dur,
        value: typeof a.v === 'number' ? a.v : 0, sourceId: 0, school: 'physical' as const,
      }));
      e.loot = w.lootList ?? null;
      if (wasDead !== e.dead || wasLootable !== e.lootable || (previousHp > 0 && e.hp <= 0)) {
        predictionTrace.record('entity-state', {
          id: e.id,
          kind: e.kind,
          templateId: e.templateId,
          wasDead,
          dead: e.dead,
          previousHp,
          hp: e.hp,
          maxHp: e.maxHp,
          wasLootable,
          lootable: e.lootable,
          x: traceRound(e.pos.x),
          y: traceRound(e.pos.y),
          z: traceRound(e.pos.z),
        });
      }
      return e;
    };

    let phaseStart = performance.now();
    for (const w of snap.ents) {
      if (applyWire(w) !== null) seen.add(w.id);
    }
    this.markTrace('net.snapshot.entities', phaseStart, {
      ents: Array.isArray(snap.ents) ? snap.ents.length : 0,
      seen: seen.size,
      added: addedEntities,
      full: fullRecords,
      lite: liteRecords,
      skippedLite: skippedLiteRecords,
      teleports: teleportSnaps,
    });
    // entities listed in keep are alive but unchanged (or not due an update
    // at their distance tier this snapshot) — just protect them from pruning
    phaseStart = performance.now();
    for (const id of snap.keep ?? []) {
      seen.add(id);
    }
    this.markTrace('net.snapshot.keep', phaseStart, { keep: Array.isArray(snap.keep) ? snap.keep.length : 0, seen: seen.size });

    // self with extended state (always a full record)
    phaseStart = performance.now();
    const s = snap.self;
    const e = s ? applyWire(s) : null;
    if (s && e) {
      seen.add(s.id);
      const previousAck = this.ackedInputSeq ?? 0;
      let ackForReplay = previousAck;
      const snapshotAck = typeof s.ack === 'number' && Number.isFinite(s.ack) ? Math.floor(s.ack) : null;
      const rawAckCoverage = snapshotAck !== null ? predictionAckCoverageFromWire(s) : undefined;
      let ackCoverage: PredictionAckCoverage | undefined;
      if (snapshotAck !== null) {
        const coveredThrough = snapshotAck + (rawAckCoverage?.heldTicks ?? 0);
        if (coveredThrough >= previousAck) {
          ackForReplay = Math.max(snapshotAck, previousAck);
          if (rawAckCoverage && coveredThrough > ackForReplay) {
            ackCoverage = {
              ...rawAckCoverage,
              heldTicks: coveredThrough - ackForReplay,
            };
          }
        }
      }
      this.predictionMovementMode = predictionMovementModeFromWire(s.pmv);
      e.resource = s.res;
      e.maxResource = s.mres;
      e.resourceType = s.rtype;
      if (typeof s.vx === 'number') e.vx = s.vx;
      if (typeof s.vz === 'number') e.vz = s.vz;
      if (typeof s.vy === 'number') e.vy = s.vy;
      if (s.og !== undefined) e.onGround = !!s.og;
      if (typeof s.fy === 'number') e.fallStartY = s.fy;
      const serverPose = traceWirePose(s);
      const preReplayPose = tracePose(e);
      // delta fields: the server omits them while unchanged, so only the
      // snapshots that carry them rebuild the local structures
      if (s.cds !== undefined) e.cooldowns = new Map(Object.entries(s.cds).map(([k, v]) => [k, Number(v)]));
      e.gcdRemaining = s.gcd ?? 0;
      e.comboPoints = s.combo ?? 0;
      e.comboTargetId = s.comboTgt ?? null;
      e.targetId = s.target ?? null;
      e.autoAttack = !!s.auto;
      e.queuedOnSwing = s.queued ?? null;
      e.stats = s.stats ?? e.stats;
      e.attackPower = s.ap ?? 0;
      e.critChance = s.crit ?? 0.05;
      e.dodgeChance = s.dodge ?? 0.05;
      e.weapon = s.weapon ?? e.weapon;
      e.eating = s.eat
        ? { itemId: '', kind: 'food', hpPer2s: 0, manaPer2s: 0, remaining: s.eat.remaining }
        : null;
      e.drinking = s.drk
        ? { itemId: '', kind: 'drink', hpPer2s: 0, manaPer2s: 0, remaining: s.drk.remaining }
        : null;
      this.xp = s.xp ?? 0;
      this.lifetimeXp = s.lxp ?? 0;
      this.prestigeRank = s.prk ?? 0;
      if (s.milestones !== undefined) this.unlockedMilestones = s.milestones;
      this.copper = s.copper ?? 0;
      if (s.inv !== undefined) { this.inventory = s.inv; this.invChanged = true; }
      if (s.buyback !== undefined) { this.vendorBuyback = s.buyback; this.invChanged = true; }
      if (s.equip !== undefined) this.equipment = s.equip;
      if (s.qlog !== undefined) this.questLog = new Map((s.qlog as QuestProgress[]).map((q) => [q.questId, q]));
      if (s.qdone !== undefined) this.questsDone = new Set(s.qdone);
      if (s.qlog !== undefined || s.qdone !== undefined) this.pendingQuestCommands?.clear();
      // talent state (heavy field, sent on change): mirror it, then resolve known
      // with the precomputed modifiers so granted abilities + tweaks show locally.
      if (s.tal !== undefined && s.tal) {
        this.talents = s.tal.alloc ?? emptyAllocation();
        this.talentSpec = s.tal.spec ?? null;
        this.talentRole = s.tal.role ?? null;
        this.loadouts = s.tal.loadouts ?? [];
        this.activeLoadout = typeof s.tal.activeLoadout === 'number' ? s.tal.activeLoadout : -1;
      }
      const talents = this.talents ?? (this.talents = emptyAllocation());
      this.known = abilitiesKnownAt(this.cfg.playerClass, e.level, computeTalentModifiers(this.cfg.playerClass, talents));
      if (s.party !== undefined) this.partyInfo = s.party;
      if (s.marks !== undefined) this.markers = s.marks ?? {}; // null = cleared (no party/disband)
      if (s.trade !== undefined) this.tradeInfo = s.trade;
      if (s.duel !== undefined) this.duelInfo = s.duel;
      if (s.arena !== undefined) this.arenaInfo = s.arena;
      if (s.market !== undefined) this.marketInfo = s.market;
      const replay = this.predictionMovementMode === 'server'
        ? this.acceptServerDrivenMovement(e, ackForReplay, renderedSelfBefore, preReplayPose, now)
        : this.replayPendingInputs(e, ackForReplay, ackCoverage, renderedSelfBefore, preReplayPose, now);
      if (replay.effectiveAck > previousAck) {
        const sentAtBySeq = (this.pendingInputSeqSentAt ??= new Map());
        const echoSamples = (this.inputEchoSamples ??= []);
        for (let seq = previousAck + 1; seq <= replay.effectiveAck; seq++) {
          const sentAt = sentAtBySeq.get(seq);
          if (sentAt !== undefined) {
            echoSamples.push(now - sentAt);
            sentAtBySeq.delete(seq);
          }
        }
        this.ackedInputSeq = replay.effectiveAck;
      }
      const afterReplayPose = tracePose(e);
      predictionTrace.record('snapshot-reconcile', {
        tick: typeof snap.tick === 'number' ? Math.floor(snap.tick) : null,
        time: typeof snap.time === 'number' ? traceRound(snap.time) : null,
        ack: snapshotAck,
        ackForReplay,
        effectiveAck: replay.effectiveAck,
        ackHeldTicks: rawAckCoverage?.heldTicks ?? 0,
        residualHeldTicks: ackCoverage?.heldTicks ?? 0,
        heldCovered: replay.heldCovered,
        predictionMode: this.predictionMovementMode,
        previousAck,
        ackAdvanced: replay.effectiveAck - previousAck,
        ackLag: Math.max(0, (this.inputSeq ?? 0) - replay.effectiveAck),
        inputSeq: this.inputSeq ?? 0,
        snapInterval: traceRound(this.snapInterval),
        contAlpha: traceRound(contAlpha),
        pendingBefore: replay.pendingBefore,
        dropped: replay.dropped,
        replayed: replay.replayed,
        capped: replay.capped,
        pendingAfter: replay.pendingAfter,
        anchorMode: replay.anchorMode,
        inputMode: replay.inputMode,
        leadTicks: replay.leadTicks,
        leadCapped: replay.leadTicks >= MAX_LOCAL_PREDICTION_LEAD_TICKS,
        correctionSmoothMs: replay.correctionSmoothMs,
        renderCorrectionDist: replay.renderCorrectionDist,
        serverDeltaDist: tracePoseDist(selfBeforeSnapshot, serverPose),
        replayDeltaDist: replay.replayDeltaDist,
        renderedBefore: renderedSelfTrace,
        before: selfBeforeSnapshot,
        server: serverPose,
        preReplay: preReplayPose,
        after: afterReplayPose,
      });
      // camera follows server-side facing changes when not mouselooking
      if (prevSelfFacing !== undefined && this.mouselookFacing === null) {
        let d = e.facing - prevSelfFacing;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        this.pendingFacingDelta += d;
      }
    }
    this.markTrace('net.snapshot.self', phaseStart, {
      hasSelf: !!s,
      inventory: s?.inv !== undefined,
      quests: s?.qlog !== undefined || s?.qdone !== undefined,
      talents: s?.tal !== undefined,
      party: s?.party !== undefined,
      socialEntities: seen.size,
    });

    // prune entities that left our interest area
    phaseStart = performance.now();
    let removedEntities = 0;
    for (const [id, entity] of this.entities) {
      if (!seen.has(id)) {
        predictionTrace.record('entity-remove', {
          id,
          kind: entity.kind,
          templateId: entity.templateId,
          dead: entity.dead,
          lootable: entity.lootable,
          hp: entity.hp,
          maxHp: entity.maxHp,
          x: traceRound(entity.pos.x),
          y: traceRound(entity.pos.y),
          z: traceRound(entity.pos.z),
        });
        this.entities.delete(id);
        removedEntities++;
      }
    }
    this.markTrace('net.snapshot.prune', phaseStart, { removed: removedEntities, entities: this.entities.size });
  }

  // -----------------------------------------------------------------------
  // IWorld commands -> network
  // -----------------------------------------------------------------------

  questState(questId: string): QuestState {
    const state = computeQuestState(questId, this.questLog, this.questsDone, this.player.level);
    const pending = this.pendingQuestCommands?.get(questId);
    if ((pending === 'accept' && state === 'available') || (pending === 'turnin' && state === 'ready')) {
      return 'active';
    }
    return state;
  }

  consumeInventoryChanged(): boolean {
    const v = this.invChanged;
    this.invChanged = false;
    return v;
  }

  castAbility(abilityId: string): void {
    this.cmd({ cmd: 'cast', ability: abilityId });
  }
  castAbilityBySlot(slot: number): void {
    this.cmd({ cmd: 'castSlot', slot });
  }
  targetEntity(id: number | null): void {
    // optimistic local update for snappy UI
    const p = this.entities.get(this.playerId);
    if (p) {
      if (id === null) p.targetId = null;
      else {
        const e = this.entities.get(id);
        if (e && (!e.dead || e.lootable)) p.targetId = id;
      }
    }
    this.cmd({ cmd: 'target', id });
  }
  tabTarget(): void {
    this.cmd({ cmd: 'tab' });
  }
  targetNearestFriendly(): void {
    this.cmd({ cmd: 'targetNearestFriendly' });
  }
  friendlyTabTarget(): void {
    this.cmd({ cmd: 'tabFriendly' });
  }
  startAutoAttack(): void {
    this.cmd({ cmd: 'attack' });
  }
  stopAutoAttack(): void {
    this.cmd({ cmd: 'stopattack' });
  }
  interact(): void {
    this.cmd({ cmd: 'interact' });
  }
  lootCorpse(id: number): void {
    this.cmd({ cmd: 'loot', id });
  }
  pickUpObject(id: number): void {
    this.cmd({ cmd: 'pickup', id });
  }
  acceptQuest(questId: string): void {
    if (!this.canSendCommand()) return;
    this.pendingQuestCommands.set(questId, 'accept');
    this.cmd({ cmd: 'accept', quest: questId });
  }
  turnInQuest(questId: string): void {
    if (!this.canSendCommand()) return;
    this.pendingQuestCommands.set(questId, 'turnin');
    this.cmd({ cmd: 'turnin', quest: questId });
  }
  abandonQuest(questId: string): void {
    this.cmd({ cmd: 'abandon', quest: questId });
  }
  equipItem(itemId: string): void {
    this.cmd({ cmd: 'equip', item: itemId });
  }
  useItem(itemId: string): void {
    this.cmd({ cmd: 'use', item: itemId });
  }
  discardItem(itemId: string, count?: number): void {
    this.cmd({ cmd: 'discard', item: itemId, count });
  }
  buyItem(npcId: number, itemId: string): void {
    this.cmd({ cmd: 'buy', npc: npcId, item: itemId });
  }
  sellItem(itemId: string, count?: number): void {
    this.cmd({ cmd: 'sell', item: itemId, count });
  }
  buyBackItem(itemId: string): void {
    this.cmd({ cmd: 'buyback', item: itemId });
  }
  changeSkin(skin: number): void {
    const idx = Math.max(0, Math.min(7, Math.floor(skin)));
    const p = this.entities.get(this.playerId);
    if (p) p.skin = idx;
    this.cmd({ cmd: 'change_skin', skin: idx });
  }
  releaseSpirit(): void {
    this.cmd({ cmd: 'release' });
  }
  chat(text: string): void {
    this.cmd({ cmd: 'chat', text });
  }
  playEmote(emoteId: OverheadEmoteId): void {
    if (!this.player.dead) {
      this.player.overheadEmoteId = emoteId;
      this.player.overheadEmoteUntil = Number.POSITIVE_INFINITY;
      this.player.overheadEmoteSeq += 1;
    }
    this.cmd({ cmd: 'emote', emote: emoteId });
  }
  abandonPet(): void {
    this.cmd({ cmd: 'pet_abandon' });
  }
  renamePet(name: string): void {
    this.cmd({ cmd: 'pet_rename', name });
  }
  revivePet(): void {
    this.cmd({ cmd: 'pet_revive' });
  }
  petAttack(): void {
    this.cmd({ cmd: 'pet_attack' });
  }
  petTaunt(): void {
    this.cmd({ cmd: 'pet_taunt' });
  }
  feedPet(itemId: string): void {
    this.cmd({ cmd: 'pet_feed', item: itemId });
  }
  healPet(): void {
    this.cmd({ cmd: 'pet_heal' });
  }
  setPetMode(mode: 'passive' | 'defensive' | 'aggressive'): void {
    this.cmd({ cmd: 'pet_mode', mode });
  }
  // social systems
  partyInvite(targetPid: number): void {
    this.cmd({ cmd: 'pinvite', id: targetPid });
  }
  partyAccept(): void {
    this.cmd({ cmd: 'paccept' });
  }
  partyDecline(): void {
    this.cmd({ cmd: 'pdecline' });
  }
  partyLeave(): void {
    this.cmd({ cmd: 'pleave' });
  }
  partyKick(targetPid: number): void {
    this.cmd({ cmd: 'pkick', id: targetPid });
  }
  // raid/target markers
  markerFor(entityId: number): number | null {
    return this.markers[entityId] ?? null;
  }
  setMarker(entityId: number, markerId: number): void {
    this.cmd({ cmd: 'setMarker', id: entityId, marker: markerId });
  }
  clearMarker(entityId: number): void {
    this.cmd({ cmd: 'clearMarker', id: entityId });
  }
  tradeRequest(targetPid: number): void {
    this.cmd({ cmd: 'trade_req', id: targetPid });
  }
  tradeAccept(): void {
    this.cmd({ cmd: 'trade_accept' });
  }
  tradeSetOffer(items: InvSlot[], copper: number): void {
    this.cmd({ cmd: 'trade_offer', items, copper });
  }
  tradeConfirm(): void {
    this.cmd({ cmd: 'trade_confirm' });
  }
  tradeCancel(): void {
    this.cmd({ cmd: 'trade_cancel' });
  }
  duelRequest(targetPid: number): void {
    this.cmd({ cmd: 'duel_req', id: targetPid });
  }
  duelAccept(): void {
    this.cmd({ cmd: 'duel_accept' });
  }
  duelDecline(): void {
    this.cmd({ cmd: 'duel_decline' });
  }
  // persistent social (resolved server-side by character name)
  friendAdd(name: string): void { this.cmd({ cmd: 'friend_add', name }); }
  friendRemove(name: string): void { this.cmd({ cmd: 'friend_remove', name }); }
  blockAdd(name: string): void { this.cmd({ cmd: 'block_add', name }); }
  blockRemove(name: string): void { this.cmd({ cmd: 'block_remove', name }); }
  guildCreate(name: string): void { this.cmd({ cmd: 'guild_create', name }); }
  guildInvite(name: string): void { this.cmd({ cmd: 'guild_invite', name }); }
  guildAccept(): void { this.cmd({ cmd: 'guild_accept' }); }
  guildDecline(): void { this.cmd({ cmd: 'guild_decline' }); }
  guildLeave(): void { this.cmd({ cmd: 'guild_leave' }); }
  guildKick(name: string): void { this.cmd({ cmd: 'guild_kick', name }); }
  guildPromote(name: string): void { this.cmd({ cmd: 'guild_promote', name }); }
  guildDemote(name: string): void { this.cmd({ cmd: 'guild_demote', name }); }
  guildTransfer(name: string): void { this.cmd({ cmd: 'guild_transfer', name }); }
  guildDisband(): void { this.cmd({ cmd: 'guild_disband' }); }
  async searchCharacters(query: string): Promise<CharacterSearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    try {
      const res = await fetch(`${this.base}/api/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!res.ok) return [];
      return (await res.json()).results ?? [];
    } catch {
      return [];
    }
  }
  arenaQueueJoin(format?: import('../world_api').ArenaFormat): void {
    this.cmd({ cmd: 'arena_queue', format: format ?? '1v1' });
  }
  arenaQueueLeave(): void {
    this.cmd({ cmd: 'arena_leave' });
  }
  marketList(itemId: string, count: number, price: number): void {
    this.cmd({ cmd: 'market_list', item: itemId, count, price });
  }
  marketBuy(listingId: number): void {
    this.cmd({ cmd: 'market_buy', id: listingId });
  }
  marketCancel(listingId: number): void {
    this.cmd({ cmd: 'market_cancel', id: listingId });
  }
  marketCollect(): void {
    this.cmd({ cmd: 'market_collect' });
  }
  enterDungeon(dungeonId: string): void {
    this.cmd({ cmd: 'enter_dungeon', dungeon: dungeonId });
  }
  leaveDungeon(): void {
    this.cmd({ cmd: 'leave_dungeon' });
  }
  async leaderboard(): Promise<LeaderboardEntry[]> {
    try {
      const res = await fetch(`${this.base}/api/leaderboard?metric=lifetimeXp&limit=100`);
      if (!res.ok) return [];
      return (await res.json()).leaders ?? [];
    } catch {
      return [];
    }
  }
  prestige(): void {
    this.cmd({ cmd: 'prestige' });
  }
  // Talents & Specializations — the server re-validates every allocation.
  talentPoints(): { total: number; spent: number } {
    const level = this.entities.get(this.playerId)?.level ?? 1;
    return { total: talentPointsAtLevel(level), spent: pointsSpent(this.talents) };
  }
  applyTalents(alloc: TalentAllocation): void {
    this.cmd({ cmd: 'applyTalents', alloc });
  }
  respec(): void {
    this.cmd({ cmd: 'respec' });
  }
  setSpec(specId: string | null): void {
    this.cmd({ cmd: 'setSpec', spec: specId });
  }
  saveLoadout(name: string, bar: (string | null)[], alloc?: TalentAllocation): void {
    this.cmd({ cmd: 'saveLoadout', name, bar, alloc });
    if (alloc) {
      const clean = (name || 'Build').toString().slice(0, 24);
      const safeBar = Array.isArray(bar) ? bar.slice(0, 16).map((b) => (typeof b === 'string' ? b : null)) : [];
      const saved = { name: clean, alloc: cloneAllocation(alloc), bar: safeBar };
      this.talents = cloneAllocation(alloc);
      const existing = this.loadouts.findIndex((l) => l.name === clean);
      if (existing >= 0) {
        this.loadouts[existing] = saved;
        this.activeLoadout = existing;
      } else {
        this.loadouts = [...this.loadouts, saved];
        this.activeLoadout = this.loadouts.length - 1;
      }
      this.known = abilitiesKnownAt(this.cfg.playerClass, this.player.level, computeTalentModifiers(this.cfg.playerClass, this.talents));
    }
  }
  switchLoadout(index: number): void {
    this.cmd({ cmd: 'switchLoadout', index });
  }
  deleteLoadout(index: number): void {
    this.cmd({ cmd: 'deleteLoadout', index });
    if (index < 0 || index >= this.loadouts.length) return;
    const wasActive = this.activeLoadout === index;
    this.loadouts = this.loadouts.filter((_, i) => i !== index);
    if (wasActive) {
      this.activeLoadout = this.loadouts.length > 0 ? Math.min(index, this.loadouts.length - 1) : -1;
      const next = this.activeLoadout >= 0 ? this.loadouts[this.activeLoadout] : null;
      if (next) {
        this.talents = cloneAllocation(next.alloc);
        this.known = abilitiesKnownAt(this.cfg.playerClass, this.player.level, computeTalentModifiers(this.cfg.playerClass, this.talents));
      }
    } else if (this.activeLoadout > index) this.activeLoadout -= 1;
  }
  // legacy aliases kept for older scripts
  enterCrypt(): void {
    this.enterDungeon('hollow_crypt');
  }
  leaveCrypt(): void {
    this.leaveDungeon();
  }
}
