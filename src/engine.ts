/** Pure virtual shell: no platform imports, host IO, dynamic evaluation or process execution. */
export type VirtualFiles = Record<string, string>;
export interface ShellState { cwd: string; files: VirtualFiles; writablePaths?: string[] }
export type GameAction = { type: 'next-mission' | 'hint' } | { type: 'mission'; number?: number } | { type: 'focus'; mode: 'on' | 'off' | 'toggle' };
export interface Stage { command: string; args: string[]; stdout: string; stderr: string; exitCode: number; isHelp?: boolean; action?: GameAction }
export interface Execution { stdout: string; stderr: string; exitCode: number; cwd: string; stages: Stage[]; files?: VirtualFiles }
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
  tee [-a] file...       Save piped output to authorized virtual controls
  echo [text...]         Print text
  help [command|topic]   Show this reference or detailed help
  clear                  Clear the terminal

Game controls (not Bash commands)
  mission [number]       Review the objective or open a mission
  hint                   Reveal the next hint in the terminal
  next-mission           Continue after completing your mission
  focus [on|off]         Toggle the page-filling terminal view

Try grep --help, ls --help, help cd, or help echo.
Topics: help pipes, help quoting, help globs.
Most commands here accept --help before their input arguments.
echo --help prints literal text, like Bash's builtin; use help echo.
In this lab, help also covers utilities. Bash help covers builtins;
for external programs, try command --help or man command (where installed).

