# Grep Quest

A responsive command-line learning game with 20 missions, three investigations, free practice, a virtual file explorer, progressive hints, and pipeline inspection.

## Run locally

Requires Node.js 24 or newer.

```sh
npm install
npm run build
npm start
```

Open http://127.0.0.1:3000. `PORT=3001 npm start` changes the port. The server binds to loopback by default.

### Try it over your LAN

Run `npm run start:lan` to listen on all network interfaces at port 3001. Open `http://<your-machine-LAN-IP>:3001` from a desktop or phone on the same network. Use your machine's current LAN IP; no device-specific address is stored in the project. The Node server runs the virtual command interpreter for connected clients.

To choose a different interface or port, run `HOST=0.0.0.0 PORT=3002 npm start`. This project can be developed and served entirely locally; no hosted artifact or deployment is required.

For frontend development, `npm run dev` starts Vite. This mode uses the browser worker. Production Node mode uses `/api/run` and a JavaScript worker thread for each command. A static deployment uses the identical engine in a browser Web Worker. Neither mode executes an OS shell.

## Isolation model

`src/engine.ts` is a pure TypeScript interpreter. It has **no imports**, host filesystem access, process execution, network requests, `eval`, or dynamic code generation. Paths resolve exclusively against a fixed, in-memory virtual filesystem. There is no fallback to real executables. Unsupported commands and syntax return an explanation.

The Node server reads only application assets from `dist/`; player paths are never passed to filesystem APIs. The API accepts a command and virtual cwd, supplies its own training files, and evaluates the result in a disposable JavaScript worker. Worker threads are not shell processes. Limits cover command length, regex length, pipeline stages, output, worker memory, concurrent server executions, and execution time. Browser workers are also terminated after a timeout, so an expensive regular expression cannot freeze the interface.

Progress lives in localStorage in the current browser. There are no accounts, cross-device sync, leaderboards, paid services, or AI requests. Grading is deterministic and does not serve as an anti-cheat system.

## Supported shell subset

- `pwd`, `ls -a`, `cd`, `cat`, `head -n N`, `tail -n N`
- `grep -i -v -n -r -l -c -F -E -h -H -w -x`, plus `--` and `-e pattern`
- `sort -n -r`, `uniq -c`, `wc -l -w -c`, `echo`, `help`, `clear`
- `tee -a` for designated virtual control files in cyberspace mode
- Single and double quotes, backslash escaping, relative and absolute virtual paths, unquoted `*`/`?` filename globs, and pipelines.
- Standard output, standard error, exit codes, and per-stage pipeline results. A pipeline's exit code is its last stage's, while all stage errors remain visible.

### Help inside the terminal

Use `help` for the overview, `grep --help` or `ls --help` for supported flags and examples, and `help cd` for a builtin. `help <command>` works for every supported command in this lab. `help pipes`, `help quoting`, and `help globs` explain shell concepts. Help output can be filtered through pipelines and does not count toward mission completion. Terminal shortcuts and Tab completion help you discover these references.

`--help` is a convention, not a universal Bash feature. GNU utilities commonly accept it, while other implementations vary; Bash's `help` documents builtins. In particular, the builtin `echo --help` prints literal text, so use `help echo`. This lab preserves that behavior and labels its references as a supported subset, rather than full system manuals.

### Stay in the CLI

Use the terminal's **Focus** button or type `focus` to fill the webpage with the terminal. The rest of the layout is hidden without using the browser's fullscreen API. Escape, **Restore layout**, or `focus off` returns to the full page. The focus preference is saved in this browser, and toggling it preserves your input draft, transcript, and progress.

Mission completion appears directly in the transcript. Type `next-mission` to continue once the current mission is complete; the next objective appears in the terminal and command history is preserved. After the final mission, this command enters free practice. Use `mission` to review the objective, `hint` for progressive hints, or `mission <number>` to open or replay a particular mission. These are game controls, separate from the Bash-style commands, and must run outside pipelines. Each also has `--help`.

