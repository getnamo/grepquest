import { advanceArenaInput, arenaPath, arenaWalkable, laneAngle, MOVEMENT_STEP } from './arena.ts';
import type { MovementFrame, PublicRacer, RaceSnapshot } from './arena.ts';
import type { Vec } from '../cyber/model.ts';
export interface LocalInput { x: number; y: number; sneak: boolean }
const separation = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
/** Fixed-step local movement with acknowledged-input replay. Only the server decides game events. */
export class LocalPrediction {
  private race?: RaceSnapshot;
  private self?: PublicRacer;
  private position?: Vec;
  private pending: MovementFrame[] = [];
  private accumulator = 0;
  private sequence = 0;
  private sent = 0;
  private receivedAt = 0;
  private correction: Vec = { x: 0, z: 0 };
  private path: Vec[] = [];
  private input: LocalInput = { x: 0, y: 0, sneak: false };
  private presentation?: Vec;
  get epoch() { return this.self?.movementEpoch ?? 0; }
  get navigating() { return this.path.length > 0; }
  get unacknowledged() { return this.pending.length; }
  reset() { this.race = undefined; this.self = undefined; this.position = undefined; this.pending = []; this.path = []; this.sequence = this.sent = 0; this.accumulator = 0; this.correction = { x: 0, z: 0 }; this.presentation = undefined; }
  receive(state: RaceSnapshot, selfId: string, now: number) {
    const own = state.racers.find(p => p.id === selfId); if (!own) return;
    const reset = !this.self || this.race?.id !== state.id || own.movementEpoch !== this.self.movementEpoch || own.detections !== this.self.detections || !own.connected || own.dnf || state.phase !== 'running';
    const previous = this.position && { ...this.position };
    this.race = state; this.self = own; this.receivedAt = now;
    if (reset) { this.pending = []; this.sequence = own.acknowledgedInput; this.sent = this.sequence; this.path = []; this.accumulator = 0; this.correction = { x: 0, z: 0 }; this.presentation = { ...own.position }; }
    else this.pending = this.pending.filter(frame => frame.sequence > own.acknowledgedInput);
    const body = { position: { ...own.position }, stage: own.stage, slot: own.slot };
    if (!own.inTerminal && !own.stunned && !own.dnf && own.connected && state.phase === 'running') for (const frame of this.pending) advanceArenaInput(state, body, frame);
    this.position = body.position;
    if (!reset && previous) {
      if (separation(previous, body.position) > 3) { this.correction = { x: 0, z: 0 }; this.path = []; }
      else { this.correction.x += previous.x - body.position.x; this.correction.z += previous.z - body.position.z; }
    }
  }
  setWaypoint(target: Vec) {
    if (!this.race || !this.self || !this.position) return;
    this.path = arenaPath(this.race, { position: this.position, stage: this.self.stage }, target);
  }
  cancelWaypoint() { this.path = []; }
  private steering(input: LocalInput, duration: number): Omit<MovementFrame, 'sequence'> {
    if (!this.self || !this.position || input.x || input.y) { if (input.x || input.y) this.path = []; return { ...input, navigating: false }; }
    while (this.path.length && separation(this.position, this.path[0]) < .015) this.path.shift();
    if (!this.path.length) return { ...input, navigating: false };
    const dx = this.path[0].x - this.position.x, dz = this.path[0].z - this.position.z;
    const amount = Math.max(Math.hypot(dx, dz), (input.sneak ? 3.2 : 7) * duration), angle = laneAngle(this.self.slot, this.race!.capacity);
    return { x: (dx * Math.sin(angle) - dz * Math.cos(angle)) / amount, y: (-dx * Math.cos(angle) - dz * Math.sin(angle)) / amount, sneak: input.sneak, navigating: true };
  }
  update(input: LocalInput, dt: number, now: number): Vec | undefined {
    this.input = input;
    if (!this.race || !this.self || !this.position) return;
    const active = this.race.phase === 'running' && this.self.connected && !this.self.dnf && now - this.receivedAt < 500;
    const movable = active && !this.self.inTerminal && !this.self.stunned;
    this.accumulator += active ? Math.min(.1, Math.max(0, dt)) : 0;
    if (active) while (this.accumulator + 1e-9 >= MOVEMENT_STEP && this.pending.length < 120) {
      const steering = movable ? this.steering(input, MOVEMENT_STEP) : { x: 0, y: 0, sneak: input.sneak, navigating: false };
      const frame = { ...steering, sequence: ++this.sequence }; this.pending.push(frame);
      if (movable) { const body: { position: Vec; stage: number; slot: number } = { position: this.position!, stage: this.self.stage, slot: this.self.slot }; advanceArenaInput(this.race, body, frame); this.position = body.position; }
      this.accumulator -= MOVEMENT_STEP;
    }
    if (this.pending.length >= 120) this.accumulator = 0;
    const body: { position: Vec; stage: number; slot: number } = { position: { ...this.position! }, stage: this.self.stage, slot: this.self.slot };
    // Preview the partial next physics step so high-refresh displays are not tied to 60 Hz either.
    if (movable && this.accumulator > 0) advanceArenaInput(this.race, body, this.steering(this.input, this.accumulator), this.accumulator);
    const decay = Math.exp(-14 * Math.max(0, dt)); this.correction.x *= decay; this.correction.z *= decay;
    const presented = { x: body.position.x + this.correction.x, z: body.position.z + this.correction.z };
    this.presentation = arenaWalkable(this.race, this.self, presented) ? presented : body.position;
    return { ...this.presentation };
  }
  packet(): { type: 'input'; epoch: number; frames: MovementFrame[] } | undefined {
    const frames = this.pending.filter(frame => frame.sequence > this.sent).slice(0, 12);
    if (!frames.length) return;
    this.sent = frames.at(-1)!.sequence;
    return { type: 'input', epoch: this.epoch, frames };
  }
}
/** Remote actors use a small snapshot buffer; patrol animation follows a continuous render clock. */
export class SnapshotInterpolation {
  private samples: { snapshot: RaceSnapshot; receivedAt: number }[] = [];
  private renderTime = 0;
  readonly delay: number;
  constructor(delay = .08) { this.delay = delay; }
  reset() { this.samples = []; this.renderTime = 0; }
  receive(snapshot: RaceSnapshot, now: number) {
    const latest = this.samples.at(-1);
    if (latest?.snapshot.id !== snapshot.id || snapshot.elapsed < (latest?.snapshot.elapsed ?? 0)) this.reset();
    if (this.samples.at(-1)?.snapshot.elapsed === snapshot.elapsed) this.samples.pop();
    this.samples.push({ snapshot, receivedAt: now }); if (this.samples.length > 40) this.samples.shift();
  }
  sample(now: number, selfId: string, local?: Vec): RaceSnapshot | undefined {
    const latest = this.samples.at(-1); if (!latest) return;
    const state = latest.snapshot, first = this.samples[0];
    const estimate = state.elapsed + Math.min(.2, Math.max(0, (now - latest.receivedAt) / 1000));
    const target = state.phase === 'running' ? Math.max(first.snapshot.elapsed, Math.min(state.elapsed + .05, estimate - this.delay)) : state.elapsed;
    this.renderTime = Math.max(this.renderTime, target);
    let before = first.snapshot, after = state;
    for (const item of this.samples) { if (item.snapshot.elapsed <= this.renderTime) before = item.snapshot; if (item.snapshot.elapsed >= this.renderTime) { after = item.snapshot; break; } }
    const span = after.elapsed - before.elapsed, alpha = span > 0 ? Math.max(0, Math.min(1, (this.renderTime - before.elapsed) / span)) : 1;
    return { ...state, elapsed: this.renderTime, racers: state.racers.map(player => {
      if (player.id === selfId && local) return { ...player, position: { ...local } };
      const a = before.racers.find(p => p.id === player.id), b = after.racers.find(p => p.id === player.id);
      const position = a && b && a.detections === player.detections && b.detections === player.detections && separation(a.position, b.position) < 3 ? { x: a.position.x + (b.position.x - a.position.x) * alpha, z: a.position.z + (b.position.z - a.position.z) * alpha } : { ...player.position };
      return { ...player, position };
    }) };
  }
}
