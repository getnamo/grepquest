import './style.css';
import { CHAPTERS, MISSIONS, createFiles, isComplete } from './missions.ts';
import { HELP } from './engine.ts';
import type { Execution, ShellState } from './engine.ts';
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const icons = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m9 5 7 7-7 7"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h7l2 2h9v12H3V6Z"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18v-2c-5-4-3-12 3-12s8 8 3 12v2H9Zm0 3h6M12 1v1M2 11h2m16 0h2M4 3l2 2m12 0 2-2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"/></svg>',
};
interface Saved { completed: string[]; active: number }
function load(): Saved {
  try {
    const data = JSON.parse(localStorage.getItem('grep-quest-v1') ?? '{}');
    return { completed: Array.isArray(data.completed) ? [...new Set<string>(data.completed.filter((id: unknown) => MISSIONS.some(m => m.id === id)))] : [], active: Number.isInteger(data.active) && data.active >= 0 && data.active < MISSIONS.length ? data.active : 0 };
  } catch { return { completed: [], active: 0 }; }
}
const saved = load();
let active = saved.active, completed = new Set(saved.completed), practice = false;
let state: ShellState = { cwd: '/workspace', files: createFiles() };
let hints = 0, running = false, mobileTab = 'terminal', selectedFile = '', storageFailed = false;
let history: string[] = [], historyIndex = 0, draft = '', worker: Worker | undefined;
let apiAvailable = false;
const entries: { source: string; result: Execution; complete: boolean }[] = [];
fetch('/api/health').then(async response => { if (response.ok && response.headers.get('content-type')?.includes('application/json')) apiAvailable = (await response.json()).engine === 'virtual'; }).catch(() => {});
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="Grep Quest home"><span class="brand-mark">&gt;_</span><span>grep<span class="brand-light">quest</span><span class="beta">BETA</span></span></a>
    <div class="top-center"><span class="live-dot"></span> A LITTLE PRACTICE. A POWERFUL SKILL.</div>
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
        <div class="terminal-title"><span class="terminal-name"><span class="terminal-dot"></span> terminal <span class="terminal-label">/ VIRTUAL WORKSPACE</span></span><button data-action="clear" aria-label="Clear terminal">Clear <span>↺</span></button></div>
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
  try { localStorage.setItem('grep-quest-v1', JSON.stringify({ active, completed: [...completed] })); }
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
  document.querySelector('#mobile-objective')!.innerHTML = `<div><span class="eyebrow">${practice ? 'FREE PRACTICE' : done ? '✓ MISSION ACCOMPLISHED' : `MISSION ${String(active + 1).padStart(2, '0')}`}</span><p>${escape(practice ? 'Explore the workspace. Type help for the command reference.' : done ? mission.lesson : mission.brief)}</p></div>${done && !practice ? '<button class="next-button" data-action="next">Next →</button>' : '<button class="hint-button" data-tab="mission" aria-label="View mission and hints">Details →</button>'}`;
  document.querySelector('#mission-card')!.innerHTML = practice ? `<div class="mission-top"><span class="eyebrow">THE SANDBOX</span><span class="skill-pill">Explore freely</span></div><h2>Follow your curiosity.</h2><p class="brief">The whole workspace is yours to explore. Try a command, inspect the output, then build on what you learn.</p><div class="mission-bottom"><span class="mission-objective">No score. No timer. Just practice.</span><button class="text-button" data-action="return-course">Back to missions ${icons.arrow}</button></div>` : `<div class="mission-top"><span class="eyebrow">${CHAPTERS[mission.chapter].label}</span><span class="mission-position">${local.findIndex(m => m.id === mission.id) + 1} OF ${local.length}</span></div><div class="mission-title"><h2>${escape(mission.title)}</h2><span class="skill-pill">${escape(mission.skill)}</span></div><p class="brief">${escape(mission.brief)}</p>${done ? `<div class="success-box">${icons.check}<div><strong>${completed.size === MISSIONS.length ? 'Course complete. Keep exploring.' : 'Mission accomplished.'}</strong><p>${escape(mission.lesson)}</p></div></div>` : hints ? `<div class="hint-box">${icons.bulb}<div><strong>Hint ${hints} of ${mission.hints.length}</strong><p>${escape(mission.hints[hints - 1])}</p></div></div>` : ''}<div class="mission-bottom"><span class="mission-objective">${done ? '✓ Discovery saved' : '<span class="objective-dot"></span> Run a command to investigate'}</span>${done ? `<button class="next-button" data-action="next">${active < MISSIONS.length - 1 ? 'Next mission' : 'Free practice'} ${icons.arrow}</button>` : `<button class="hint-button" data-action="hint" ${hints === mission.hints.length ? 'disabled' : ''}>${icons.bulb} ${hints ? 'Another hint' : 'Need a hint?'}<span>${hints}/${mission.hints.length}</span></button>`}</div>`;
}
function renderOutput() {
  const container = document.querySelector('#terminal-output')!;
  container.innerHTML = entries.length ? entries.map((entry, index) => `<div class="terminal-entry"><div class="executed-command"><span>❯</span><code>${escape(entry.source)}</code>${entry.complete ? '<span class="command-check">✓</span>' : ''}</div>${entry.result.stdout ? `<pre class="stdout">${escape(entry.result.stdout)}</pre>` : ''}${entry.result.stderr ? `<pre class="stderr">${escape(entry.result.stderr)}</pre>` : ''}${entry.result.exitCode === 1 && !entry.result.stdout ? '<p class="no-match">No matching lines. grep exited with status 1.</p>' : ''}${entry.result.stages.length > 1 ? `<details class="pipeline"><summary>Inspect pipeline <span>${entry.result.stages.length} stages</span></summary><div>${entry.result.stages.map((stage, i) => `<section><span class="stage-number">${i + 1}</span><div><code>${escape([stage.command, ...stage.args].join(' '))}</code><span class="stage-status">exit ${stage.exitCode}</span><pre>${escape(stage.stdout || (stage.stderr ? '' : '(no output)'))}</pre>${stage.stderr ? `<pre class="stderr">${escape(stage.stderr)}</pre>` : ''}</div></section>`).join('')}</div></details>` : ''}<span class="entry-id sr-only">Command ${index + 1}</span></div>`).join('') : `<div class="terminal-welcome"><div class="welcome-mark">&gt;_</div><h3>A good question starts here.</h3><p>Your workspace is ready. Take a look around.</p><div class="starter-commands"><button data-fill="pwd">pwd <span>where am I?</span></button><button data-fill="ls">ls <span>what’s here?</span></button><button data-fill="help">help <span>what can I do?</span></button></div></div>`;
  container.scrollTop = container.scrollHeight;
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
function chooseMission(index: number) {
  active = index; practice = false; hints = 0; state = { cwd: '/workspace', files: createFiles() }; entries.length = 0; history = []; historyIndex = 0; draft = ''; commandInput.value = ''; selectedFile = ''; save(); render();
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
    state.cwd = result.cwd;
    const complete = !practice && isComplete(MISSIONS[active], result);
    entries.push({ source, result, complete });
    if (entries.length > 80) entries.shift();
    if (complete) { completed.add(MISSIONS[active].id); save(); renderNav(); renderMission(); announce('Mission accomplished. ' + MISSIONS[active].lesson); }
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
  const baseCommands = ['pwd', 'ls', 'cd', 'cat', 'head', 'tail', 'grep', 'sort', 'uniq', 'wc', 'help', 'clear'];
  const relativePaths = paths.map(p => state.cwd === '/' ? p.slice(1) : p.startsWith(state.cwd + '/') ? p.slice(state.cwd.length + 1) : p).flatMap(p => p.split('/').map((_, i, a) => a.slice(0, i + 1).join('/') + (i < a.length - 1 ? '/' : '')));
  const candidates = [...new Set((before === partial ? baseCommands : relativePaths).filter(p => p.startsWith(partial)))];
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
    case 'guide': document.querySelector<HTMLDialogElement>('#guide')!.showModal(); break;
    case 'close-guide': document.querySelector<HTMLDialogElement>('#guide')!.close(); break;
    case 'close-file': selectedFile = ''; renderFiles(); break;
    case 'hint': hints = Math.min(hints + 1, MISSIONS[active].hints.length); renderMission(); announce(MISSIONS[active].hints[hints - 1]); break;
    case 'next': if (active < MISSIONS.length - 1) chooseMission(active + 1); else { practice = true; renderNav(); renderMission(); } break;
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
