import './style.css';
import { ArenaWorld } from './world.ts';
import { LocalPrediction, SnapshotInterpolation } from './netcode.ts';
import { completeShell, completeLobby } from './completion.ts';
import { NODE_NAMES, LAYERS, nodePosition } from './arena.ts';
import type { ServerMessage, RaceSnapshot, Presence, RoomSummary, LobbyEntry, PublicTask } from './arena.ts';
const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const app = document.querySelector<HTMLDivElement>('#multiplayer-app')!;
let socket: WebSocket | undefined, selfId = '', selfName = 'Connecting', selfRoomId: string | undefined, rooms: RoomSummary[] = [], online: Presence[] = [];
let snapshot: RaceSnapshot | undefined, world: ArenaWorld | undefined, terminalTask: PublicTask | undefined, terminalOpen = false, terminalWide = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined, unloading = false, connected = false;
let frameId = 0, requestNumber = 0, pendingRequest: string | undefined, sneak = false, attemptedWorld: string | undefined;
let lobbyHistory: string[] = [], lobbyIndex = 0, shellHistory: string[] = [], shellIndex = 0, shellDraft = '', lobbyDraft = '';
const seen = new Set<string>(), pressed = new Set<string>();
const prediction = new LocalPrediction(), interpolation = new SnapshotInterpolation();
let shellCwd = '/workspace', shellPaths: string[] = [], lastFrame = performance.now(), lastHud = 0, lastMap = 0, routeNumber = 0;
let lastStandings = '', lastRivals = '';
const lobbyLines: { html: string }[] = [], shellLines: string[] = [];
app.innerHTML = `
<header class="mp-header"><a href="/" class="mp-brand"><span>[&gt;]</span> NULL//RUN <small>THE CONCOURSE</small></a><div class="mp-header-right"><span id="mp-network" class="network-badge">CONNECTING</span><span id="mp-online-count">0 ONLINE</span><a href="/cyber.html">Solo race ↗</a><a href="/">Course ↗</a></div></header>
<main id="mp-lobby" class="mp-lobby"><section class="lobby-hero"><div><span class="micro-label">MULTIPLAYER / 2–4 RUNNERS / LOCAL SERVER</span><h1>Meet at the edge.<br/><em>Race to the core.</em></h1><p>Five access layers. One escape signal. Your sharpest weapon is a well-built command.</p></div><div class="arena-emblem" aria-hidden="true"><span></span><span></span><span></span><span></span><i></i><b>THE CORE</b></div></section>
<div class="lobby-columns"><section class="lobby-terminal" aria-label="Lobby chat"><div class="lobby-terminal-bar"><span><i></i> concourse://lobby</span><span id="mp-you">HANDSHAKE PENDING</span></div><div id="mp-waiting" class="waiting-strip" hidden></div><div id="lobby-output" class="lobby-output" role="log" aria-live="polite" aria-label="Lobby messages"></div><nav class="lobby-shortcuts" aria-label="Lobby command shortcuts"><button data-command="/create">/create</button><button data-command="/create 4 easy">/create 4 easy</button><button data-command="/ls">/ls</button><button data-command="/who">/who</button><button data-command="/help">/help</button></nav><form id="lobby-form"><label for="lobby-command"><span id="mp-prompt-name">runner</span>@concourse <b>❯</b></label><div><textarea id="lobby-command" rows="1" aria-label="Lobby command or chat" placeholder="Say hello, or /create a race…" maxlength="500" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"></textarea><button id="lobby-send" type="submit">Send ↵</button></div><div id="lobby-completions" class="completion-hint" role="status" hidden></div></form><footer>Plain text chats · /help lists commands <span>NO ACCOUNTS. JUST CALL SIGNS.</span></footer></section>
<aside class="lobby-side"><section class="room-panel"><div class="panel-title"><h2>OPEN CHANNELS</h2><span id="room-count">0 ROOMS</span></div><div id="mp-rooms"></div></section><section class="presence-panel"><div class="panel-title"><h2>RUNNERS ONLINE</h2><span class="live-light"></span></div><div id="mp-presence"></div></section><section class="lobby-rules"><span class="micro-label">THE RULES OF THE GRID</span><p>Spawn on opposite sides. Patch a node to cross each personal access layer. First to broadcast from the center wins.</p><p>Same evidence. Same patrol timing.<br/>Your terminal shields you, but the race never pauses.</p></section></aside></div></main>
<section id="mp-race" class="mp-race" hidden><div id="mp-world"></div><div class="screen-vignette"></div><div class="mp-race-top"><section class="mp-objective"><span id="mp-room-label" class="micro-label"></span><h1 id="mp-layer-name"></h1><p id="mp-layer-title"></p><button data-action="waypoint">Set waypoint ↗</button><p id="mp-distance"></p></section><section class="mp-standings"><canvas id="mp-minimap" width="180" height="180" aria-label="Circular arena progress map"></canvas><div id="mp-racers"></div><p id="mp-race-clock"></p></section></div><div id="mp-toast" class="mp-toast" role="status"></div><div id="mp-countdown" class="mp-countdown" hidden></div><div class="mp-race-bottom"><div class="trace-hud"><div><span id="mp-trace-label">SIGNAL / HIDDEN</span><strong id="mp-trace-number">0%</strong></div><div class="trace-track"><span id="mp-trace-bar"></span></div><p id="mp-movement">WASD / arrows · E interface · Shift sneak</p></div><div class="mp-race-controls"><button id="mp-interface" data-action="interface" disabled>Interface with node <kbd>E</kbd></button><button id="mp-sneak" data-action="sneak" aria-pressed="false">◇ Sneak</button><button data-action="forfeit">Forfeit /leave</button></div></div><nav class="touch-pad" aria-label="Multiplayer movement"><button data-move="w" aria-label="Move inward">↑</button><button data-move="a" aria-label="Move left">←</button><button data-move="s" aria-label="Move outward">↓</button><button data-move="d" aria-label="Move right">→</button></nav>
<section id="mp-terminal" class="cyber-console mp-terminal" aria-label="Multiplayer node terminal" hidden><div class="console-bar"><span><i></i><strong id="mp-terminal-name"></strong> / SERVER LINK</span><div><button data-action="terminal-focus" aria-label="Expand multiplayer terminal">⛶</button><button data-action="jack-out">Jack out <kbd>ESC</kbd></button></div></div><div class="console-objective"><span id="mp-terminal-skill"></span><h2 id="mp-terminal-title"></h2><p id="mp-terminal-goal"></p></div><div id="mp-live-rivals" class="mp-live-rivals" aria-label="Live opponent progress"></div><nav id="mp-terminal-shortcuts" aria-label="Multiplayer terminal shortcuts"></nav><div id="mp-shell-output" class="console-output" role="log" aria-live="polite" aria-label="Multiplayer command output"></div><form id="cyber-form"><div class="console-cwd"><span id="mp-shell-cwd">/workspace / virtual</span><span id="mp-shell-rivals">RIVALS KEEP RACING</span></div><div class="console-input"><label for="cyber-command">❯</label><textarea id="cyber-command" rows="1" aria-label="Multiplayer shell command" placeholder="Inspect. Filter. Cross the next layer." autocapitalize="off" spellcheck="false" autocomplete="off" enterkeyhint="go"></textarea><button id="cyber-run" type="submit">Run ↵</button></div><div class="cyber-symbols"><button type="button" data-insert="|">|</button><button type="button" data-insert="'">'</button><button type="button" data-insert="/">/</button><button type="button" data-insert="-">-</button><button type="button" data-action="shell-history">↑</button><button type="button" data-action="complete-shell">Tab ⇥</button><span></span><button type="button" data-shell="hint">hint</button><button type="button" data-shell="help">help</button></div><div id="shell-completions" class="completion-hint" role="status" hidden></div></form><div class="console-foot">SERVER-VALIDATED VIRTUAL COMMANDS <span>No individual pause · /leave forfeits</span></div></section>
<div id="mp-render-error" class="mp-render-error" hidden><h2>3D rendering is unavailable.</h2><p>This race needs WebGL 2. Try a browser with hardware acceleration.</p><button data-action="forfeit">Leave race and return to lobby</button></div>
<div id="mp-results" class="mp-results" hidden><div class="mp-results-card"><span class="micro-label">RACE COMPLETE / BROADCAST TO LOBBY</span><h2 id="mp-result-title"></h2><p id="mp-result-reason"></p><div id="mp-result-rows"></div><button class="primary-action" data-action="rematch">Create rematch room ↗</button><button class="secondary-action" data-action="return-lobby">Return to the concourse</button><button class="gg-button" data-action="gg">/gg — well raced</button></div></div></section>`;
const lobbyInput = document.querySelector<HTMLTextAreaElement>('#lobby-command')!;
const shellInput = document.querySelector<HTMLTextAreaElement>('#cyber-command')!;
function send(message: unknown) { if (socket?.readyState !== WebSocket.OPEN) return false; socket.send(JSON.stringify(message)); return true; }
function time(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function addLobby(text: string, label = 'SYSTEM', kind = 'system', timestamp = Date.now()) {
  const container = $('#lobby-output'), bottom = container.scrollHeight - container.scrollTop - container.clientHeight < 65;
  lobbyLines.push({ html: `<div class="lobby-line ${esc(kind)}"><time>${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><strong>${esc(label)}</strong><pre>${esc(text)}</pre></div>` });
  if (lobbyLines.length > 180) lobbyLines.shift(); container.innerHTML = lobbyLines.map(line => line.html).join(''); if (bottom) container.scrollTop = container.scrollHeight;
}
function receiveLog(entry: LobbyEntry) { const key = `${entry.at}:${entry.id}`; if (seen.has(key)) return; seen.add(key); if (seen.size > 1000) seen.delete(seen.values().next().value!); addLobby(entry.text, entry.name, entry.kind, entry.at); }
function shellLog(text: string, command?: string, error = false, secured = false) {
  shellLines.push(`<div class="cyber-entry ${error ? 'error' : secured ? 'success' : command ? 'output' : 'system'}">${command ? `<div class="cyber-executed"><span>❯</span><code>${esc(command)}</code></div>` : ''}<pre>${esc(text)}</pre></div>`);
  if (shellLines.length > 65) shellLines.shift(); $('#mp-shell-output').innerHTML = shellLines.join(''); $('#mp-shell-output').scrollTop = $('#mp-shell-output').scrollHeight;
}
function toast(text: string) { $('#mp-toast').textContent = text; $('#mp-toast').classList.remove('show'); void $('#mp-toast').offsetWidth; $('#mp-toast').classList.add('show'); }
function renderLobby() {
  $('#mp-online-count').textContent = `${online.length} ONLINE`;
  const own = online.find(p => p.id === selfId);
  if (own) { selfName = own.name; $('#mp-you').textContent = `${selfName} / YOU`; $('#mp-prompt-name').textContent = selfName; try { localStorage.setItem('nullrun-nickname', selfName); } catch {} }
  $('#mp-presence').innerHTML = online.map(p => `<div class="presence-row"><span class="presence-dot"></span><strong>${esc(p.name)}${p.id === selfId ? '<small>YOU</small>' : ''}</strong><span>${p.roomId ? '#' + p.roomId : 'LOBBY'}${p.wins ? ` · ${p.wins}W` : ''}</span></div>`).join('');
  $('#room-count').textContent = `${rooms.filter(r => r.status === 'waiting').length} WAITING`;
  $('#mp-rooms').innerHTML = rooms.length ? rooms.map(room => `<article class="room-card ${room.id === selfRoomId ? 'your-room' : ''}"><div><strong>#${room.id}</strong><span>${room.count}/${room.capacity} RUNNERS</span></div><p>${esc(room.creator)} <span>· ${room.difficulty}</span></p><footer><span>${room.status === 'waiting' ? 'AWAITING CHALLENGERS' : room.status.toUpperCase()}</span>${room.status === 'waiting' && room.id !== selfRoomId ? `<button data-join="${room.id}">/join ↗</button>` : '<span class="room-beacon">●</span>'}</footer></article>`).join('') : '<div class="no-rooms"><span>[_]</span><p>No channels waiting.</p><small>Type /create to start a race.</small></div>';
  const room = rooms.find(r => r.id === selfRoomId);
  $('#mp-waiting').hidden = !room || room.status !== 'waiting';
  if (room) $('#mp-waiting').innerHTML = `<div><strong>ROOM ${room.id} / ${room.count} OF ${room.capacity}</strong><span>Auto-launch when full · ${room.difficulty}</span></div><button data-action="invite">Invite ↗</button><button data-command="/leave" data-run="true">/leave</button>`;
}
function showLobby() {
  $('#mp-lobby').hidden = false; $('#mp-race').hidden = true; $('#mp-terminal').hidden = true; $('#mp-results').hidden = true;
  terminalOpen = false; pendingRequest = undefined; (document.querySelector('#cyber-run') as HTMLButtonElement).disabled = false;
  shellInput.readOnly = false; $('#lobby-output').scrollTop = $('#lobby-output').scrollHeight;
  prediction.reset(); interpolation.reset(); routeNumber++;
  pressed.clear(); snapshot = undefined; world?.dispose(); world = undefined; attemptedWorld = undefined; app.classList.remove('in-race', 'console-open'); shellLines.length = 0; shellHistory = []; shellIndex = 0; lobbyInput.focus({ preventScroll: true });
}
function drawMap(state: RaceSnapshot) {
  const canvas = document.querySelector<HTMLCanvasElement>('#mp-minimap')!, ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, 180, 180);
  ctx.strokeStyle = '#31516b'; ctx.lineWidth = 1;
  for (const r of [47, ...LAYERS, 2]) { ctx.beginPath(); ctx.arc(90, 90, r * 1.7, 0, Math.PI * 2); ctx.stroke(); }
  for (const racer of state.racers) {
    const point = { x: 90 + racer.position.x * 1.7, y: 90 + racer.position.z * 1.7 };
    ctx.globalAlpha = racer.dnf || !racer.connected ? .35 : 1; ctx.fillStyle = racer.color;
    ctx.beginPath(); ctx.arc(point.x, point.y, racer.id === selfId ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    if (racer.id === selfId) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(point.x, point.y, 7, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}
function renderRace(state: RaceSnapshot) {
  const previous = snapshot; snapshot = state;
  const now = performance.now(); prediction.receive(state, selfId, now); interpolation.receive(state, now);
  const own = state.racers.find(p => p.id === selfId); if (!own) return;
  if (previous && previous.id !== state.id) { world?.dispose(); world = undefined; }
  if (attemptedWorld !== state.id) {
    attemptedWorld = state.id;
    $('#mp-lobby').hidden = true; $('#mp-race').hidden = false; $('#mp-results').hidden = true; $('#mp-render-error').hidden = true; app.classList.add('in-race');
    try { world = new ArenaWorld($('#mp-world'), selfId, state, p => requestWaypoint(p)); }
    catch { $('#mp-render-error').hidden = false; }
    pressed.clear(); shellLines.length = 0; shellHistory = []; shellIndex = 0;
  }
  if (previous) {
    const before = previous.racers.find(p => p.id === selfId);
    if (before && own.detections > before.detections) toast('DETECTED — returned to your checkpoint. Solved layers are preserved.');
    for (const rival of state.racers.filter(p => p.id !== selfId)) if (rival.stage > (previous.racers.find(p => p.id === rival.id)?.stage ?? rival.stage)) toast(`${rival.name} crossed layer ${rival.stage}. Keep moving.`);
  }
  if (!own.inTerminal && terminalOpen) closeTerminal();
  if (now - lastHud < 95 && state.phase === previous?.phase && own.stage === previous?.racers.find(p => p.id === selfId)?.stage) return;
  lastHud = now;
  $('#mp-room-label').textContent = `ROOM ${state.id} / ${state.capacity} RUNNERS / ${state.difficulty.toUpperCase()}`;
  $('#mp-layer-name').textContent = `${Math.min(5, own.stage + 1)} / ${NODE_NAMES[Math.min(4, own.stage)]}`;
  $('#mp-layer-title').textContent = 'Cross your access layers. Reach the core first.';
  const target = nodePosition(own.slot, state.capacity, own.stage), distance = Math.hypot(target.x - own.position.x, target.z - own.position.z);
  $('#mp-distance').textContent = `${Math.round(distance)}m TO YOUR NODE · ${own.stage}/5 LAYERS`;
  (document.querySelector('#mp-interface') as HTMLButtonElement).disabled = state.phase !== 'running' || own.dnf || own.stunned || distance > 2.8 || !connected;
  const standings = state.racers.map(p => `<div class="racer-standing ${p.id === selfId ? 'self' : ''}"><div><i style="background:${p.color}"></i><strong>${esc(p.name)}${p.id === selfId ? ' <small>YOU</small>' : ''}</strong><span>${p.dnf ? 'DNF' : !p.connected ? 'OFFLINE' : p.stage + '/5'}</span></div><div class="racer-progress"><span style="width:${p.stage / 5 * 100}%;background:${p.color}"></span></div></div>`).join('');
  $('#mp-race-clock').textContent = `${time(state.elapsed)} / ${state.phase === 'countdown' ? 'GET READY' : 'LIVE RACE'}`;
  $('#mp-countdown').hidden = state.phase !== 'countdown'; $('#mp-countdown').textContent = `DEPLOY IN ${Math.max(1, Math.ceil(state.countdownMs / 1000))}`;
  $('#mp-trace-number').textContent = `${Math.round(own.trace)}%`; $('#mp-trace-bar').style.width = `${own.trace}%`;
  $('#mp-trace-label').textContent = own.inTerminal ? 'SIGNAL / SHIELDED' : own.trace > 1 ? 'SIGNAL / EXPOSED' : 'SIGNAL / HIDDEN';
  $('#mp-movement').textContent = own.stunned ? 'Reconnecting at your checkpoint…' : own.navigating ? 'Following waypoint · movement cancels' : 'WASD / arrows · E interface · Shift sneak';
  $('#mp-shell-rivals').textContent = state.racers.filter(p => p.id !== selfId).map(p => `${p.name} ${p.stage}/5`).join(' · ');
  const rivals = state.racers.filter(p => p.id !== selfId).map(p => `<span><i style="background:${p.color}"></i>${esc(p.name)} <strong>${p.dnf ? 'DNF' : !p.connected ? 'OFFLINE' : p.stage + '/5'}</strong></span>`).join('');
  if (standings !== lastStandings) { $('#mp-racers').innerHTML = standings; lastStandings = standings; }
  if (rivals !== lastRivals) { $('#mp-live-rivals').innerHTML = rivals; lastRivals = rivals; }

}
function closeTerminal() { pendingRequest = undefined; shellInput.readOnly = false; (document.querySelector('#cyber-run') as HTMLButtonElement).disabled = false; terminalOpen = false; $('#mp-terminal').hidden = true; app.classList.remove('console-open'); shellInput.blur(); }
function terminal(task: PublicTask, cwd = '/workspace', paths: string[] = []) {
  shellCwd = cwd; shellPaths = paths; $('#mp-shell-cwd').textContent = cwd + ' / virtual'; clearCompletions();
  terminalTask = task; terminalOpen = true; $('#mp-terminal').hidden = false; app.classList.add('console-open'); pressed.clear(); prediction.cancelWaypoint(); routeNumber++;
  $('#mp-terminal-name').textContent = task.name; $('#mp-terminal-title').textContent = task.title; $('#mp-terminal-goal').textContent = task.goal; $('#mp-terminal-skill').textContent = task.skill;
  $('#mp-terminal-shortcuts').innerHTML = `<button data-shell="cat ${esc(task.input)}">Inspect input</button><button data-shell="mission">Objective</button><button data-shell="hint">Hint</button><button data-shell="grep --help">grep --help</button><button data-shell="tee --help">tee --help</button>`;
  shellLog(`CONNECTED / ${task.name}\n${task.goal}\n\nYour terminal blocks patrol scans. The other runners are still racing.\nUse hint, status, or jack-out.`); shellInput.focus({ preventScroll: true });
}
function handle(message: ServerMessage) {
  switch (message.type) {
    case 'welcome': {
      if (selfId && selfId !== message.id) showLobby(); selfId = message.id; selfName = message.name;
      try { sessionStorage.setItem('nullrun-mp-session', message.token); } catch {}
      message.history.forEach(receiveLog); addLobby(`Connected as ${message.name}. Use /nick <name> to change your call sign.`, 'LINK');
      const invite = new URLSearchParams(location.search).get('room'); if (invite && /^\d{4}$/.test(invite) && !selfRoomId) { lobbyInput.value = `/join ${invite}`; addLobby(`Invitation to room ${invite}. Press Send to join.`, 'INVITE'); }
      break;
    }
    case 'lobby': online = message.online; rooms = message.rooms; selfRoomId = message.selfRoomId; renderLobby(); break;
    case 'log': receiveLog(message.entry); break;
    case 'notice': addLobby(message.text, message.error ? 'ERROR' : 'SYSTEM', message.error ? 'error' : 'system'); if (snapshot && message.error) toast(message.text); break;
    case 'race': selfId = message.selfId; renderRace(message.snapshot); break;
    case 'terminal': if (message.open && message.task) terminal(message.task, message.cwd, message.paths); else closeTerminal(); break;
    case 'route': if (message.requestId === 'route-' + routeNumber && message.epoch === prediction.epoch) prediction.setWaypoint(message.target); break;
    case 'shell': {
      if (message.cwd) { shellCwd = message.cwd; $('#mp-shell-cwd').textContent = message.cwd + ' / virtual'; }
      if (pendingRequest === message.requestId) { pendingRequest = undefined; (document.querySelector('#cyber-run') as HTMLButtonElement).disabled = false; shellInput.readOnly = false; }
      if (message.ui) { terminalWide = message.ui.mode === 'toggle' ? !terminalWide : message.ui.mode === 'on'; $('#mp-terminal').classList.toggle('wide-console', terminalWide); }
      shellLog(message.stderr || message.stdout || '(no output)', undefined, !!message.stderr, message.secured);
      if (message.stages && message.stages.length > 1) {
        shellLines[shellLines.length - 1] += `<details class="mp-pipeline"><summary>Inspect pipeline · ${message.stages.length} stages</summary>${message.stages.map(stage => `<pre>${esc(stage.command + ' ' + stage.args.join(' ') + '\n' + (stage.stdout || stage.stderr || '(no output)'))}</pre>`).join('')}</details>`;
        $('#mp-shell-output').innerHTML = shellLines.join('');
        $('#mp-shell-output').scrollTop = $('#mp-shell-output').scrollHeight;
      }
      if (message.stages?.at(-1)?.isHelp && $('#mp-shell-output').lastElementChild) {
        const output = $('#mp-shell-output'); output.scrollTop += output.lastElementChild!.getBoundingClientRect().top - output.getBoundingClientRect().top - 12;
      }
      if (terminalOpen) shellInput.focus({ preventScroll: true }); break;
    }
    case 'result':
      closeTerminal(); pendingRequest = undefined; $('#mp-results').hidden = false;
      $('#mp-result-title').textContent = message.rows[0]?.winner ? message.rows[0].id === selfId ? 'You broke the system first.' : `${message.rows[0].name} reached the core.` : 'Operation ended.';
      $('#mp-result-reason').textContent = `ROOM ${message.roomId} · ${time(message.elapsed)} · ${message.reason}`;
      $('#mp-result-rows').innerHTML = message.rows.map((p, i) => `<div class="result-row"><span>${p.winner ? '★' : String(i + 1).padStart(2, '0')}</span><strong style="color:${p.color}">${esc(p.name)}${p.id === selfId ? ' / YOU' : ''}</strong><span>${p.stage}/5 · ${p.dnf ? 'DNF' : p.detections + ' traces'}</span></div>`).join(''); break;
    case 'left': showLobby(); break;
  }
}
function connectSocket() {
  if (unloading) return;
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.addEventListener('open', () => {
    connected = true; $('#mp-network').textContent = 'LINK ONLINE'; $('#mp-network').classList.add('is-online');
    let token: string | null = null, name: string | null = null; try { token = sessionStorage.getItem('nullrun-mp-session'); name = localStorage.getItem('nullrun-nickname'); } catch {}
    send({ type: 'hello', token, name });
  });
  socket.addEventListener('message', event => { try { handle(JSON.parse(event.data)); } catch (error) { console.error('Multiplayer update failed:', error); } });
  socket.addEventListener('close', () => {
    connected = false; pressed.clear(); prediction.cancelWaypoint(); $('#mp-network').textContent = 'RECONNECTING'; $('#mp-network').classList.remove('is-online');
    if (snapshot && snapshot.phase !== 'finished') toast('Connection interrupted. Reconnecting… your slot is reserved for 20 seconds.');
    if (pendingRequest) { pendingRequest = undefined; shellInput.readOnly = false; (document.querySelector('#cyber-run') as HTMLButtonElement).disabled = false; shellLog('Connection interrupted. Reconnect before retrying the command.', undefined, true); }
    if (!unloading) reconnectTimer = setTimeout(connectSocket, 1000);
  });
  socket.addEventListener('error', () => {});
}
function submitLobby(command = lobbyInput.value.trim()) {
  if (!command) return;
  clearCompletions();
  lobbyHistory.push(command); lobbyIndex = lobbyHistory.length; lobbyDraft = ''; lobbyInput.value = '';
  if (command === '/clear') { lobbyLines.length = 0; $('#lobby-output').replaceChildren(); return; }
  if (!send({ type: 'lobby', text: command })) addLobby('Link unavailable. Reconnecting to the local server…', 'ERROR', 'error');
}
function submitShell() {
  const command = shellInput.value.trim(); if (!command || pendingRequest || !terminalOpen || !connected) return;
  clearCompletions();
  shellHistory.push(command); shellIndex = shellHistory.length; shellDraft = ''; shellInput.value = '';
  if (command.startsWith('/')) { submitLobby(command); shellLog('Lobby command sent.', command); return; }
  if (command === 'clear') { shellLines.length = 0; $('#mp-shell-output').replaceChildren(); return; }
  pendingRequest = `cmd-${++requestNumber}`;
  shellLog('', command); shellInput.readOnly = true; (document.querySelector('#cyber-run') as HTMLButtonElement).disabled = true;
  send({ type: 'shell', requestId: pendingRequest, command });
}
function sendInput() {
  if (!snapshot || snapshot.phase !== 'running' || !connected) return;
  const packet = prediction.packet(); if (packet) send(packet);
}
function stopInput() {
  pressed.clear(); prediction.cancelWaypoint(); routeNumber++;
  if (snapshot?.phase === 'running' && connected) send({ type: 'stop-input' });
}
function requestWaypoint(point?: { x: number; z: number }) {
  pressed.clear(); prediction.cancelWaypoint();
  send({ type: 'waypoint', requestId: 'route-' + (++routeNumber), ...(point ? point : { current: true }) });
}
function clearCompletions() { $('#lobby-completions').hidden = true; $('#shell-completions').hidden = true; }
function tabComplete(kind: 'lobby' | 'shell') {
  const input = kind === 'lobby' ? lobbyInput : shellInput;
  const roomIds = rooms.filter(room => room.status === 'waiting').map(room => room.id);
  const result = kind === 'lobby' ? completeLobby(input.value, input.selectionStart, roomIds) : completeShell(input.value, input.selectionStart, shellCwd, shellPaths, roomIds);
  input.value = result.value; input.setSelectionRange(result.cursor, result.cursor);
  const hint = $(kind === 'lobby' ? '#lobby-completions' : '#shell-completions');
  hint.textContent = result.matches.length > 1 ? result.matches.join('  ') : result.matches.length ? '' : 'No matching completion';
  hint.hidden = !hint.textContent; input.focus({ preventScroll: true });
}
app.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!button) return;
  if (button.dataset.command) { lobbyInput.value = button.dataset.command; if (button.dataset.run) submitLobby(); else lobbyInput.focus({ preventScroll: true }); return; }
  if (button.dataset.join) { submitLobby(`/join ${button.dataset.join}`); return; }
  if (button.dataset.shell) { shellInput.value = button.dataset.shell; shellInput.focus({ preventScroll: true }); return; }
  if (button.dataset.insert) { shellInput.setRangeText(button.dataset.insert, shellInput.selectionStart, shellInput.selectionEnd, 'end'); shellInput.focus({ preventScroll: true }); return; }
  switch (button.dataset.action) {
    case 'waypoint': requestWaypoint(); break;
    case 'complete-shell': tabComplete('shell'); break;
    case 'interface': send({ type: 'interface' }); break;
    case 'jack-out': if (!pendingRequest) send({ type: 'disconnect-terminal' }); break;
    case 'terminal-focus': terminalWide = !terminalWide; $('#mp-terminal').classList.toggle('wide-console', terminalWide); break;
    case 'sneak': sneak = !sneak; $('#mp-sneak').setAttribute('aria-pressed', String(sneak)); sendInput(); break;
    case 'forfeit': case 'return-lobby': submitLobby('/leave'); break;
    case 'rematch': submitLobby('/rematch'); showLobby(); break;
    case 'gg': submitLobby('/gg'); toast('gg — sent to the concourse'); break;
    case 'invite': if (selfRoomId) { const url = new URL(location.href); url.search = `?room=${selfRoomId}`; addLobby(`Invite: ${url.href}\nOr share /join ${selfRoomId}`, 'INVITE'); void navigator.clipboard?.writeText(url.href).catch(() => {}); } break;
    case 'shell-history': shellIndex = Math.max(0, shellIndex - 1); shellInput.value = shellHistory[shellIndex] ?? ''; shellInput.focus({ preventScroll: true }); break;
  }
});
document.querySelector('#lobby-form')!.addEventListener('submit', e => { e.preventDefault(); submitLobby(); });
document.querySelector('#cyber-form')!.addEventListener('submit', e => { e.preventDefault(); submitShell(); });
lobbyInput.addEventListener('input', clearCompletions); shellInput.addEventListener('input', clearCompletions);
for (const [input, kind] of [[lobbyInput, 'lobby'], [shellInput, 'shell']] as const) input.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); if (kind === 'lobby') submitLobby(); else submitShell(); }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault(); const direction = event.key === 'ArrowUp' ? -1 : 1;
    if (kind === 'lobby') { if (lobbyIndex === lobbyHistory.length) lobbyDraft = input.value; lobbyIndex = Math.max(0, Math.min(lobbyHistory.length, lobbyIndex + direction)); input.value = lobbyIndex === lobbyHistory.length ? lobbyDraft : lobbyHistory[lobbyIndex]; }
    else { if (shellIndex === shellHistory.length) shellDraft = input.value; shellIndex = Math.max(0, Math.min(shellHistory.length, shellIndex + direction)); input.value = shellIndex === shellHistory.length ? shellDraft : shellHistory[shellIndex]; }
  }
  if (event.key === 'Tab' && !event.shiftKey && (kind === 'shell' || input.value.trimStart().startsWith('/') || !input.value)) { event.preventDefault(); tabComplete(kind); }
});
window.addEventListener('keydown', event => {
  if (!snapshot || snapshot.phase === 'finished' || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
    if (event.key === 'Escape' && terminalOpen && !pendingRequest) send({ type: 'disconnect-terminal' }); return;
  }
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) { event.preventDefault(); pressed.add(key); if (key !== 'shift') { prediction.cancelWaypoint(); routeNumber++; } }
  if (key === 'e' && !event.repeat) send({ type: 'interface' });
  if (key === 'escape' && terminalOpen && !pendingRequest) send({ type: 'disconnect-terminal' });
});
window.addEventListener('keyup', e => { pressed.delete(e.key.toLowerCase()); });
window.addEventListener('blur', stopInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopInput(); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-move]')) {
  button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); pressed.add(button.dataset.move!); prediction.cancelWaypoint(); routeNumber++; });
  const release = () => { pressed.delete(button.dataset.move!); };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
}
const inputTimer = setInterval(sendInput, 1000 / 30);
function frame(now: number) {
  const dt = Math.min(.1, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
  if (snapshot && !document.hidden) {
    const active = connected && !terminalOpen && document.hasFocus();
    const local = prediction.update({ x: active ? Number(pressed.has('d') || pressed.has('arrowright')) - Number(pressed.has('a') || pressed.has('arrowleft')) : 0, y: active ? Number(pressed.has('w') || pressed.has('arrowup')) - Number(pressed.has('s') || pressed.has('arrowdown')) : 0, sneak: sneak || pressed.has('shift') }, dt, now);
    const presented = interpolation.sample(now, selfId, local);
    if (world && presented) world.render(presented, dt);
    if (presented && now - lastMap > 32) {
      drawMap(presented); lastMap = now;
      const own = presented.racers.find(player => player.id === selfId);
      if (own && snapshot.phase === 'running') {
        const target = nodePosition(own.slot, presented.capacity, own.stage);
        $('#mp-distance').textContent = `${Math.round(Math.hypot(target.x - own.position.x, target.z - own.position.z))}m TO YOUR NODE · ${own.stage}/5 LAYERS`;
      }
    }
  }
  frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame); connectSocket();
window.addEventListener('beforeunload', () => { unloading = true; clearInterval(inputTimer); clearTimeout(reconnectTimer); cancelAnimationFrame(frameId); socket?.close(); world?.dispose(); });
