import type { Execution, VirtualFiles } from './engine.ts';
export interface Mission {
  id: string; chapter: number; title: string; skill: string; brief: string;
  lesson: string; hints: string[]; solution: string; expected: string;
  mode?: 'cwd' | 'listing' | 'count'; requiresPipe?: boolean;
}
const logRows = [
  '09:00:01 INFO checkout service started',
  '09:01:12 INFO payment accepted order=1041',
  '09:02:03 ERROR payment timeout order=1042',
  '09:02:10 ERROR healthcheck timeout probe=1',
  '09:03:15 WARN retry scheduled order=1042',
  '09:04:22 ERROR inventory unavailable order=1043',
  '09:05:08 INFO payment accepted order=1044',
  '09:06:31 ERROR payment timeout order=1045',
  '09:07:02 ERROR healthcheck timeout probe=2',
  '09:08:41 INFO checkout recovery started',
  '09:09:04 ERROR payment declined order=1046',
  '09:10:00 INFO checkout service recovered',
];
const log = logRows.join('\n') + '\n';
const brief = 'INCIDENT 042\nCheckout errors increased after the morning deploy.\nStart with logs/checkout.log. Health checks may add noise.\n';
const errors = logRows.filter(row => row.includes('ERROR'));
const realErrors = errors.filter(row => !row.includes('healthcheck'));
const requests = ['checkout', 'search', 'checkout', 'profile', 'search', 'checkout', 'checkout', 'profile', 'search', 'checkout'];
const tickets = [
  'T-101 OPEN checkout payment timeout',
  'T-102 CLOSED search stale index',
  'T-103 OPEN checkout payment declined',
  'T-104 OPEN profile avatar missing',
  'T-105 CLOSED checkout payment timeout',
  'T-106 OPEN search slow response',
];
export const CHAPTERS = [
  { name: 'The morning incident', label: '01 / INCIDENT RESPONSE', description: 'A deploy went sideways. Follow the evidence.', icon: '⌁' },
  { name: 'Inside the codebase', label: '02 / REPO DETECTIVE', description: 'Find the right signal in unfamiliar code.', icon: '⌘' },
  { name: 'Follow the data', label: '03 / DATA TRAIL', description: 'Turn noisy records into useful answers.', icon: '≋' },
];
export function createFiles(): VirtualFiles {
  return {
    '/workspace/README.md': '# Checkout workspace\n\nIncident brief: docs/incident.txt\nApplication logs: logs/checkout.log\nSource code: src/\nSupport records: data/\n',
    '/workspace/.env.example': 'APP_ENV=training\nPORT=3000\n',
    '/workspace/docs/incident.txt': brief,
    '/workspace/docs/search notes.txt': 'Search broadly, inspect a sample, then narrow.\nQuote filenames that contain spaces.\n',
    '/workspace/logs/checkout.log': log,
    '/workspace/logs/deploy.log': '08:59:00 INFO deploy version=2.4.0\n08:59:40 INFO deploy completed\n09:00:01 INFO service ready\n',
    '/workspace/src/config.ts': 'export const SERVICE = "checkout";\nexport const RATE_LIMIT = 120;\nexport const RETRY_COUNT = 3;\n',
    '/workspace/src/checkout.ts': 'import { RATE_LIMIT } from "./config";\n// TODO: make retries configurable\nexport function checkout() {\n  return { limit: RATE_LIMIT };\n}\n',
    '/workspace/src/search.ts': '// TODO: improve result ranking\nexport const SEARCH_TIMEOUT = 500;\n',
    '/workspace/src/profile.ts': 'export const AVATAR_SIZE = 128;\n// profile settings\n',
    '/workspace/data/requests.txt': requests.join('\n') + '\n',
    '/workspace/data/tickets.txt': tickets.join('\n') + '\n',
    '/workspace/data/endpoints.txt': '/api/checkout\n/api/search\n/health\n/api/profile\n/health/ready\n/api/checkout\n',
  };
}
const rows = (value: string[]) => value.join('\n');
export const MISSIONS: Mission[] = [
  { id: 'where-am-i', chapter: 0, title: 'Get your bearings', skill: 'pwd', brief: 'You’re on call. Before investigating, print the directory you’re working in.', lesson: 'Start by understanding your context. pwd prints your current working directory.', hints: ['Ask the shell where you are.', 'The command is short for “print working directory”.', 'Run: pwd'], solution: 'pwd', expected: '/workspace' },
  { id: 'look-around', chapter: 0, title: 'Read the room', skill: 'ls', brief: 'List the contents of the workspace. Look for where the logs and incident notes live.', lesson: 'Inspect the structure before guessing filenames. ls lists the files in a directory.', hints: ['You don’t need to open any files yet.', 'Use ls to list the current directory.', 'Run: ls'], solution: 'ls', expected: 'README.md\ndata/\ndocs/\nlogs/\nsrc/', mode: 'listing' },
  { id: 'read-brief', chapter: 0, title: 'Find the brief', skill: 'cat · paths', brief: 'Read the entire incident brief at docs/incident.txt.', lesson: 'cat prints file contents. A relative path starts from your current directory.', hints: ['You can read a file without changing directories.', 'Pass docs/incident.txt as the file argument to cat.', 'Run: cat docs/incident.txt'], solution: 'cat docs/incident.txt', expected: brief },
  { id: 'small-sample', chapter: 0, title: 'Start with a sample', skill: 'head -n', brief: 'Print only the first 3 lines of logs/checkout.log to learn the log format.', lesson: 'Inspect a small sample before reading everything. head -n controls how many lines you see.', hints: ['Start at the top of the log.', 'head -n 3 reads the first three lines.', 'Run: head -n 3 logs/checkout.log'], solution: 'head -n 3 logs/checkout.log', expected: rows(logRows.slice(0, 3)) },
  { id: 'find-errors', chapter: 0, title: 'Find the signal', skill: 'grep', brief: 'Return every ERROR line from logs/checkout.log. Keep the lines themselves, without line numbers.', lesson: 'grep keeps the lines that match a pattern. Inspect the result before adding more filters.', hints: ['Search for the log severity.', 'Give grep a pattern followed by a filename.', "Run: grep 'ERROR' logs/checkout.log"], solution: "grep 'ERROR' logs/checkout.log", expected: rows(errors) },
  { id: 'remove-noise', chapter: 0, title: 'Cut the noise', skill: 'pipes · grep -v', brief: 'Return ERROR lines from logs/checkout.log, excluding healthcheck entries. Build a pipeline so you can inspect each filter.', lesson: 'A pipe sends one command’s output to the next. grep -v keeps lines that do not match.', hints: ['First keep ERROR lines; then remove healthcheck lines.', 'Pipe your first grep into grep -v healthcheck.', "Run: grep 'ERROR' logs/checkout.log | grep -v 'healthcheck'"], solution: "grep 'ERROR' logs/checkout.log | grep -v 'healthcheck'", expected: rows(realErrors), requiresPipe: true },
  { id: 'count-impact', chapter: 0, title: 'Measure the impact', skill: 'wc -l', brief: 'Count the ERROR entries that are not healthcheck entries. Return just the count.', lesson: 'Once the filter is right, count its output. wc -l counts newline characters.', hints: ['Reuse the pipeline that removed the noise.', 'Add a final stage: wc -l.', "Run: grep ERROR logs/checkout.log | grep -v healthcheck | wc -l"], solution: 'grep ERROR logs/checkout.log | grep -v healthcheck | wc -l', expected: '4', requiresPipe: true },
  { id: 'verify-recovery', chapter: 0, title: 'Verify the recovery', skill: 'tail -n', brief: 'Print only the final 2 lines of logs/checkout.log to check the latest state.', lesson: 'Verify your conclusion against the evidence. tail reads the most recent lines of an append-only log.', hints: ['You want the end of the file.', 'tail -n 2 returns two lines.', 'Run: tail -n 2 logs/checkout.log'], solution: 'tail -n 2 logs/checkout.log', expected: rows(logRows.slice(-2)) },
  { id: 'change-context', chapter: 1, title: 'Step into the source', skill: 'cd', brief: 'Change your working directory to /workspace/src.', lesson: 'cd changes the context for relative paths. Each mission begins at /workspace so you can replay it independently.', hints: ['Use a directory as the argument.', 'The source directory is named src.', 'Run: cd src'], solution: 'cd src', expected: '/workspace/src', mode: 'cwd' },
  { id: 'find-setting', chapter: 1, title: 'Find a setting', skill: 'grep -r', brief: 'Find every occurrence of RATE_LIMIT anywhere under src. Include the filenames in your output.', lesson: 'Search a directory recursively when you don’t yet know which file matters.', hints: ['Search the source directory instead of guessing a filename.', 'Use grep -r to recurse into directories.', 'Run: grep -r RATE_LIMIT src'], solution: 'grep -r RATE_LIMIT src', expected: 'src/checkout.ts:import { RATE_LIMIT } from "./config";\nsrc/checkout.ts:  return { limit: RATE_LIMIT };\nsrc/config.ts:export const RATE_LIMIT = 120;' },
  { id: 'find-files', chapter: 1, title: 'Names, not contents', skill: 'grep -l', brief: 'List only the source filenames containing TODO, in alphabetical order.', lesson: 'Choose the output you need. grep -l returns filenames instead of matching lines.', hints: ['There are TODO comments in more than one source file.', 'Combine recursive search and filename-only output, then sort.', 'Run: grep -rl TODO src | sort'], solution: 'grep -rl TODO src | sort', expected: 'src/checkout.ts\nsrc/search.ts' },
  { id: 'line-number', chapter: 1, title: 'Pinpoint the change', skill: 'grep -n', brief: 'Find RETRY_COUNT in src/config.ts and include its line number.', lesson: 'Line numbers make search results actionable when you need to edit or discuss a file.', hints: ['Search just the configuration file.', 'The -n flag adds line numbers.', 'Run: grep -n RETRY_COUNT src/config.ts'], solution: 'grep -n RETRY_COUNT src/config.ts', expected: '3:export const RETRY_COUNT = 3;' },
  { id: 'quoted-path', chapter: 1, title: 'Mind the space', skill: 'quoting', brief: 'Read the entire file docs/search notes.txt. Its name contains a space.', lesson: 'Quotes keep spaces inside one argument. You can also escape an individual space with a backslash.', hints: ['An unquoted space splits the path into two arguments.', 'Wrap the whole path in single or double quotes.', "Run: cat 'docs/search notes.txt'"], solution: "cat 'docs/search notes.txt'", expected: createFiles()['/workspace/docs/search notes.txt'] },
  { id: 'expand-paths', chapter: 1, title: 'Search a family of files', skill: 'globs · grep', brief: 'Find TODO lines in the TypeScript files directly inside src, including their filenames.', lesson: 'An unquoted * expands filenames before grep runs. A glob matches paths; a regex matches text.', hints: ['The filename pattern src/*.ts selects TypeScript files.', 'Leave the filename glob unquoted so the shell can expand it.', "Run: grep TODO src/*.ts"], solution: 'grep TODO src/*.ts', expected: 'src/checkout.ts:// TODO: make retries configurable\nsrc/search.ts:// TODO: improve result ranking' },
  { id: 'ignore-case', chapter: 2, title: 'Search without case', skill: 'grep -i', brief: 'Find all open support tickets in data/tickets.txt using the lowercase pattern open.', lesson: 'Use case-insensitive search when capitalization should not decide the result.', hints: ['The file uses uppercase statuses.', 'The -i flag ignores case.', 'Run: grep -i open data/tickets.txt'], solution: 'grep -i open data/tickets.txt', expected: rows(tickets.filter(t => t.includes('OPEN'))) },
  { id: 'combine-terms', chapter: 2, title: 'Ask a sharper question', skill: 'filters', brief: 'Return the open checkout tickets from data/tickets.txt. Exclude closed checkout tickets and other services.', lesson: 'Successive filters express “and”: each stage narrows the evidence further.', hints: ['Filter by status and service.', 'Pipe OPEN matches into a second search for checkout.', 'Run: grep OPEN data/tickets.txt | grep checkout'], solution: 'grep OPEN data/tickets.txt | grep checkout', expected: rows(tickets.filter(t => t.includes('OPEN') && t.includes('checkout'))) },
  { id: 'unique-services', chapter: 2, title: 'Make a clean inventory', skill: 'sort · uniq', brief: 'Return each distinct service in data/requests.txt once, in alphabetical order.', lesson: 'uniq combines adjacent duplicates. Sort first to bring equal lines together.', hints: ['Repeated requests are scattered throughout the file.', 'Sort the records, then remove adjacent duplicates.', 'Run: sort data/requests.txt | uniq'], solution: 'sort data/requests.txt | uniq', expected: 'checkout\nprofile\nsearch' },
  { id: 'rank-services', chapter: 2, title: 'Find the busiest service', skill: 'uniq -c · sort -nr', brief: 'Return all services with request counts, highest count first. Use data/requests.txt.', lesson: 'Build a pipeline in small steps: group equal records, count them, then rank numerically.', hints: ['Use sort before uniq -c.', 'uniq -c prefixes each group with its count. sort -nr orders counts from largest to smallest.', 'Run: sort data/requests.txt | uniq -c | sort -nr'], solution: 'sort data/requests.txt | uniq -c | sort -nr', expected: '5 checkout\n3 search\n2 profile' },
  { id: 'regex-alternatives', chapter: 2, title: 'Match either signal', skill: 'grep -E · alternatives', brief: 'Return the ERROR and WARN entries from logs/checkout.log using one grep search.', lesson: 'Extended regex uses | for alternatives. Quote it so the shell does not treat it as a pipeline.', hints: ['Use an extended regular expression with two alternatives.', 'Quote ERROR|WARN and pass -E to grep.', "Run: grep -E 'ERROR|WARN' logs/checkout.log"], solution: "grep -E 'ERROR|WARN' logs/checkout.log", expected: rows(logRows.filter(row => /ERROR|WARN/.test(row))) },
  { id: 'final-investigation', chapter: 2, title: 'Follow the evidence', skill: 'independent investigation', brief: 'How many lines in data/endpoints.txt start with /api/? Return just the count. This time, choose the commands yourself.', lesson: 'A reliable investigation starts with a sample, narrows precisely, and verifies the result. ^ anchors a regex to the start of a line.', hints: ['Inspect the file and distinguish API routes from health checks.', 'Search for lines starting with /api/, then count them.', "Run: grep '^/api/' data/endpoints.txt | wc -l"], solution: "grep '^/api/' data/endpoints.txt | wc -l", expected: '4', requiresPipe: true },
];
function canonical(text: string): string { return text.trim().split('\n').map(line => line.trim().replace(/\s+/g, ' ')).join('\n'); }
export function isComplete(mission: Mission, result: Execution): boolean {
  if (result.stderr || result.exitCode !== 0 || !result.stages.length || result.stages.some(s => s.command === 'echo')) return false;
  if (mission.requiresPipe && result.stages.length < 2) return false;
  if (mission.mode === 'cwd') return result.cwd === mission.expected;
  if (mission.mode === 'listing') return canonical(result.stdout).includes(canonical(mission.expected));
  return canonical(result.stdout) === canonical(mission.expected);
}
