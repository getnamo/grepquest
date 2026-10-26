import { COMMAND_HELP, HELP_TOPICS, directories, normalize } from '../engine.ts';
export interface Completion { value: string; cursor: number; matches: string[] }
interface Word { text: string; start: number; end: number; pipe?: boolean }
function words(source: string): Word[] {
  const result: Word[] = []; let text = '', start = -1, quote = '';
  const flush = (end: number) => { if (start >= 0) result.push({ text, start, end }); text = ''; start = -1; };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (!quote && (/\s/.test(c) || c === '|')) { flush(i); if (c === '|') result.push({ text: '|', start: i, end: i + 1, pipe: true }); continue; }
    if (start < 0) start = i;
    if (c === "'" && quote !== '"') { quote = quote ? '' : "'"; continue; }
    if (c === '"' && quote !== "'") { quote = quote ? '' : '"'; continue; }
    if (c === '\\' && quote !== "'" && i + 1 < source.length) { text += source[++i]; continue; }
    text += c;
  }
  flush(source.length); return result;
}
function context(line: string, cursor: number) {
  const before = line.slice(0, cursor), tokens = words(before);
  const last = tokens.at(-1);
  const current = last && !last.pipe && last.end === cursor ? last : { text: '', start: cursor, end: cursor };
  const completeWord = words(line).find(w => w.start === current.start && !w.pipe);
  const earlier = tokens.filter(w => w.end <= current.start);
  const pipe = earlier.findLastIndex(w => w.pipe);
  return { current, end: completeWord?.end ?? cursor, previous: earlier.slice(pipe + 1).map(w => w.text), raw: line.slice(current.start, completeWord?.end ?? cursor) };
}
function apply(line: string, cursor: number, candidates: string[], quoted = false): Completion {
  const c = context(line, cursor);
  const matches = [...new Set(candidates.filter(value => value.startsWith(c.current.text)))].sort();
  if (!matches.length) return { value: line, cursor, matches };
  let value = matches[0]; for (const candidate of matches) while (!candidate.startsWith(value)) value = value.slice(0, -1);
  if (value.length <= c.current.text.length) return { value: line, cursor, matches };
  const quote = quoted && (c.raw[0] === "'" || c.raw[0] === '"') ? c.raw[0] : '';
  let replacement: string;
  if (quote === "'") replacement = "'" + value.replaceAll("'", "'\\''") + "'";
  else if (quote === '"') replacement = '"' + value.replace(/["\\$`]/g, '\\$&') + '"';
  else replacement = quoted ? value.replace(/[\s'"\\|;&<>$`*?()[\]{}]/g, '\\$&') : value;
  const next = line.slice(0, c.current.start) + replacement + line.slice(c.end);
  return { value: next, cursor: c.current.start + replacement.length - (quote && value.endsWith('/') ? 1 : 0), matches };
}
export const LOBBY_COMMANDS = ['/create', '/join', '/ls', '/who', '/leave', '/nick', '/rematch', '/me', '/gg', '/clear', '/help'];
export function completeLobby(line: string, cursor: number, roomIds: string[]): Completion {
  const c = context(line, cursor), command = c.previous[0];
  let choices: string[] = [];
  if (!c.previous.length) choices = LOBBY_COMMANDS;
  else if (command === '/join' && c.previous.length === 1) choices = roomIds;
  else if (command === '/create') choices = c.previous.length === 1 ? ['2', '3', '4', 'easy', 'moderate'] : c.previous.length === 2 && /^[234]$/.test(c.previous[1]) ? ['easy', 'moderate'] : [];
  return apply(line, cursor, choices);
}
const GAME_COMMANDS = ['jack-out', 'next-node', 'status'];
export function completeShell(line: string, cursor: number, cwd: string, paths: string[], roomIds: string[] = []): Completion {
  const c = context(line, cursor), command = c.previous[0];
  if (line.trimStart().startsWith('/')) return completeLobby(line, cursor, roomIds);
  if (!c.previous.length) return apply(line, cursor, [...Object.keys(COMMAND_HELP), ...GAME_COMMANDS]);
  if (command === 'help' && c.previous.length === 1) return apply(line, cursor, [...Object.keys(COMMAND_HELP), ...Object.keys(HELP_TOPICS)]);
  const args = c.previous.slice(1);
  if (c.current.text.startsWith('-') && !args.includes('--')) {
    const options = COMMAND_HELP[command]?.options?.map(text => text.split(/\s/)[0]) ?? [];
    return apply(line, cursor, [...options, ...(command !== 'echo' ? ['--help'] : [])]);
  }
  if (!['ls', 'cd', 'cat', 'head', 'tail', 'grep', 'sort', 'uniq', 'wc', 'tee'].includes(command)) return { value: line, cursor, matches: [] };
  if (command === 'grep') {
    let hasPattern = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-e') { hasPattern = i + 1 < args.length; break; }
      if (args[i] === '--') { hasPattern = i + 1 < args.length; break; }
      if (!args[i].startsWith('-') || args[i] === '-') { hasPattern = true; break; }
    }
    if (!hasPattern) return { value: line, cursor, matches: [] };
  }
  if ((command === 'head' || command === 'tail') && args.at(-1) === '-n') return { value: line, cursor, matches: [] };
  const files = Object.fromEntries(paths.map(path => [path, ''])), dirs = directories(files);
  const slash = c.current.text.lastIndexOf('/'), prefix = c.current.text.slice(0, slash + 1), leaf = c.current.text.slice(slash + 1);
  const parent = normalize(prefix || '.', cwd), base = parent === '/' ? '/' : parent + '/';
  const choices = [...(command === 'cd' ? [] : paths), ...dirs].filter(path => path !== parent && path.startsWith(base) && !path.slice(base.length).includes('/')).map(path => {
    const name = path.slice(base.length);
    if (name.startsWith('.') && !leaf.startsWith('.')) return '';
    return prefix + name + (dirs.includes(path) ? '/' : '');
  }).filter(Boolean);
  if (leaf.startsWith('.')) choices.push(prefix + './', prefix + '../');
  return apply(line, cursor, choices, true);
}
