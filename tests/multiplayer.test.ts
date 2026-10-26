import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { execute } from '../src/engine.ts';
import { createRace, stepRace, acceptEvidence, interfaceRace, nodePosition, arenaPath, arenaWalkable, raceSnapshot, forfeit, resultRows, radius } from '../src/multiplayer/arena.ts';
import type { ServerMessage } from '../src/multiplayer/arena.ts';
import { MultiplayerHub } from '../server/multiplayer.ts';
const members = (n = 2) => Array.from({ length: n }, (_, i) => ({ id: 'player' + i, name: 'Runner' + i }));
test('2–4 runners have symmetric starting positions and identical evidence', () => {
  for (const n of [2, 3, 4]) {
    const race = createRace('1234', members(n), 'moderate', 42, 0);
    for (const player of race.racers) { assert.ok(Math.abs(radius(player.position) - 44) < .001); assert.deepEqual(player.files, race.racers[0].files); assert.notEqual(player.files, race.racers[(player.slot + 1) % n].files); }
    if (n === 2) { assert.ok(Math.abs(race.racers[0].position.z + race.racers[1].position.z) < .001); }
  }
});
test('all circular routes are reachable without bypassing locked layers', () => {
  for (const n of [2, 3, 4]) {
    const race = createRace('1234', members(n), 'easy', 42, 0);
    for (const player of race.racers) for (let stage = 0; stage < 5; stage++) {
      player.stage = stage; player.position = stage ? nodePosition(player.slot, n, stage - 1) : player.checkpoint;
      const target = nodePosition(player.slot, n, stage), path = arenaPath(race, player, target);
      assert.ok(path.length, `${n} players, slot ${player.slot}, stage ${stage}`);
      assert.ok(path.every(point => arenaWalkable(race, player, point)));
      if (stage < 4) assert.equal(arenaPath(race, player, nodePosition(player.slot, n, stage + 1)).length, 0);
    }
  }
});
test('the server model owns movement, proximity, puzzle validation and winners', () => {
  const race = createRace('1234', members(), 'moderate', 42, 0); race.phase = 'running';
  const player = race.racers[0], rival = race.racers[1];
  assert.equal(interfaceRace(race, player), false);
  player.input = { x: 0, y: 999, sneak: false, at: 4000 }; stepRace(race, 1, 4000);
  assert.ok(radius(player.position) >= 34.65); assert.equal(player.stage, 0);
  for (let i = 0; i < 5; i++) {
    player.position = nodePosition(player.slot, 2, i); assert.ok(interfaceRace(race, player));
    const task = race.objectives[i];
    const result = execute(task.solution, { cwd: '/workspace', files: player.files, writablePaths: ['/workspace/' + task.output] });
    assert.ok(acceptEvidence(race, player, result, 5000 + i));
    assert.equal(rival.stage, 0); assert.equal(rival.files['/workspace/' + task.output], '');
    player.terminalNode = -1;
  }
  assert.equal(race.phase, 'finished'); assert.equal(race.winnerId, player.id);
  assert.equal(resultRows(race)[0].winner, true); assert.equal(acceptEvidence(race, rival, execute('pwd', { cwd: '/workspace', files: rival.files })), false);
});
test('raw output, echo and unrelated controls cannot fabricate an unlock', () => {
  const race = createRace('1234', members(), 'easy', 1, 0); race.phase = 'running'; const player = race.racers[0];
  player.position = nodePosition(0, 2, 0); interfaceRace(race, player);
  for (const command of ['grep ACTIVE logs/routes.log', 'cat logs/routes.log | tee controls/relay.cfg', `echo '${race.objectives[0].expected.trim()}' | tee controls/relay.cfg`]) {
    const result = execute(command, { cwd: '/workspace', files: player.files, writablePaths: ['/workspace/controls/relay.cfg'] });
    assert.equal(acceptEvidence(race, player, result), false);
  }
  assert.equal(player.stage, 0);
});
test('countdown and stale input cannot cause movement; public snapshots omit private state', () => {
  const race = createRace('1234', members(), 'moderate', 42, 0), player = race.racers[0];
  player.input = { x: 0, y: 1, sneak: false, at: 0 };
  stepRace(race, .1, 1000); assert.deepEqual(player.position, player.checkpoint);
  stepRace(race, .1, 4000); assert.equal(race.phase, 'running'); assert.deepEqual(player.position, player.checkpoint);
  const serialized = JSON.stringify(raceSnapshot(race, 4000));
  assert.doesNotMatch(serialized, /expected|solution|files|writablePaths|hints|seed/);
});
test('disconnect grace expires fairly and simultaneous disconnects do not award a phantom win', () => {
  const race = createRace('1234', members(), 'moderate', 42, 0); race.phase = 'running';
  race.racers[0].connected = false; race.racers[0].disconnectedAt = 1000;
  stepRace(race, .1, 20000); assert.equal(race.phase, 'running');
  stepRace(race, .1, 21001); assert.equal(race.phase, 'finished'); assert.equal(race.winnerId, race.racers[1].id);
  const allGone = createRace('5678', members(), 'moderate', 42, 0); allGone.phase = 'running';
  allGone.racers.forEach(p => { p.connected = false; p.disconnectedAt = 1000; });
  stepRace(allGone, .1, 21001); assert.equal(allGone.phase, 'finished'); assert.equal(allGone.winnerId, undefined);
});
async function until(predicate: () => boolean, timeout = 3000) {
  const start = Date.now(); while (!predicate()) { if (Date.now() - start > timeout) throw Error('Timed out waiting for multiplayer state.'); await new Promise(resolve => setTimeout(resolve, 15)); }
}
class Driver {
  ws: WebSocket; messages: ServerMessage[] = [];
  constructor(url: string, hello: Record<string, unknown> = {}) { this.ws = new WebSocket(url); this.ws.on('message', data => this.messages.push(JSON.parse(data.toString()))); this.ws.on('open', () => this.send({ type: 'hello', ...hello })); }
  send(message: unknown) { this.ws.send(JSON.stringify(message)); }
  command(text: string) { this.send({ type: 'lobby', text }); }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined { return this.messages.filter(m => m.type === type).at(-1) as Extract<ServerMessage, { type: T }> | undefined; }
  async ready() { await until(() => !!this.last('welcome')); return this; }
  close() { this.ws.terminate(); }
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const server = createServer(), hub = new MultiplayerHub(server); server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number }, drivers: Driver[] = [];
  t.after(async () => { drivers.forEach(d => d.close()); hub.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const client = async (hello: Record<string, unknown> = {}) => { const d = new Driver(`ws://127.0.0.1:${address.port}/ws`, hello); drivers.push(d); await d.ready(); return d; };
  return { server, hub, client, url: `ws://127.0.0.1:${address.port}/ws` };
}
test('lobby broadcasts presence, chat, room numbers, /ls, /join and creator cleanup', async t => {
  const { hub, client } = await fixture(t), host = await client({ name: 'Host' }), guest = await client({ name: 'Guest' });
  await until(() => host.last('lobby')?.online.length === 2);
  host.command('hello grid'); await until(() => guest.last('log')?.entry.text === 'hello grid');
  host.command('/create 4 easy'); await until(() => hub.rooms.size === 1); const room = [...hub.rooms.values()][0];
  guest.command('/ls'); await until(() => guest.last('notice')?.text.includes(room.id) === true);
  guest.command('/join ' + room.id); await until(() => room.members.length === 2);
  host.command('/leave'); await until(() => hub.rooms.size === 0);
  await until(() => guest.last('lobby')?.selfRoomId === undefined);
  assert.equal(guest.last('lobby')!.online.length, 2);
  host.command('/create'); await until(() => hub.rooms.size === 1);
  host.close(); await until(() => hub.rooms.size === 0); await until(() => guest.last('lobby')?.online.length === 1);
});
test('full rooms launch, forged progress is ignored, winners broadcast once and rematch works', async t => {
  const { hub, client } = await fixture(t), host = await client({ name: 'Alpha' }), guest = await client({ name: 'Beta' }), observer = await client({ name: 'Observer' });
  host.command('/create'); await until(() => hub.rooms.size === 1); const room = [...hub.rooms.values()][0]; guest.command('/join ' + room.id);
  await until(() => !!room.race); await until(() => !!host.last('race') && !!guest.last('race'));
  const race = room.race!; race.countdownEndsAt = 0; await until(() => race.phase === 'running');
  host.send({ type: 'progress', stage: 5, winnerId: host.last('welcome')!.id }); await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(race.racers[0].stage, 0);
  host.send({ type: 'interface' }); await until(() => host.last('notice')?.error === true); assert.equal(race.racers[0].terminalNode, -1);
  const racer = race.racers[0];
  for (let stage = 0; stage < 5; stage++) {
    await new Promise(resolve => setTimeout(resolve, 120));
    racer.position = nodePosition(racer.slot, race.capacity, stage); racer.invulnerable = 20;
    host.send({ type: 'interface' }); await until(() => racer.terminalNode === stage);
    host.send({ type: 'shell', requestId: 'test-' + stage, command: race.objectives[stage].solution });
    await until(() => racer.stage === stage + 1, 4000);
    racer.terminalNode = -1;
  }
  await until(() => !!host.last('result') && !!guest.last('result'));
  await until(() => observer.last('log')?.entry.kind === 'result');
  assert.equal(host.last('result')!.rows[0].name, 'Alpha'); assert.equal(host.messages.filter(m => m.type === 'result').length, 1);
  assert.equal(hub.sessions.get(host.last('welcome')!.id)!.wins, 1);
  host.command('/rematch'); await until(() => hub.rooms.size === 2); assert.notEqual(hub.sessions.get(host.last('welcome')!.id)!.roomId, room.id);
});
test('active reconnect preserves identity and room; explicit leaving forfeits', async t => {
  const { hub, client } = await fixture(t), host = await client(), guest = await client(); host.command('/create'); await until(() => hub.rooms.size === 1);
  const room = [...hub.rooms.values()][0]; guest.command('/join ' + room.id); await until(() => !!room.race); room.race!.countdownEndsAt = 0; await until(() => room.race!.phase === 'running');
  const welcome = host.last('welcome')!; host.close(); await until(() => !room.race!.racers[0].connected);
  assert.equal(room.race!.phase, 'running'); const reconnected = await client({ token: welcome.token });
  assert.equal(reconnected.last('welcome')!.id, welcome.id); await until(() => !!reconnected.last('race')); assert.equal(room.race!.racers[0].connected, true);
  reconnected.command('/leave'); await until(() => room.race!.phase === 'finished'); assert.equal(room.race!.winnerId, guest.last('welcome')!.id);
});
test('invalid commands and oversized or cross-origin websocket traffic are rejected', async t => {
  const { client, url } = await fixture(t), player = await client({ name: 'Valid' });
  player.command('/create 9'); await until(() => player.last('notice')?.error === true); assert.match(player.last('notice')!.text, /Usage/);
  player.command('/join nope'); await until(() => player.last('notice')?.text.includes('4-digit') === true);
  const rejected = new WebSocket(url, { origin: 'https://external.invalid' });
  const status = await new Promise<number>(resolve => { rejected.on('unexpected-response', (_, response) => { response.resume(); rejected.terminate(); resolve(response.statusCode!); }); rejected.on('error', () => {}); });
  assert.equal(status, 403);
  const huge = await client(); huge.ws.on('error', () => {}); const closed = new Promise<number>(resolve => huge.ws.once('close', code => resolve(code))); huge.ws.send('x'.repeat(10000)); assert.equal(await closed, 1009);
});
test('four-player rooms wait for every seat and creator cancellation resets the countdown', async t => {
  const { hub, client } = await fixture(t), host = await client(), guests = [await client(), await client(), await client()];
  host.command('/create 4 easy'); await until(() => hub.rooms.size === 1); const room = [...hub.rooms.values()][0];
  guests[0].command('/join ' + room.id); guests[1].command('/join ' + room.id); await until(() => room.members.length === 3);
  assert.equal(room.race, undefined);
  guests[2].command('/join ' + room.id); await until(() => !!room.race); assert.equal(room.race!.racers.length, 4);
  for (const guest of guests) await until(() => !!guest.last('race'));
  host.command('/leave'); await until(() => hub.rooms.size === 0);
  for (const guest of guests) await until(() => guest.last('lobby')?.selfRoomId === undefined);
});
test('a throttled shell request gets a reply so the client can release its input', async t => {
  const { hub, client } = await fixture(t), player = await client();
  const session = hub.sessions.get(player.last('welcome')!.id)!; session.tokens = 0; session.budgetAt = Date.now();
  player.send({ type: 'shell', requestId: 'throttled', command: 'help' });
  await until(() => player.last('shell')?.requestId === 'throttled');
  assert.match(player.last('shell')!.stderr, /Slow down/);
});
test('server sends about 30 snapshots per second and exposes only the player file paths for completion', async t => {
  const { hub, client } = await fixture(t), host = await client(), guest = await client();
  host.command('/create'); await until(() => hub.rooms.size === 1); const room = [...hub.rooms.values()][0];
  guest.command('/join ' + room.id); await until(() => !!room.race); room.race!.countdownEndsAt = 0; await until(() => room.race!.phase === 'running');
  const before = host.messages.filter(m => m.type === 'race').length;
  await new Promise(resolve => setTimeout(resolve, 1000));
  const count = host.messages.filter(m => m.type === 'race').length - before;
  assert.ok(count >= 24 && count <= 36, `Snapshot count: ${count}`);
  const racer = room.race!.racers[0]; racer.position = nodePosition(0, 2, 0); racer.invulnerable = 999;
  host.send({ type: 'interface' }); await until(() => host.last('terminal')?.open === true);
  assert.equal(host.last('terminal')!.cwd, '/workspace'); assert.ok(host.last('terminal')!.paths!.includes('/workspace/logs/routes.log'));
  assert.doesNotMatch(JSON.stringify(host.last('terminal')), /expected|solution|ACTIVE route=/);
  host.send({ type: 'shell', requestId: 'cd-test', command: 'cd logs' }); await until(() => host.last('shell')?.requestId === 'cd-test');
  assert.equal(host.last('shell')!.cwd, '/workspace/logs');
});