This is an explicitly limited Bash-style environment, not a full Bash implementation. The course is read-only; cyberspace enables tee writes to designated virtual controls. There are no redirections, scripts, loops, variables, substitutions, command lists, networking, or real executables. Grep's regex subset uses JavaScript regex internally, with a basic-regex translation; lookaround, backreferences, and POSIX character classes are rejected. Sorting uses predictable codepoint ordering rather than a host locale. `ls` shows directory suffixes for discoverability. Some flag combinations, multi-file formatting, and edge cases differ from GNU utilities. Full GNU conformance is not claimed.

## Structure

```text
src/engine.ts       Pure, shared virtual shell
src/missions.ts     Training files, lessons, hints, completion rules
src/main.ts         Responsive browser interface and progress
src/worker.ts       Browser execution worker
server/index.ts    Node static server and virtual execution API
server/runner.ts   Disposable Node execution worker
```

Each mission defines an objective, hints, a reference solution, and expected evidence. Completion compares normalized output or virtual cwd, accepts alternative commands, requires pipelines where taught, rejects stderr, and rejects answers manufactured with echo. Reference solutions are shipped with the app for hints; this is a learning tool.

## Checks

```sh
npm test
npm run build
npx playwright install chromium
npx playwright test
```

The engine tests exercise every mission, alternative solutions, syntax, paths, grep semantics, and isolation. Browser checks complete the course, verify persistence, test mobile views and narrow layouts, exercise both execution modes, and confirm recovery from a pathological regex. Set `PLAYWRIGHT_BROWSERS_PATH` when your environment requires a custom browser install location.

Browser checks currently target Chromium, including mobile viewport emulation. Physical device keyboard behavior, Firefox, and Safari still need manual validation. Course mission data is fixed; cyberspace generates seeded evidence for each run. Randomized course datasets and cross-device progress are future work.

Self-hosted DM Sans and IBM Plex Mono fonts use the SIL Open Font License; license files are in `public/fonts/`.

## NULL//RUN: cyberspace mode

Open `/cyber.html`, or choose **NULL//RUN** in the course header. This is a separate first playable mode: a third-person 3D stealth race against ECHO-9, the rogue system's deterministic recovery bot. Grep Quest course progress is separate.

Move through a neon grid, use cover to avoid sentinel scan cones, and interface with five nodes. Each node teaches a filtering task whose output changes a designated virtual control file through `tee`. Successful patches lower gates, disable a sentinel, weaken detection, and ultimately broadcast an escape signal. The rival moves through the same nodes and evaluates authored commands against its own copy of the same files; it is not an LLM or a remote opponent.

- **Desktop:** WASD/arrows move, Shift sneaks, E interfaces, Escape disconnects or pauses, P pauses.
- **Mobile:** tap the ground, set a waypoint, or use the directional pad. Use the Interface button within range.
- **Terminal:** `mission`, `hint`, `status`, `help`, `grep --help`, `tee --help`, `focus`, `jack-out`, and `next-node` support the loop.
- **Moderate:** the bot keeps racing during terminal work; detection returns you to your last liberated node with a small race penalty.
- **Easy:** the bot takes 2.4 times as long to solve each node, detection rises more slowly, and detection adds no extra race penalty.
- **Pause:** freezes both racers and patrols, including when the page loses focus. Node terminals shield you from patrols, while the bot continues racing.

Checkpoint retry preserves liberated nodes within the current run. Restart or page reload begins a new run; only difficulty preference persists. Terminal writes are opt-in, limited to the currently connected node's virtual control file, and never reach Node's or the browser host's filesystem. Course files stay read-only. There is no multiplayer service or account sync. Two-player versus racing is a future stretch goal.

The 3D scene uses locally bundled Three.js and procedural geometry; it makes no image, model, or LLM service calls. WebGL 2 is required, and unsupported browsers get an explanatory screen with a link back to the course. Visual effects and touch controls have browser automation coverage; physical mobile GPU/keyboard testing remains useful before wider distribution.

`src/cyber/model.ts` contains the testable race, collision, detection, checkpoint, pathfinding, and objective logic. `src/cyber/world.ts` renders the grid. `src/cyber/main.ts` connects controls, the worker-based virtual shell, and the UI. The separate HTML entry keeps 3D assets out of the course's initial bundle.
