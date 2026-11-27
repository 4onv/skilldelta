import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSuite } from '../src/config.mjs';

const examplesUrl = new URL('../examples/', import.meta.url);
const suite = JSON.parse(await readFile(new URL('suite.json', examplesUrl), 'utf8'));
const solutions = JSON.parse(await readFile(new URL('demo-solutions.json', examplesUrl), 'utf8'));

async function evaluate(task, files, directory = examplesUrl) {
  const workspace = await mkdtemp(join(tmpdir(), 'skilldelta-fixture-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(workspace, name), content);
    }
    const verifier = await readFile(new URL(task.testFile, directory), 'utf8');
    await writeFile(join(workspace, '__skilldelta.test.mjs'), verifier);
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '__skilldelta.test.mjs'], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: task.timeoutMs,
      windowsHide: true,
      shell: false,
      env: childEnv,
    });
    assert.equal(result.error, undefined, result.error?.message);
    return result;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

test('synthetic demo baseline passes exactly one task; skill passes all three', async () => {
  const counts = { baseline: 0, skill: 0 };
  for (const task of suite.tasks) {
    for (const condition of ['baseline', 'skill']) {
      const result = await evaluate(task, solutions[task.id][condition]);
      const expectedPass = condition === 'skill' || task.id === 'chunk';
      assert.equal(result.status === 0, expectedPass,
        `${task.id}/${condition}:\n${result.stdout}\n${result.stderr}`);
      if (result.status === 0) counts[condition] += 1;
    }
  }
  assert.deepEqual(counts, { baseline: 1, skill: 3 });
});

const httpDirectory = new URL('http-boundaries/', examplesUrl);
const httpSuiteUrl = new URL('suite.json', httpDirectory);
const httpSuite = JSON.parse(await readFile(httpSuiteUrl, 'utf8'));
const variants = JSON.parse(await readFile(new URL('fixtures/http-boundary-variants.json', import.meta.url), 'utf8'));

test('HTTP benchmark loads through the normal suite parser', async () => {
  const loaded = await loadSuite(fileURLToPath(httpSuiteUrl));
  assert.deepEqual(loaded.tasks.map(task => task.id), ['retry-after', 'byte-range', 'ndjson-chunks']);
});

for (const task of httpSuite.tasks) {
  test(`HTTP fixture ${task.id} passes a reference and rejects a plausible shortcut`, async () => {
    const implementations = variants[task.id];
    const pass = await evaluate(task, { 'solution.mjs': implementations.reference }, httpDirectory);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    const fail = await evaluate(task, { 'solution.mjs': implementations.mutant }, httpDirectory);
    assert.equal(fail.status, 1, fail.stdout + fail.stderr);
    assert.match(fail.stdout, /^not ok \d+/m);
  });
}

test('every starter fails, so the example suite detects unimplemented tasks', async () => {
  for (const task of suite.tasks) {
    const result = await evaluate(task, task.starter);
    assert.notEqual(result.status, 0, `${task.id} unexpectedly passed without implementation`);
  }
});

test('fixture outputs can only replace each declared solution file', () => {
  assert.equal(suite.tasks.length, 3);
  assert.equal(new Set(suite.tasks.map(task => task.id)).size, suite.tasks.length);
  for (const task of suite.tasks) {
    assert.deepEqual(Object.keys(task.starter), task.editableFiles);
    for (const condition of ['baseline', 'skill']) {
      assert.deepEqual(Object.keys(solutions[task.id][condition]), task.editableFiles);
    }
  }
});

const uiDirectory = new URL('ui-boundaries/', examplesUrl);
const uiSuiteUrl = new URL('suite.json', uiDirectory);
const uiSuite = JSON.parse(await readFile(uiSuiteUrl, 'utf8'));
const uiVariants = JSON.parse(await readFile(new URL('fixtures/ui-boundary-variants.json', import.meta.url), 'utf8'));

test('UI benchmark loads both tasks through the normal suite parser', async () => {
  const loaded = await loadSuite(fileURLToPath(uiSuiteUrl));
  assert.deepEqual(loaded.tasks.map(task => task.id), ['latest-search', 'grid-paste']);
});

for (const task of uiSuite.tasks) {
  test('UI benchmark ' + task.id + ' accepts the reference and rejects each shortcut', async () => {
    const { reference, mutants } = uiVariants[task.id];
    const pass = await evaluate(task, { 'solution.mjs': reference }, uiDirectory);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    for (const [label, implementation] of Object.entries(mutants)) {
      assert.notEqual(implementation, reference, label);
      const fail = await evaluate(task, { 'solution.mjs': implementation }, uiDirectory);
      assert.equal(fail.status, 1, label + fail.stdout + fail.stderr);
      assert.match(fail.stdout, /^not ok \d+/m);
      assert.doesNotMatch(fail.stdout + fail.stderr, /(SyntaxError|cancelledByParent)/);
    }
  });
}
