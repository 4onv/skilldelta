import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sha256 } from '../src/config.mjs';

const action = fileURLToPath(new URL('../src/action.mjs', import.meta.url));

function savedRun(id, baselinePasses, skillPasses) {
  const trials = 3;
  const results = [];
  for (let trial = 1; trial <= trials; trial++) {
    for (const [condition, passes] of [['baseline', baselinePasses], ['skill', skillPasses]]) {
      const passed = trial <= passes;
      results.push({ taskId: 'task', taskTitle: 'PRIVATE_TASK', trial, condition, passed,
        status: passed ? 'passed' : 'failed', inputTokens: null, outputTokens: null, durationMs: 0 });
    }
  }
  return {
    schemaVersion: 1, id, createdAt: '2026-11-11T00:00:00Z', mode: 'demo', trials, seed: 42,
    skill: { name: 'PRIVATE_SKILL', sha256: sha256(id) },
    suite: { name: 'PRIVATE_SUITE', sha256: sha256('suite'), tests: [{ id: 'task', sha256: sha256('task') }] },
    model: 'PRIVATE_MODEL', runtime: 'fixture', results,
    comparison: { version: 1, inputsSha256: sha256('inputs') },
  };
}

async function invoke(previous, current, threshold) {
  const directory = await mkdtemp(join(tmpdir(), 'skilldelta-action-'));
  try {
    const output = join(directory, 'outputs');
    const summary = join(directory, 'summary');
    await writeFile(join(directory, 'previous run.json'), JSON.stringify(previous));
    await writeFile(join(directory, 'current.json'), JSON.stringify(current));
    const env = {
      ...process.env, GITHUB_WORKSPACE: directory, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
      INPUT_PREVIOUS: 'previous run.json', INPUT_CURRENT: 'current.json', INPUT_MAX_REGRESSION_PP: threshold,
    };
    if (threshold === undefined) delete env.INPUT_MAX_REGRESSION_PP;
    const result = spawnSync(process.execPath, [action], { env, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    const outputs = Object.fromEntries((await readFile(output, 'utf8')).trimEnd().split('\n').map((line) => line.split('=')));
    const report = await readFile(summary, 'utf8');
    assert.doesNotMatch(`${report}${result.stdout}${result.stderr}${JSON.stringify(outputs)}`, /PRIVATE_|previous run\.json/);
    return { code: result.status, outputs, report };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('the default gate accepts exactly equal skill effects across different pass rates', async () => {
  const result = await invoke(savedRun('before', 1, 2), savedRun('after', 2, 3));
  assert.equal(result.code, 0);
  assert.deepEqual(result.outputs, { status: 'pass', skill_effect_change_pp: '0', simulated: 'true' });
  assert.match(result.report, /Simulated demo/);
});

test('the gate rejects a decline and accepts an inclusive configured tolerance', async () => {
  const before = savedRun('before', 0, 2);
  const after = savedRun('after', 0, 1);
  const regression = await invoke(before, after, '33.33');
  assert.equal(regression.code, 1);
  assert.equal(regression.outputs.status, 'regression');
  assert.equal(Number(regression.outputs.skill_effect_change_pp), -100 / 3);
  const accepted = await invoke(before, after, String(100 / 3));
  assert.equal(accepted.code, 0);
  assert.equal(accepted.outputs.status, 'pass');
});

test('incompatible and incomplete runs produce distinct failures without a numeric delta', async () => {
  const before = savedRun('before', 0, 2);
  const incompatible = savedRun('other', 0, 1);
  incompatible.model = 'PRIVATE_OTHER_MODEL';
  const incomplete = savedRun('incomplete', 0, 1);
  incomplete.results.pop();
  for (const [candidate, status] of [[incompatible, 'incompatible'], [incomplete, 'inconclusive']]) {
    const result = await invoke(before, candidate);
    assert.equal(result.code, 2);
    assert.equal(result.outputs.status, status);
    assert.equal(result.outputs.skill_effect_change_pp, '');
  }
});

test('bad thresholds and malformed evaluation data fail without exposing inputs', async () => {
  const before = savedRun('before', 0, 2);
  const after = savedRun('after', 0, 1);
  for (const threshold of [' ', '-1', '201', '0x10', 'NaN', '0\nPRIVATE_ANNOTATION']) {
    const result = await invoke(before, after, threshold);
    assert.equal(result.code, 2);
    assert.equal(result.outputs.status, 'invalid');
  }
  const malformed = await invoke(before, { unexpected: 'PRIVATE_BODY' });
  assert.equal(malformed.code, 2);
  assert.equal(malformed.outputs.status, 'invalid');
});
