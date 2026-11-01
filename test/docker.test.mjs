import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFiles, prepareDocker, dockerArgs } from '../src/execute.mjs';

test('Docker configuration isolates verification and never passes provider secrets', () => {
  const args = dockerArgs({ directory: '/tmp/skilldelta-work', image: 'node:22-alpine', name: 'skilldelta-test' });
  for (const flag of ['--read-only', '--cap-drop', '--pids-limit', '--memory', '--cpus', '--user']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.ok(args.includes('type=bind,source=/tmp/skilldelta-work,target=/workspace,readonly'));
  assert.ok(!args.includes('--env') && !args.includes('-e'));
});

test('Docker executes real passes, failures, timeouts, and isolation checks', { skip: process.env.SKILLDELTA_DOCKER_TEST !== '1', timeout: 360000 }, async () => {
  const image = await prepareDocker('node:22-alpine');
  const testSource = `import test from 'node:test'; import assert from 'node:assert/strict'; import {answer} from './solution.mjs'; test('answer',()=>assert.equal(answer,42));`;
  const run = (source, options = {}) => checkFiles({ files: { 'solution.mjs': source }, testSource, timeoutMs: 15000, image, ...options });
  assert.equal((await run('export const answer = 42;')).status, 'passed');
  assert.equal((await run('export const answer = 0;')).status, 'failed');
  assert.equal((await run('process.exit(0); export const answer=42;')).status, 'failed');
  const timeout = await run('while(true){}; export const answer=42;', { timeoutMs: 2000 });
  assert.equal(timeout.status, 'failed');
  assert.match(timeout.error, /timeout/i);
  const isolation = await run(`import {writeFileSync} from 'node:fs';
    import {networkInterfaces} from 'node:os';
    import assert from 'node:assert/strict';
    assert.equal(process.env.SKILLDELTA_API_KEY, undefined);
    assert.equal(process.getuid(),65534);
    assert.ok(Object.keys(networkInterfaces()).every(n=>n==='lo'));
    assert.throws(()=>writeFileSync('/workspace/solution.mjs','changed'));
    assert.throws(()=>writeFileSync('/escape','changed'));
    export const answer=42;`);
  assert.equal(isolation.status, 'passed');
});
