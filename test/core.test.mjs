import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSuite, safeFile, validateEndpoint } from '../src/config.mjs';
import { makeMessages, parseFiles, generate } from '../src/provider.mjs';
import { summarize, orderedConditions, runEvaluation } from '../src/runner.mjs';
import { checkFiles, command, dockerArgs } from '../src/execute.mjs';

const task = {
  id: 'answer', title: 'Export an answer', prompt: 'Export answer = 42.',
  starter: { 'solution.mjs': 'export const answer = 0;' },
  editableFiles: ['solution.mjs'], testFile: 'tasks/answer.checks.mjs',
  testSource: 'HIDDEN_VERIFIER_SENTINEL', testSha256: 'test-hash', timeoutMs: 10000,
};
const suite = { name: 'Core tests', sha256: 'suite-hash', tasks: [task] };
const skill = { name: 'careful/SKILL.md', sha256: 'skill-hash', text: 'SKILL_TEXT_SENTINEL' };
const generation = { files: { 'solution.mjs': 'export const answer = 42;' }, inputTokens: 10, outputTokens: 5 };

async function withSuite(mutator, callback) {
  const root = await mkdtemp(join(tmpdir(), 'skilldelta-config-test-'));
  try {
    await mkdir(join(root, 'tasks'));
    await writeFile(join(root, 'tasks', 'answer.checks.mjs'), '// verifier source');
    const config = structuredClone(suite);
    mutator(config);
    const file = join(root, 'suite.json');
    await writeFile(file, JSON.stringify(config));
    return await callback(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('suite loading preserves provenance and reads only its declared verifier', async () => {
  await withSuite(() => {}, async file => {
    const loaded = await loadSuite(file);
    assert.match(loaded.sha256, /^[a-f0-9]{64}$/);
    assert.match(loaded.tasks[0].testSha256, /^[a-f0-9]{64}$/);
    assert.equal(loaded.tasks[0].testSource, '// verifier source');
  });
});

test('suite paths reject traversal, reserved outputs, and cross-platform collisions', async () => {
  for (const invalid of ['../outside.mjs', '/absolute.mjs', 'C:/absolute.mjs', 'a\\b.mjs', 'a//b.mjs', '__skilldelta.test.mjs', 'NUL', 'com1.txt']) {
    assert.equal(safeFile(invalid), false, invalid);
    await withSuite(config => { config.tasks[0].editableFiles = [invalid]; }, file => assert.rejects(loadSuite(file), /editableFiles/));
  }
  await withSuite(config => {
    config.tasks[0].editableFiles = ['solution.mjs', 'Solution.mjs'];
  }, file => assert.rejects(loadSuite(file), /editableFiles|collision/i));
  await withSuite(config => { config.tasks[0].testFile = '../outside.mjs'; }, file => assert.rejects(loadSuite(file), /testFile/));
  assert.equal(safeFile('src/solution.mjs'), true);
});

test('suite rejects duplicate task IDs and invalid timeouts before evaluation', async () => {
  await withSuite(config => { config.tasks.push(structuredClone(config.tasks[0])); }, file => assert.rejects(loadSuite(file), /unique/));
  await withSuite(config => { config.tasks[0].timeoutMs = 0; }, file => assert.rejects(loadSuite(file), /timeoutMs/));
});

test('endpoint validation limits plaintext transport to loopback and rejects embedded secrets', () => {
  assert.equal(validateEndpoint('https://model.example/v1/chat/completions'), 'https://model.example/v1/chat/completions');
  assert.equal(validateEndpoint('http://127.0.0.1:1234/v1/chat/completions'), 'http://127.0.0.1:1234/v1/chat/completions');
  for (const endpoint of ['http://model.example/v1', 'https://user:secret@model.example/v1', 'https://model.example/v1?key=secret', 'https://model.example/v1#secret', 'file:///tmp/model']) {
    assert.throws(() => validateEndpoint(endpoint), /Endpoint|URL/);
  }
});

test('model prompts contain the task and optional skill, never hidden verifier material', () => {
  const baseline = makeMessages(task);
  const treatment = makeMessages(task, skill.text);
  for (const messages of [baseline, treatment]) {
    assert.doesNotMatch(JSON.stringify(messages), /HIDDEN_VERIFIER_SENTINEL|test-hash|answer\.checks/);
    assert.equal(JSON.parse(messages[1].content).task, task.prompt);
  }
  assert.doesNotMatch(JSON.stringify(baseline), /SKILL_TEXT_SENTINEL/);
  assert.match(JSON.stringify(treatment), /SKILL_TEXT_SENTINEL/);
  assert.equal(treatment[1].content, baseline[1].content);
});

test('model output must contain exactly the declared files and bounded text', () => {
  assert.deepEqual(parseFiles(JSON.stringify({ files: generation.files }), task.editableFiles), generation.files);
  for (const invalid of [
    '```json\n{}\n```',
    JSON.stringify({ files: {} }),
    JSON.stringify({ files: generation.files, extra: true }),
    JSON.stringify({ files: { '../escape.mjs': 'bad' } }),
    JSON.stringify({ files: { 'solution.mjs': 42 } }),
    JSON.stringify({ files: { 'solution.mjs': 'x'.repeat(256 * 1024 + 1) } }),
  ]) {
    assert.throws(() => parseFiles(invalid, task.editableFiles), /Model/);
  }
});

test('provider request forbids redirects, keeps auth in headers, and captures actual usage', async () => {
  let received;
  const result = await generate({
    endpoint: 'https://model.example/v1/chat/completions', key: 'TEST_ONLY_KEY', model: 'test-model',
    maxOutputTokens: 100, timeoutMs: 10000, task, skillText: skill.text,
    fetchImpl: async (endpoint, options) => {
      received = { endpoint, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ files: generation.files }) } }], usage: { prompt_tokens: 31, completion_tokens: 17 } }));
    },
  });
  assert.equal(received.options.redirect, 'error');
  assert.equal(received.options.headers.Authorization, 'Bearer TEST_ONLY_KEY');
  assert.doesNotMatch(received.options.body, /TEST_ONLY_KEY|HIDDEN_VERIFIER_SENTINEL/);
  assert.equal(JSON.parse(received.options.body).max_tokens, 100);
  assert.deepEqual(result, { files: generation.files, inputTokens: 31, outputTokens: 17 });
});

