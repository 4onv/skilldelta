import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const examplesUrl = new URL('../examples/', import.meta.url);
const suite = JSON.parse(await readFile(new URL('suite.json', examplesUrl), 'utf8'));
const solutions = JSON.parse(await readFile(new URL('demo-solutions.json', examplesUrl), 'utf8'));

async function evaluate(task, files) {
  const workspace = await mkdtemp(join(tmpdir(), 'skilldelta-fixture-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(workspace, name), content);
    }
    const verifier = await readFile(new URL(task.testFile, examplesUrl), 'utf8');
    await writeFile(join(workspace, '__skilldelta.test.mjs'), verifier);
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '__skilldelta.test.mjs'], {
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
