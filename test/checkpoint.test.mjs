import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runEvaluation } from '../src/runner.mjs';
import { openRunDirectory, readCheckpoint, atomicJson } from '../src/checkpoint.mjs';
import { renderReport, renderBadge } from '../src/report.mjs';
import { generate } from '../src/provider.mjs';
import { command } from '../src/execute.mjs';
import { fileURLToPath } from 'node:url';

const suite = { name: 'Mock suite', sha256: 'suite', tasks: [{ id: 'a', title: 'Task A', prompt: 'Implement A', editableFiles: ['a.mjs'], starter: {}, testSource: 'HIDDEN_TEST', testSha256: 'test', timeoutMs: 1000 }] };
const base = { suite, skill: { name: 'skill', text: 'PRIVATE_SKILL', sha256: 'skill' }, model: 'mock', endpoint: 'https://model.example/v1', key: 'PRIVATE_KEY', image: 'sha256:image', trials: 2,
  generateFn: async () => ({ files: { 'a.mjs': 'PRIVATE_CODE' }, inputTokens: 4, outputTokens: 2 }), checkFn: async () => ({ passed: true, status: 'passed' }) };
async function partial(completed = 1) {
  const controller = new AbortController();
  let count = 0;
  return runEvaluation({ ...base, signal: controller.signal, onProgress: row => { if (row.phase === 'complete' && ++count === completed) controller.abort(); } });
}

test('checkpoint resume preserves run identity, order and completed outcomes without repeated calls', async () => {
  const saved = await partial();
  assert.equal(saved.results.length, 1); assert.equal(saved.checkpoint.complete, false);
  assert.match(saved.summary.verdict, /incomplete/);
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_KEY|PRIVATE_SKILL|PRIVATE_CODE|HIDDEN_TEST|model\.example/);
  let calls = 0;
  const resumed = await runEvaluation({ ...base, key: 'ROTATED_KEY', resumeReport: saved, generateFn: async input => { calls++; return base.generateFn(input); } });
  assert.equal(calls, 3); assert.equal(resumed.id, saved.id); assert.equal(resumed.createdAt, saved.createdAt);
  assert.deepEqual(resumed.results[0], saved.results[0]); assert.equal(resumed.checkpoint.complete, true);
  const finished = await runEvaluation({ ...base, resumeReport: resumed, generateFn: () => assert.fail('Completed run called provider') });
  assert.equal(finished.results.length, 4);
});

test('resume rejects changed inputs including test source, endpoint and resolved image before calls', async () => {
  const saved = await partial();
  for (const changes of [{model:'other'}, {endpoint:'https://other.example/v1'}, {image:'sha256:other'}, {trials:3}, {seed:43}, {maxOutputTokens:5000}, {timeoutMs:2000},
    {skill:{...base.skill,text:'changed'}}, {suite:{...suite,tasks:[{...suite.tasks[0],testSource:'changed'}]}}]) {
    await assert.rejects(runEvaluation({ ...base, ...changes, resumeReport: saved, generateFn: () => assert.fail('Mismatch called provider') }), /does not match/);
  }
});

test('resume rejects invalid rows, duplicate attempts, changed ordering and excess results', async () => {
  const saved = await partial(2);
  for (const change of [s => s.results.push(s.results[0]), s => s.results.reverse(), s => s.results[0].durationMs = -1, s => s.results[0].passed = false, s => s.results[0].inputTokens = '4', s => s.results[0].secret = 'unexpected']) {
    const copy = structuredClone(saved); change(copy);
    await assert.rejects(runEvaluation({ ...base, resumeReport: copy, generateFn: () => assert.fail('Invalid rows called provider') }), /invalid, duplicate|does not match/);
  }
});

test('completed provider errors remain recorded and are not silently retried on resume', async () => {
  const controller = new AbortController();
  const saved = await runEvaluation({ ...base, signal: controller.signal, generateFn: async () => { throw Error('private provider error'); }, onProgress: row => { if (row.phase === 'complete') controller.abort(); } });
  assert.equal(saved.results[0].status, 'error');
  const resumed = await runEvaluation({ ...base, resumeReport: saved });
  assert.equal(resumed.summary.errors, 1); assert.match(resumed.summary.verdict, /Inconclusive/);
});

test('cancellation during generation or checking leaves the in-flight attempt pending', async () => {
  for (const phase of ['generateFn','checkFn']) {
    const controller = new AbortController();
    const report = await runEvaluation({ ...base, signal: controller.signal, [phase]: async () => { controller.abort(); throw controller.signal.reason; } });
    assert.equal(report.results.length, 0); assert.equal(report.checkpoint.complete, false);
    assert.match(report.summary.verdict, /incomplete/);
  }
});

test('checkpoint write failures stop before the next provider request', async () => {
  let calls = 0, writes = 0;
  await assert.rejects(runEvaluation({ ...base, generateFn: async input => { calls++; return base.generateFn(input); }, onCheckpoint: async () => { if (++writes === 2) throw Error('disk failure'); } }), /disk failure/);
  assert.equal(calls, 1);
});