test('provider errors omit response bodies and invalid usage stays unknown', async () => {
  const base = { endpoint: 'https://model.example/v1', model: 'test', maxOutputTokens: 10, timeoutMs: 10000, task };
  await assert.rejects(generate({ ...base, fetchImpl: async () => new Response('LEAKED_SECRET_SENTINEL', { status: 401 }) }), error => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /LEAKED_SECRET_SENTINEL/);
    return true;
  });
  const result = await generate({ ...base, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ files: generation.files }) } }], usage: { prompt_tokens: -1, completion_tokens: '12' } })) });
  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
});

test('summary uses complete task outcomes and excludes infrastructure errors from paired wins', () => {
  const rows = [];
  const add = (trial, baseline, treatment) => {
    for (const [condition, status] of [['baseline', baseline], ['skill', treatment]]) {
      rows.push({ taskId: 'answer', trial, condition, status, passed: status === 'passed' });
    }
  };
  add(1, 'failed', 'passed');
  add(2, 'passed', 'failed');
  add(3, 'passed', 'passed');
  add(4, 'error', 'passed');
  const summary = summarize(rows);
  assert.deepEqual(summary.baseline, { passed: 2, total: 4, passRate: 0.5 });
  assert.deepEqual(summary.skill, { passed: 3, total: 4, passRate: 0.75 });
  assert.equal(summary.deltaPercentagePoints, 25);
  assert.deepEqual(summary.paired, { wins: 1, losses: 1, ties: 1 });
  assert.equal(summary.errors, 1);
  assert.match(summary.verdict, /Inconclusive/);
});

