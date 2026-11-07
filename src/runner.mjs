import { randomUUID } from 'node:crypto';
import { generate } from './provider.mjs';
import { checkFiles } from './execute.mjs';
import { sha256 } from './config.mjs';

export function summarize(results, expectedResults = results.length) {
  const group = condition => {
    const rows = results.filter(r => r.condition === condition);
    const passed = rows.filter(r => r.passed).length;
    return { passed, total: rows.length, passRate: rows.length ? passed / rows.length : 0 };
  };
  const baseline = group('baseline'), skill = group('skill');
  const paired = { wins: 0, losses: 0, ties: 0 };
  const pairs = new Map();
  for (const row of results) { const key = `${row.taskId}:${row.trial}`; if (!pairs.has(key)) pairs.set(key, {}); pairs.get(key)[row.condition] = row; }
  for (const pair of pairs.values()) {
    if (!pair.baseline || !pair.skill || pair.baseline.status === 'error' || pair.skill.status === 'error') continue;
    if (pair.baseline.passed === pair.skill.passed) paired.ties++;
    else if (pair.skill.passed) paired.wins++; else paired.losses++;
  }
  const deltaPercentagePoints = (skill.passRate - baseline.passRate) * 100;
  const errors = results.filter(r => r.status === 'error').length;
  const incomplete = !results.length || results.length < expectedResults || [...pairs.values()].some(pair => !pair.baseline || !pair.skill);
  return { baseline, skill, deltaPercentagePoints, paired, errors, verdict: incomplete ? 'Inconclusive: evaluation incomplete' : errors ? 'Inconclusive: runtime or provider errors' : deltaPercentagePoints > 0 ? 'Skill improved this sample' : deltaPercentagePoints < 0 ? 'Skill regressed on this sample' : 'No observed difference' };
}
export function orderedConditions(seed, taskIndex, trial) { return ((seed + taskIndex + trial) % 2) ? ['baseline', 'skill'] : ['skill', 'baseline']; }

function schedule(suite, seed, trials) {
  const steps = [];
  for (let trial = 1; trial <= trials; trial++) {
    for (let index = 0; index < suite.tasks.length; index++) {
      const task = suite.tasks[index];
      for (const condition of orderedConditions(seed, index, trial)) steps.push({ task, trial, condition });
    }
  }
  return steps;
}

function resumeRows(saved, report, steps, planSha256) {
  if (!saved || saved.schemaVersion !== 1 || saved.checkpoint?.version !== 1 || saved.checkpoint.planSha256 !== planSha256 ||
      typeof saved.id !== 'string' || !saved.id || !Number.isFinite(Date.parse(saved.createdAt)) || !Array.isArray(saved.results) || saved.results.length > steps.length) {
    throw new Error('Checkpoint does not match this evaluation. Keep suite, skill, tests, model, endpoint, settings and image unchanged.');
  }
  const allowedKeys = new Set(['taskId','taskTitle','trial','condition','passed','status','inputTokens','outputTokens','durationMs','error']);
  const rows = saved.results.map((row, index) => {
    const { task, trial, condition } = steps[index];
    const token = value => value === null || (Number.isSafeInteger(value) && value >= 0);
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !allowedKeys.has(key)) || row.taskId !== task.id || row.taskTitle !== task.title || row.trial !== trial || row.condition !== condition ||
        !['passed','failed','error'].includes(row.status) || row.passed !== (row.status === 'passed') || !token(row.inputTokens) || !token(row.outputTokens) ||
        !Number.isSafeInteger(row.durationMs) || row.durationMs < 0 || ('error' in row && (typeof row.error !== 'string' || row.error.length > 1024))) {
      throw new Error('Checkpoint contains invalid, duplicate or out-of-order completed attempts.');
    }
    return { ...row };
  });
  report.id = saved.id; report.createdAt = saved.createdAt;
  return rows;
}

export async function runEvaluation({ suite, skill, model, seed = 42, trials = 3, endpoint, key, image, maxOutputTokens = 4096, timeoutMs = 120000, demoSolutions, onProgress = () => {}, onCheckpoint = async () => {}, resumeReport, signal, generateFn = generate, checkFn = checkFiles }) {
  const steps = schedule(suite, seed, trials);
  // Bind the complete evaluation inputs, including hidden test contents, without persisting them.
  const planSha256 = sha256(JSON.stringify({ version: 1, suite, skill, model: model ?? null, seed, trials, endpoint: endpoint ?? null,
    image: image ?? null, maxOutputTokens, timeoutMs, demoSolutions: demoSolutions ?? null }));
  const report = { schemaVersion: 1, id: randomUUID(), createdAt: new Date().toISOString(), mode: demoSolutions ? 'demo' : 'live', skill: { name: skill.name, sha256: skill.sha256 }, suite: { name: suite.name, sha256: suite.sha256, tests: suite.tasks.map(t => ({ id: t.id, sha256: t.testSha256 })) }, model: demoSolutions ? 'Deterministic fixtures (no model)' : model, seed, trials, runtime: demoSolutions ? process.version : image, settings: { maxOutputTokens, timeoutMs, temperature: 0, ordering: 'Alternating pair order; seed controls parity, not model randomness' } };
  const results = resumeReport ? resumeRows(resumeReport, report, steps, planSha256) : [];
  const checkpoint = async () => {
    report.results = results;
    report.summary = summarize(results, steps.length);
    report.checkpoint = { version: 1, planSha256, expectedResults: steps.length, complete: results.length === steps.length, updatedAt: new Date().toISOString() };
    await onCheckpoint(structuredClone(report));
  };
  await checkpoint();
  for (let index = results.length; index < steps.length; index++) {
    if (signal?.aborted) break;
    const { task, trial, condition } = steps[index];
    onProgress({ taskId: task.id, trial, condition, phase: 'start' });
    const started = performance.now();
    let row = { taskId: task.id, taskTitle: task.title, trial, condition, passed: false, status: 'error', inputTokens: null, outputTokens: null };
    try {
      const generated = demoSolutions ? { files: demoSolutions[task.id][condition], inputTokens: null, outputTokens: null } : await generateFn({ endpoint, key, model, maxOutputTokens, timeoutMs, task, skillText: condition === 'skill' ? skill.text : '', signal });
      signal?.throwIfAborted();
      row.inputTokens = generated.inputTokens; row.outputTokens = generated.outputTokens;
      Object.assign(row, await checkFn({ files: generated.files, testSource: task.testSource, timeoutMs: task.timeoutMs, image, demo: Boolean(demoSolutions), signal }));
      signal?.throwIfAborted();
    } catch (error) {
      if (signal?.aborted) break;
      // Never include arbitrary provider bodies, source, or authentication in shareable artifacts.
      const message = error?.name === 'TimeoutError' ? 'Provider request timed out.' : String(error?.message ?? 'Evaluation failed.');
      if (message.startsWith('Model ')) row.status = 'failed';
      const allowed = /^(Model |Provider returned HTTP |Provider returned invalid JSON\.|Provider response exceeded |Test |Invalid generated file\.)/;
      row.error = allowed.test(message) ? message : 'Evaluation failed. Check endpoint, credentials, and runtime configuration.';
    }
    row.durationMs = Math.round(performance.now() - started);
    results.push(row);
    // A storage failure stops the run before another provider request is made.
    await checkpoint();
    onProgress({ ...row, phase: 'complete' });
  }
  await checkpoint();
  return report;
}
