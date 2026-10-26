import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execute, COMMAND_HELP, HELP_TOPICS } from '../src/engine.ts';
import { MISSIONS, createFiles, isComplete } from '../src/missions.ts';
const run = (command: string, cwd = '/workspace') => execute(command, { cwd, files: createFiles() });
for (const mission of MISSIONS) test(`Mission: ${mission.id}`, () => assert.equal(isComplete(mission, run(mission.solution)), true));
test('pipes preserve every stage and apply filters in sequence', () => {
  const result = run('grep ERROR logs/checkout.log | grep -v healthcheck | wc -l');
  assert.equal(result.stdout, '4\n'); assert.equal(result.stages.length, 3);
  assert.equal(result.stages[0].stdout.trim().split('\n').length, 6);
  assert.equal(result.stages[1].stdout.trim().split('\n').length, 4);
});
test('valid alternative solutions complete output-based missions', () => {
  const mission = MISSIONS.find(m => m.id === 'find-errors')!;
  assert.ok(isComplete(mission, run('cat logs/checkout.log | grep ERROR')));
  assert.ok(isComplete(mission, run('grep -F ERROR /workspace/logs/checkout.log')));
  assert.ok(!isComplete(mission, run(`echo '${mission.expected}'`)));
});
test('a failing stage cannot accidentally complete a task', () => {
  const result = run('cat nonexistent | wc -l');
  assert.equal(result.exitCode, 0); assert.match(result.stderr, /No such file/);
  assert.ok(!isComplete({ ...MISSIONS[0], expected: '0' }, result));
});
test('quoting, escaping and filenames with spaces', () => {
  const expected = createFiles()['/workspace/docs/search notes.txt'];
  assert.equal(run("cat 'docs/search notes.txt'").stdout, expected);
  assert.equal(run('cat docs/search\\ notes.txt').stdout, expected);
  assert.equal(run('cat "docs/search notes.txt"').stdout, expected);
  assert.equal(run("echo '' end").stdout, ' end\n');
  assert.equal(run('grep "\\bERROR\\b" logs/checkout.log').stdout, run('grep ERROR logs/checkout.log').stdout);
});
test('unquoted globs expand; quoted wildcards remain literal', () => {
  assert.equal(run('grep TODO src/*.ts').exitCode, 0);
  assert.match(run("cat 'src/*.ts'").stderr, /No such file/);
  assert.ok(!run('ls *').stdout.includes('.env.example'));
  assert.ok(run('ls -a').stdout.includes('.env.example'));
});
test('basic and extended regex behave differently; literal grep does not parse regex', () => {
  assert.equal(run("grep 'ERROR|WARN' logs/checkout.log").exitCode, 1);
  assert.equal(run("grep -E 'ERROR|WARN' logs/checkout.log").stdout.trim().split('\n').length, 7);
  assert.equal(run("grep 'ERROR\\|WARN' logs/checkout.log").stdout.trim().split('\n').length, 7);
  assert.equal(run("grep -F 'ERROR|WARN' logs/checkout.log").exitCode, 1);
  assert.match(run("grep -E '[' logs/checkout.log").stderr, /Invalid regular expression/);
});
test('grep distinguishes no match, success and missing input', () => {
  assert.equal(run('grep absent logs/checkout.log').exitCode, 1);
  assert.equal(run('grep ERROR logs/checkout.log').exitCode, 0);
  assert.equal(run('grep ERROR missing.log').exitCode, 2);
  assert.equal(run('grep -c absent logs/checkout.log').stdout, '0\n');
  assert.equal(run('grep -c absent logs/checkout.log').exitCode, 1);
  const result = run('grep ERROR missing.log logs/checkout.log');
  assert.equal(result.exitCode, 2); assert.match(result.stdout, /ERROR/); assert.match(result.stderr, /missing/);
});
test('sort and uniq teach adjacency and numeric ranking', () => {
  assert.equal(run('uniq data/requests.txt').stdout.trim().split('\n').length, 9);
  assert.equal(run('sort data/requests.txt | uniq').stdout, 'checkout\nprofile\nsearch\n');
  assert.equal(run('sort data/requests.txt | uniq -c | sort -nr').stdout, '      5 checkout\n      3 search\n      2 profile\n');
});
test('wc counts newlines, words and UTF-8 bytes', () => {
  const state = { cwd: '/workspace', files: { '/workspace/a': 'café\nlast' } };
  assert.equal(execute('wc -lwc a', state).stdout, '1 2 10 a\n');
  assert.equal(execute('head -n 1 a', state).stdout, 'café\n');
  assert.equal(execute('tail -n 1 a', state).stdout, 'last');
  assert.equal(execute('tail -n 0 a', state).stdout, '');
});
test('virtual cwd persists for a simple command but not a pipeline subshell', () => {
  assert.equal(run('cd logs').cwd, '/workspace/logs');
  assert.equal(run('cd logs | pwd').cwd, '/workspace');
  assert.equal(run('cd logs | pwd').stdout, '/workspace\n');
  assert.equal(run('cat checkout.log', '/workspace/logs').stdout, createFiles()['/workspace/logs/checkout.log']);
});
test('all absolute paths are virtual; traversal cannot expose host files', () => {
  for (const command of ['cat /etc/passwd', 'cat ../../../../etc/passwd', 'cat /proc/self/environ', 'ls /home', 'cd /tmp']) {
    const result = run(command); assert.equal(result.exitCode, 2, command);
  }
  assert.equal(run('ls /').stdout, 'workspace/\n');
  assert.equal(run('cd ../../../../../').cwd, '/');
});
test('shell escape syntax is rejected and no executable fallback exists', () => {
  for (const command of ['ls; pwd', 'ls && pwd', 'ls > out', 'echo $(id)', 'echo `id`', 'echo $HOME', 'ls || pwd', 'pwd\nls']) assert.equal(run(command).exitCode, 2, command);
  for (const command of ['bash -c pwd', 'node -e process.exit()', 'curl https://example.com', 'rm README.md', 'touch x', 'eval pwd']) assert.equal(run(command).exitCode, 2, command);
  assert.equal(run("echo '$(id)' ").stdout, '$(id)\n');
});
test('syntax errors, unsupported options and limits return helpful errors', () => {
  for (const command of ["grep 'unclosed", 'pwd |', '| pwd', 'pwd || pwd', 'head -n no README.md', 'grep -P . README.md', 'pwd '.repeat(1100), Array(14).fill('cat').join(' | ')]) {
    assert.equal(run(command).exitCode, 2, command.slice(0, 80));
    assert.ok(run(command).stderr.length > 0);
  }
});
test('no engine source imports a platform API or evaluates code', async () => {
  const source = await readFile(new URL('../src/engine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b|\beval\s*\(|new Function|child_process|node:fs|fetch\s*\(/);
});
for (const name of Object.keys(COMMAND_HELP)) test(`detailed help: ${name}`, () => {
  const result = run(`help ${name}`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /supported subset/);
  assert.match(result.stdout, /Usage:\n/);
  assert.match(result.stdout, /Examples:\n/);
  assert.equal(result.cwd, '/workspace');
  assert.equal(result.stages[0].isHelp, true);
  if (name !== 'echo') {
    const flagHelp = run(`${name} --help`);
    assert.equal(flagHelp.stdout, result.stdout);
    assert.equal(flagHelp.exitCode, 0);
    assert.equal(flagHelp.stages[0].isHelp, true);
  }
});
for (const name of Object.keys(HELP_TOPICS)) test(`shell concept help: ${name}`, () => {
  const result = run(`help ${name}`);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Examples:/);
});
test('overview makes command-specific help and shell conventions discoverable', () => {
  const result = run('help');
  assert.match(result.stdout, /grep --help/);
  assert.match(result.stdout, /help cd/);
  assert.match(result.stdout, /help pipes/);
  assert.match(result.stdout, /Bash help covers builtins/);
  assert.equal(result.stages[0].isHelp, true);
});
test('help flags work after supported options without consuming option values', () => {
  assert.equal(run('ls -a --help').stdout, run('help ls').stdout);
  assert.equal(run('grep -i --help').stdout, run('help grep').stdout);
  assert.equal(run('head -n 2 --help').stdout, run('help head').stdout);
  assert.equal(run('head -n --help').exitCode, 2);
});
test('help requests respect literal arguments, -- and grep pattern operands', () => {
  const state = { cwd: '/workspace', files: { '/workspace/--help': '--help\nplain\n' } };
  assert.equal(execute('cat -- --help', state).stdout, '--help\nplain\n');
  assert.equal(execute('grep -- --help --help', state).stdout, '--help\n');
  assert.equal(execute('grep -e --help --help', state).stdout, '--help\n');
  assert.equal(execute('grep plain --help', state).stdout, 'plain\n');
  assert.equal(run('echo --help').stdout, '--help\n');
  assert.notEqual(run('echo --help').stages[0].isHelp, true);
  assert.notEqual(execute('cat -- --help', state).stages[0].isHelp, true);
});
test('help can be piped but cannot manufacture mission evidence', () => {
  const filtered = run("grep --help | grep 'Ignore case'");
  assert.match(filtered.stdout, /-i  Ignore case/);
  assert.equal(filtered.exitCode, 0);
  const count = run('help grep | head -n 4 | wc -l');
  assert.equal(count.stdout, '4\n');
  assert.equal(isComplete(MISSIONS.find(m => m.id === 'count-impact')!, count), false);
  assert.equal(isComplete({ ...MISSIONS[0], expected: filtered.stdout }, filtered), false);
});
test('unknown help targets and options guide the learner without exposing internals', () => {
  for (const source of ['help absent', 'help constructor', 'help __proto__', 'help grep extra', 'missing --help']) {
    const result = run(source);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /help/);
  }
  for (const name of ['ls', 'cat', 'head', 'tail', 'grep', 'sort', 'uniq', 'wc']) assert.match(run(`${name} -Z`).stderr, new RegExp(`${name} --help`));
});
test('game controls return typed actions without changing virtual shell state', () => {
  const cases = [
    ['mission', { type: 'mission' }], ['mission 3', { type: 'mission', number: 3 }],
    ['hint', { type: 'hint' }], ['next-mission', { type: 'next-mission' }],
    ['focus', { type: 'focus', mode: 'toggle' }], ['focus on', { type: 'focus', mode: 'on' }], ['focus off', { type: 'focus', mode: 'off' }],
  ] as const;
  for (const [command, action] of cases) {
    const result = run(command);
    assert.equal(result.exitCode, 0);
    assert.equal(result.cwd, '/workspace');
    assert.deepEqual(result.stages[0].action, action);
    assert.equal(isComplete({ ...MISSIONS[0], expected: '' }, result), false);
  }
});
test('game controls reject invalid arguments and cannot run inside a pipeline', () => {
  for (const command of ['mission 0', 'mission -1', 'mission nope', 'mission 1 2', 'mission 99999999999999999999', 'hint extra', 'next-mission now', 'focus yes', 'focus on off', 'pwd | next-mission', 'mission | wc -l', 'focus off | cat']) {
    const result = run(command);
    assert.equal(result.exitCode, 2, command);
    assert.equal(result.stages.some(stage => stage.action), false, command);
  }
  const helpPipeline = run("next-mission --help | grep 'Game control'");
  assert.equal(helpPipeline.exitCode, 0);
  assert.equal(helpPipeline.stages.some(stage => stage.action), false);
});
