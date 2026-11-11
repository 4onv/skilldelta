import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readCheckpoint } from './checkpoint.mjs';
import { compareEvaluations } from './history.mjs';

async function evaluate(env) {
  const previousFile = env.INPUT_PREVIOUS;
  const currentFile = env.INPUT_CURRENT;
  if (!previousFile?.trim() || !currentFile?.trim()) {
    return { status: 'invalid', message: 'Provide both previous and current saved evaluation paths.' };
  }

  const rawThreshold = (env.INPUT_MAX_REGRESSION_PP ?? '0').trim();
  const threshold = Number(rawThreshold);
  if (!/^\d+(?:\.\d+)?$/.test(rawThreshold) || threshold < 0 || threshold > 200) {
    return { status: 'invalid', message: 'max_regression_pp must be a decimal number from 0 to 200.' };
  }

  const workspace = env.GITHUB_WORKSPACE || process.cwd();
  let comparison;
  try {
    const [previous, current] = await Promise.all([
      readCheckpoint(resolve(workspace, previousFile)),
      readCheckpoint(resolve(workspace, currentFile)),
    ]);
    comparison = compareEvaluations(previous, current);
  } catch {
    return { status: 'invalid', message: 'Check that both paths contain readable SkillDelta evaluation files.' };
  }

  const { simulated, changes, reasons } = comparison;
  if (comparison.status !== 'comparable') {
    return { status: comparison.status, simulated, message: reasons.join(' ') };
  }

  const change = changes.skillEffectPercentagePoints;
  const regression = change < -threshold;
  const message = `Skill effect changed by ${change.toFixed(2)} percentage points. Allowed decrease: ${threshold}.`;
  return { status: regression ? 'regression' : 'pass', change, simulated, message };
}

async function main(env) {
  const result = await evaluate(env);
  // Only computed numbers, booleans and fixed status values go into runner outputs.
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, [
      `status=${result.status}`,
      `skill_effect_change_pp=${result.change ?? ''}`,
      `simulated=${result.simulated ?? ''}`,
      '',
    ].join('\n'));
  }
  const demoLabel = result.simulated ? '\n\n**Simulated demo evaluations.**' : '';
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY, `## SkillDelta regression check\n\n**${result.status}** — ${result.message}${demoLabel}\n`);
  }
  console.log(`SkillDelta ${result.status}. ${result.message}${result.simulated ? ' Simulated demo evaluations.' : ''}`);
  if (result.status === 'regression') process.exitCode = 1;
  else if (result.status !== 'pass') process.exitCode = 2;
}

main(process.env).catch(() => {
  console.error('SkillDelta could not write the action outputs or summary.');
  process.exitCode = 2;
});
