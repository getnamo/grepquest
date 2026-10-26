import './style.css';
import { CHAPTERS, MISSIONS, createFiles, isComplete } from './missions.ts';
import { HELP, COMMAND_HELP, HELP_TOPICS } from './engine.ts';
import type { Execution, ShellState, GameAction } from './engine.ts';
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const icons = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m9 5 7 7-7 7"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h7l2 2h9v12H3V6Z"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18v-2c-5-4-3-12 3-12s8 8 3 12v2H9Zm0 3h6M12 1v1M2 11h2m16 0h2M4 3l2 2m12 0 2-2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"/></svg>',
};
interface Saved { completed: string[]; active: number; focused: boolean }
function load(): Saved {
  try {
    const data = JSON.parse(localStorage.getItem('grep-quest-v1') ?? '{}');
    return { completed: Array.isArray(data.completed) ? [...new Set<string>(data.completed.filter((id: unknown) => MISSIONS.some(m => m.id === id)))] : [], active: Number.isInteger(data.active) && data.active >= 0 && data.active < MISSIONS.length ? data.active : 0, focused: data.focused === true };
  } catch { return { completed: [], active: 0, focused: false }; }
}
const saved = load();
let active = saved.active, completed = new Set(saved.completed), practice = false;
let focused = saved.focused, layoutScroll = 0, completionAnnounced = false;
let state: ShellState = { cwd: '/workspace', files: createFiles() };
let hints = 0, running = false, mobileTab = 'terminal', selectedFile = '', storageFailed = false;
let history: string[] = [], historyIndex = 0, draft = '', worker: Worker | undefined;
let apiAvailable = false;
interface TerminalEntry { source: string; result: Execution; complete: boolean; completion?: string; notice?: boolean }
const entries: TerminalEntry[] = [];
fetch('/api/health').then(async response => { if (response.ok && response.headers.get('content-type')?.includes('application/json')) apiAvailable = (await response.json()).engine === 'virtual'; }).catch(() => {});
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="Grep Quest home"><span class="brand-mark">&gt;_</span><span>grep<span class="brand-light">quest</span><span class="beta">BETA</span></span></a>
    <nav class="mode-links" aria-label="Game modes"><a class="cyber-mode-link" href="/cyber.html"><span class="live-dot"></span> NULL//RUN <span>SOLO MODE ↗</span></a><a class="versus-mode-link" href="/multiplayer.html">VERSUS <span>2–4 PLAYERS ↗</span></a></nav>
    <button class="guide-button" data-action="guide">${icons.book}<span>Field guide</span><kbd>?</kbd></button>
  </header>
  <div class="layout">
    <aside class="sidebar" aria-label="Mission navigation"><div id="course-nav"></div></aside>
    <main class="workspace">
      <div class="workspace-heading"><div><span class="eyebrow">YOUR COMMAND-LINE FIELD TRAINING</span><h1>Follow the signal<span>.</span></h1><p>Small commands. Clear thinking. Real discoveries.</p></div><div class="heading-art" aria-hidden="true"><span>⌁</span><code>inspect<br/> &nbsp;↳ filter<br/> &nbsp;&nbsp;&nbsp;↳ discover</code></div></div>
      <nav class="mobile-tabs" aria-label="Workspace views"><button data-tab="mission">Mission</button><button data-tab="terminal">Terminal</button><button data-tab="files">Files</button></nav>
      <section id="mission-card" class="mission-card" aria-label="Current mission"></section>
      <div id="mobile-objective" class="mobile-objective"></div>
      <section class="terminal" aria-label="Virtual terminal">
        <div class="terminal-title"><span class="terminal-name"><span class="terminal-dot"></span> terminal <span id="terminal-mission-label" class="terminal-label"></span></span><div class="terminal-actions"><button data-action="clear" aria-label="Clear terminal">Clear <span>↺</span></button><button data-action="focus" aria-label="Focus terminal" aria-pressed="false">Focus <span aria-hidden="true">⛶</span></button></div></div>
        <nav class="terminal-help" aria-label="Terminal help shortcuts"><span>Need a hand?</span><button data-fill="help">help</button><button data-fill="grep --help">grep --help</button><button data-fill="help pipes">help pipes</button></nav>
        <div id="terminal-output" class="terminal-output" role="log" aria-label="Command output" aria-live="polite"></div>
        <div class="input-area"><div class="cwd"><span class="live-dot"></span><span id="cwd">/workspace</span><span class="input-instruction">Enter to run</span></div>
          <form id="command-form"><label for="command" class="prompt" aria-label="Command">❯</label><textarea id="command" rows="1" aria-label="Shell command" placeholder="Type a command…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"></textarea><button class="run-button" type="submit">Run <span>↵</span></button></form>
          <div class="symbol-toolbar" aria-label="Command input helpers"><button data-insert="|" aria-label="Insert pipe">|</button><button data-insert="'" aria-label="Insert single quote">'</button><button data-insert='"' aria-label="Insert double quote">&quot;</button><button data-insert="/" aria-label="Insert slash">/</button><button data-insert="-" aria-label="Insert dash">-</button><button data-insert="*" aria-label="Insert wildcard">*</button><span></span><button data-action="previous" aria-label="Previous command">↑</button><button data-action="next-history" aria-label="Next command">↓</button><button data-action="complete">Tab ⇥</button></div>
        </div>
        <div class="terminal-foot"><span><span class="tiny-dot"></span> Safe to experiment</span><span>Virtual files · no system commands</span></div>
      </section>
      <div class="learning-note">${icons.bulb}<span>You don’t need to memorize everything. Learn to ask the next useful question.</span></div>
    </main>
    <aside class="inspector" aria-label="Virtual file explorer"><div class="inspector-head"><span>EXPLORER</span><span class="file-count">14 FILES</span></div><div class="tree-root">${icons.folder}<span>workspace</span><span class="root-badge">VIRTUAL</span></div><div id="file-tree"></div><div id="file-preview"></div><div class="explorer-note"><span>01 — THE WORKING HABIT</span><p>Look around before<br/>you narrow down.</p><div class="habit-diagram"><code>ls</code><i>→</i><code>head</code><i>→</i><code>grep</code></div></div></aside>
  </div>
  <dialog id="guide"><div class="dialog-heading"><div><span class="eyebrow">KEEP THIS HANDY</span><h2>Your field guide</h2></div><button data-action="close-guide" aria-label="Close field guide">×</button></div><pre>${escape(HELP)}</pre><p>Your progress is saved in this browser. This environment teaches a limited Bash-style command set.</p><button class="reset-button" data-action="reset">Reset course progress</button></dialog>
  <div id="announcement" class="sr-only" role="status" aria-live="polite"></div>`;
const commandInput = document.querySelector<HTMLTextAreaElement>('#command')!;
function save() {
  try { localStorage.setItem('grep-quest-v1', JSON.stringify({ active, completed: [...completed], focused })); }
  catch { if (!storageFailed) { storageFailed = true; announce('Browser storage is unavailable. Progress will last for this session only.'); } }
}
function announce(text: string) { document.querySelector('#announcement')!.textContent = text; }
function renderNav() {
  const chapter = MISSIONS[active].chapter;
  document.querySelector('#course-nav')!.innerHTML = `<div class="course-intro"><span class="eyebrow">THE LEARNING PATH</span><h2>Think in commands.</h2><p>Three cases. Twenty discoveries.</p></div><div class="progress-label"><span>Your progress</span><strong>${completed.size}<span> / ${MISSIONS.length}</span></strong></div><div class="progress-track"><div style="width:${completed.size / MISSIONS.length * 100}%"></div></div><div class="chapters">${CHAPTERS.map((c, index) => {
    const missions = MISSIONS.map((m, i) => ({ ...m, index: i })).filter(m => m.chapter === index);
    const done = missions.filter(m => completed.has(m.id)).length;
    return `<div class="chapter ${index === chapter && !practice ? 'chapter-active' : ''}"><button class="chapter-button" data-chapter="${index}" aria-expanded="${index === chapter && !practice}"><span class="chapter-icon">${c.icon}</span><span><small>CASE 0${index + 1}</small><strong>${c.name}</strong></span><span class="chapter-count">${done}/${missions.length}</span></button>${index === chapter && !practice ? `<div class="mission-list">${missions.map((m, i) => `<button class="mission-link ${m.index === active ? 'selected' : ''} ${completed.has(m.id) ? 'done' : ''}" data-mission="${m.index}" ${m.index === active ? 'aria-current="step"' : ''}><span class="mission-number">${completed.has(m.id) ? icons.check : String(i + 1).padStart(2, '0')}</span><span>${escape(m.title)}</span>${m.index === active ? '<span class="selected-dot"></span>' : ''}</button>`).join('')}</div>` : ''}</div>`;
  }).join('')}</div><div class="sidebar-bottom"><button class="practice-button ${practice ? 'practice-active' : ''}" data-action="practice"><span>&gt;_</span><span>Free practice<small>A little room to experiment</small></span>${icons.arrow}</button><p>Curiosity is a command-line superpower.</p></div>`;
}
function renderMission() {
  const mission = MISSIONS[active];
  const done = completed.has(mission.id);
  const local = MISSIONS.filter(m => m.chapter === mission.chapter);
  document.querySelector('#terminal-mission-label')!.textContent = practice ? '/ FREE PRACTICE' : `/ MISSION ${String(active + 1).padStart(2, '0')} · ${mission.title}`;
  document.querySelector('#mobile-objective')!.innerHTML = `<div><span class="eyebrow">${practice ? 'FREE PRACTICE' : done ? '✓ MISSION ACCOMPLISHED' : `MISSION ${String(active + 1).padStart(2, '0')}`}</span><p>${escape(practice ? 'Explore the workspace. Type help for the command reference.' : done ? mission.lesson : mission.brief)}</p></div>${done && !practice ? '<button class="next-button" data-action="next">Next →</button>' : '<button class="hint-button" data-tab="mission" aria-label="View mission and hints">Details →</button>'}`;
  document.querySelector('#mission-card')!.innerHTML = practice ? `<div class="mission-top"><span class="eyebrow">THE SANDBOX</span><span class="skill-pill">Explore freely</span></div><h2>Follow your curiosity.</h2><p class="brief">The whole workspace is yours to explore. Try a command, inspect the output, then build on what you learn.</p><div class="mission-bottom"><span class="mission-objective">No score. No timer. Just practice.</span><button class="text-button" data-action="return-course">Back to missions ${icons.arrow}</button></div>` : `<div class="mission-top"><span class="eyebrow">${CHAPTERS[mission.chapter].label}</span><span class="mission-position">${local.findIndex(m => m.id === mission.id) + 1} OF ${local.length}</span></div><div class="mission-title"><h2>${escape(mission.title)}</h2><span class="skill-pill">${escape(mission.skill)}</span></div><p class="brief">${escape(mission.brief)}</p>${done ? `<div class="success-box">${icons.check}<div><strong>${completed.size === MISSIONS.length ? 'Course complete. Keep exploring.' : 'Mission accomplished.'}</strong><p>${escape(mission.lesson)}</p></div></div>` : hints ? `<div class="hint-box">${icons.bulb}<div><strong>Hint ${hints} of ${mission.hints.length}</strong><p>${escape(mission.hints[hints - 1])}</p></div></div>` : ''}<div class="mission-bottom"><span class="mission-objective">${done ? '✓ Discovery saved' : '<span class="objective-dot"></span> Run a command to investigate'}</span>${done ? `<button class="next-button" data-action="next">${active < MISSIONS.length - 1 ? 'Next mission' : 'Free practice'} ${icons.arrow}</button>` : `<button class="hint-button" data-action="hint" ${hints === mission.hints.length ? 'disabled' : ''}>${icons.bulb} ${hints ? 'Another hint' : 'Need a hint?'}<span>${hints}/${mission.hints.length}</span></button>`}</div>`;
}
function missionBriefing(): string {
  if (practice) return `FREE PRACTICE\nExplore the virtual workspace at your own pace.\nUse help for commands, or mission <number> to return to a case.`;
  const mission = MISSIONS[active];
  return `MISSION ${String(active + 1).padStart(2, '0')}/${MISSIONS.length} — ${mission.title}\n${mission.brief}\n\n${completed.has(mission.id) ? 'Already completed. Type next-mission to continue or replay the task.' : 'Type hint for a nudge, or help <command> for a reference.'}`;
}
function completionMessage(): string {
  const mission = MISSIONS[active];
  return `✓ MISSION COMPLETE — ${mission.title}\n${mission.lesson}\n\n${active === MISSIONS.length - 1 ? 'Type next-mission to enter free practice.' : 'Type next-mission to continue.'}`;
}
function appendNotice(text: string) {
  entries.push({ source: '', result: { stdout: text, stderr: '', exitCode: 0, cwd: state.cwd, stages: [] }, complete: false, notice: true });
  if (entries.length > 80) entries.shift();
}
function renderOutput() {
  const container = document.querySelector('#terminal-output')!;
  container.innerHTML = entries.length ? entries.map((entry, index) => `
    <div class="terminal-entry ${entry.notice ? 'game-notice' : ''}">
      ${entry.source ? `<div class="executed-command"><span>❯</span><code>${escape(entry.source)}</code>${entry.complete ? '<span class="command-check">✓</span>' : ''}</div>` : ''}
      ${entry.result.stdout ? `<pre class="${entry.notice ? 'mission-brief' : 'stdout'} ${entry.result.stages.at(-1)?.isHelp || entry.result.stages.at(-1)?.action ? 'help-output' : ''}">${escape(entry.result.stdout)}</pre>` : ''}
      ${entry.result.stderr ? `<pre class="stderr">${escape(entry.result.stderr)}</pre>` : ''}
      ${entry.result.exitCode === 1 && !entry.result.stdout ? '<p class="no-match">No matching lines. grep exited with status 1.</p>' : ''}
      ${entry.result.stages.length > 1 ? `<details class="pipeline"><summary>Inspect pipeline <span>${entry.result.stages.length} stages</span></summary><div>${entry.result.stages.map((stage, i) => `<section><span class="stage-number">${i + 1}</span><div><code>${escape([stage.command, ...stage.args].join(' '))}</code><span class="stage-status">exit ${stage.exitCode}</span><pre>${escape(stage.stdout || (stage.stderr ? '' : '(no output)'))}</pre>${stage.stderr ? `<pre class="stderr">${escape(stage.stderr)}</pre>` : ''}</div></section>`).join('')}</div></details>` : ''}
      ${entry.completion ? `<pre class="mission-complete">${escape(entry.completion)}</pre>` : ''}
      <span class="entry-id sr-only">Command ${index + 1}</span>
    </div>`).join('') : `<div class="terminal-welcome"><div class="welcome-mark">&gt;_</div><h3>A good question starts here.</h3><p>Your workspace is ready. Take a look around.</p><div class="starter-commands"><button data-fill="pwd">pwd <span>where am I?</span></button><button data-fill="ls">ls <span>what’s here?</span></button><button data-fill="help">help <span>what can I do?</span></button></div></div><pre class="mission-brief welcome-brief">${escape(missionBriefing())}</pre>`;
  const last = entries.at(-1);
  if (!entries.length) container.scrollTop = 0;
  else if ((last?.result.stages.at(-1)?.isHelp || last?.result.stages.at(-1)?.action || last?.notice) && container.lastElementChild) {
    // Open references and mission briefings at their heading.
    container.scrollTop += container.lastElementChild.getBoundingClientRect().top - container.getBoundingClientRect().top - 18;
  } else container.scrollTop = container.scrollHeight;
  document.querySelector('#cwd')!.textContent = state.cwd;
}
function renderFiles() {
  const dirs = ['', 'data', 'docs', 'logs', 'src'];
  document.querySelector('#file-tree')!.innerHTML = dirs.map(dir => {
    const paths = Object.keys(state.files).filter(p => p.slice('/workspace/'.length).split('/').slice(0, -1).join('/') === dir);
    const content = paths.map(path => `<button class="file-button ${path === selectedFile ? 'file-selected' : ''}" data-file="${escape(path)}">${icons.file}<span>${escape(path.split('/').at(-1)!)}</span></button>`).join('');
    return dir ? `<details class="file-folder" open><summary>${icons.folder}<span>${dir}</span><span class="folder-count">${paths.length}</span></summary>${content}</details>` : content;
  }).join('');
  document.querySelector('#file-preview')!.innerHTML = selectedFile ? `<div class="preview-heading"><span>${escape(selectedFile.split('/').at(-1)!)}</span><button data-action="close-file" aria-label="Close file preview">×</button></div><div class="preview-path">${escape(selectedFile)}</div><pre class="file-content">${escape(state.files[selectedFile])}</pre><button class="read-file-button" data-fill="${escape(`cat '${selectedFile.slice('/workspace/'.length)}'`)}">Read in terminal ${icons.arrow}</button>` : '<div class="preview-empty">Select a file to peek inside.<br/>Use commands to solve the mission.</div>';
  document.querySelector('.file-count')!.textContent = `${Object.keys(state.files).length} FILES`;
}
function renderTabs() {
  app.dataset.tab = mobileTab;
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach(button => { button.classList.toggle('tab-active', button.dataset.tab === mobileTab); button.setAttribute('aria-current', button.dataset.tab === mobileTab ? 'page' : 'false'); });
}
function render() { renderNav(); renderMission(); renderOutput(); renderFiles(); renderTabs(); }
function chooseMission(index: number, preserveTranscript = false) {
  active = index; practice = false; hints = 0; completionAnnounced = false;
  state = { cwd: '/workspace', files: createFiles() };
  if (!preserveTranscript) { entries.length = 0; history = []; historyIndex = 0; draft = ''; commandInput.value = ''; }
  selectedFile = ''; save(); render();
}
function setFocus(enabled: boolean, focusInput = true) {
  if (enabled && !focused) layoutScroll = window.scrollY;
  focused = enabled;
  app.classList.toggle('cli-focus', focused);
  document.body.classList.toggle('terminal-focused', focused);
  const button = document.querySelector<HTMLButtonElement>('[data-action="focus"]')!;
  button.setAttribute('aria-pressed', String(focused));
  button.setAttribute('aria-label', focused ? 'Restore layout' : 'Focus terminal');
  button.innerHTML = focused ? 'Restore layout <span aria-hidden="true">↙</span>' : 'Focus <span aria-hidden="true">⛶</span>';
  if (focused) { mobileTab = 'terminal'; renderTabs(); }
  else window.scrollTo(0, layoutScroll);
  save();
  if (focusInput) commandInput.focus({ preventScroll: true });
}
function nextMission(): string {
  if (practice) return 'You are in free practice. Type mission <number> to open a mission.';
  if (!completed.has(MISSIONS[active].id)) throw Error('Finish the current mission first. Type mission to review the objective or hint for a nudge.');
  if (active < MISSIONS.length - 1) chooseMission(active + 1, true);
  else {
    practice = true; renderNav(); renderMission();
    return `${completed.size === MISSIONS.length ? 'COURSE COMPLETE — all 20 missions solved.' : `Final mission complete. ${completed.size}/${MISSIONS.length} missions solved.`}\n\n${missionBriefing()}`;
  }
  return missionBriefing();
}
function applyGameAction(action: GameAction): string {
  switch (action.type) {
    case 'next-mission': return nextMission();
    case 'mission':
      if (action.number !== undefined) {
        if (action.number > MISSIONS.length) throw Error(`Choose a mission from 1 to ${MISSIONS.length}.`);
        chooseMission(action.number - 1, true);
      }
      return missionBriefing();
    case 'hint':
      if (practice) return 'Free practice has no mission hints. Try help, or mission <number> to open a case.';
      hints = Math.min(hints + 1, MISSIONS[active].hints.length); renderMission();
      return `HINT ${hints}/${MISSIONS[active].hints.length} — ${MISSIONS[active].title}\n${MISSIONS[active].hints[hints - 1]}`;
    case 'focus':
      setFocus(action.mode === 'toggle' ? !focused : action.mode === 'on');
      return focused ? `Focus mode on. Use Escape or focus off to restore the layout.\n\n${missionBriefing()}` : 'Focus mode off. Your transcript and progress are unchanged.';
  }
}
function runWorker(command: string): Promise<Execution> {
  return new Promise((resolve, reject) => {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const current = worker;
    const timer = setTimeout(() => { current.terminate(); reject(Error('That command took too long. Simplify your pattern and try again.')); }, 1500);
    current.onmessage = event => { clearTimeout(timer); current.terminate(); resolve(event.data); };
    current.onerror = () => { clearTimeout(timer); current.terminate(); reject(Error('The command could not be evaluated. Your virtual files are unchanged.')); };
    current.postMessage({ command, state });
  });
}
async function submit() {
  const source = commandInput.value.trim();
  if (!source || running) return;
  if (source === 'clear') { entries.length = 0; commandInput.value = ''; renderOutput(); return; }
  running = true;
  const runButton = document.querySelector<HTMLButtonElement>('.run-button')!;
  runButton.disabled = true; runButton.textContent = 'Running…';
  commandInput.readOnly = true;
  history.push(source); historyIndex = history.length; draft = '';
  try {
    let result: Execution;
    if (apiAvailable) {
      const response = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: source, cwd: state.cwd, missionId: practice ? undefined : MISSIONS[active].id }), signal: AbortSignal.timeout(4000) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error ?? 'Unable to run the virtual command.');
      result = payload;
    } else result = await runWorker(source);
    const action = result.exitCode === 0 ? result.stages[0]?.action : undefined;
    state.cwd = result.cwd;
    if (action) {
      try { result = { ...result, stdout: applyGameAction(action), cwd: state.cwd }; }
      catch (error) { result = { ...result, stdout: '', stderr: (error as Error).message + '\n', exitCode: 2 }; }
    }
    const complete = !action && !practice && isComplete(MISSIONS[active], result);
    const completion = complete && !completionAnnounced ? completionMessage() : undefined;
    entries.push({ source, result, complete, completion });
    if (entries.length > 80) entries.shift();
    if (complete) { completionAnnounced = true; completed.add(MISSIONS[active].id); save(); renderNav(); renderMission(); announce('Mission accomplished. Type next-mission to continue.'); }
    else if (action) announce(result.stderr || result.stdout);
    else if (!practice && !result.stderr && result.exitCode === 0) announce('Command ran. Keep investigating to reach the mission objective.');
    commandInput.value = ''; renderOutput();
  } catch (error) {
    entries.push({ source, result: { stdout: '', stderr: (error as Error).message, exitCode: 2, cwd: state.cwd, stages: [] }, complete: false }); renderOutput();
  } finally { running = false; runButton.disabled = false; runButton.innerHTML = 'Run <span>↵</span>'; commandInput.readOnly = false; commandInput.style.height = ''; commandInput.focus({ preventScroll: true }); }
}
function fill(value: string) { commandInput.value = value; mobileTab = 'terminal'; renderTabs(); commandInput.focus({ preventScroll: true }); resizeInput(); }
function changeHistory(direction: number) {
  if (historyIndex === history.length) draft = commandInput.value;
  historyIndex = Math.max(0, Math.min(history.length, historyIndex + direction));
  commandInput.value = historyIndex === history.length ? draft : history[historyIndex]; resizeInput();
}
function completePath() {
  const before = commandInput.value.slice(0, commandInput.selectionStart);
  const match = before.match(/(?:^|\s)([^\s'"]*)$/);
  if (!match) return;
  const partial = match[1];
  const paths = [...Object.keys(state.files)];
  const baseCommands = Object.keys(COMMAND_HELP);
  const relativePaths = paths.map(p => state.cwd === '/' ? p.slice(1) : p.startsWith(state.cwd + '/') ? p.slice(state.cwd.length + 1) : p).flatMap(p => p.split('/').map((_, i, a) => a.slice(0, i + 1).join('/') + (i < a.length - 1 ? '/' : '')));
  const segment = before.split('|').at(-1)!.trimStart();
  const choices = segment === partial ? baseCommands : /^help\s+\S*$/.test(segment) ? [...baseCommands, ...Object.keys(HELP_TOPICS)] : partial.startsWith('--') ? ['--help'] : relativePaths;
  const candidates = [...new Set(choices.filter(p => p.startsWith(partial)))];
  if (!candidates.length) { announce('No matching command or path.'); return; }
  let common = candidates[0];
  for (const candidate of candidates) while (!candidate.startsWith(common)) common = common.slice(0, -1);
  if (common.length > partial.length) {
    const end = commandInput.selectionStart;
    commandInput.setRangeText(common.slice(partial.length), end, end, 'end'); resizeInput();
  } else announce(`Matches: ${candidates.join(', ')}`);
  commandInput.focus({ preventScroll: true });
}
function resizeInput() { commandInput.style.height = 'auto'; commandInput.style.height = Math.min(commandInput.scrollHeight, 120) + 'px'; }
document.querySelector('#command-form')!.addEventListener('submit', event => { event.preventDefault(); void submit(); });
commandInput.addEventListener('input', resizeInput);
commandInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); void submit(); }
  if (event.key === 'ArrowUp' && !event.shiftKey) { event.preventDefault(); changeHistory(-1); }
  if (event.key === 'ArrowDown' && !event.shiftKey) { event.preventDefault(); changeHistory(1); }
  if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); completePath(); }
  if (event.key === 'l' && event.ctrlKey) { event.preventDefault(); entries.length = 0; renderOutput(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && focused && !document.querySelector<HTMLDialogElement>('#guide')!.open) { event.preventDefault(); setFocus(false); }
  if (event.key === '?' && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLInputElement)) document.querySelector<HTMLDialogElement>('#guide')!.showModal();
});
app.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('button, a.brand');
  if (!button) return;
  if (button.matches('a.brand')) { event.preventDefault(); if (!running) chooseMission(active); return; }
  if (button.dataset.tab) { mobileTab = button.dataset.tab; renderTabs(); return; }
  if (running && !['guide', 'close-guide'].includes(button.dataset.action ?? '')) return;
  if (button.dataset.mission !== undefined) { chooseMission(Number(button.dataset.mission)); return; }
  if (button.dataset.chapter !== undefined) { const chapter = Number(button.dataset.chapter); chooseMission(MISSIONS.findIndex(m => m.chapter === chapter && !completed.has(m.id)) >= 0 ? MISSIONS.findIndex(m => m.chapter === chapter && !completed.has(m.id)) : MISSIONS.findIndex(m => m.chapter === chapter)); return; }
  if (button.dataset.fill !== undefined) { fill(button.dataset.fill); return; }
  if (button.dataset.insert !== undefined) { commandInput.setRangeText(button.dataset.insert, commandInput.selectionStart, commandInput.selectionEnd, 'end'); commandInput.focus({ preventScroll: true }); resizeInput(); return; }
  if (button.dataset.file) { selectedFile = button.dataset.file; renderFiles(); return; }
  switch (button.dataset.action) {
    case 'focus': {
      setFocus(!focused);
      if (focused) { appendNotice(missionBriefing()); renderOutput(); }
      break;
    }
    case 'guide': document.querySelector<HTMLDialogElement>('#guide')!.showModal(); break;
    case 'close-guide': document.querySelector<HTMLDialogElement>('#guide')!.close(); break;
    case 'close-file': selectedFile = ''; renderFiles(); break;
    case 'hint': hints = Math.min(hints + 1, MISSIONS[active].hints.length); renderMission(); announce(MISSIONS[active].hints[hints - 1]); break;
    case 'next': appendNotice(nextMission()); renderOutput(); commandInput.focus({ preventScroll: true }); break;
    case 'return-course': practice = false; renderNav(); renderMission(); break;
    case 'practice': practice = true; hints = 0; renderNav(); renderMission(); break;
    case 'clear': entries.length = 0; renderOutput(); break;
    case 'previous': changeHistory(-1); commandInput.focus({ preventScroll: true }); break;
    case 'next-history': changeHistory(1); commandInput.focus({ preventScroll: true }); break;
    case 'complete': completePath(); break;
    case 'reset': if (confirm('Reset all saved mission progress in this browser?')) { completed = new Set(); chooseMission(0); document.querySelector<HTMLDialogElement>('#guide')!.close(); } break;
  }
});
window.addEventListener('beforeunload', () => worker?.terminate());
render();
setFocus(focused, false);
