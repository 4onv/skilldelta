import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFiles, prepareDocker, dockerArgs, command } from '../src/execute.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const controller = new AbortController();
  const pending = run('while(true){}; export const answer=42;', { signal: controller.signal });
  setTimeout(() => controller.abort(), 750);
  await assert.rejects(pending, /abort/i);
  const containers = await command('docker',['ps','--filter','name=skilldelta-','--format','{{.Names}}']);
  assert.equal(containers.output.trim(),'');
});

test('CLI interrupts a local mock-provider request and resumes only pending attempts with Docker', { skip: process.env.SKILLDELTA_DOCKER_TEST !== '1', timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'skilldelta-resume-cli-'));
  const bin = fileURLToPath(new URL('../bin/skilldelta.mjs',import.meta.url));
  const out = path.join(directory,'run');
  let calls=0, active;
  const server = createServer((request,response) => {
    request.resume();
    request.on('end',() => {
      calls++;
      if(calls===2) { setTimeout(()=>active.kill('SIGINT'),100); return; }
      response.setHeader('content-type','application/json');
      response.end(JSON.stringify({choices:[{message:{content:JSON.stringify({files:{'solution.mjs':'export const answer=42;'}})}}]}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const invoke = args => new Promise((resolve,reject)=> {
    const env={...process.env}; delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS; delete env.SKILLDELTA_API_KEY;
    active=spawn(process.execPath,[bin,'run','--config',path.join(directory,'skilldelta.config.json'),...args],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output=''; active.stdout.on('data',chunk=>output+=chunk); active.stderr.on('data',chunk=>output+=chunk);
    const timer=setTimeout(()=>{active.kill('SIGKILL'); reject(Error('CLI resume integration timed out'));},60000);
    active.on('error',error=>{clearTimeout(timer);reject(error);}); active.on('close',code=>{clearTimeout(timer);resolve({code,output});});
  });
  try {
    await writeFile(path.join(directory,'checks.mjs'),"import {test} from 'node:test'; import assert from 'node:assert/strict'; import {answer} from './solution.mjs'; test('answer',()=>assert.equal(answer,42));");
    await writeFile(path.join(directory,'suite.json'),JSON.stringify({name:'Synthetic local provider',tasks:[{id:'answer',title:'Answer',prompt:'Export answer=42',editableFiles:['solution.mjs'],starter:{'solution.mjs':''},testFile:'checks.mjs'}]}));
    await writeFile(path.join(directory,'SKILL.md'),'Check your answer.');
    await writeFile(path.join(directory,'skilldelta.config.json'),JSON.stringify({schemaVersion:1,suite:'suite.json',skill:'SKILL.md',model:'mock-only',endpoint:`http://127.0.0.1:${server.address().port}/v1/chat/completions`,trials:1,out}));
    const stopped=await invoke([]); assert.equal(stopped.code,130,stopped.output);
    const checkpoint=JSON.parse(await readFile(path.join(out,'checkpoint.json'),'utf8'));
    assert.equal(checkpoint.results.length,1); assert.equal(checkpoint.checkpoint.complete,false);
    assert.ok(!(await readdir(out)).includes('run.lock'));
    const resumed=await invoke(['--resume']); assert.equal(resumed.code,0,resumed.output); assert.equal(calls,3);
    const report=JSON.parse(await readFile(path.join(out,'results.json'),'utf8'));
    assert.equal(report.id,checkpoint.id); assert.equal(report.results.length,2); assert.equal(report.checkpoint.complete,true);
    assert.deepEqual(report.results[0],checkpoint.results[0]);
    assert.equal((await invoke(['--resume'])).code,0); assert.equal(calls,3);
  } finally {
    active?.kill('SIGKILL'); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});
