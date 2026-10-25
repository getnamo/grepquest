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

For frontend development, `npm run dev` starts Vite. This mode uses the browser worker. Production Node mode uses `/api/run` and a JavaScript worker thread for each command. A static deployment uses the identical engine in a browser Web Worker. Neither mode executes an OS shell.

## Isolation model

`src/engine.ts` is a pure TypeScript interpreter. It has **no imports**, host filesystem access, process execution, network requests, `eval`, or dynamic code generation. Paths resolve exclusively against a fixed, in-memory virtual filesystem. There is no fallback to real executables. Unsupported commands and syntax return an explanation.

The Node server reads only application assets from `dist/`; player paths are never passed to filesystem APIs. The API accepts a command and virtual cwd, supplies its own training files, and evaluates the result in a disposable JavaScript worker. Worker threads are not shell processes. Limits cover command length, regex length, pipeline stages, output, worker memory, concurrent server executions, and execution time. Browser workers are also terminated after a timeout, so an expensive regular expression cannot freeze the interface.

Progress lives in localStorage in the current browser. There are no accounts, cross-device sync, leaderboards, paid services, or AI requests. Grading is deterministic and does not serve as an anti-cheat system.

## Supported shell subset

- `pwd`, `ls -a`, `cd`, `cat`, `head -n N`, `tail -n N`
- `grep -i -v -n -r -l -c -F -E -h -H -w -x`, plus `--` and `-e pattern`
- `sort -n -r`, `uniq -c`, `wc -l -w -c`, `echo`, `help`, `clear`
- Single and double quotes, backslash escaping, relative and absolute virtual paths, unquoted `*`/`?` filename globs, and pipelines.
- Standard output, standard error, exit codes, and per-stage pipeline results. A pipeline's exit code is its last stage's, while all stage errors remain visible.

This is an explicitly limited Bash-style environment, not a full Bash implementation. There are no writes, redirections, scripts, loops, variables, substitutions, command lists, networking, or real executables. Grep's regex subset uses JavaScript regex internally, with a basic-regex translation; lookaround, backreferences, and POSIX character classes are rejected. Sorting uses predictable codepoint ordering rather than a host locale. `ls` shows directory suffixes for discoverability. Some flag combinations, multi-file formatting, and edge cases differ from GNU utilities. Full GNU conformance is not claimed.

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

Browser checks currently target Chromium, including mobile viewport emulation. Physical device keyboard behavior, Firefox, and Safari still need manual validation. Mission data is currently fixed; randomized replay datasets and cross-device progress are future work.

Self-hosted DM Sans and IBM Plex Mono fonts use the SIL Open Font License; license files are in `public/fonts/`.
