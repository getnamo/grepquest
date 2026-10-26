import './style.css';
import { HELP, COMMAND_HELP } from '../engine.ts';
import type { Execution } from '../engine.ts';
import { createGame, canInterface, connect, movePlayer, tick, submitEvidence, botProgress, distance, findPath } from './model.ts';
import type { Difficulty, Vec } from './model.ts';
import { CyberWorld } from './world.ts';
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
let difficulty: Difficulty = 'moderate';
try { if (localStorage.getItem('nullrun-difficulty') === 'easy') difficulty = 'easy'; } catch {}
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
let game = createGame(difficulty, seed());
let path: Vec[] = [], sneak = false, world: CyberWorld | undefined, runningCommand = false, worker: Worker | undefined;
let cwd = '/workspace', history: string[] = [], historyIndex = 0, draft = '', hints = [0, 0, 0, 0, 0];
let entries: { command?: string; text: string; type: 'system' | 'output' | 'error' | 'success' }[] = [];
let terminalFocused = false, lastEvent = -1, hudTime = 0, lastFrame = performance.now(), animation = 0;
const keys = new Set<string>();
const app = document.querySelector<HTMLDivElement>('#cyber-app')!;
const difficultyOptions = `<option value="moderate">Moderate</option><option value="easy">Easy · relaxed pace</option>`;
app.innerHTML = `
  <div id="world" aria-label="Cyberspace game world"></div><div class="screen-vignette" aria-hidden="true"></div>
  <header class="cyber-header"><a href="/" class="cyber-logo" aria-label="Return to Grep Quest"><span class="logo-bracket">[&gt;]</span><strong>NULL<span>//</span>RUN</strong><span class="edition">GREP QUEST / CYBERSPACE</span></a><div class="header-actions"><span class="mode-tag">SOLO / BOT RACE</span><select aria-label="Game difficulty" data-difficulty>${difficultyOptions}</select><button id="pause-button" data-action="pause" aria-label="Pause game">Ⅱ <span>Pause</span></button><a href="/" class="course-link">Exit to course ↗</a></div></header>
  <main class="game-hud"><section class="objective-hud"><span class="micro-label">OPERATION / LIBERATE</span><h1 id="objective-name">01 / RELAY</h1><p id="objective-text">Find a way in.</p><button id="waypoint-button" data-action="waypoint">Set waypoint <span>↗</span></button><div id="node-track" class="node-track"></div></section><section class="race-hud" aria-label="Race progress"><div class="race-line"><span>YOU <i>UNAUTHORIZED</i></span><strong id="player-score">0 / 5</strong></div><div class="race-track"><span id="player-progress"></span></div><div class="race-line rival"><span>ECHO-9 <i>RECOVERY BOT</i></span><strong id="bot-score">0 / 5</strong></div><div class="race-track rival"><span id="bot-progress"></span></div><p id="bot-status">Rival awaiting deployment</p><span id="game-clock">00:00</span></section></main>
  <div id="event-toast" class="event-toast" role="status" aria-live="polite"></div>
  <div class="bottom-hud"><section class="trace-hud"><div><span id="trace-label">SIGNAL / HIDDEN</span><strong id="trace-percent">0%</strong></div><div class="trace-track"><span id="trace-progress"></span></div><p id="movement-state">Stay behind cover. Red cones can see you.</p></section><div class="controls-legend"><kbd>W A S D</kbd> move <kbd>SHIFT</kbd> sneak <kbd>E</kbd> interface <span>· click ground to move</span></div><section class="interaction-hud"><span id="node-distance">RELAY · 15m</span><button id="interface-button" data-action="interface" disabled><kbd>E</kbd> Interface with node <span>↗</span></button><button id="sneak-button" data-action="sneak" aria-pressed="false">◇ Sneak mode</button></section></div>
  <nav class="touch-pad" aria-label="Movement controls"><button data-move="w" aria-label="Move forward">↑</button><button data-move="a" aria-label="Move left">←</button><button data-move="s" aria-label="Move backward">↓</button><button data-move="d" aria-label="Move right">→</button></nav>
  <section id="console" class="cyber-console" aria-label="Node terminal" hidden><div class="console-bar"><span><i></i><strong id="console-node">RELAY</strong> / SHELL LINK</span><div><button data-action="console-focus" aria-label="Expand node terminal">⛶</button><button data-action="jack-out">Jack out <kbd>ESC</kbd></button></div></div><div class="console-objective"><span id="console-skill"></span><h2 id="console-title"></h2><p id="console-goal"></p></div><nav id="console-shortcuts" aria-label="Terminal shortcuts"></nav><div id="console-output" class="console-output" role="log" aria-label="Node terminal output" aria-live="polite"></div><form id="cyber-form"><div class="console-cwd"><span id="console-cwd">/workspace</span><span>SHIELDED · BOT STILL RACING</span></div><div class="console-input"><label for="cyber-command">❯</label><textarea id="cyber-command" rows="1" aria-label="Cyberspace command" placeholder="Inspect. Filter. Rewrite the system." autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"></textarea><button id="cyber-run" type="submit">Run ↵</button></div><div class="cyber-symbols"><button type="button" data-insert="|">|</button><button type="button" data-insert="'">'</button><button type="button" data-insert="/">/</button><button type="button" data-insert="-">-</button><button type="button" data-action="history">↑</button><button type="button" data-action="complete">Tab ⇥</button><span></span><button type="button" data-fill="hint">hint</button><button type="button" data-fill="help">help</button></div></form><div class="console-foot">VIRTUAL FILES ONLY <span id="console-race-status">ECHO-9 is working against the same objectives.</span></div></section>
  <section id="briefing" class="overlay-screen"><div class="briefing-card"><span class="micro-label">A GREP QUEST FIELD OPERATION / 001</span><div class="briefing-kicker"><span></span> YOUR ACCESS HAS BEEN REVOKED.</div><h2>Your mind.<br/>Their <em>machine.</em></h2><p class="story">WARDEN has locked the free programs inside its grid. Its recovery bot, <b>ECHO-9</b>, is racing to seal the network. You have one way to fight back: reach five nodes, read their evidence, and rewrite their controls.</p><div class="briefing-features"><span><b>01</b> MOVE THROUGH THE GRID</span><span><b>02</b> HIDE FROM SENTINELS</span><span><b>03</b> WIN WITH COMMANDS</span></div><label class="difficulty-label">CHOOSE YOUR PACE<select aria-label="Starting difficulty" data-difficulty>${difficultyOptions}</select></label><p class="difficulty-description" id="difficulty-description"></p><button class="primary-action" data-action="start">Enter the grid <span>↗</span></button><p class="start-controls">WASD / arrows to move · E to interface · Shift to sneak<br/>On mobile, tap destinations or use the directional pad.</p><p class="stretch-note">FIRST PLAYABLE / BOT RACE · TWO-PLAYER VERSUS PLANNED</p></div></section>
  <section id="pause-screen" class="overlay-screen" hidden><div class="small-card"><span class="micro-label">BOTH SIDES ARE PAUSED</span><h2>Take a breath.</h2><p>The grid, patrols, and ECHO-9 are waiting. You can change the difficulty without losing your liberated nodes.</p><label class="difficulty-label">PACE<select aria-label="Paused difficulty" data-difficulty>${difficultyOptions}</select></label><button class="primary-action" data-action="resume">Resume operation ↗</button><button class="secondary-action" data-action="restart">Restart with a fresh grid</button><a href="/">Return to Grep Quest</a></div></section>
  <section id="outcome" class="overlay-screen" hidden><div class="small-card"><span id="outcome-label" class="micro-label"></span><h2 id="outcome-title"></h2><p id="outcome-story"></p><div id="outcome-stats"></div><button id="retry-checkpoint" class="primary-action" data-action="retry">Retry from checkpoint ↗</button><button class="secondary-action" data-action="restart">New operation</button><a href="/">Return to Grep Quest</a></div></section>
  <div id="webgl-error" class="webgl-error" hidden><h2>3D rendering is unavailable.</h2><p>This mode needs WebGL 2. Try a browser with hardware acceleration enabled.</p><a href="/">Return to the Grep Quest course</a></div>`;