test('partial runs with complete pairs still have inconclusive reports and badges', async () => {
  const saved = await partial(2);
  assert.match(saved.summary.verdict, /incomplete/);
  assert.match(renderBadge(saved), /INCONCLUSIVE/);
  assert.match(renderReport(saved), /Inconclusive/);
});

test('checkpoint writes replace atomically, preserve last data on invalid payload, and enforce input bounds', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'skilldelta-checkpoint-'));
  try {
    const file = path.join(directory, 'checkpoint.json');
    await atomicJson(file, { value: 1 }); await atomicJson(file, { value: 2 });
    assert.deepEqual(await readCheckpoint(file), { value: 2 });
    await assert.rejects(atomicJson(file, { value: 'x'.repeat(17 * 1024 * 1024) }), /exceeded/);
    assert.deepEqual(await readCheckpoint(file), { value: 2 });
    assert.deepEqual(await readdir(directory), ['checkpoint.json']);
    await writeFile(file, Buffer.from([0xff])); await assert.rejects(readCheckpoint(file), /UTF-8 JSON/);
    await writeFile(file, 'x'.repeat(17 * 1024 * 1024)); await assert.rejects(readCheckpoint(file), /smaller/);
  } finally { await rm(directory, {recursive:true,force:true}); }
});

test('output lock excludes concurrent writers, resume reads state, and fresh runs preserve prior artifacts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'skilldelta-lock-'));
  try {
    const first = await openRunDirectory(directory);
    await assert.rejects(openRunDirectory(directory), /locked/);
    await first.write(await partial());
    const original = await readFile(path.join(directory,'checkpoint.json'),'utf8');
    await first.close();
    await assert.rejects(openRunDirectory(directory), /already contains/);
    assert.equal(await readFile(path.join(directory,'checkpoint.json'),'utf8'), original);
    const second = await openRunDirectory(directory, {resume:true});
    assert.equal(second.checkpoint.results.length, 1); await second.close();
    assert.deepEqual(await readdir(directory), ['checkpoint.json']);
    await writeFile(path.join(directory,'run.lock'),'{"pid":1,"host":"stale"}');
    await assert.rejects(openRunDirectory(directory,{resume:true}), /locked/);
  } finally { await rm(directory, {recursive:true,force:true}); }
});

test('provider signal cancellation is propagated and subprocess cancellation terminates promptly', async () => {
  const controller = new AbortController();
  let requestSignal;
  const pending = generate({ ...base, task: suite.tasks[0], timeoutMs:10000, signal:controller.signal, fetchImpl: async (_url, options) => {
    requestSignal = options.signal;
    return new Promise((_resolve,reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true}));
  } });
  controller.abort(); await assert.rejects(pending, /abort/i); assert.equal(requestSignal.aborted,true);
  const subprocess = new AbortController();
  const result = command(process.execPath,['-e','setInterval(()=>{},1000)'], {signal:subprocess.signal,timeoutMs:10000});
  setTimeout(() => subprocess.abort(),100);
  assert.equal((await result).aborted,true);
});

test('demo and report cannot overwrite an active or saved live run', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'skilldelta-artifacts-'));
  const bin = fileURLToPath(new URL('../bin/skilldelta.mjs', import.meta.url));
  try {
    const saved = await partial(2), input = path.join(directory,'source.json'), out = path.join(directory,'run');
    await atomicJson(input,saved);
    const live = await openRunDirectory(out); await live.write(saved);
    for (const args of [['demo','--out',out],['report',input,'--out',out]]) {
      const result = await command(process.execPath,[bin,...args]); assert.equal(result.code,2); assert.match(result.output,/locked/);
    }
    await live.close();
    for (const args of [['demo','--out',out],['report',input,'--out',out]]) {
      const result = await command(process.execPath,[bin,...args]); assert.equal(result.code,2); assert.match(result.output,/live checkpoint/);
    }
    assert.deepEqual(await readCheckpoint(path.join(out,'checkpoint.json')),saved);
    assert.deepEqual(await readdir(out),['checkpoint.json']);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('CLI rebuild rejects contradictory progress and empty legacy reports; valid partial report stays inconclusive', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'skilldelta-progress-'));
  const bin = fileURLToPath(new URL('../bin/skilldelta.mjs', import.meta.url));
  try {
    const input = path.join(directory,'source.json'), out = path.join(directory,'rebuilt');
    const saved = await partial(2);
    for (const change of [s => s.checkpoint.complete = true, s => s.checkpoint.expectedResults = -1, s => { s.results=[]; delete s.checkpoint; }]) {
      const invalid=structuredClone(saved); change(invalid); await atomicJson(input,invalid);
      const result = await command(process.execPath,[bin,'report',input,'--out',out]);
      assert.equal(result.code,2); assert.match(result.output,/Invalid checkpoint/);
    }
    await atomicJson(input,saved);
    assert.equal((await command(process.execPath,[bin,'report',input,'--out',out])).code,0);
    assert.match(await readFile(path.join(out,'badge.svg'),'utf8'),/INCONCLUSIVE/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