Use | to send output into another command. Quote patterns with spaces.
Unquoted * and ? expand virtual paths. Supported: quotes, pipes and --.
Writes are enabled only for designated virtual control files in cyberspace.
Course files remain read-only. Not supported: scripts, variables, substitutions,
redirects, command lists, networking, backreferences or lookaround.
No host commands run.`;

interface Reference { summary: string; usage: string; options?: string[]; examples: string[]; note?: string }
export const COMMAND_HELP: Record<string, Reference> = {
  pwd: { summary: 'Print your current virtual working directory.', usage: 'pwd', examples: ['pwd'], note: 'An absolute path starts at /. Each mission starts at /workspace. In Bash, pwd is usually a builtin; help pwd describes that version.' },
  ls: { summary: 'List virtual files and directories.', usage: 'ls [-a] [path ...]', options: ['-a  Include hidden entries such as .env.example, plus . and ..', '--  Treat following arguments as paths, even if they start with -'], examples: ['ls', 'ls -a', 'ls logs', 'ls src/*.ts'], note: 'Directories have a trailing / in this lab. Unquoted globs expand paths before ls runs.' },
  cd: { summary: 'Change the virtual working directory.', usage: 'cd [directory]', examples: ['cd src', 'cd ..', 'cd /workspace/logs', 'cd'], note: 'With no directory, return to /workspace. cd in a pipeline does not change the parent shell. In Bash, cd is a builtin; use help cd.' },
  cat: { summary: 'Print file contents, or pass piped input through.', usage: 'cat [--] [file ...]', options: ['--  End option parsing; following arguments are filenames', '-   Read piped input at this position'], examples: ['cat README.md', "cat 'docs/search notes.txt'", 'cat logs/checkout.log | grep ERROR'], note: 'Quote a filename containing spaces. File contents come only from the virtual workspace.' },
  head: { summary: 'Print the first lines of a file or piped input.', usage: 'head [-n N] [--] [file ...]', options: ['-n N  Print the first N lines (default: 10; supported: 0 to 10000)', '--    End option parsing', '-     Read piped input at this position'], examples: ['head -n 3 logs/checkout.log', 'grep ERROR logs/checkout.log | head -n 2'], note: 'Inspect a small sample before deciding how to filter.' },
  tail: { summary: 'Print the last lines of a file or piped input.', usage: 'tail [-n N] [--] [file ...]', options: ['-n N  Print the last N lines (default: 10; supported: 0 to 10000)', '--    End option parsing', '-     Read piped input at this position'], examples: ['tail -n 2 logs/checkout.log', 'grep ERROR logs/checkout.log | tail -n 1'], note: 'This lab does not support tail -f (following a live file).' },
  grep: { summary: 'Keep lines matching a pattern from files or piped input.', usage: 'grep [options] [-e pattern | -- pattern | pattern] [file ...]', options: [
    '-i  Ignore case', '-v  Keep lines that do NOT match', '-n  Include line numbers', '-r  Search directories recursively', '-l  Print only filenames with matches', '-c  Print the number of matching lines for each input', '-F  Treat the pattern as literal text', '-E  Use extended regex, including | for alternatives', '-h  Hide filename prefixes', '-H  Always include filename prefixes', '-w  Match whole words', '-x  Match whole lines', '-e pattern  Supply one pattern explicitly, including one starting with -', '--  End option parsing; the next argument is the pattern', '-   Read piped input at this position',
  ], examples: ["grep -in 'error' logs/checkout.log", "grep ERROR logs/checkout.log | grep -v healthcheck", 'grep -rl TODO src', "grep -E 'ERROR|WARN' logs/checkout.log", "grep '^/api/' data/endpoints.txt"], note: 'Quote patterns containing spaces, |, or *. -h hides filenames; it is not a help flag. Status 0 means a match, 1 means no match, and 2 means an error. This lab supports a regex subset; lookaround, backreferences, and POSIX character classes are unavailable.' },
  sort: { summary: 'Order lines from files or piped input.', usage: 'sort [-nr] [--] [file ...]', options: ['-n  Compare leading numbers numerically', '-r  Reverse the ordering', '--  End option parsing', '-   Read piped input at this position'], examples: ['sort data/requests.txt', 'sort data/requests.txt | uniq -c | sort -nr'], note: 'Sort before uniq to bring duplicate records together. Text ordering uses codepoints rather than the host locale.' },
  uniq: { summary: 'Collapse adjacent duplicate lines.', usage: 'uniq [-c] [--] [file]', options: ['-c  Prefix each group with its count', '--  End option parsing', '-   Read piped input'], examples: ['sort data/requests.txt | uniq', 'sort data/requests.txt | uniq -c'], note: 'uniq does not remove duplicates that are separated by other lines. Sort first when you want one group per distinct value. Output-file arguments are not supported.' },
  wc: { summary: 'Count newlines, words, or UTF-8 bytes.', usage: 'wc [-lwc] [--] [file ...]', options: ['-l  Count newline characters', '-w  Count whitespace-separated words', '-c  Count UTF-8 bytes', '--  End option parsing', '-   Read piped input at this position'], examples: ['wc -l logs/checkout.log', 'grep ERROR logs/checkout.log | wc -l', 'wc -w README.md'], note: 'With no flags, show line, word, and byte counts. A file argument includes its name in the output; piped input returns only counts. A final line without a newline is not counted by -l.' },
  echo: { summary: 'Print literal arguments separated by spaces.', usage: 'echo [text ...]', examples: ["echo 'hello world'", 'echo --help', 'help echo'], note: 'Bash\'s builtin echo prints --help as text, so this lab does too. Use help echo for documentation. This lab does not implement echo flags, variable expansion, or escape interpretation.' },
  help: { summary: 'Show the command overview or a detailed lab reference.', usage: 'help [command | pipes | quoting | globs]', examples: ['help', 'help grep', 'help cd', 'help pipes', 'help quoting', 'help globs'], note: 'These references describe only the supported virtual environment. In this lab help covers all commands; in Bash, help documents shell builtins. GNU utilities commonly provide --help; other implementations may vary.' },
  clear: { summary: 'Clear the visible terminal history.', usage: 'clear', examples: ['clear'], note: 'Your current directory, virtual files, and saved mission progress are unchanged. clear --help displays this lab reference without clearing anything.' },
  tee: { summary: 'Copy piped input to authorized virtual control files and standard output.', usage: 'tee [-a] [--] file ...', options: ['-a  Append instead of overwriting', '--  End option parsing'], examples: ['grep ACTIVE logs/routes.log | tee controls/relay.cfg'], note: 'Only designated control files in the cyberspace game are writable. Grep Quest course files are read-only. tee copies exactly what reaches it; inspect your filter before changing a control. It never writes to the host filesystem.' },
  mission: { summary: 'Review the current objective or open a numbered mission.', usage: 'mission [number]', examples: ['mission', 'mission 1'], note: 'Game control, not a Bash command. Opening a mission resets its virtual directory and files, while keeping the transcript and command history. Use mission without a number to review your task without resetting it.' },
  hint: { summary: 'Reveal the next hint for the current mission.', usage: 'hint', examples: ['hint'], note: 'Game control, not a Bash command. Hints reveal progressively, ending with a worked example. Reading a hint does not complete a mission.' },
  'next-mission': { summary: 'Continue to the next mission after completing the current one.', usage: 'next-mission', examples: ['next-mission'], note: 'Game control, not a Bash command. Your next objective appears in the terminal. The transcript and focus view are preserved. After the final mission, enter free practice.' },
  focus: { summary: 'Fill the webpage with the terminal to hide distractions.', usage: 'focus [on|off]', examples: ['focus', 'focus on', 'focus off'], note: 'Game control, not a Bash command. With no argument, toggle focus mode. Escape or Restore layout returns to the normal page. This does not activate browser fullscreen. Your commands, draft, and mission progress are preserved.' },
};
export const HELP_TOPICS: Record<string, Reference> = {
  pipes: { summary: 'Send one command\'s standard output into the next command.', usage: 'command | command [| command ...]', examples: ['grep ERROR logs/checkout.log | grep -v healthcheck', 'grep ERROR logs/checkout.log | wc -l', 'sort data/requests.txt | uniq -c | sort -nr'], note: 'Build one stage at a time and inspect its output. Errors remain separate from the data. The final stage sets the pipeline exit status. Use Inspect pipeline below the result to see each stage. Limit: 12 stages.' },
  quoting: { summary: 'Keep spaces and shell symbols inside one argument.', usage: "command 'literal argument'", examples: ["cat 'docs/search notes.txt'", 'cat "docs/search notes.txt"', "grep -E 'ERROR|WARN' logs/checkout.log", "echo 'literal * and |'"], note: 'Unquoted spaces split arguments; an unquoted | makes a pipeline. Single quotes preserve literal characters. Double quotes also group arguments, but this lab rejects variable and command expansion. A backslash can escape an unquoted space. Quotes do not turn an option such as --help into a filename: use -- to end option parsing.' },
  globs: { summary: 'Expand unquoted filename patterns before running a command.', usage: 'command directory/*.extension', examples: ['ls src/*.ts', 'grep TODO src/*.ts', 'ls logs/checkout.?og'], note: "* matches zero or more non-slash characters; ? matches one. Globs select paths, while grep regex selects text within files. Hidden entries require an explicit leading dot. Quoted globs stay literal. This lab does not support bracket globs or ** recursion; use grep -r to search subdirectories." },
};
function reference(name: string): string {
  const entry = Object.hasOwn(COMMAND_HELP, name) ? COMMAND_HELP[name] : Object.hasOwn(HELP_TOPICS, name) ? HELP_TOPICS[name] : undefined;
  if (!entry) throw Error(`help: No reference for '${name}'. Type help for available commands and topics.`);
  return `${name} — Grep Quest reference (supported subset)\n\n${entry.summary}\n\nUsage:\n  ${entry.usage}\n${entry.options?.length ? '\nOptions:\n' + entry.options.map(option => '  ' + option).join('\n') + '\n' : ''}\nExamples:\n${entry.examples.map(example => '  ' + example).join('\n')}\n${entry.note ? '\nNotes:\n  ' + entry.note + '\n' : ''}`;
}
function requestsHelp(command: string, args: string[]): boolean {
  // Respect data arguments: echo --help, grep -e --help, and cat -- --help.
  if (command === 'echo') return false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--' || arg === '-' || !arg.startsWith('-')) return false;
    if (arg === '--help') return true;
    if (command === 'grep' && arg === '-e') return false;
    if ((command === 'head' || command === 'tail') && arg === '-n') i++;
  }
  return false;
}

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
function options(args: string[], allowed: string, command: string): { flags: Set<string>; operands: string[] } {
  const flags = new Set<string>(), operands: string[] = [];
  let literal = false;
  for (const arg of args) {
    if (!literal && arg === '--') { literal = true; continue; }
    if (!literal && arg.startsWith('-') && arg !== '-') {
      for (const flag of arg.slice(1)) {
        if (!allowed.includes(flag)) throw Error(`${command}: Unsupported option -${flag}. Try ${command} --help for supported flags.`);
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
      if (!'ivnrlcFEhHwx'.includes(flag)) throw Error(`grep: Unsupported option -${flag}. Try grep --help for supported flags.`);
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
  const helpResult = (text: string): Stage => ({ ...result(text), isHelp: true });
  const content = (operands: string[]) => operands.length ? operands.map(path => path === '-' ? input ?? '' : read(path, state)).join('') : input ?? '';
  if (Object.hasOwn(COMMAND_HELP, command) && requestsHelp(command, args)) return helpResult(reference(command));
  switch (command) {
    case 'pwd': if (args.length) throw Error('pwd: Does not accept arguments in this lab.'); return result(state.cwd + '\n');
    case 'cd': {
      if (args.length > 1) throw Error('cd: Expected one directory.');
      const path = normalize(args[0] ?? '/workspace', state.cwd);
      if (!directories(state.files).includes(path)) throw Error(`cd: ${args[0]}: Not a virtual directory`);
      state.cwd = path; return result('');
    }
    case 'ls': {
      const { flags, operands } = options(args, 'a', command);
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
    case 'cat': { const { operands } = options(args, '', command); return result(content(operands)); }
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
        } else if (!literal && args[i].startsWith('-') && args[i] !== '-') throw Error(`${command}: Unsupported option. Try ${command} --help for supported flags.`);
        else operands.push(args[i]);
      }
      const take = (text: string) => { const rows = lines(text); const selected = command === 'head' ? rows.slice(0, n) : n === 0 ? [] : rows.slice(-n); return selected.length ? selected.join('\n') + (text.endsWith('\n') || (command === 'head' && n < rows.length) ? '\n' : '') : ''; };
      return result(operands.length ? operands.map(path => (operands.length > 1 ? `==> ${path} <==\n` : '') + take(path === '-' ? input ?? '' : read(path, state))).join('\n') : take(input ?? ''));
    }
    case 'grep': return { command, args, ...grep(args, input, state) };
    case 'sort': {
      const { flags, operands } = options(args, 'nr', command);
      const rows = lines(content(operands));
      const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
      rows.sort((a, b) => (flags.has('n') ? (parseFloat(a) || 0) - (parseFloat(b) || 0) || compare(a, b) : compare(a, b)) * (flags.has('r') ? -1 : 1));
      return result(outputLines(rows));
    }
    case 'uniq': {
      const { flags, operands } = options(args, 'c', command);
      if (operands.length > 1) throw Error('uniq: Expected at most one input file. Output file writes are not supported.');
      const groups: { text: string; count: number }[] = [];
      for (const text of lines(content(operands))) { const last = groups.at(-1); if (last?.text === text) last.count++; else groups.push({ text, count: 1 }); }
      return result(outputLines(groups.map(g => flags.has('c') ? `${String(g.count).padStart(7)} ${g.text}` : g.text)));
    }
    case 'wc': {
      const { flags, operands } = options(args, 'lwc', command);
      const count = (text: string) => [text.split('\n').length - 1, text.trim() ? text.trim().split(/\s+/).length : 0, new TextEncoder().encode(text).length];
      const format = (counts: number[]) => counts.filter((_, i) => !flags.size || flags.has(['l', 'w', 'c'][i])).join(' ');
      if (!operands.length) return result(format(count(input ?? '')) + '\n');
      const total = [0, 0, 0];
      const rows = operands.map(path => { const counts = count(path === '-' ? input ?? '' : read(path, state)); counts.forEach((n, i) => total[i] += n); return format(counts) + ' ' + path; });
      if (operands.length > 1) rows.push(format(total) + ' total');
      return result(outputLines(rows));
    }
    case 'echo': return result(args.join(' ') + '\n');
    case 'tee': {
      const { flags, operands } = options(args, 'a', command);
      if (!operands.length) return result(input ?? '');
      const writes = operands.map(path => {
        const resolved = normalize(path, state.cwd);
        if (!state.writablePaths?.includes(resolved)) throw Error(`tee: ${path}: Read-only virtual path. Only designated cyberspace controls are writable.`);
        const text = (flags.has('a') ? state.files[resolved] ?? '' : '') + (input ?? '');
        if (text.length > MAX_OUTPUT) throw Error('tee: Virtual file size limit reached.');
        return { resolved, text };
      });
      for (const write of writes) state.files[write.resolved] = write.text;
      return result(input ?? '');
    }
    case 'help':
      if (args.length > 1) throw Error('help: Use help [command or topic], for example: help grep');
      return helpResult(args.length ? reference(args[0]) : HELP + '\n');
    case 'clear': if (args.length) throw Error('clear: Does not accept arguments.'); return result('');
    case 'mission':
      if (args.length > 1 || (args.length === 1 && !/^[1-9]\d*$/.test(args[0]))) throw Error('mission: Use mission [number], for example: mission 1');
      if (args.length && !Number.isSafeInteger(Number(args[0]))) throw Error('mission: Mission number is too large.');
      return { ...result(''), action: { type: 'mission', ...(args.length ? { number: Number(args[0]) } : {}) } };
    case 'hint': case 'next-mission':
      if (args.length) throw Error(`${command}: Does not accept arguments. Try ${command} --help.`);
      return { ...result(''), action: { type: command } };
    case 'focus':
      if (args.length > 1 || (args.length === 1 && args[0] !== 'on' && args[0] !== 'off')) throw Error('focus: Use focus [on|off].');
      return { ...result(''), action: { type: 'focus', mode: args[0] as 'on' | 'off' | undefined ?? 'toggle' } };
    default: throw Error(`${command}: Command not available in this virtual lab. Type help to see supported commands.`);
  }
}
export function execute(source: string, initial: ShellState): Execution {
  const state = { ...initial, files: { ...initial.files } };
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
      if (stage.action && pipeline.length > 1) throw Error(`${command}: Run game controls on their own, outside a pipeline.`);
      if (stage.stdout.length > MAX_OUTPUT) throw Error('Output limit reached. Narrow your search.');
      stages.push(stage);
      input = stage.stdout;
    }
    const last = stages.at(-1)!;
    return { stdout: last.stdout, stderr: stages.map(stage => stage.stderr).join(''), exitCode: last.exitCode, cwd: state.cwd, stages, ...(state.writablePaths ? { files: state.files } : {}) };
  } catch (error) { return { stdout: '', stderr: (error as Error).message + '\n', exitCode: 2, cwd: initial.cwd, stages }; }
}
