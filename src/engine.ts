/** Pure virtual shell: no platform imports, host IO, dynamic evaluation or process execution. */
export type VirtualFiles = Record<string, string>;
export interface ShellState { cwd: string; files: VirtualFiles }
export interface Stage { command: string; args: string[]; stdout: string; stderr: string; exitCode: number }
export interface Execution { stdout: string; stderr: string; exitCode: number; cwd: string; stages: Stage[] }
interface Word { text: string; glob: string }
type Token = Word | '|';
const MAX_COMMAND = 4096;
const MAX_OUTPUT = 65536;
export const HELP = `Virtual shell commands
  pwd                    Print your current directory
  ls [-a] [path]         List virtual files
  cd [directory]         Change directory (.. goes up)
  cat file...            Read files
  head / tail [-n N]     Read the first / last N lines
  grep [-ivnrlcFEhHwx] pattern [file...]
                         Search lines; -r searches directories
  sort [-nr] [file...]   Order lines; -n compares numbers
  uniq [-c] [file...]    Collapse adjacent duplicate lines
  wc [-lwc] [file...]    Count lines, words or bytes
  echo [text...]         Print text
  help                   Show this reference
  clear                  Clear the terminal

Use | to send output into another command. Quote patterns with spaces.
Unquoted * and ? expand virtual paths. Supported: quotes, pipes and --.
Not supported: scripts, variables, substitutions, redirects, command lists,
networking, file writes, backreferences or lookaround. No host commands run.`;

