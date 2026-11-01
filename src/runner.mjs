import { randomUUID } from 'node:crypto';
import { generate } from './provider.mjs';
import { checkFiles } from './execute.mjs';

export function summarize(results) {
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
  return { baseline, skill, deltaPercentagePoints, paired, errors, verdict: errors ? 'Inconclusive: runtime or provider errors' : deltaPercentagePoints > 0 ? 'Skill improved this sample' : deltaPercentagePoints < 0 ? 'Skill regressed on this sample' : 'No observed difference' };
}
export function orderedConditions(seed, taskIndex, trial) { return ((seed + taskIndex + trial) % 2) ? ['baseline', 'skill'] : ['skill', 'baseline']; }
export async function runEvaluation({ suite, skill, model, seed = 42, trials = 3, endpoint, key, image, maxOutputTokens = 4096, timeoutMs = 120000, demoSolutions, onProgress = () => {}, generateFn = generate, checkFn = checkFiles }) {
  const results = [];
  for (let trial = 1; trial <= trials; trial++) {
    for (let index = 0; index < suite.tasks.length; index++) {
      const task = suite.tasks[index];
      for (const condition of orderedConditions(seed, index, trial)) {
        onProgress({ taskId: task.id, trial, condition, phase: 'start' });
        const started = performance.now();
        let row = { taskId: task.id, taskTitle: task.title, trial, condition, passed: false, status: 'error', inputTokens: null, outputTokens: null };
        try {
          const generated = demoSolutions ? { files: demoSolutions[task.id][condition], inputTokens: null, outputTokens: null } : await generateFn({ endpoint, key, model, maxOutputTokens, timeoutMs, task, skillText: condition === 'skill' ? skill.text : '' });
          row.inputTokens = generated.inputTokens; row.outputTokens = generated.outputTokens;
          Object.assign(row, await checkFn({ files: generated.files, testSource: task.testSource, timeoutMs: task.timeoutMs, image, demo: Boolean(demoSolutions) }));
        } catch (error) {
          // Never include arbitrary provider bodies, source, or authentication in shareable artifacts.
          const message = error?.name === 'TimeoutError' ? 'Provider request timed out.' : String(error?.message ?? 'Evaluation failed.');
          if (message.startsWith('Model ')) row.status = 'failed';
          const allowed = /^(Model |Provider returned HTTP |Provider returned invalid JSON\.|Provider response exceeded |Test |Invalid generated file\.)/;
          row.error = allowed.test(message) ? message : 'Evaluation failed. Check endpoint, credentials, and runtime configuration.';
        }
        row.durationMs = Math.round(performance.now() - started);
        results.push(row); onProgress({ ...row, phase: 'complete' });
      }
    }
  }
  return { schemaVersion: 1, id: randomUUID(), createdAt: new Date().toISOString(), mode: demoSolutions ? 'demo' : 'live', skill: { name: skill.name, sha256: skill.sha256 }, suite: { name: suite.name, sha256: suite.sha256, tests: suite.tasks.map(t => ({ id: t.id, sha256: t.testSha256 })) }, model: demoSolutions ? 'Deterministic fixtures (no model)' : model, seed, trials, runtime: demoSolutions ? process.version : image, settings: { maxOutputTokens, timeoutMs, temperature: 0, ordering: 'Alternating pair order; seed controls parity, not model randomness' }, results, summary: summarize(results) };
}
