import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execute } from '../src/engine.ts';
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