test('pair order alternates across tasks and trials and is deterministic for a seed', () => {
  const first = orderedConditions(42, 0, 1);
  assert.deepEqual(orderedConditions(42, 0, 1), first);
  assert.deepEqual(orderedConditions(42, 1, 1), [...first].reverse());
  assert.deepEqual(orderedConditions(42, 0, 2), [...first].reverse());
  assert.deepEqual([...first].sort(), ['baseline', 'skill']);
});

test('runner treats malformed model output as a failed attempt, preserving the paired comparison', async () => {
  const report = await runEvaluation({ suite, skill, model: 'mock', trials: 1,
    generateFn: async ({ skillText }) => {
      if (!skillText) return parseFiles('not json', task.editableFiles);
      return generation;
    },
    checkFn: async () => ({ passed: true, status: 'passed' }),
  });
  assert.equal(report.results.find(row => row.condition === 'baseline').status, 'failed');
  assert.equal(report.summary.errors, 0);
  assert.deepEqual(report.summary.paired, { wins: 1, losses: 0, ties: 0 });
  assert.equal(report.summary.deltaPercentagePoints, 100);
});

test('runner keeps provider failures inconclusive and redacts arbitrary thrown details', async () => {
  const report = await runEvaluation({ suite, skill, model: 'mock', trials: 1,
    generateFn: async ({ skillText }) => { throw new Error(skillText ? 'Provider returned HTTP 429. Response body omitted to avoid leaking credentials.' : 'PRIVATE_SECRET_SENTINEL'); },
    checkFn: async () => { assert.fail('Provider failures must not reach execution'); },
  });
  assert.equal(report.summary.errors, 2);
  assert.match(report.summary.verdict, /Inconclusive/);
  assert.deepEqual(report.summary.paired, { wins: 0, losses: 0, ties: 0 });
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SECRET_SENTINEL|SKILL_TEXT_SENTINEL|HIDDEN_VERIFIER_SENTINEL/);
});

test('local test execution detects success, assertion failure, and premature exit', async () => {
  const verifier = "import test from 'node:test'; import assert from 'node:assert/strict'; import {answer} from './solution.mjs'; test('answer equals 42', () => assert.equal(answer,42));";
  for (const [source, expected] of [
    ['export const answer = 42;', true],
    ['export const answer = 0;', false],
    ['process.exit(0); export const answer = 42;', false],
  ]) {
    const result = await checkFiles({ files: { 'solution.mjs': source }, testSource: verifier, timeoutMs: 10000, demo: true });
    assert.equal(result.passed, expected, source);
    assert.equal(result.status, expected ? 'passed' : 'failed');
  }
});

test('subprocess execution clears inherited test context and Node startup hooks', async () => {
  const result = await command(process.execPath, ['-e', "console.log(JSON.stringify({context:process.env.NODE_TEST_CONTEXT,options:process.env.NODE_OPTIONS}))"], {
    env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8', NODE_OPTIONS: '--require=missing-test-hook' }, timeoutMs: 10000,
  });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.output), {});
});

test('Docker execution isolates the workspace, disables networking, and passes no host credentials', () => {
  const args = dockerArgs({ directory: '/tmp/skilldelta test', image: 'sha256:example', name: 'skilldelta-test' });
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.ok(args.includes('--read-only'));
  assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
  assert.equal(args[args.indexOf('--user') + 1], '65534:65534');
  assert.match(args[args.indexOf('--mount') + 1], /target=\/workspace,readonly$/);
  assert.equal(args.includes('--env'), false);
  assert.equal(args.includes('-e'), false);
  assert.throws(() => dockerArgs({ directory: '/tmp/with,comma', image: 'node:22', name: 'test' }), /commas/);
});