const input = document.querySelector<HTMLTextAreaElement>('#cyber-command')!;
const panel = document.querySelector<HTMLElement>('#console')!;
const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
function setDifficulty(value: string) {
  difficulty = value === 'easy' ? 'easy' : 'moderate'; game.difficulty = difficulty;
  document.querySelectorAll<HTMLSelectElement>('[data-difficulty]').forEach(select => select.value = difficulty);
  $('#difficulty-description').textContent = difficulty === 'easy' ? 'A 2.4× slower rival, gentler detection, and no extra race penalty when spotted. Same commands, more room to learn.' : 'The rival keeps racing during terminal work. Detection returns you to your checkpoint and gives the rival a small head start.';
  try { localStorage.setItem('nullrun-difficulty', difficulty); } catch {}
}
function log(text: string, type: 'system' | 'output' | 'error' | 'success' = 'system', command?: string) {
  entries.push({ text, type, command }); if (entries.length > 65) entries.shift();
  $('#console-output').innerHTML = entries.map(entry => `<div class="cyber-entry ${entry.type}">${entry.command ? `<div class="cyber-executed"><span>❯</span><code>${esc(entry.command)}</code></div>` : ''}<pre>${esc(entry.text)}</pre></div>`).join('');
  $('#console-output').scrollTop = $('#console-output').scrollHeight;
}
function objectiveText() {
  const objective = game.objectives[game.connectedNode >= 0 ? game.connectedNode : Math.min(game.stage, 4)];
  return `${objective.name} / ${objective.title}\n${objective.goal}\n\nInspect: ${objective.input}\nWrite:   ${objective.output}\nUse hint, help grep, help tee, or jack-out.`;
}
function openConsole() {
  if (!connect(game)) return;
  path = []; world?.showDestination(); keys.clear();
  cwd = '/workspace'; $('#console-cwd').textContent = cwd;
  const objective = game.objectives[game.connectedNode];
  $('#console-node').textContent = objective.name; $('#console-skill').textContent = objective.skill; $('#console-title').textContent = objective.title; $('#console-goal').textContent = objective.goal;
  $('#console-shortcuts').innerHTML = `<button data-fill="cat ${esc(objective.input)}">Inspect input</button><button data-fill="mission">Objective</button><button data-fill="hint">Hint</button><button data-fill="grep --help">grep --help</button><button data-fill="tee --help">tee --help</button>`;
  panel.hidden = false; app.classList.add('console-open');
  log(`LINK ESTABLISHED — ${objectiveText()}\n\nYou are shielded from patrols while connected. The rival is not paused.`);
  input.focus({ preventScroll: true }); updateHUD();
}
function closeConsole() {
  if (runningCommand) return;
  game.terminalOpen = false; panel.hidden = true; app.classList.remove('console-open'); keys.clear(); input.blur();
}
function setPaused(value: boolean) {
  if (game.phase !== 'running') return;
  game.paused = value; $('#pause-screen').hidden = !value; keys.clear();
  if (!value && game.terminalOpen) input.focus({ preventScroll: true });
}
function start() { game.phase = 'running'; $('#briefing').hidden = true; keys.clear(); updateHUD(); }
function restart() {
  worker?.terminate(); game = createGame(difficulty, seed()); path = []; hints = [0, 0, 0, 0, 0]; cwd = '/workspace'; history = []; historyIndex = 0; draft = ''; entries = []; lastEvent = -1;
  panel.hidden = true; app.classList.remove('console-open'); $('#pause-screen').hidden = true; $('#outcome').hidden = true; $('#briefing').hidden = false; world?.showDestination(); updateHUD();
}
function destination(point: Vec) {
  if (game.phase !== 'running' || game.paused || game.terminalOpen) return;
  path = findPath(game, point);
  if (path.length) world?.showDestination(point);
  else { game.event = 'No open route to that destination. Liberate the current node to lower its gate.'; game.eventId++; }
}
function showOutcome() {
  const won = game.phase === 'won'; $('#outcome').hidden = false; panel.hidden = true; app.classList.remove('console-open'); keys.clear();
  $('#outcome-label').textContent = won ? 'OPERATION COMPLETE / USER WINS' : 'RECOVERY COMPLETE / ECHO-9 WINS';
  $('#outcome-title').textContent = won ? 'The grid is yours.' : 'The system got there first.';
  $('#outcome-story').textContent = won ? 'Your broadcast freed the programs. WARDEN lost the network one careful command at a time.' : 'WARDEN has sealed the network. Your liberated nodes are saved for a checkpoint retry. Try Easy mode for more thinking time.';
  $('#outcome-stats').textContent = `${game.stage}/5 nodes liberated · ${clock(game.elapsed)} · ${game.detections} detections · ${difficulty}`;
  $('#retry-checkpoint').hidden = won;
}
function clock(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function updateHUD() {
  const objective = game.objectives[Math.min(game.stage, 4)];
  $('#objective-name').textContent = `${String(Math.min(game.stage + 1, 5)).padStart(2, '0')} / ${objective.name}`;
  $('#objective-text').textContent = objective.title;
  $('#node-track').innerHTML = game.objectives.map((o, i) => `<span class="${i < game.stage ? 'secured' : i === game.stage ? 'current' : ''}" title="${o.name}">${i < game.stage ? '✓' : i + 1}</span>`).join('');
  $('#player-score').textContent = `${game.stage} / 5`; $('#bot-score').textContent = `${game.bot.stage} / 5`;
  $('#player-progress').style.width = `${game.stage / 5 * 100}%`; $('#bot-progress').style.width = `${botProgress(game) * 100}%`;
  $('#bot-status').textContent = game.bot.stage >= 5 ? 'Recovery sequence complete' : `ECHO-9 → ${game.objectives[game.bot.stage].name} / ${distance(game.bot.position, game.objectives[game.bot.stage].position) > .3 ? 'APPROACHING' : game.bot.command ? 'APPLYING PATCH' : 'PROBING'}`;
  $('#game-clock').textContent = clock(game.elapsed);
  $('#trace-label').textContent = game.terminalOpen ? 'SIGNAL / SHIELDED' : game.trace > 1 ? 'SIGNAL / EXPOSED' : 'SIGNAL / HIDDEN';
  $('#trace-percent').textContent = `${Math.round(game.trace)}%`; $('#trace-progress').style.width = `${game.trace}%`; app.classList.toggle('exposed', game.trace > 20);
  $('#movement-state').textContent = path.length ? 'Following waypoint · movement keys cancel' : sneak || keys.has('shift') ? 'Sneaking · lower signal, slower movement' : 'Use cover. Red cones can see you.';
  const near = canInterface(game);
  $('#node-distance').textContent = `${objective.name} · ${Math.round(distance(game.position, objective.position))}m ${near ? '· IN RANGE' : ''}`;
  (document.querySelector('#interface-button') as HTMLButtonElement).disabled = !near;
  $('#console-race-status').textContent = `ECHO-9: ${game.bot.stage}/5 · ${clock(game.elapsed)}`;
  if (lastEvent !== game.eventId) { lastEvent = game.eventId; $('#event-toast').textContent = game.event; $('#event-toast').classList.remove('pulse'); void $('#event-toast').offsetWidth; $('#event-toast').classList.add('pulse'); }
  if (game.phase === 'won' || game.phase === 'lost') showOutcome();
}
function evaluate(command: string): Promise<Execution> {
  return new Promise((resolve, reject) => {
    const current = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' }); worker = current;
    const timer = setTimeout(() => { current.terminate(); reject(Error('Pattern timed out. Simplify the search; your control files are unchanged.')); }, 1500);
    current.onmessage = event => { clearTimeout(timer); current.terminate(); resolve(event.data); };
    current.onerror = () => { clearTimeout(timer); current.terminate(); reject(Error('The virtual command could not be evaluated.')); };
    current.postMessage({ command, state: { cwd, files: game.files, writablePaths: game.connectedNode === game.stage ? ['/workspace/' + game.objectives[game.stage].output] : [] } });
  });
}
async function submit() {
  const command = input.value.trim();
  if (!command || runningCommand || !game.terminalOpen || game.paused || game.phase !== 'running') return;
  history.push(command); historyIndex = history.length; draft = ''; input.value = '';
  if (command === 'jack-out' || command === 'next-node' || command === 'next-mission') {
    if (command !== 'jack-out' && game.connectedNode === game.stage) log('This node is not liberated yet. Use mission or hint. You can jack-out to explore.', 'error', command);
    else closeConsole();
    return;
  }
  if (command === 'status') { log(`YOU ${game.stage}/5 · ECHO-9 ${game.bot.stage}/5\nTRACE ${Math.round(game.trace)}% · TIME ${clock(game.elapsed)}\nPACE ${difficulty} · only designated virtual controls are writable.`, 'system', command); return; }
  if (command === 'clear') { entries = []; log(objectiveText()); return; }
  if (command === 'help') { log(`NULL//RUN controls (game commands, not Bash)\n  mission   Review this node's objective\n  hint      Reveal a progressive hint\n  status    Show race and trace status\n  jack-out  Return to the 3D grid\n  next-node Return to the grid after a successful patch\n  focus     Expand or restore the terminal\n\n${HELP}`, 'system', command); return; }
  runningCommand = true; input.readOnly = true; (document.querySelector('#cyber-run') as HTMLButtonElement).disabled = true;
  try {
    const result = await evaluate(command);
    if (game.phase !== 'running') return;
    cwd = result.cwd; $('#console-cwd').textContent = cwd;
    const action = result.stages[0]?.action;
    if (action && result.exitCode === 0) {
      if (action.type === 'hint') { const i = game.connectedNode; hints[i] = Math.min(3, hints[i] + 1); log(`HINT ${hints[i]}/3\n${game.objectives[i].hints[hints[i] - 1]}`, 'system', command); }
      else if (action.type === 'mission') log(action.number === undefined ? objectiveText() : 'Reach cyberspace nodes through movement. Use mission without a number to review the connected node.', 'system', command);
      else if (action.type === 'focus') { terminalFocused = action.mode === 'toggle' ? !terminalFocused : action.mode === 'on'; panel.classList.toggle('wide-console', terminalFocused); log('Terminal layout updated. The rival keeps racing.', 'system', command); }
      return;
    }
    log(result.stderr || result.stdout || (result.exitCode === 1 ? 'No matching lines. grep status: 1.' : '(no output)'), result.stderr ? 'error' : 'output', command);
    if (submitEvidence(game, result)) log(`CONTROL PATCHED ✓\n${game.objectives[game.connectedNode].reward}\n\nType next-node or jack-out to reach the next terminal.`, 'success');
    else if (result.stages.some(s => s.command === 'tee') && !result.stderr) log('Control updated, but the evidence does not match the objective yet. Inspect your pipeline and try again.', 'system');
    updateHUD();
  } catch (error) { log((error as Error).message, 'error', command); }
  finally { runningCommand = false; input.readOnly = false; (document.querySelector('#cyber-run') as HTMLButtonElement).disabled = false; if (game.terminalOpen) input.focus({ preventScroll: true }); }
}
function fill(text: string) { input.value = text; input.focus({ preventScroll: true }); }
function complete() {
  const before = input.value.slice(0, input.selectionStart); const partial = before.match(/[^\s'"|]*$/)?.[0] ?? '';
  const commands = [...Object.keys(COMMAND_HELP), 'jack-out', 'next-node', 'status'];
  const paths = Object.keys(game.files).map(p => p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p).flatMap(p => p.split('/').map((_, i, a) => a.slice(0, i + 1).join('/') + (i < a.length - 1 ? '/' : '')));
  const pool = /^help\s+\S*$/.test(before) || before === partial ? commands : partial.startsWith('--') ? ['--help'] : paths;
  const candidates = [...new Set(pool.filter(p => p.startsWith(partial)))];
  if (!candidates.length) return;
  let common = candidates[0]; for (const candidate of candidates) while (!candidate.startsWith(common)) common = common.slice(0, -1);
  input.setRangeText(common.slice(partial.length), input.selectionStart, input.selectionEnd, 'end'); input.focus({ preventScroll: true });
}
app.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!button) return;
  if (button.dataset.fill) { fill(button.dataset.fill); return; }
  if (button.dataset.insert) { input.setRangeText(button.dataset.insert, input.selectionStart, input.selectionEnd, 'end'); input.focus({ preventScroll: true }); return; }
  switch (button.dataset.action) {
    case 'start': if (world) start(); break;
    case 'pause': setPaused(!game.paused); break;
    case 'resume': setPaused(false); break;
    case 'restart': if (!runningCommand) restart(); break;
    case 'interface': openConsole(); break;
    case 'jack-out': closeConsole(); break;
    case 'waypoint': destination(game.objectives[Math.min(game.stage, 4)].position); break;
    case 'sneak': sneak = !sneak; $('#sneak-button').setAttribute('aria-pressed', String(sneak)); break;
    case 'history': if (historyIndex === history.length) draft = input.value; historyIndex = Math.max(0, historyIndex - 1); fill(history[historyIndex] ?? draft); break;
    case 'complete': complete(); break;
    case 'console-focus': terminalFocused = !terminalFocused; panel.classList.toggle('wide-console', terminalFocused); break;
    case 'retry': game.phase = 'running'; game.paused = false; game.position = { ...game.checkpoint }; game.trace = 0; game.invulnerable = 4; game.bot.stage = game.stage; game.bot.timer = 0; game.bot.command = 0; game.bot.position = { x: game.position.x + 4, z: game.position.z }; path = []; $('#outcome').hidden = true; updateHUD(); break;
  }
});
document.querySelectorAll<HTMLSelectElement>('[data-difficulty]').forEach(select => select.addEventListener('change', () => setDifficulty(select.value)));
document.querySelector('#cyber-form')!.addEventListener('submit', event => { event.preventDefault(); void submit(); });
input.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); void submit(); }
  if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); complete(); }
  if (event.key === 'ArrowUp') { event.preventDefault(); if (historyIndex === history.length) draft = input.value; historyIndex = Math.max(0, historyIndex - 1); fill(history[historyIndex] ?? draft); }
  if (event.key === 'ArrowDown') { event.preventDefault(); historyIndex = Math.min(history.length, historyIndex + 1); fill(historyIndex === history.length ? draft : history[historyIndex]); }
});
window.addEventListener('keydown', event => {
  const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
  if (event.key === 'Escape') { if (game.paused) setPaused(false); else if (game.terminalOpen) closeConsole(); else setPaused(true); return; }
  if (typing) return;
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) { event.preventDefault(); keys.add(key); if (key !== 'shift') { path = []; world?.showDestination(); } }
  if (key === 'e' && !event.repeat) openConsole();
  if (key === 'p' && !event.repeat) setPaused(!game.paused);
});
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); if (game.phase === 'running') setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); setPaused(true); } });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-move]')) {
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(button.dataset.move!); path = []; world?.showDestination(); });
  const release = () => keys.delete(button.dataset.move!);
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
}
setDifficulty(difficulty);
try { world = new CyberWorld($('#world'), destination, game); }
catch { $('#webgl-error').hidden = false; $('#briefing').hidden = true; }
function frame(now: number) {
  const dt = Math.min(.06, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
  if (game.phase === 'running' && !game.paused && !game.terminalOpen) {
    let movementTime = dt;
    let direction = { x: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')), z: Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')) };
    if (!direction.x && !direction.z && path.length) {
      if (distance(game.position, path[0]) < .2) path.shift();
      if (path.length) {
        direction = { x: path[0].x - game.position.x, z: path[0].z - game.position.z };
        movementTime = Math.min(dt, distance(game.position, path[0]) / (sneak || keys.has('shift') ? 3.2 : 7));
      }
      else world?.showDestination();
    }
    movePlayer(game, direction, movementTime, sneak || keys.has('shift'));
  }
  tick(game, dt, sneak || keys.has('shift'));
  world?.render(game, game.elapsed);
  if (now - hudTime > 90) { updateHUD(); hudTime = now; }
  animation = requestAnimationFrame(frame);
}
updateHUD(); animation = requestAnimationFrame(frame);
window.addEventListener('beforeunload', () => { cancelAnimationFrame(animation); worker?.terminate(); world?.dispose(); });
