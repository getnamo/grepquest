import test from 'node:test';
import assert from 'node:assert/strict';
import { completeShell, completeLobby } from '../src/multiplayer/completion.ts';
import { LocalPrediction, SnapshotInterpolation } from '../src/multiplayer/netcode.ts';
import { createRace, raceSnapshot, stepRace, queueMovement, resetMovement, MOVEMENT_STEP, radius } from '../src/multiplayer/arena.ts';
const paths = ['/workspace/README.md', '/workspace/logs/routes.log', '/workspace/logs/permissions.log', '/workspace/data/services.txt', '/workspace/controls/relay.cfg', '/workspace/docs/search notes.txt', '/workspace/.env.example'];
const complete = (line: string, cwd = '/workspace', cursor = line.length) => completeShell(line, cursor, cwd, paths);
function race() { const r = createRace('1234', [{ id: 'self', name: 'Self' }, { id: 'other', name: 'Other' }], 'easy', 42, 0); r.phase = 'running'; r.racers.forEach(p => p.invulnerable = 999); return r; }
test('shell completion handles commands, pipeline stages, help and flags', () => {
  assert.equal(complete('gr').value, 'grep');
  assert.equal(complete('cat README.md | gr').value, 'cat README.md | grep');
  assert.equal(complete('help gr').value, 'help grep');
  assert.equal(complete('help pi').value, 'help pipes');
  assert.equal(complete('grep --he').value, 'grep --help');
  assert.ok(complete('grep -').matches.includes('-v'));
  assert.equal(complete("echo 'x|y' | so").value, "echo 'x|y' | sort");
});
test('path completion follows cwd, directories, absolute paths and -- operands', () => {
  assert.equal(complete('cat log').value, 'cat logs/');
  assert.equal(complete('grep ACTIVE logs/rou').value, 'grep ACTIVE logs/routes.log');
  assert.equal(complete('cat rou', '/workspace/logs').value, 'cat routes.log');
  assert.equal(complete('cat ../data/ser', '/workspace/logs').value, 'cat ../data/services.txt');
  assert.equal(complete('cat /workspace/logs/rou').value, 'cat /workspace/logs/routes.log');
  assert.equal(complete('cd data/ser').matches.length, 0);
  assert.equal(complete('grep -- -pattern logs/rou').value, 'grep -- -pattern logs/routes.log');
  assert.equal(complete('grep -e ACTIVE logs/rou').value, 'grep -e ACTIVE logs/routes.log');
  assert.equal(complete('grep ACT').matches.length, 0);
  assert.equal(complete('head -n ').matches.length, 0);
  assert.equal(complete('cat .en').value, 'cat .env.example');
});
test('quoted and escaped filenames stay valid shell arguments', () => {
  assert.equal(complete("cat 'docs/se").value, "cat 'docs/search notes.txt'");
  assert.equal(complete('cat "docs/se').value, 'cat "docs/search notes.txt"');
  assert.equal(complete('cat docs/se').value, 'cat docs/search\\ notes.txt');
  assert.equal(complete('cat docs/search\\ n').value, 'cat docs/search\\ notes.txt');
  const line = 'cat logs/rou | wc -l';
  assert.equal(complete(line, '/workspace', line.indexOf(' |')).value, 'cat logs/routes.log | wc -l');
});
test('ambiguous completion shows choices and preserves the typed prefix', () => {
  const result = complete('cat logs/');
  assert.equal(result.value, 'cat logs/'); assert.deepEqual(result.matches, ['logs/permissions.log', 'logs/routes.log']);
  assert.equal(complete('cat does-not-exist').matches.length, 0);
});
test('lobby completion supplies commands, room IDs and create options', () => {
  assert.equal(completeLobby('/cr', 3, []).value, '/create');
  assert.equal(completeLobby('/join 12', 8, ['1234', '5678']).value, '/join 1234');
  assert.equal(completeLobby('/create 4 ea', 12, []).value, '/create 4 easy');
  assert.ok(completeLobby('/create ', 8, []).matches.includes('3'));
  assert.equal(completeLobby('plain chat', 10, []).matches.length, 0);
});
test('local movement starts before a packet or server acknowledgement exists', () => {
  const r = race(), prediction = new LocalPrediction(); prediction.receive(raceSnapshot(r, 4000), 'self', 0);
  const position = prediction.update({ x: 0, y: 1, sneak: false }, 1 / 120, 8);
  assert.ok(position && position.z < 44); assert.equal(prediction.packet(), undefined);
});
test('prediction replays unacknowledged inputs against server collision steps', () => {
  const r = race(), prediction = new LocalPrediction(); prediction.receive(raceSnapshot(r, 4000), 'self', 0);
  let presented;
  for (let i = 1; i <= 24; i++) {
    presented = prediction.update({ x: 0, y: 1, sneak: false }, MOVEMENT_STEP, i * 1000 / 60);
    if (i % 2 === 0) { const packet = prediction.packet(); if (packet) assert.ok(queueMovement(r.racers[0], packet.epoch, packet.frames)); }
    stepRace(r, MOVEMENT_STEP, 4000 + i * 1000 / 60);
    if (i % 2 === 0) prediction.receive(raceSnapshot(r, 4000 + i * 1000 / 60), 'self', i * 1000 / 60);
  }
  assert.ok(presented && Math.abs(presented.z - (44 - 7 * 24 / 60)) < 1e-7);
  assert.ok(prediction.unacknowledged <= 2); assert.ok(r.racers[0].movement.acknowledged >= 22);
});
test('server bounds movement by elapsed time rather than input packet count', () => {
  const r = race(), player = r.racers[0];
  const frames = Array.from({ length: 12 }, (_, i) => ({ sequence: i + 1, x: 0, y: 1, sneak: false, navigating: false }));
  assert.ok(queueMovement(player, 0, frames)); stepRace(r, MOVEMENT_STEP, 4000);
  assert.equal(player.movement.acknowledged, 1); assert.ok(44 - player.position.z <= 7 / 60 + 1e-8);
  assert.equal(queueMovement(player, 0, frames), false);
  assert.equal(queueMovement(player, 1, [{ ...frames[0], sequence: 13 }]), false);
});
test('local prediction obeys locked layers, and checkpoints discard old input epochs', () => {
  const r = race(), prediction = new LocalPrediction(); prediction.receive(raceSnapshot(r, 4000), 'self', 0);
  let position;
  for (let i = 1; i <= 100; i++) {
    if (i % 10 === 0) prediction.receive(raceSnapshot(r, 4000), 'self', i * 1000 / 60);
    position = prediction.update({ x: 0, y: 1, sneak: false }, MOVEMENT_STEP, i * 1000 / 60);
  }
  assert.ok(position && radius(position) >= 34.65);
  r.racers[0].position = { x: 0, z: 44 }; r.racers[0].detections++; resetMovement(r.racers[0]);
  prediction.receive(raceSnapshot(r, 5000), 'self', 1700);
  assert.equal(prediction.unacknowledged, 0); assert.deepEqual(prediction.update({ x: 0, y: 0, sneak: false }, 0, 1700), { x: 0, z: 44 });
});
test('waypoint steering is predicted locally using the same collision geometry', () => {
  const r = race(), prediction = new LocalPrediction(); prediction.receive(raceSnapshot(r, 4000), 'self', 0); prediction.setWaypoint({ x: 0, z: 37 });
  let position;
  for (let i = 1; i <= 75; i++) {
    if (i % 10 === 0) prediction.receive(raceSnapshot(r, 4000), 'self', i * 1000 / 60);
    position = prediction.update({ x: 0, y: 0, sneak: false }, MOVEMENT_STEP, i * 1000 / 60);
  }
  assert.ok(position && Math.abs(position.z - 37) < .02); assert.equal(prediction.navigating, false);
});
test('remote positions and patrol time interpolate smoothly between received snapshots', () => {
  const r = race(), interpolation = new SnapshotInterpolation();
  r.elapsed = 1; r.racers[1].position.x = 0; interpolation.receive(raceSnapshot(r, 4000), 1000);
  r.elapsed = 1.1; r.racers[1].position.x = 1; interpolation.receive(raceSnapshot(r, 4100), 1100);
  const a = interpolation.sample(1150, 'self', { x: 2, z: 40 })!, b = interpolation.sample(1166, 'self', { x: 3, z: 40 })!;
  assert.ok(Math.abs(a.racers[1].position.x - .7) < 1e-8);
  assert.ok(b.racers[1].position.x > a.racers[1].position.x); assert.ok(b.elapsed > a.elapsed);
  assert.deepEqual(a.racers[0].position, { x: 2, z: 40 });
  const stale = interpolation.sample(5000, 'self')!; assert.ok(stale.elapsed <= 1.151); assert.equal(stale.racers[1].position.x, 1);
});
test('remote detection teleports snap to the server checkpoint instead of sliding across the arena', () => {
  const r = race(), interpolation = new SnapshotInterpolation(); r.elapsed = 1;
  interpolation.receive(raceSnapshot(r, 4000), 1000); r.elapsed = 1.1; r.racers[1].position = { x: 10, z: -40 }; r.racers[1].detections++;
  interpolation.receive(raceSnapshot(r, 4100), 1100);
  assert.deepEqual(interpolation.sample(1110, 'self')!.racers[1].position, { x: 10, z: -40 });
});
