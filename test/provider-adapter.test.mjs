import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createMockAdapter } from '../examples/mock-adapter.mjs';
import { bridgeAdapter, defaultAdapter, generate } from '../src/provider.mjs';
import { sha256 } from '../src/config.mjs';
import { compareEvaluations } from '../src/history.mjs';
import { renderReport } from '../src/report.mjs';
import { runEvaluation } from '../src/runner.mjs';

const files = { 'solution.mjs': 'export const answer = 42;' };
const task = { id: 'answer', title: 'Answer', prompt: 'Export an answer.', starter: { 'solution.mjs': '' },
  editableFiles: ['solution.mjs'], testSource: 'HIDDEN_VERIFIER', testSha256: sha256('HIDDEN_VERIFIER'), timeoutMs: 15000 };
const endpoint = 'http://127.0.0.1:9999/evaluate';
const generationInput = { endpoint, key: 'PRIVATE_KEY', model: 'mock-agent', maxOutputTokens: 100,
  timeoutMs: 10000, task, adapter: bridgeAdapter };

test('bridge sends only the public task and selected skill, with usage and authentication handled separately', async () => {
  const payloads = [];
  for (const skillText of ['', 'SKILL_ONLY']) {
    const result = await generate({ ...generationInput, skillText, fetchImpl: async (url, options) => {
      assert.equal(url, endpoint);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer PRIVATE_KEY');
      assert.doesNotMatch(options.body, /PRIVATE_KEY|HIDDEN_VERIFIER|testSha256|timeoutMs/);
      payloads.push(JSON.parse(options.body));
      return Response.json({ schemaVersion: 1, files, usage: { inputTokens: 5, outputTokens: 7 } });
    } });
    assert.deepEqual(result, { files, inputTokens: 5, outputTokens: 7 });
  }
  assert.deepEqual(payloads[0], { schemaVersion: 1, model: 'mock-agent', limits: { maxOutputTokens: 100, temperature: 0 },
    task: { id: task.id, prompt: task.prompt, editableFiles: task.editableFiles, starter: task.starter }, skill: null });
  assert.deepEqual(payloads[1], { ...payloads[0], skill: { text: 'SKILL_ONLY' } });
});

test('bridge contract errors are bounded and token counts are unknown when not reported', async () => {
  const request = data => generate({ ...generationInput, fetchImpl: async () => Response.json(data) });
  await assert.rejects(request({ schemaVersion: 2, files, debug: 'SECRET' }), error => {
    assert.match(error.message, /invalid SkillDelta HTTP v1 response/);
    assert.doesNotMatch(error.message, /SECRET/);
    return true;
  });
  await assert.rejects(request({ schemaVersion: 1, files: { '../elsewhere.mjs': 'source' } }), /exactly the editable files/);
  assert.deepEqual(await request({ schemaVersion: 1, files, usage: { inputTokens: -1 } }),
    { files, inputTokens: null, outputTokens: null });
  await assert.rejects(generate({ ...generationInput, fetchImpl: async () => new Response(new Uint8Array([255])) }),
    /invalid JSON/);
  await assert.rejects(generate({ ...generationInput, fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }),
    /exceeded 2 MiB/);
  await assert.rejects(generate({ ...generationInput, adapter: 'unknown', fetchImpl: () => assert.fail('unexpected request') }),
    /Choose adapter/);
});

test('the bundled synthetic adapter responds over loopback with distinct paired fixtures', async () => {
  const server = await createMockAdapter();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const options = { ...generationInput, model: 'synthetic-fixtures',
      endpoint: 'http://127.0.0.1:' + server.address().port + '/evaluate',
      task: { ...task, id: 'slugify', editableFiles: ['solution.mjs'] } };
    const [baseline, skill] = await Promise.all([generate(options), generate({ ...options, skillText: 'Synthetic' })]);
    assert.notDeepEqual(baseline.files, skill.files);
    assert.equal(baseline.inputTokens, 0);
    assert.equal(skill.outputTokens, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('resume and saved comparisons bind adapter identity while default fingerprints remain backward compatible', async () => {
  const suite = { name: 'Test plan', sha256: sha256('suite'), tasks: [task] };
  const skill = { name: 'Test skill', sha256: sha256('skill'), text: 'Check the boundary.' };
  const options = { suite, skill, model: 'mock-agent', endpoint, image: 'test-image', trials: 1,
    generateFn: async () => ({ files, inputTokens: null, outputTokens: null }),
    checkFn: async () => ({ status: 'passed', passed: true }) };
  const legacy = await runEvaluation(options);
  const originalInputs = { version: 1, suite, model: options.model, seed: 42, trials: 1,
    endpoint, image: options.image, maxOutputTokens: 4096, timeoutMs: 120000, demoSolutions: null };
  assert.equal(legacy.comparison.inputsSha256, sha256(JSON.stringify(originalInputs)));
  const { suite: sameSuite, version, ...rest } = originalInputs;
  assert.equal(legacy.checkpoint.planSha256, sha256(JSON.stringify({ version, suite: sameSuite, skill, ...rest })));
  const explicitlyDefault = await runEvaluation({ ...options, adapter: defaultAdapter });
  assert.equal(compareEvaluations(legacy, explicitlyDefault).status, 'comparable');

  const controller = new AbortController();
  const partial = await runEvaluation({ ...options, adapter: bridgeAdapter, signal: controller.signal,
    onProgress: row => { if (row.phase === 'complete') controller.abort(); } });
  assert.equal(partial.results.length, 1);
  await assert.rejects(runEvaluation({ ...options, resumeReport: partial,
    generateFn: () => assert.fail('incompatible resume should not call a provider') }), /does not match/);
  const completed = await runEvaluation({ ...options, adapter: bridgeAdapter, resumeReport: partial, generateFn: async input => {
    assert.equal(input.adapter, bridgeAdapter);
    return options.generateFn();
  } });
  const bridge = await runEvaluation({ ...options, adapter: bridgeAdapter });
  assert.equal(completed.id, partial.id);
  assert.equal(completed.results.length, 2);
  assert.equal(compareEvaluations(legacy, bridge).status, 'incompatible');
  assert.equal(compareEvaluations(completed, bridge).status, 'comparable');
  assert.match(renderReport(bridge), /skilldelta-http-v1/);
  assert.doesNotMatch(JSON.stringify(bridge), /127\.0\.0\.1|HIDDEN_VERIFIER|export const answer/);
});