export function normalize(path: string, cwd = '/workspace'): string {
  const result: string[] = [];
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '..') result.pop();
    else if (part && part !== '.') result.push(part);
  }
  return '/' + result.join('/');
}
export function directories(files: VirtualFiles): string[] {
  const dirs = new Set(['/', '/workspace']);
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let i = 2; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return [...dirs].sort();
}
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let text = '', glob = '', active = false, quote = '';
  const add = (char: string, wildcard = false) => {
    text += char;
    glob += wildcard ? (char === '*' ? '[^/]*' : '[^/]') : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    active = true;
  };
  const flush = () => { if (active) tokens.push({ text, glob }); text = ''; glob = ''; active = false; };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote === "'") { if (c === "'") quote = ''; else add(c); continue; }
    if (c === '`' || (c === '$' && /[\w({]/.test(source[i + 1] ?? ''))) throw Error('Variables and command substitution are not supported. Use literal text.');
    if (c === '\\') {
      if (i + 1 >= source.length) throw Error('Finish the escaped character after \\.');
      const next = source[i + 1];
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) add(c);
      else { add(next); i++; }
      continue;
    }
    if (quote === '"') { if (c === '"') quote = ''; else add(c); continue; }
    if (c === "'" || c === '"') { quote = c; active = true; }
    else if (c === '|') { flush(); tokens.push('|'); }
    else if (/[;&<>\n\r]/.test(c)) throw Error('This lab supports one command or a pipeline. Command lists and redirects are not supported.');
    else if (/\s/.test(c)) flush();
    else add(c, c === '*' || c === '?');
  }
  if (quote) throw Error(`Close your ${quote === "'" ? 'single' : 'double'} quote before running the command.`);
  flush();
  return tokens;
}
function expand(word: Word, state: ShellState): string[] {
  if (!word.glob.includes('[^/]')) return [word.text];
  const candidates = [...Object.keys(state.files), ...directories(state.files)];
  const matcher = new RegExp(`^${word.glob}$`);
  const matches = candidates.map(path => word.text.startsWith('/') ? path : relative(path, state.cwd))
    .filter(path => matcher.test(path) && !path.split('/').some((p, i) => p.startsWith('.') && !word.text.split('/')[i]?.startsWith('.'))).sort();
  return matches.length ? matches : [word.text];
}
function relative(path: string, cwd: string): string {
  const base = cwd.split('/').filter(Boolean), dest = path.split('/').filter(Boolean);
  let i = 0; while (i < base.length && i < dest.length && base[i] === dest[i]) i++;
  return [...base.slice(i).map(() => '..'), ...dest.slice(i)].join('/') || '.';
}
export function lines(text: string): string[] { return text === '' ? [] : text.replace(/\n$/, '').split('\n'); }
const outputLines = (rows: string[]) => rows.length ? rows.join('\n') + '\n' : '';
function read(path: string, state: ShellState): string {
  const resolved = normalize(path, state.cwd);
  if (directories(state.files).includes(resolved)) throw Error(`${path}: Is a directory`);
  if (!Object.hasOwn(state.files, resolved)) throw Error(`${path}: No such file or directory`);
  return state.files[resolved];
}
function options(args: string[], allowed: string): { flags: Set<string>; operands: string[] } {
  const flags = new Set<string>(), operands: string[] = [];
  let literal = false;
  for (const arg of args) {
    if (!literal && arg === '--') { literal = true; continue; }
    if (!literal && arg.startsWith('-') && arg !== '-') {
      for (const flag of arg.slice(1)) {
        if (!allowed.includes(flag)) throw Error(`Unsupported option: -${flag}. Type help for supported flags.`);
        flags.add(flag);
      }
    } else operands.push(arg);
  }
  return { flags, operands };
}
function basicRegex(pattern: string): string {
  let result = '', inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) {
      const next = pattern[++i];
      result += !inClass && '+?|(){}'.includes(next) ? next : '\\' + next;
    } else if (c === '[') { inClass = true; result += c; }
    else if (c === ']' && inClass) { inClass = false; result += c; }
    else result += !inClass && '+?|(){}'.includes(c) ? '\\' + c : c;
  }
  return result;
}
function grep(args: string[], input: string | undefined, state: ShellState): Pick<Stage, 'stdout' | 'stderr' | 'exitCode'> {
  // Parse flags only before the pattern; leading '-' patterns can use -- or -e.
  const flags = new Set<string>();
  let i = 0, pattern: string | undefined;
  for (; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') { i++; break; }
    if (arg === '-e') { pattern = args[++i]; i++; break; }
    if (!arg.startsWith('-') || arg === '-') break;
    for (const flag of arg.slice(1)) {
      if (!'ivnrlcFEhHwx'.includes(flag)) throw Error(`grep: Unsupported option -${flag}. Type help for supported flags.`);
      flags.add(flag);
    }
  }
  pattern ??= args[i++];
  if (pattern === undefined) throw Error('grep: Provide a search pattern, for example: grep ERROR logs/checkout.log');
  if (pattern.length > 512) throw Error('grep: Patterns are limited to 512 characters.');
  let matcher: (text: string) => boolean;
  if (flags.has('F') && !flags.has('w') && !flags.has('x')) {
    const needle = flags.has('i') ? pattern.toLowerCase() : pattern;
    matcher = text => (flags.has('i') ? text.toLowerCase() : text).includes(needle);
  } else {
    if (!flags.has('F') && (/\\[1-9]/.test(pattern) || /\(\?/.test(pattern) || /\[:[a-z]+:\]/.test(pattern))) throw Error('grep: Backreferences, lookaround and POSIX character classes are not supported in this lab.');
    let source = flags.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : flags.has('E') ? pattern : basicRegex(pattern);
    if (flags.has('w')) source = `(?:^|[^A-Za-z0-9_])(?:${source})(?=$|[^A-Za-z0-9_])`;
    if (flags.has('x')) source = `^(?:${source})$`;
    let regex: RegExp;
    try { regex = new RegExp(source, flags.has('i') ? 'i' : ''); } catch { throw Error('grep: Invalid regular expression. Check brackets and escaping.'); }
    matcher = text => regex.test(text);
  }
  const paths = args.slice(i), sources: { name: string; content: string }[] = [], errors: string[] = [];
  if (!paths.length) {
    if (input === undefined) throw Error('grep: Provide a file or pipe input into grep.');
    sources.push({ name: '(standard input)', content: input });
  }
  for (const path of paths) {
    if (path === '-') { sources.push({ name: '(standard input)', content: input ?? '' }); continue; }
    const resolved = normalize(path, state.cwd);
    if (directories(state.files).includes(resolved)) {
      if (!flags.has('r')) { errors.push(`grep: ${path}: Is a directory (try -r)`); continue; }
      for (const file of Object.keys(state.files).sort()) if (file.startsWith(resolved === '/' ? '/' : resolved + '/')) {
        sources.push({ name: path.replace(/\/$/, '') + '/' + file.slice(resolved === '/' ? 1 : resolved.length + 1), content: state.files[file] });
      }
    } else { try { sources.push({ name: path, content: read(path, state) }); } catch (e) { errors.push(`grep: ${(e as Error).message}`); } }
  }
  const showName = !flags.has('h') && (flags.has('H') || sources.length > 1 || flags.has('r'));
  const results: string[] = [];
  let found = false;
  for (const file of sources) {
    const matches = lines(file.content).map((text, index) => ({ text, index })).filter(row => matcher(row.text) !== flags.has('v'));
    found ||= matches.length > 0;
    if (flags.has('l')) { if (matches.length) results.push(file.name); }
    else if (flags.has('c')) results.push(`${showName ? file.name + ':' : ''}${matches.length}`);
    else for (const row of matches) results.push(`${showName ? file.name + ':' : ''}${flags.has('n') ? row.index + 1 + ':' : ''}${row.text}`);
  }
  return { stdout: outputLines(results), stderr: outputLines(errors), exitCode: errors.length ? 2 : found ? 0 : 1 };
}
function run(command: string, args: string[], input: string | undefined, state: ShellState): Stage {
  let stdout = '';
  const result = (text: string): Stage => ({ command, args, stdout: text, stderr: '', exitCode: 0 });
  const content = (operands: string[]) => operands.length ? operands.map(path => path === '-' ? input ?? '' : read(path, state)).join('') : input ?? '';
  switch (command) {
    case 'pwd': if (args.length) throw Error('pwd: Does not accept arguments in this lab.'); return result(state.cwd + '\n');
    case 'cd': {
      if (args.length > 1) throw Error('cd: Expected one directory.');
      const path = normalize(args[0] ?? '/workspace', state.cwd);
      if (!directories(state.files).includes(path)) throw Error(`cd: ${args[0]}: Not a virtual directory`);
      state.cwd = path; return result('');
    }
    case 'ls': {
      const { flags, operands } = options(args, 'a');
      const paths = operands.length ? operands : ['.'];
      stdout = paths.map(path => {
        const resolved = normalize(path, state.cwd);
        if (Object.hasOwn(state.files, resolved)) return path + '\n';
        if (!directories(state.files).includes(resolved)) throw Error(`ls: ${path}: No such file or directory`);
        const prefix = resolved === '/' ? '/' : resolved + '/';
        const entries = new Set([...Object.keys(state.files), ...directories(state.files)].filter(f => f.startsWith(prefix) && f !== resolved).map(f => f.slice(prefix.length).split('/')[0]).filter(name => flags.has('a') || !name.startsWith('.')));
        const rows = [...entries].sort().map(name => name + (directories(state.files).includes(prefix + name) ? '/' : ''));
        if (flags.has('a')) rows.unshift('./', '../');
        return (paths.length > 1 ? path + ':\n' : '') + outputLines(rows);
      }).join('\n');
      return result(stdout);
    }
    case 'cat': { const { operands } = options(args, ''); return result(content(operands)); }
    case 'head': case 'tail': {
      let n = 10;
      const operands: string[] = [];
      let literal = false;
      for (let i = 0; i < args.length; i++) {
        if (!literal && args[i] === '--') { literal = true; continue; }
        if (!literal && args[i] === '-n') {
          const value = args[++i];
          if (!value || !/^\d+$/.test(value) || Number(value) > 10000) throw Error(`${command}: -n requires a number from 0 to 10000.`);
          n = Number(value);
        } else if (!literal && args[i].startsWith('-') && args[i] !== '-') throw Error(`${command}: Supported option: -n N`);
        else operands.push(args[i]);
      }
      const take = (text: string) => { const rows = lines(text); const selected = command === 'head' ? rows.slice(0, n) : n === 0 ? [] : rows.slice(-n); return selected.length ? selected.join('\n') + (text.endsWith('\n') || (command === 'head' && n < rows.length) ? '\n' : '') : ''; };
      return result(operands.length ? operands.map(path => (operands.length > 1 ? `==> ${path} <==\n` : '') + take(path === '-' ? input ?? '' : read(path, state))).join('\n') : take(input ?? ''));
    }
    case 'grep': return { command, args, ...grep(args, input, state) };
    case 'sort': {
      const { flags, operands } = options(args, 'nr');
      const rows = lines(content(operands));
      const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
      rows.sort((a, b) => (flags.has('n') ? (parseFloat(a) || 0) - (parseFloat(b) || 0) || compare(a, b) : compare(a, b)) * (flags.has('r') ? -1 : 1));
      return result(outputLines(rows));
    }
    case 'uniq': {
      const { flags, operands } = options(args, 'c');
      if (operands.length > 1) throw Error('uniq: Expected at most one input file. Output file writes are not supported.');
      const groups: { text: string; count: number }[] = [];
      for (const text of lines(content(operands))) { const last = groups.at(-1); if (last?.text === text) last.count++; else groups.push({ text, count: 1 }); }
      return result(outputLines(groups.map(g => flags.has('c') ? `${String(g.count).padStart(7)} ${g.text}` : g.text)));
    }
    case 'wc': {
      const { flags, operands } = options(args, 'lwc');
      const count = (text: string) => [text.split('\n').length - 1, text.trim() ? text.trim().split(/\s+/).length : 0, new TextEncoder().encode(text).length];
      const format = (counts: number[]) => counts.filter((_, i) => !flags.size || flags.has(['l', 'w', 'c'][i])).join(' ');
      if (!operands.length) return result(format(count(input ?? '')) + '\n');
      const total = [0, 0, 0];
      const rows = operands.map(path => { const counts = count(path === '-' ? input ?? '' : read(path, state)); counts.forEach((n, i) => total[i] += n); return format(counts) + ' ' + path; });
      if (operands.length > 1) rows.push(format(total) + ' total');
      return result(outputLines(rows));
    }
    case 'echo': return result(args.join(' ') + '\n');
    case 'help': if (args.length) throw Error('help: Type help without arguments.'); return result(HELP + '\n');
    case 'clear': if (args.length) throw Error('clear: Does not accept arguments.'); return result('');
    default: throw Error(`${command}: Command not available in this virtual lab. Type help to see supported commands.`);
  }
}
export function execute(source: string, initial: ShellState): Execution {
  const state = { cwd: initial.cwd, files: initial.files };
  const stages: Stage[] = [];
  try {
    if (source.length > MAX_COMMAND) throw Error(`Commands are limited to ${MAX_COMMAND} characters.`);
    const tokens = tokenize(source);
    if (!tokens.length) return { stdout: '', stderr: '', exitCode: 0, cwd: state.cwd, stages };
    const pipeline: Word[][] = [[]];
    for (const token of tokens) {
      if (token === '|') { if (!pipeline.at(-1)!.length) throw Error('Put a command on both sides of each pipe.'); pipeline.push([]); }
      else pipeline.at(-1)!.push(token);
    }
    if (!pipeline.at(-1)!.length) throw Error('Add a command after the final pipe.');
    if (pipeline.length > 12) throw Error('Pipelines are limited to 12 stages.');
    let input: string | undefined;
    for (const words of pipeline) {
      const stageState = pipeline.length === 1 ? state : { ...state };
      const [command, ...args] = words.flatMap(word => expand(word, stageState));
      let stage: Stage;
      try { stage = run(command, args, input, stageState); }
      catch (error) { stage = { command, args, stdout: '', stderr: (error as Error).message + '\n', exitCode: 2 }; }
      if (stage.stdout.length > MAX_OUTPUT) throw Error('Output limit reached. Narrow your search.');
      stages.push(stage);
      input = stage.stdout;
    }
    const last = stages.at(-1)!;
    return { stdout: last.stdout, stderr: stages.map(stage => stage.stderr).join(''), exitCode: last.exitCode, cwd: state.cwd, stages };
  } catch (error) { return { stdout: '', stderr: (error as Error).message + '\n', exitCode: 2, cwd: initial.cwd, stages }; }
}
