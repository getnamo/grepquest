import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/engine.ts';
import { createGame, makeScenario, movePlayer, tick, canInterface, connect, submitEvidence, walkable, findPath, distance, inScan, botProgress } from '../src/cyber/model.ts';

test('every seeded objective can be solved with real filtering and a virtual tee', () => {
  for (const seed of [1, 42, 777]) {
    const game = createGame('moderate', seed); game.phase = 'running';
    for (let i = 0; i < game.objectives.length; i++) {
      const objective = game.objectives[i]; game.position = { ...objective.position };
      assert.ok(connect(game));
      const original = { ...game.files };
      const result = execute(objective.solution, { cwd: '/workspace', files: game.files, writablePaths: ['/workspace/' + objective.output] });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(game.files, original, 'the shared engine does not mutate caller state');
      assert.ok(submitEvidence(game, result));
      assert.equal(game.stage, i + 1);
      assert.equal(game.files['/workspace/' + objective.output], objective.expected);
      game.terminalOpen = false;
    }
    assert.equal(game.phase, 'won');
  }
});
test('virtual writes are restricted to explicit paths and never expose host files', () => {
  const { files } = makeScenario(1);
  for (const command of ['echo data | tee /etc/passwd', 'echo data | tee controls/../../etc/passwd', 'echo data | tee logs/routes.log']) {
    const result = execute(command, { cwd: '/workspace', files, writablePaths: ['/workspace/controls/relay.cfg'] });
    assert.equal(result.exitCode, 2); assert.match(result.stderr, /Read-only virtual path/);
  }
  assert.equal(execute('echo data | tee controls/relay.cfg', { cwd: '/workspace', files }).exitCode, 2);
  const result = execute('echo data | tee -a controls/relay.cfg', { cwd: '/workspace', files, writablePaths: ['/workspace/controls/relay.cfg'] });
  assert.equal(result.files!['/workspace/controls/relay.cfg'], 'data\n');
});
test('raw output or an invented echo cannot unlock a node', () => {
  const game = createGame(); game.phase = 'running'; game.position = { ...game.objectives[0].position }; connect(game);
  const state = { cwd: '/workspace', files: game.files, writablePaths: ['/workspace/controls/relay.cfg'] };
  assert.equal(submitEvidence(game, execute('grep ACTIVE logs/routes.log', state)), false);
  assert.equal(submitEvidence(game, execute('cat logs/routes.log | tee controls/relay.cfg', state)), false);
  assert.equal(submitEvidence(game, execute(`echo '${game.objectives[0].expected.trim()}' | tee controls/relay.cfg`, state)), false);
  assert.equal(game.stage, 0);
});
test('node connections require proximity and only the current node can advance', () => {
  const game = createGame(); game.phase = 'running'; assert.equal(canInterface(game), false); assert.equal(connect(game), false);
  game.position = { ...game.objectives[1].position }; assert.equal(connect(game), false);
  game.position = { ...game.objectives[0].position }; assert.ok(connect(game));
  const result = execute(game.objectives[0].solution, { cwd: '/workspace', files: game.files, writablePaths: ['/workspace/controls/relay.cfg'] });
  assert.ok(submitEvidence(game, result)); assert.equal(submitEvidence(game, result), false);
});
test('collision stops at locked gates, world boundaries, and physical cover', () => {
  const game = createGame(); game.phase = 'running';
  game.position = { x: 0, z: 7 }; movePlayer(game, { x: 0, z: -1 }, 1); assert.ok(game.position.z > 5);
  game.stage = 1; movePlayer(game, { x: 0, z: -1 }, 1); assert.ok(game.position.z < 5);
  assert.equal(walkable(game, { x: -6, z: 18 }), false);
  assert.equal(walkable(game, { x: 26, z: 0 }), false);
});
test('tap paths cannot bypass locked gates and can reach the active node', () => {
  const game = createGame(); game.phase = 'running';
  const path = findPath(game, game.objectives[0].position); assert.ok(path.length > 0);
  for (const point of path) assert.ok(walkable(game, point));
  assert.equal(distance(path.at(-1)!, game.objectives[0].position), 0);
  assert.equal(findPath(game, game.objectives[1].position).length, 0);
  game.stage = 1; game.position = { ...game.objectives[0].position };
  assert.ok(findPath(game, game.objectives[1].position).length > 0);
});
test('scan cones account for direction, range, and cover occlusion', () => {
  const patrol = { position: { x: 0, z: 9 }, angle: 0, range: 9, disabled: false };
  assert.ok(inScan({ x: 0, z: 12 }, patrol));
  assert.equal(inScan({ x: 0, z: 4 }, patrol), false);
  assert.equal(inScan({ x: 0, z: 23 }, patrol), false);
  assert.equal(inScan({ x: 0, z: 12 }, { ...patrol, disabled: true }), false);
  assert.equal(inScan({ x: -6, z: 21 }, { position: { x: -6, z: 14 }, angle: 0, range: 9, disabled: false }), false);
});
test('pause freezes both racers, but a shielded terminal does not stop the bot', () => {
  const game = createGame(); game.phase = 'running'; game.paused = true;
  tick(game, 5); assert.equal(game.elapsed, 0); assert.deepEqual(game.bot.position, { x: 19, z: 23 });
  game.paused = false; game.terminalOpen = true; game.trace = 0;
  tick(game, 5); assert.equal(game.elapsed, 5); assert.notDeepEqual(game.bot.position, { x: 19, z: 23 }); assert.equal(game.trace, 0);
});
test('the deterministic rival solves the same objectives and Easy slows it down', () => {
  const moderate = createGame('moderate'), easy = createGame('easy'); moderate.phase = easy.phase = 'running';
  for (let i = 0; i < 6500; i++) { tick(moderate, .1); tick(easy, .1); }
  assert.equal(moderate.phase, 'lost'); assert.equal(moderate.bot.stage, 5);
  assert.equal(easy.phase, 'running'); assert.ok(easy.bot.stage < 5); assert.ok(botProgress(easy) < 1);
  for (const objective of moderate.objectives) assert.equal(moderate.bot.files['/workspace/' + objective.output], objective.expected);
});
test('detection reconnects at a checkpoint without losing liberated controls', () => {
  const game = createGame(); game.phase = 'running';
  game.stage = 1; game.checkpoint = { x: -10, z: 12 }; game.position = { x: 0, z: 12 }; game.trace = 99;
  game.files['/workspace/controls/relay.cfg'] = game.objectives[0].expected;
  tick(game, .1);
  assert.equal(game.detections, 1); assert.deepEqual(game.position, game.checkpoint); assert.equal(game.stage, 1);
  assert.equal(game.trace, 0); assert.ok(game.invulnerable > 0);
  assert.equal(game.files['/workspace/controls/relay.cfg'], game.objectives[0].expected);
});
test('Easy and sneaking each reduce trace buildup', () => {
  const normal = createGame('moderate'), easy = createGame('easy'), sneaking = createGame('moderate');
  for (const game of [normal, easy, sneaking]) { game.phase = 'running'; game.position = { x: 0, z: 12 }; }
  tick(normal, .1); tick(easy, .1); tick(sneaking, .1, true);
  assert.ok(normal.trace > 0); assert.ok(easy.trace < normal.trace); assert.ok(sneaking.trace < normal.trace);
});
