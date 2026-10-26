import { execute, normalize } from '../engine.ts';
import type { Execution, VirtualFiles } from '../engine.ts';
export type Difficulty = 'moderate' | 'easy';
export type Vec = { x: number; z: number };
export interface Objective { name: string; title: string; position: Vec; input: string; output: string; goal: string; skill: string; expected: string; solution: string; hints: string[]; reward: string }
export interface Cover { x: number; z: number; w: number; d: number; h: number }
export const COVERS: Cover[] = [
  { x: -6, z: 18, w: 4, d: 3, h: 3 }, { x: 11, z: 18, w: 4, d: 5, h: 4 },
  { x: -15, z: -1, w: 5, d: 4, h: 4 }, { x: 3, z: 0, w: 4, d: 3, h: 3 },
  { x: 13, z: -16, w: 5, d: 4, h: 5 }, { x: -2, z: -18, w: 3, d: 4, h: 3 },
  { x: -14, z: -30, w: 5, d: 4, h: 5 }, { x: 0, z: -33, w: 3, d: 3, h: 3 },
  { x: 12, z: -44, w: 4, d: 4, h: 5 },
];
export const GATES = [5, -10, -24, -38];
export const START: Vec = { x: 0, z: 23 };
const SETTINGS = { moderate: { botTime: 1, detection: 27, penalty: 6 }, easy: { botTime: 2.4, detection: 12, penalty: 0 } };
export function makeScenario(seed: number): { files: VirtualFiles; objectives: Objective[] } {
  const key = String(1000 + (Math.abs(seed) % 8000));
  const rogueCount = 2 + (Math.abs(seed) % 3);
  const active = `ACTIVE route=relay-${key} auth=user`;
  const allowed = [`ALLOW program=echo-${key} role=free`, 'ALLOW program=memory role=free'];
  const services = ['archive', 'relay', 'uplink'];
  const broadcast = [`SIGNAL OPEN channel=freedom-${key}`, 'SIGNAL READY channel=memory'];
  const files: VirtualFiles = {
    '/workspace/README.md': 'NULL//RUN — infiltrator console\nInspect logs/ and data/; save filtered evidence with tee.\nOnly controls/*.cfg are writable. Commands never reach the host.\nmission: objective | hint: nudge | jack-out: return to the grid\n',
    '/workspace/logs/routes.log': `OFFLINE route=old-${key}\n${active}\nOFFLINE route=dead-end\n`,
    '/workspace/logs/permissions.log': ['DENY program=user role=free', allowed[0], 'ALLOW DECOY program=warden role=system', allowed[1], 'DENY program=unknown role=system'].join('\n') + '\n',
    '/workspace/data/processes.txt': [...Array.from({ length: rogueCount }, (_, i) => `ROGUE pid=${key}${i} type=warden`), 'ROGUE HEALTHCHECK pid=0000 type=test', 'SAFE pid=100 type=archive'].join('\n') + '\n',
    '/workspace/data/services.txt': ['uplink', 'relay', 'archive', 'relay', 'uplink', 'archive', 'relay'].join('\n') + '\n',
    '/workspace/logs/broadcast.log': ['SYSTEM CLOSED channel=warden', ...broadcast, 'SIGNAL CLOSED channel=trap', 'DECOY SIGNAL OPEN channel=warden'].join('\n') + '\n',
  };
  const definitions = [
    { name: 'RELAY', title: 'Find a way in', position: { x: -10, z: 12 }, input: 'logs/routes.log', output: 'controls/relay.cfg', goal: 'Keep the ACTIVE route from logs/routes.log and write that line to controls/relay.cfg with tee.', skill: 'grep → tee', expected: active + '\n', solution: 'grep ACTIVE logs/routes.log | tee controls/relay.cfg', hints: ['Inspect the log with cat or head. Only one route is ACTIVE.', 'grep ACTIVE logs/routes.log keeps the route. Pipe that output into tee controls/relay.cfg.', 'grep ACTIVE logs/routes.log | tee controls/relay.cfg'], reward: 'Relay claimed. The first laser gate is offline.' },
    { name: 'ARCHIVE', title: 'Free the programs', position: { x: 11, z: -2 }, input: 'logs/permissions.log', output: 'controls/permissions.cfg', goal: 'Keep ALLOW records from logs/permissions.log, remove DECOY records, and save the remaining lines to controls/permissions.cfg.', skill: 'pipes · grep -v', expected: allowed.join('\n') + '\n', solution: 'grep ALLOW logs/permissions.log | grep -v DECOY | tee controls/permissions.cfg', hints: ['First keep ALLOW, then remove DECOY. Those are two separate filters.', 'grep -v keeps nonmatching lines. Add tee controls/permissions.cfg as the last stage.', 'grep ALLOW logs/permissions.log | grep -v DECOY | tee controls/permissions.cfg'], reward: 'Archive released. One sentinel has lost its authority.' },
    { name: 'FIREWALL', title: 'Quarantine the threat', position: { x: -10, z: -17 }, input: 'data/processes.txt', output: 'controls/quarantine.cfg', goal: 'Count ROGUE lines in data/processes.txt after excluding HEALTHCHECK. Save only the count to controls/quarantine.cfg.', skill: 'grep · wc -l', expected: String(rogueCount) + '\n', solution: 'grep ROGUE data/processes.txt | grep -v HEALTHCHECK | wc -l | tee controls/quarantine.cfg', hints: ['Find the rogue processes, but discard the healthcheck before counting.', 'Use grep -v HEALTHCHECK, then wc -l, then tee controls/quarantine.cfg.', 'grep ROGUE data/processes.txt | grep -v HEALTHCHECK | wc -l | tee controls/quarantine.cfg'], reward: 'Firewall reversed. Sentinel detection strength is reduced.' },
    { name: 'CORE', title: 'Restore the trusted network', position: { x: 8, z: -31 }, input: 'data/services.txt', output: 'controls/services.cfg', goal: 'Save each distinct service from data/services.txt once, in alphabetical order, to controls/services.cfg.', skill: 'sort · uniq', expected: services.join('\n') + '\n', solution: 'sort data/services.txt | uniq | tee controls/services.cfg', hints: ['Repeated service names are scattered throughout the file.', 'Sort first so duplicates are adjacent. Then use uniq and tee controls/services.cfg.', 'sort data/services.txt | uniq | tee controls/services.cfg'], reward: 'The core is exposed. The final route to the uplink is open.' },
    { name: 'UPLINK', title: 'Broadcast the escape signal', position: { x: -5, z: -44 }, input: 'logs/broadcast.log', output: 'controls/uplink.cfg', goal: 'Keep lines beginning with SIGNAL OPEN or SIGNAL READY from logs/broadcast.log. Save them to controls/uplink.cfg. Exclude prefixed decoys and CLOSED channels.', skill: 'grep -E · anchors', expected: broadcast.join('\n') + '\n', solution: "grep -E '^SIGNAL (OPEN|READY)' logs/broadcast.log | tee controls/uplink.cfg", hints: ['Anchor the search to the beginning of the line with ^. Match OPEN or READY.', 'Use grep -E for alternatives. Quote the expression so | stays inside the pattern.', "grep -E '^SIGNAL (OPEN|READY)' logs/broadcast.log | tee controls/uplink.cfg"], reward: 'Freedom signal broadcast. WARDEN no longer controls this grid.' },
  ];
  for (const objective of definitions) files['/workspace/' + objective.output] = '';
  return { files, objectives: definitions };
}
export interface Game {
  phase: 'briefing' | 'running' | 'won' | 'lost'; difficulty: Difficulty; paused: boolean; terminalOpen: boolean; connectedNode: number;
  seed: number; stage: number; position: Vec; checkpoint: Vec; trace: number; elapsed: number; detections: number; invulnerable: number;
  files: VirtualFiles; objectives: Objective[]; event: string; eventId: number;
  bot: { position: Vec; stage: number; timer: number; command: number; files: VirtualFiles };
}
export function createGame(difficulty: Difficulty = 'moderate', seed = 42): Game {
  const scenario = makeScenario(seed);
  return { phase: 'briefing', difficulty, paused: false, terminalOpen: false, connectedNode: -1, seed, stage: 0, position: { ...START }, checkpoint: { ...START }, trace: 0, elapsed: 0, detections: 0, invulnerable: 0, files: scenario.files, objectives: scenario.objectives, event: 'Reach the relay. Stay outside the red scan cones.', eventId: 0, bot: { position: { x: 19, z: 23 }, stage: 0, timer: 0, command: 0, files: { ...scenario.files } } };
}
export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
function event(game: Game, text: string) { game.event = text; game.eventId++; }
export function walkable(game: Game, point: Vec): boolean {
  if (point.x < -24 || point.x > 24 || point.z < -49 || point.z > 25) return false;
  if (COVERS.some(c => Math.abs(point.x - c.x) < c.w / 2 + .55 && Math.abs(point.z - c.z) < c.d / 2 + .55)) return false;
  if (GATES.some((z, i) => i >= game.stage && Math.abs(point.z - z) < .85)) return false;
  return true;
}
export function movePlayer(game: Game, direction: Vec, dt: number, sneak = false) {
  if (game.phase !== 'running' || game.paused || game.terminalOpen) return;
  const length = Math.hypot(direction.x, direction.z);
  if (!length) return;
  const speed = sneak ? 3.2 : 7;
  const steps = Math.max(1, Math.ceil(dt * speed / .25));
  for (let i = 0; i < steps; i++) {
    const dx = direction.x / length * speed * dt / steps, dz = direction.z / length * speed * dt / steps;
    const x = { x: game.position.x + dx, z: game.position.z };
    if (walkable(game, x)) game.position.x = x.x;
    const z = { x: game.position.x, z: game.position.z + dz };
    if (walkable(game, z)) game.position.z = z.z;
  }
}
export interface Patrol { position: Vec; angle: number; range: number; disabled: boolean }
export function patrols(game: Game): Patrol[] {
  return [9, -12, -29].map((z, index) => ({ position: { x: Math.sin(game.elapsed * .22 + index * 2.1) * 16, z }, angle: game.elapsed * .45 + index * 1.9, range: 9, disabled: index === 0 && game.stage >= 2 }));
}
function blockedByCover(a: Vec, b: Vec): boolean {
  const length = distance(a, b);
  for (let t = .25; t < length; t += .3) {
    const p = { x: a.x + (b.x - a.x) * t / length, z: a.z + (b.z - a.z) * t / length };
    if (COVERS.some(c => Math.abs(p.x - c.x) < c.w / 2 && Math.abs(p.z - c.z) < c.d / 2)) return true;
  }
  return false;
}
export function inScan(player: Vec, patrol: Patrol): boolean {
  const dx = player.x - patrol.position.x, dz = player.z - patrol.position.z, dist = Math.hypot(dx, dz);
  return !patrol.disabled && dist < patrol.range && (dist < 1.8 || (dx * Math.sin(patrol.angle) + dz * Math.cos(patrol.angle)) / dist > Math.cos(.52)) && !blockedByCover(patrol.position, player);
}
export function canInterface(game: Game) { return game.phase === 'running' && !game.paused && game.stage < game.objectives.length && distance(game.position, game.objectives[game.stage].position) <= 2.8; }
export function connect(game: Game): boolean {
  if (!canInterface(game)) return false;
  game.terminalOpen = true; game.connectedNode = game.stage;
  event(game, 'Shielded terminal connection. ECHO-9 keeps racing.'); return true;
}
export function submitEvidence(game: Game, result: Execution): boolean {
  if (game.phase !== 'running' || !game.terminalOpen || game.connectedNode !== game.stage || result.exitCode !== 0 || result.stderr || !result.files) return false;
  game.files = { ...result.files };
  const objective = game.objectives[game.stage];
  const expectedPath = '/workspace/' + objective.output;
  const wroteControl = result.stages.some(s => s.command === 'tee' && s.args.some(a => normalize(a, result.cwd) === expectedPath));
  if (!wroteControl || result.stages.some(s => s.isHelp || s.action || s.command === 'echo') || game.files[expectedPath]?.trim() !== objective.expected.trim()) return false;
  game.checkpoint = { ...objective.position }; game.trace = 0; game.stage++;
  event(game, objective.reward);
  if (game.stage === game.objectives.length) { game.phase = 'won'; game.terminalOpen = false; }
  return true;
}
export function advanceBot(game: Game, dt: number) {
  if (game.bot.stage >= game.objectives.length) return;
  const objective = game.objectives[game.bot.stage];
  const dist = distance(game.bot.position, objective.position);
  if (dist > .3) {
    const step = Math.min(dist, dt * 4.2);
    game.bot.position.x += (objective.position.x - game.bot.position.x) / dist * step;
    game.bot.position.z += (objective.position.z - game.bot.position.z) / dist * step;
    return;
  }
  game.bot.timer += dt;
  const delay = [75, 90, 105, 105, 120][game.bot.stage] * SETTINGS[game.difficulty].botTime;
  const commands = [`head -n 3 ${objective.input}`, objective.solution];
  if (game.bot.timer < delay / commands.length) return;
  game.bot.timer = 0;
  const result = execute(commands[game.bot.command], { cwd: '/workspace', files: game.bot.files, writablePaths: ['/workspace/' + objective.output] });
  if (result.files) game.bot.files = result.files;
  game.bot.command++;
  if (game.bot.command === commands.length && game.bot.files['/workspace/' + objective.output]?.trim() === objective.expected.trim()) {
    game.bot.stage++; game.bot.command = 0;
    event(game, game.bot.stage === game.objectives.length ? 'ECHO-9 completed recovery. WARDEN has reclaimed the grid.' : `ECHO-9 has secured ${objective.name}. Keep moving.`);
    if (game.bot.stage === game.objectives.length) { game.phase = 'lost'; game.terminalOpen = false; }
  }
}
export function tick(game: Game, dt: number, sneak = false) {
  if (game.phase !== 'running' || game.paused || dt <= 0) return;
  game.elapsed += dt;
  game.invulnerable = Math.max(0, game.invulnerable - dt);
  advanceBot(game, dt);
  if (game.phase !== 'running') return;
  const spotted = !game.terminalOpen && game.invulnerable === 0 && patrols(game).some(p => inScan(game.position, p));
  game.trace = Math.max(0, Math.min(100, game.trace + (spotted ? SETTINGS[game.difficulty].detection * (sneak ? .5 : 1) * (game.stage >= 3 ? .6 : 1) : -15) * dt));
  if (game.trace >= 100) {
    game.position = { ...game.checkpoint }; game.trace = 0; game.detections++; game.invulnerable = 4;
    advanceBot(game, SETTINGS[game.difficulty].penalty);
    event(game, 'Detected. Reconnected at your last liberated node. Your solved controls are preserved.');
  }
}
export function botProgress(game: Game): number {
  if (game.bot.stage >= game.objectives.length) return 1;
  const delay = [75, 90, 105, 105, 120][game.bot.stage] * SETTINGS[game.difficulty].botTime;
  return (game.bot.stage + Math.min(.98, game.bot.command / 2 + game.bot.timer / delay)) / game.objectives.length;
}
// Grid A*: tap-to-move follows collision-safe paths; keyboard input can interrupt it.
export function findPath(game: Game, target: Vec): Vec[] {
  const key = (p: Vec) => `${p.x},${p.z}`;
  const start = { x: Math.round(game.position.x / 2) * 2, z: Math.round(game.position.z / 2) * 2 };
  const end = { x: Math.round(target.x / 2) * 2, z: Math.round(target.z / 2) * 2 };
  if (!walkable(game, target) || !walkable(game, end)) return [];
  const open = [start], score = new Map([[key(start), 0]]), previous = new Map<string, Vec>(), closed = new Set<string>();
  for (let steps = 0; open.length && steps < 1600; steps++) {
    open.sort((a, b) => (score.get(key(a))! + distance(a, end)) - (score.get(key(b))! + distance(b, end)));
    const current = open.shift()!, id = key(current);
    if (closed.has(id)) continue;
    if (distance(current, end) < .1) {
      const path = [end]; let cursor = current;
      while (previous.has(key(cursor))) { cursor = previous.get(key(cursor))!; path.unshift(cursor); }
      path.shift(); path.push(target); return path;
    }
    closed.add(id);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const next = { x: current.x + dx, z: current.z + dz };
      const midpoint = { x: current.x + dx / 2, z: current.z + dz / 2 };
      if (!walkable(game, next) || !walkable(game, midpoint) || closed.has(key(next))) continue;
      const value = score.get(id)! + 2;
      if (value < (score.get(key(next)) ?? Infinity)) { score.set(key(next), value); previous.set(key(next), current); open.push(next); }
    }
  }
  return [];
}
