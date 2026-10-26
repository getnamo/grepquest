import { makeScenario, distance } from '../cyber/model.ts';
import type { Difficulty, Objective, Vec } from '../cyber/model.ts';
import type { Execution, VirtualFiles } from '../engine.ts';
import { normalize } from '../engine.ts';
export const COLORS = ['#65e8f4', '#ed91fa', '#ffd580', '#9bf3ba'];
export const NODE_RADII = [37, 29, 21, 13, 5];
export const LAYERS = [34, 26, 18, 10];
export const NODE_NAMES = ['RELAY', 'ARCHIVE', 'FIREWALL', 'CORE', 'UPLINK'];
export const MOVEMENT_STEP = 1 / 60;
export interface MovementFrame { sequence: number; x: number; y: number; sneak: boolean; navigating: boolean }
export interface MovementState { enabled: boolean; epoch: number; received: number; acknowledged: number; credit: number; frames: MovementFrame[]; navigating: boolean }
export const laneAngle = (slot: number, capacity: number) => Math.PI / 2 + slot * Math.PI * 2 / capacity;
export const polar = (radius: number, angle: number): Vec => ({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
export const radius = (p: Vec) => Math.hypot(p.x, p.z);
export const nodePosition = (slot: number, capacity: number, stage: number) => polar(NODE_RADII[Math.min(stage, 4)], laneAngle(slot, capacity));
export interface ArenaRacer {
  id: string; name: string; slot: number; color: string; position: Vec; checkpoint: Vec; stage: number;
  trace: number; detections: number; invulnerable: number; stunned: number; connected: boolean; disconnectedAt: number; dnf: boolean;
  terminalNode: number; files: VirtualFiles; cwd: string; hints: number[]; input: { x: number; y: number; sneak: boolean; at: number }; path: Vec[];
  movement: MovementState;
}
export interface Race {
  id: string; capacity: number; difficulty: Difficulty; phase: 'countdown' | 'running' | 'finished';
  objectives: Objective[]; racers: ArenaRacer[]; elapsed: number; countdownEndsAt: number; winnerId?: string; reason?: string; finishedAt?: number;
}
export interface PublicRacer { id: string; name: string; slot: number; color: string; position: Vec; stage: number; trace: number; detections: number; connected: boolean; dnf: boolean; inTerminal: boolean; navigating: boolean; stunned: boolean; movementEpoch: number; acknowledgedInput: number }
export interface RaceSnapshot { id: string; capacity: number; difficulty: Difficulty; phase: Race['phase']; elapsed: number; countdownMs: number; winnerId?: string; reason?: string; racers: PublicRacer[] }
export interface RoomSummary { id: string; creator: string; capacity: number; count: number; difficulty: Difficulty; status: 'waiting' | 'countdown' | 'running' | 'finished' }
export interface Presence { id: string; name: string; roomId?: string; wins: number }
export interface LobbyEntry { id: number; at: number; kind: 'chat' | 'system' | 'room' | 'result'; name: string; text: string }
export interface ResultRow { id: string; name: string; color: string; stage: number; detections: number; dnf: boolean; winner: boolean }
export interface PublicTask { name: string; title: string; input: string; output: string; goal: string; skill: string }
export type ServerMessage =
  | { type: 'welcome'; id: string; name: string; token: string; history: LobbyEntry[] }
  | { type: 'lobby'; online: Presence[]; rooms: RoomSummary[]; selfRoomId?: string }
  | { type: 'log'; entry: LobbyEntry }
  | { type: 'notice'; text: string; error?: boolean }
  | { type: 'race'; snapshot: RaceSnapshot; selfId: string }
  | { type: 'terminal'; open: boolean; task?: PublicTask; solved?: boolean; cwd?: string; paths?: string[] }
  | { type: 'shell'; requestId: string; stdout: string; stderr: string; secured?: boolean; ui?: { mode: string }; stages?: Execution['stages']; cwd?: string }
  | { type: 'route'; target: Vec; path: Vec[]; epoch: number; requestId: string }
  | { type: 'result'; roomId: string; elapsed: number; reason: string; rows: ResultRow[] }
  | { type: 'left' };
export function createRace(id: string, members: { id: string; name: string }[], difficulty: Difficulty, seed: number, now = Date.now()): Race {
  const scenario = makeScenario(seed);
  return { id, capacity: members.length, difficulty, phase: 'countdown', objectives: scenario.objectives, elapsed: 0, countdownEndsAt: now + 3000,
    racers: members.map((member, slot) => ({ ...member, slot, color: COLORS[slot], position: polar(44, laneAngle(slot, members.length)), checkpoint: polar(44, laneAngle(slot, members.length)), stage: 0, trace: 0, detections: 0, invulnerable: 3, stunned: 0, connected: true, disconnectedAt: 0, dnf: false, terminalNode: -1, files: { ...scenario.files }, cwd: '/workspace', hints: [0, 0, 0, 0, 0], input: { x: 0, y: 0, sneak: false, at: 0 }, path: [], movement: { enabled: false, epoch: 0, received: 0, acknowledged: 0, credit: 0, frames: [], navigating: false } })) };
}
const coverCache = new Map<number, { x: number; z: number; w: number; d: number; h: number }[]>();
export function arenaCovers(capacity: number) {
  if (!coverCache.has(capacity)) {
    const covers = [];
    for (let slot = 0; slot < capacity; slot++) for (let index = 0; index < 4; index++) {
      const angle = laneAngle(slot, capacity), r = [40, 30, 22, 14][index], offset = index % 2 ? -4 : 4;
      const center = polar(r, angle);
      covers.push({ x: center.x + Math.sin(angle) * offset, z: center.z - Math.cos(angle) * offset, w: 3, d: 3, h: index % 2 ? 4 : 3 });
    }
    coverCache.set(capacity, covers);
  }
  return coverCache.get(capacity)!;
}
export function arenaWalkable(race: Pick<Race, 'capacity'>, racer: Pick<ArenaRacer, 'stage'>, point: Vec): boolean {
  const r = radius(point);
  if (r > 47 || r < 1.2 || (racer.stage < 4 && r < LAYERS[racer.stage] + .65)) return false;
  return !arenaCovers(race.capacity).some(c => Math.abs(c.x - point.x) < c.w / 2 + .5 && Math.abs(c.z - point.z) < c.d / 2 + .5);
}
function move(race: Pick<Race, 'capacity'>, racer: Pick<ArenaRacer, 'stage' | 'position'>, direction: Vec, dt: number, sneak: boolean, analog = false) {
  const length = Math.hypot(direction.x, direction.z); if (!length) return;
  const speed = sneak ? 3.2 : 7, count = Math.max(1, Math.ceil(speed * dt / .2));
  for (let i = 0; i < count; i++) {
    const divisor = analog ? Math.max(1, length) : length;
    const x = { x: racer.position.x + direction.x / divisor * speed * dt / count, z: racer.position.z };
    if (arenaWalkable(race, racer, x)) racer.position.x = x.x;
    const z = { x: racer.position.x, z: racer.position.z + direction.z / divisor * speed * dt / count };
    if (arenaWalkable(race, racer, z)) racer.position.z = z.z;
  }
}
export function arenaPath(race: Pick<Race, 'capacity'>, racer: Pick<ArenaRacer, 'stage' | 'position'>, target: Vec): Vec[] {
  const key = (p: Vec) => `${p.x},${p.z}`;
  const start = { x: Math.round(racer.position.x / 2) * 2, z: Math.round(racer.position.z / 2) * 2 };
  const end = { x: Math.round(target.x / 2) * 2, z: Math.round(target.z / 2) * 2 };
  if (!arenaWalkable(race, racer, target) || !arenaWalkable(race, racer, end)) return [];
  const open = [start], scores = new Map([[key(start), 0]]), prev = new Map<string, Vec>(), closed = new Set<string>();
  for (let steps = 0; open.length && steps < 3000; steps++) {
    open.sort((a, b) => scores.get(key(a))! + distance(a, end) - scores.get(key(b))! - distance(b, end));
    const point = open.shift()!, id = key(point); if (closed.has(id)) continue;
    if (distance(point, end) < .1) {
      const path = [end]; let cursor = point;
      while (prev.has(key(cursor))) { cursor = prev.get(key(cursor))!; path.unshift(cursor); }
      path.shift(); path.push(target); return path;
    }
    closed.add(id);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const next = { x: point.x + dx, z: point.z + dz }, mid = { x: point.x + dx / 2, z: point.z + dz / 2 };
      if (closed.has(key(next)) || !arenaWalkable(race, racer, next) || !arenaWalkable(race, racer, mid)) continue;
      const value = scores.get(id)! + 2;
      if (value < (scores.get(key(next)) ?? Infinity)) { scores.set(key(next), value); prev.set(key(next), point); open.push(next); }
    }
  }
  return [];
}
export function arenaPatrols(race: Pick<RaceSnapshot, 'capacity' | 'elapsed' | 'racers'>) {
  return race.racers.flatMap(racer => [39, 24, 15].map((r, index) => {
    const base = laneAngle(racer.slot, race.capacity), angle = base + .23 + Math.sin(race.elapsed * .28 + index) * .12;
    return { position: polar(r, angle), angle: base + race.elapsed * .5 + index * 1.7, range: 7, disabled: index === 0 && racer.stage >= 2 };
  }));
}
/** The same kinematic collision step runs locally and on the authoritative server. */
export function advanceArenaInput(race: Pick<Race, 'capacity'>, body: Pick<ArenaRacer, 'slot' | 'position' | 'stage'>, input: Pick<MovementFrame, 'x' | 'y' | 'sneak'>, dt = MOVEMENT_STEP) {
  const angle = laneAngle(body.slot, race.capacity);
  move(race, body, { x: Math.sin(angle) * input.x - Math.cos(angle) * input.y, z: -Math.cos(angle) * input.x - Math.sin(angle) * input.y }, dt, input.sneak, true);
}
export function resetMovement(racer: ArenaRacer) {
  racer.movement = { ...racer.movement, epoch: racer.movement.epoch + 1, received: 0, acknowledged: 0, credit: 0, frames: [], navigating: false };
  racer.path = []; racer.input.x = racer.input.y = 0;
}
export function queueMovement(racer: ArenaRacer, epoch: unknown, frames: unknown): boolean {
  if (epoch !== racer.movement.epoch || !Array.isArray(frames) || !frames.length || frames.length > 12) return false;
  const valid: MovementFrame[] = []; let previous = racer.movement.received;
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object' || !Number.isSafeInteger(frame.sequence) || frame.sequence <= previous || frame.sequence > previous + 240 || typeof frame.x !== 'number' || !Number.isFinite(frame.x) || typeof frame.y !== 'number' || !Number.isFinite(frame.y)) return false;
    valid.push({ sequence: frame.sequence, x: Math.max(-1, Math.min(1, frame.x)), y: Math.max(-1, Math.min(1, frame.y)), sneak: frame.sneak === true, navigating: frame.navigating === true }); previous = frame.sequence;
  }
  if (racer.movement.frames.length + valid.length > 60) { resetMovement(racer); return false; }
  racer.movement.enabled = true; racer.movement.received = previous; racer.movement.frames.push(...valid); racer.path = []; return true;
}
function seen(race: Race, racer: ArenaRacer): boolean {
  return arenaPatrols(raceSnapshot(race, 0)).some(p => {
    const dx = racer.position.x - p.position.x, dz = racer.position.z - p.position.z, d = Math.hypot(dx, dz);
    if (p.disabled || d > p.range || (d > 1.5 && (dx * Math.sin(p.angle) + dz * Math.cos(p.angle)) / d < Math.cos(.52))) return false;
    for (let t = .3; t < d; t += .3) {
      const point = { x: p.position.x + dx * t / d, z: p.position.z + dz * t / d };
      if (arenaCovers(race.capacity).some(c => Math.abs(point.x - c.x) < c.w / 2 && Math.abs(point.z - c.z) < c.d / 2)) return false;
    }
    return true;
  });
}
export function finishRace(race: Race, winnerId: string | undefined, reason: string, now = Date.now()) {
  if (race.phase === 'finished') return;
  race.phase = 'finished'; race.winnerId = winnerId; race.reason = reason; race.finishedAt = now;
  for (const racer of race.racers) { racer.terminalNode = -1; resetMovement(racer); }
}
export function forfeit(race: Race, racer: ArenaRacer, now = Date.now()) {
  if (race.phase === 'finished') return;
  racer.dnf = true; racer.connected = false; racer.terminalNode = -1; resetMovement(racer);
  const eligible = race.racers.filter(p => !p.dnf);
  if (eligible.length <= 1) finishRace(race, eligible[0]?.id, eligible.length ? 'Last runner standing' : 'All runners left', now);
}
export function stepRace(race: Race, dt: number, now: number) {
  if (race.phase === 'finished') return;
  if (race.phase === 'countdown') { if (now >= race.countdownEndsAt) race.phase = 'running'; else return; }
  race.elapsed += dt;
  const expired = race.racers.filter(racer => !racer.connected && !racer.dnf && now - racer.disconnectedAt >= 20000);
  for (const racer of expired) { racer.dnf = true; racer.terminalNode = -1; racer.path = []; }
  if (expired.length) {
    const eligible = race.racers.filter(racer => !racer.dnf);
    if (eligible.length <= 1) { finishRace(race, eligible[0]?.id, eligible.length ? 'Last runner standing' : 'All runners disconnected', now); return; }
  }
  for (const racer of race.racers) {
    if (race.finishedAt !== undefined) return;
    if (racer.dnf || !racer.connected) continue;
    racer.invulnerable = Math.max(0, racer.invulnerable - dt); racer.stunned = Math.max(0, racer.stunned - dt);
    const fresh = now - racer.input.at < 350;
    if (racer.movement.enabled) {
      racer.movement.credit = Math.min(.2, racer.movement.credit + dt);
      while (racer.movement.frames.length && racer.movement.credit + 1e-8 >= MOVEMENT_STEP) {
        const frame = racer.movement.frames.shift()!; racer.movement.credit -= MOVEMENT_STEP;
        racer.input = { x: frame.x, y: frame.y, sneak: frame.sneak, at: now };
        if (racer.terminalNode < 0 && !racer.stunned) advanceArenaInput(race, racer, frame);
        racer.movement.acknowledged = frame.sequence; racer.movement.navigating = frame.navigating;
      }
    } else if (racer.terminalNode < 0 && !racer.stunned) {
      if (fresh && (racer.input.x || racer.input.y)) {
        racer.path = []; const angle = laneAngle(racer.slot, race.capacity);
        move(race, racer, { x: Math.sin(angle) * racer.input.x - Math.cos(angle) * racer.input.y, z: -Math.cos(angle) * racer.input.x - Math.sin(angle) * racer.input.y }, dt, racer.input.sneak);
      } else if (racer.path.length) {
        if (distance(racer.position, racer.path[0]) < .08) racer.path.shift();
        if (racer.path.length) { const target = racer.path[0]; move(race, racer, { x: target.x - racer.position.x, z: target.z - racer.position.z }, Math.min(dt, distance(racer.position, target) / (racer.input.sneak ? 3.2 : 7)), racer.input.sneak); }
      }
    }
    const spotted = racer.terminalNode < 0 && !racer.invulnerable && seen(race, racer);
    racer.trace = Math.max(0, Math.min(100, racer.trace + (spotted ? (race.difficulty === 'easy' ? 12 : 27) * (racer.input.sneak && now - racer.input.at < 350 ? .5 : 1) * (racer.stage >= 3 ? .6 : 1) : -15) * dt));
    if (racer.trace >= 100) { racer.position = { ...racer.checkpoint }; racer.trace = 0; racer.detections++; racer.invulnerable = 3; racer.stunned = race.difficulty === 'easy' ? 0 : 1.5; resetMovement(racer); }
  }
  if (race.elapsed >= 1200) {
    const ranked = race.racers.filter(p => !p.dnf).sort((a, b) => b.stage - a.stage || radius(a.position) - radius(b.position));
    finishRace(race, ranked[0]?.id, '20-minute limit: most layers, then nearest the core', now);
  }
}
export function interfaceRace(race: Race, racer: ArenaRacer): boolean {
  if (race.phase !== 'running' || racer.dnf || !racer.connected || racer.stunned || racer.stage >= 5 || distance(racer.position, nodePosition(racer.slot, race.capacity, racer.stage)) > 2.8) return false;
  racer.terminalNode = racer.stage; resetMovement(racer); racer.cwd = '/workspace'; return true;
}
export function acceptEvidence(race: Race, racer: ArenaRacer, result: Execution, now = Date.now()): boolean {
  if (race.phase !== 'running' || !racer.connected || racer.dnf || racer.terminalNode !== racer.stage || result.stderr || result.exitCode !== 0) return false;
  if (result.files) racer.files = { ...result.files };
  const objective = race.objectives[racer.stage], path = '/workspace/' + objective.output;
  if (!result.files || result.stages.some(s => s.command === 'echo' || s.isHelp || s.action) || !result.stages.some(s => s.command === 'tee' && s.args.some(a => normalize(a, result.cwd) === path)) || racer.files[path]?.trim() !== objective.expected.trim()) return false;
  racer.stage++; racer.trace = 0; racer.checkpoint = { ...nodePosition(racer.slot, race.capacity, racer.stage - 1) };
  resetMovement(racer);
  if (racer.stage === 5) finishRace(race, racer.id, 'First to broadcast the escape signal', now);
  return true;
}
export function raceSnapshot(race: Race, now: number): RaceSnapshot {
  return { id: race.id, capacity: race.capacity, difficulty: race.difficulty, phase: race.phase, elapsed: race.elapsed, countdownMs: Math.max(0, race.countdownEndsAt - now), winnerId: race.winnerId, reason: race.reason,
    racers: race.racers.map(p => ({ id: p.id, name: p.name, slot: p.slot, color: p.color, position: { ...p.position }, stage: p.stage, trace: p.trace, detections: p.detections, connected: p.connected, dnf: p.dnf, inTerminal: p.terminalNode >= 0, navigating: p.movement.enabled ? p.movement.navigating : p.path.length > 0, stunned: p.stunned > 0, movementEpoch: p.movement.epoch, acknowledgedInput: p.movement.acknowledged })) };
}
export function resultRows(race: Race): ResultRow[] {
  return [...race.racers].sort((a, b) => Number(b.id === race.winnerId) - Number(a.id === race.winnerId) || Number(a.dnf) - Number(b.dnf) || b.stage - a.stage || radius(a.position) - radius(b.position)).map(p => ({ id: p.id, name: p.name, color: p.color, stage: p.stage, detections: p.detections, dnf: p.dnf, winner: p.id === race.winnerId }));
}
