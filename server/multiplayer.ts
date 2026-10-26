import type { Server } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { Difficulty } from '../src/cyber/model.ts';
import { HELP } from '../src/engine.ts';
import { createRace, stepRace, raceSnapshot, interfaceRace, nodePosition, arenaPath, acceptEvidence, forfeit, resultRows, queueMovement, resetMovement } from '../src/multiplayer/arena.ts';
import type { Race, ServerMessage, LobbyEntry, RoomSummary, PublicTask } from '../src/multiplayer/arena.ts';
import { runVirtual } from './executor.ts';
interface Session { id: string; token: string; name: string; ws?: WebSocket; roomId?: string; wins: number; disconnectedAt: number; tokens: number; budgetAt: number; busy: boolean; inputs: number; inputAt: number }
export interface Room { id: string; creatorId: string; capacity: number; difficulty: Difficulty; members: string[]; race?: Race; announced: boolean; createdAt: number }
const GUIDE = `CONCOURSE COMMANDS\n  /nick <name>             Choose a call sign (2–18 letters, numbers, _ or -)\n  /create [2|3|4] [easy|moderate]  Create a race; default: 1v1 / moderate\n  /join <room>             Join a waiting room; launches automatically when full\n  /ls                      List waiting rooms\n  /who                     List online runners\n  /leave                   Cancel your waiting room, or forfeit a running race\n  /rematch                 Create a fresh room after a race\n  /me <action>             Send an emote\n  /gg                      Good game!\n  /clear                   Clear your local lobby transcript\n  /help                    Show this guide\n\nPlain text is lobby chat. Each runner has five personal access layers.\nFirst to patch the uplink wins. Same evidence, same patrol timing.\nDisconnected runners have 20 seconds to reconnect during a match.\nNo individual pause in multiplayer; leaving a live race is a forfeit.`;
export class MultiplayerHub {
  readonly sessions = new Map<string, Session>();
  readonly rooms = new Map<string, Room>();
  private tokens = new Map<string, Session>();
  private sockets = new Map<WebSocket, Session>();
  private history: LobbyEntry[] = [];
  private entryId = 0;
  private wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  private ticker: ReturnType<typeof setInterval>;
  private heartbeat: ReturnType<typeof setInterval>;
  private alive = new WeakSet<WebSocket>();
  private tickNumber = 0;
  private lastTick = Date.now();
  private nextSnapshot = Date.now();
  constructor(server: Server) {
    server.on('upgrade', (request, socket, head) => {
      const pathname = (request.url ?? '').split('?')[0];
      const origin = request.headers.origin, host = request.headers.host;
      if (pathname !== '/ws' || this.wss.clients.size >= 64 || (origin && origin !== `http://${host}` && origin !== `https://${host}`)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
      this.wss.handleUpgrade(request, socket, head, ws => this.connected(ws));
    });
    this.ticker = setInterval(() => this.tick(), 1000 / 60); this.ticker.unref();
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) { if (!this.alive.has(ws)) ws.terminate(); else { this.alive.delete(ws); ws.ping(); } }
    }, 15000); this.heartbeat.unref();
  }
  private send(session: Session, message: ServerMessage) {
    const ws = session.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) { ws.close(1013, 'Connection too slow'); return; }
    if (message.type === 'race' && ws.bufferedAmount > 128 * 1024) return;
    ws.send(JSON.stringify(message));
  }
  private notice(session: Session, text: string, error = false) { this.send(session, { type: 'notice', text, error }); }
  private broadcast(kind: LobbyEntry['kind'], text: string, name = 'SYSTEM') {
    const entry = { id: ++this.entryId, at: Date.now(), kind, name, text }; this.history.push(entry); if (this.history.length > 100) this.history.shift();
    for (const session of this.sessions.values()) this.send(session, { type: 'log', entry });
  }
  private summaries(): RoomSummary[] {
    return [...this.rooms.values()].filter(room => room.race?.phase !== 'finished').map(room => ({ id: room.id, creator: this.sessions.get(room.creatorId)?.name ?? 'Runner', capacity: room.capacity, count: room.members.length, difficulty: room.difficulty, status: room.race?.phase ?? 'waiting' }));
  }
  private lobby() {
    const online = [...this.sessions.values()].filter(s => s.ws?.readyState === WebSocket.OPEN).map(s => ({ id: s.id, name: s.name, roomId: s.roomId, wins: s.wins }));
    const rooms = this.summaries();
    for (const session of this.sessions.values()) this.send(session, { type: 'lobby', online, rooms, selfRoomId: session.roomId });
  }
  private connected(ws: WebSocket) {
    this.alive.add(ws); ws.on('pong', () => this.alive.add(ws));
    const handshake = setTimeout(() => { if (!this.sockets.has(ws)) ws.close(1008, 'Send hello first'); }, 5000); handshake.unref();
    ws.on('message', (data, binary) => {
      if (binary) { ws.close(1003, 'JSON text only'); return; }
      let message: unknown; try { message = JSON.parse(data.toString()); } catch { ws.close(1008, 'Invalid JSON'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { ws.close(1008, 'Invalid message'); return; }
      const payload = message as Record<string, unknown>;
      let session = this.sockets.get(ws);
      if (!session) {
        if (payload.type !== 'hello') { ws.close(1008, 'Send hello first'); return; }
        clearTimeout(handshake); session = this.hello(ws, payload); return;
      }
      if (payload.type === 'input') {
        if (Date.now() - session.inputAt > 1000) { session.inputAt = Date.now(); session.inputs = 0; }
        if (++session.inputs > 80) return;
      } else {
        const now = Date.now(); session.tokens = Math.min(12, session.tokens + (now - session.budgetAt) / 400); session.budgetAt = now;
        if (session.tokens < 1) {
          if (payload.type === 'shell' && typeof payload.requestId === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(payload.requestId)) this.send(session, { type: 'shell', requestId: payload.requestId, stdout: '', stderr: 'Slow down for a moment, then retry your command.' });
          else this.notice(session, 'Slow down for a moment.', true);
          return;
        } session.tokens--;
      }
      void this.receive(session, payload).catch(error => this.notice(session!, (error as Error).message, true));
    });
    ws.on('close', () => { clearTimeout(handshake); const session = this.sockets.get(ws); this.sockets.delete(ws); if (session?.ws === ws) { session.ws = undefined; session.disconnectedAt = Date.now(); this.leave(session, true); this.broadcast('system', `${session.name} disconnected.`); this.lobby(); } });
    ws.on('error', () => {});
  }
  private hello(ws: WebSocket, payload: Record<string, unknown>): Session {
    let session = typeof payload.token === 'string' ? this.tokens.get(payload.token) : undefined;
    const resumed = !!session && !session.ws;
    if (!session || session.ws) {
      const id = randomBytes(5).toString('hex'), token = randomBytes(24).toString('hex');
      let name = typeof payload.name === 'string' && /^[a-zA-Z0-9_-]{2,18}$/.test(payload.name) ? payload.name : `Runner-${id.slice(0, 4)}`;
      if ([...this.sessions.values()].some(s => s.name.toLowerCase() === name.toLowerCase())) name = `Runner-${id.slice(0, 6)}`;
      session = { id, token, name, wins: 0, tokens: 12, budgetAt: Date.now(), disconnectedAt: 0, busy: false, inputs: 0, inputAt: Date.now() }; this.sessions.set(id, session); this.tokens.set(token, session);
    }
    session.ws = ws; this.sockets.set(ws, session);
    this.send(session, { type: 'welcome', id: session.id, name: session.name, token: session.token, history: this.history.slice(-80) });
    this.notice(session, GUIDE);
    if (resumed && session.roomId) {
      const room = this.rooms.get(session.roomId), racer = room?.race?.racers.find(p => p.id === session!.id);
      if (room?.race && racer && !racer.dnf) { racer.connected = true; resetMovement(racer); this.send(session, { type: 'race', snapshot: raceSnapshot(room.race, Date.now()), selfId: session.id }); if (room.race.phase === 'finished') this.sendResult(session, room); }
      else { session.roomId = undefined; this.send(session, { type: 'left' }); }
    }
    this.broadcast('system', `${session.name} ${resumed ? 'reconnected' : 'entered the concourse'}.`); this.lobby(); return session;
  }
  private create(session: Session, args: string[]) {
    if (session.roomId && this.rooms.get(session.roomId)?.race?.phase !== 'finished') throw Error('You are already in a room. Use /leave first.');
    const capacity = args[0] && !['easy', 'moderate'].includes(args[0]) ? Number(args.shift()) : 2;
    const difficulty = args.shift() ?? 'moderate';
    if (![2, 3, 4].includes(capacity) || !['easy', 'moderate'].includes(difficulty) || args.length) throw Error('Usage: /create [2|3|4] [easy|moderate]');
    if (this.rooms.size >= 32) throw Error('The concourse is full. Join a room or try later.');
    let id: string; do { id = String(randomInt(1000, 10000)); } while (this.rooms.has(id));
    const room: Room = { id, creatorId: session.id, capacity, difficulty: difficulty as Difficulty, members: [session.id], announced: false, createdAt: Date.now() };
    this.rooms.set(id, room); session.roomId = id;
    this.broadcast('room', `${session.name} created room ${id} · ${capacity} runners · ${difficulty}. Join with /join ${id}`);
    this.notice(session, `ROOM ${id} CREATED — waiting for ${capacity - 1} runner${capacity > 2 ? 's' : ''}. /leave cancels your waiting room.`); this.lobby();
  }
  private join(session: Session, id: string) {
    if (session.roomId && this.rooms.get(session.roomId)?.race?.phase !== 'finished') throw Error('You are already in a room. Use /leave first.');
    const room = this.rooms.get(id);
    if (!room || room.race || room.members.length >= room.capacity) throw Error('That waiting room is unavailable. Use /ls.');
    room.members.push(session.id); session.roomId = id;
    this.broadcast('room', `${session.name} joined room ${id} (${room.members.length}/${room.capacity}).`);
    if (room.members.length === room.capacity) {
      room.race = createRace(id, room.members.map(member => ({ id: member, name: this.sessions.get(member)!.name })), room.difficulty, randomInt(1, 2 ** 30));
      this.broadcast('room', `ROOM ${id} LAUNCHING — ${room.race.racers.map(p => p.name).join(' vs ')}. First to the core wins.`);
      this.snapshot(room);
    }
    this.lobby();
  }
  private leave(session: Session, disconnected = false) {
    const room = session.roomId ? this.rooms.get(session.roomId) : undefined;
    if (!room) { session.roomId = undefined; if (!disconnected) this.send(session, { type: 'left' }); return; }
    if (!room.race || room.race.phase === 'countdown') {
      if (room.creatorId === session.id) {
        this.rooms.delete(room.id);
        for (const member of room.members) { const other = this.sessions.get(member); if (other) { other.roomId = undefined; this.send(other, { type: 'left' }); this.notice(other, `Room ${room.id} closed because its creator left.`); } }
        this.broadcast('room', `ROOM ${room.id} REMOVED — creator left before launch.`);
      } else {
        room.members = room.members.filter(id => id !== session.id); session.roomId = undefined;
        if (room.race) { room.race = undefined; for (const member of room.members) { const other = this.sessions.get(member)!; this.send(other, { type: 'left' }); this.notice(other, 'Launch cancelled: a runner left. Waiting for another player.'); } }
        if (!disconnected) this.send(session, { type: 'left' });
        this.broadcast('room', `${session.name} left waiting room ${room.id}.`);
      }
    } else if (room.race.phase === 'running') {
      const racer = room.race.racers.find(p => p.id === session.id)!;
      if (disconnected) { racer.connected = false; racer.disconnectedAt = Date.now(); racer.terminalNode = -1; resetMovement(racer); this.broadcast('system', `${session.name} has 20 seconds to reconnect to room ${room.id}.`); }
      else { forfeit(room.race, racer); session.roomId = undefined; this.send(session, { type: 'left' }); this.broadcast('room', `${session.name} forfeited room ${room.id}.`); this.finish(room); }
    } else { session.roomId = undefined; if (!disconnected) this.send(session, { type: 'left' }); }
    this.lobby();
  }
  private async receive(session: Session, message: Record<string, unknown>) {
    if (message.type === 'lobby' && typeof message.text === 'string') {
      const text = message.text.trim(); if (!text || text.length > 500 || /[\x00-\x08\x0b-\x1f]/.test(text)) throw Error('Use a message of 1–500 printable characters.');
      if (!text.startsWith('/')) { this.broadcast('chat', text, session.name); return; }
      const [command, ...args] = text.split(/\s+/);
      switch (command.toLowerCase()) {
        case '/help': this.notice(session, GUIDE); break;
        case '/create': this.create(session, args); break;
        case '/join': if (args.length !== 1 || !/^\d{4}$/.test(args[0])) throw Error('Usage: /join <4-digit room>'); this.join(session, args[0]); break;
        case '/leave': this.leave(session); break;
        case '/ls': this.notice(session, 'WAITING ROOMS\n' + ([...this.rooms.values()].filter(room => !room.race).map(room => `${room.id}  ${room.members.length}/${room.capacity}  ${room.difficulty}  host:${this.sessions.get(room.creatorId)?.name}`).join('\n') || 'No waiting rooms. Start one with /create.')); break;
        case '/who': this.notice(session, 'ONLINE RUNNERS\n' + [...this.sessions.values()].filter(s => s.ws).map(s => `${s.name}${s.id === session.id ? ' (you)' : ''}  ${s.roomId ? 'room ' + s.roomId : 'lobby'}  wins:${s.wins}`).join('\n')); break;
        case '/nick': {
          if (session.roomId) throw Error('Leave your room before changing your call sign.');
          if (args.length !== 1 || !/^[a-zA-Z0-9_-]{2,18}$/.test(args[0])) throw Error('Usage: /nick <2–18 letters, numbers, _ or ->');
          if ([...this.sessions.values()].some(s => s.id !== session.id && s.name.toLowerCase() === args[0].toLowerCase())) throw Error('That call sign is in use.');
          const old = session.name; session.name = args[0]; this.broadcast('system', `${old} is now ${session.name}.`); this.lobby(); break;
        }
        case '/rematch': {
          const room = session.roomId ? this.rooms.get(session.roomId) : undefined;
          if (!room?.race || room.race.phase !== 'finished') throw Error('Use /rematch after a finished race.');
          this.create(session, [String(room.capacity), room.difficulty]); break;
        }
        case '/me': if (!args.length) throw Error('Usage: /me <action>'); this.broadcast('chat', `* ${args.join(' ')}`, session.name); break;
        case '/gg': this.broadcast('chat', 'gg — well raced!', session.name); break;
        default: throw Error('Unknown lobby command. Try /help.');
      }
      return;
    }
    const room = session.roomId ? this.rooms.get(session.roomId) : undefined, race = room?.race, racer = race?.racers.find(p => p.id === session.id);
    if (!race || !racer || race.phase !== 'running' || racer.dnf) return;
    switch (message.type) {
      case 'input':
        if (Array.isArray(message.frames)) { queueMovement(racer, message.epoch, message.frames); break; }
        if (racer.movement.enabled) break;
        if (typeof message.x === 'number' && Number.isFinite(message.x) && typeof message.y === 'number' && Number.isFinite(message.y)) racer.input = { x: Math.max(-1, Math.min(1, message.x)), y: Math.max(-1, Math.min(1, message.y)), sneak: message.sneak === true, at: Date.now() }; break;
      case 'stop-input': resetMovement(racer); this.snapshot(room!); break;
      case 'waypoint': {
        if (racer.terminalNode >= 0) return;
        const target = message.current === true ? nodePosition(racer.slot, race.capacity, racer.stage) : typeof message.x === 'number' && Number.isFinite(message.x) && Math.abs(message.x) < 50 && typeof message.z === 'number' && Number.isFinite(message.z) && Math.abs(message.z) < 50 ? { x: message.x, z: message.z } : undefined;
        if (!target) return;
        racer.path = arenaPath(race, racer, target);
        if (!racer.path.length) this.notice(session, 'That route is blocked by your access layer or cover. Patch your current node first.', true);
        else this.send(session, { type: 'route', target, path: racer.path, epoch: racer.movement.epoch, requestId: typeof message.requestId === 'string' ? message.requestId.slice(0, 40) : '' });
        break;
      }
      case 'interface':
        if (interfaceRace(race, racer)) { this.terminal(session, race, racer.terminalNode); this.snapshot(room!); } else this.notice(session, 'Move within 2.8m of your current node to interface.', true); break;
      case 'disconnect-terminal': racer.terminalNode = -1; resetMovement(racer); this.send(session, { type: 'terminal', open: false }); this.snapshot(room!); break;
      case 'shell':
        if (racer.terminalNode < 0 || typeof message.command !== 'string' || !message.command.trim() || message.command.length > 4096 || typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(message.requestId)) return;
        if (session.busy) { this.send(session, { type: 'shell', requestId: message.requestId, stdout: '', stderr: 'Your previous command is still running.' }); return; }
        session.busy = true;
        try {
          const command = message.command.trim(), node = racer.terminalNode, objective = race.objectives[node];
          const reply = (stdout: string, stderr = '') => this.send(session, { type: 'shell', requestId: message.requestId as string, stdout, stderr, cwd: racer.cwd });
          if (['jack-out', 'next-node', 'next-mission'].includes(command)) {
            if (command !== 'jack-out' && racer.stage === node) reply('', 'Patch this node first, or use jack-out to explore.');
            else { reply('Returning to the grid.'); racer.terminalNode = -1; resetMovement(racer); this.send(session, { type: 'terminal', open: false }); this.snapshot(room!); }
            return;
          }
          if (command === 'status') { reply(`ROOM ${race.id} / ${race.difficulty}\n${race.racers.map(p => `${p.name}: ${p.stage}/5${p.dnf ? ' DNF' : !p.connected ? ' reconnecting' : ''}`).join('\n')}`); return; }
          if (command === 'help') { reply('VERSUS CONSOLE\nmission: objective | hint: progressive hint | jack-out: return to arena\nnext-node: continue after a patch | status: race standings | focus: expand console\nMatch time never pauses. Your access layers are personal.\n\n' + HELP); return; }
          const ownerSocket = session.ws;
          const result = await runVirtual(command, { cwd: racer.cwd, files: racer.files, writablePaths: racer.stage === node ? ['/workspace/' + objective.output] : [] });
          if (session.ws !== ownerSocket || session.roomId !== room!.id || room!.race !== race || race.phase !== 'running' || !racer.connected || racer.terminalNode !== node || racer.dnf) return;
          racer.cwd = result.cwd;
          const action = result.stages[0]?.action;
          if (action && result.exitCode === 0) {
            if (action.type === 'hint') { racer.hints[node] = Math.min(3, racer.hints[node] + 1); reply(`HINT ${racer.hints[node]}/3\n${objective.hints[racer.hints[node] - 1]}`); }
            else if (action.type === 'mission') reply(`${objective.name} / ${objective.title}\n${objective.goal}\nInput: ${objective.input}\nOutput: ${objective.output}`);
            else if (action.type === 'focus') this.send(session, { type: 'shell', requestId: message.requestId, stdout: 'Console layout updated. Other runners keep racing.', stderr: '', ui: { mode: action.mode } });
            else reply('', 'Use next-node after patching this node.');
            return;
          }
          const secured = acceptEvidence(race, racer, result);
          this.send(session, { type: 'shell', requestId: message.requestId, stdout: result.stdout + (secured ? `\nLAYER ${racer.stage}/5 LIBERATED ✓\n${objective.reward}\nType next-node to continue inward.` : result.stages.some(s => s.command === 'tee') && !result.stderr ? '\nControl saved, but the evidence does not match the objective. Inspect your pipeline.' : ''), stderr: result.stderr, secured, stages: result.stages, cwd: racer.cwd });
          this.snapshot(room!); this.finish(room!);
        } catch (error) { this.send(session, { type: 'shell', requestId: message.requestId, stdout: '', stderr: (error as Error).message }); }
        finally { session.busy = false; }
        break;
    }
  }
  private terminal(session: Session, race: Race, node: number) {
    const objective = race.objectives[node];
    const { name, title, input, output, goal, skill } = objective;
    this.send(session, { type: 'terminal', open: true, task: { name, title, input, output, goal, skill } satisfies PublicTask, cwd: '/workspace', paths: Object.keys(race.racers.find(p => p.id === session.id)!.files) });
  }
  private snapshot(room: Room) {
    if (!room.race) return;
    const snapshot = raceSnapshot(room.race, Date.now());
    for (const id of room.members) { const session = this.sessions.get(id); if (session?.roomId === room.id) this.send(session, { type: 'race', snapshot, selfId: id }); }
  }
  private sendResult(session: Session, room: Room) { const race = room.race!; this.send(session, { type: 'result', roomId: room.id, elapsed: race.elapsed, reason: race.reason ?? 'Race finished', rows: resultRows(race) }); }
  private finish(room: Room) {
    if (room.race?.phase !== 'finished' || room.announced) return;
    room.announced = true;
    const winner = room.race.racers.find(p => p.id === room.race!.winnerId), session = winner ? this.sessions.get(winner.id) : undefined;
    if (session) session.wins++;
    this.broadcast('result', `ROOM ${room.id} RESULT — ${winner?.name ?? 'No winner'} · ${room.race.elapsed.toFixed(1)}s · ${room.race.reason}. ${resultRows(room.race).map(p => `${p.name} ${p.stage}/5${p.dnf ? ' DNF' : ''}`).join(' | ')}`);
    for (const member of room.members) { const player = this.sessions.get(member); if (player?.roomId === room.id) this.sendResult(player, room); }
    this.lobby();
  }
  private tick() {
    const now = Date.now(), dt = Math.min(.15, Math.max(0, (now - this.lastTick) / 1000)); this.lastTick = now; this.tickNumber++;
    const snapshotDue = now >= this.nextSnapshot;
    if (snapshotDue) { this.nextSnapshot += 1000 / 30; if (now - this.nextSnapshot > 100) this.nextSnapshot = now + 1000 / 30; }
    for (const room of this.rooms.values()) {
      if (room.race) { const was = room.race.phase; stepRace(room.race, dt, now); if (was !== room.race.phase) this.lobby(); if (snapshotDue) this.snapshot(room); this.finish(room); }
      if (room.race?.finishedAt && now - room.race.finishedAt > 120000) { for (const id of room.members) { const s = this.sessions.get(id); if (s?.roomId === room.id) { s.roomId = undefined; this.send(s, { type: 'left' }); } } this.rooms.delete(room.id); this.lobby(); }
    }
    if (this.tickNumber % 200 === 0) for (const session of this.sessions.values()) if (!session.ws && now - session.disconnectedAt > 60000) { this.tokens.delete(session.token); this.sessions.delete(session.id); }
  }
  close() { clearInterval(this.ticker); clearInterval(this.heartbeat); for (const ws of this.wss.clients) ws.terminate(); this.wss.close(); }
}
