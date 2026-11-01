#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSuite, loadSkill, integer, validateEndpoint, readSmall } from '../src/config.mjs';
import { prepareDocker } from '../src/execute.mjs';
import { runEvaluation, summarize } from '../src/runner.mjs';
import { renderReport, renderBadge } from '../src/report.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const help = `SkillDelta — Does your agent skill actually help?\n\nUsage:\n  skilldelta demo [--out .skilldelta/demo]\n  skilldelta run --suite suite.json --skill SKILL.md --model MODEL --endpoint URL\n  skilldelta report results.json [--out DIRECTORY]\n\nRun options:\n  --trials 3                 Repetitions per task and condition (1–100)\n  --seed 42                  Controls alternating condition order, not model randomness\n  --max-output-tokens 4096    Maximum output tokens per request\n  --timeout-ms 120000        Provider timeout per request\n  --image node:22-alpine     Docker image with Node.js; resolved to image ID\n  --out .skilldelta/run      Results JSON, report HTML, and SVG badge\n  --dry-run                 Validate and print request count, without network calls\n  --fail-on-regression      Exit 1 if skill task pass rate decreases\n\nReal runs use SKILLDELTA_API_KEY from the environment and require Docker.\nDemo uses bundled simulated code with real tests. It is not model evidence.\nNo API keys, generated code, or raw model responses are included in reports.\n`;

async function save(report, out) {
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(out, 'report.html'), renderReport(report));
  await writeFile(path.join(out, 'badge.svg'), renderBadge(report));
  console.log(`\n${report.summary.verdict}\nBaseline ${report.summary.baseline.passed}/${report.summary.baseline.total} → Skill ${report.summary.skill.passed}/${report.summary.skill.total}\nReport: ${path.resolve(out, 'report.html')}`);
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(['out','suite','skill','model','endpoint','trials','seed','max-output-tokens','timeout-ms','image'].map(k => [k, { type: 'string' }]).concat(['help','version','dry-run','fail-on-regression'].map(k => [k, { type: 'boolean' }]))) });
  if (values.version) { console.log('0.1.0'); return; }
  if (values.help || !positionals.length) { console.log(help); return; }
  const [command, input] = positionals;
  if (!['demo','run','report'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (positionals.length > (command === 'report' ? 2 : 1)) throw new Error('Unexpected positional argument.');
  const accepted = command === 'demo' ? ['out'] : command === 'report' ? ['out'] : ['out','suite','skill','model','endpoint','trials','seed','max-output-tokens','timeout-ms','image','dry-run','fail-on-regression'];
  for (const key of Object.keys(values)) if (!accepted.includes(key)) throw new Error(`--${key} is not valid for ${command}.`);
  if (command === 'report') {
    if (!input) throw new Error('Provide a results.json file.');
    const report = JSON.parse(await readSmall(input, 10 * 1024 * 1024));
    if (report.schemaVersion !== 1 || !['demo','live'].includes(report.mode) || !Array.isArray(report.results) || !report.results.length || !report.skill || typeof report.skill.name !== 'string' || report.results.some(r => !['baseline','skill'].includes(r.condition) || !['passed','failed','error'].includes(r.status) || typeof r.passed !== 'boolean' || r.passed !== (r.status === 'passed'))) throw new Error('Unsupported or invalid results file.');
    report.summary = summarize(report.results);
    await save(report, values.out ?? path.dirname(path.resolve(input))); return;
  }
  const demo = command === 'demo';
  if (!demo && (!values.suite || !values.skill || !values.model || !values.endpoint)) throw new Error('run requires --suite, --skill, --model, and --endpoint. See --help.');
  const suite = await loadSuite(demo ? path.join(root, 'examples/suite.json') : values.suite);
  const skill = await loadSkill(demo ? path.join(root, 'examples/edge-cases/SKILL.md') : values.skill);
  const trials = integer(values.trials ?? (demo ? 1 : 3), 'trials', 1, 100);
  const seed = integer(values.seed ?? 42, 'seed', 0, 2147483647);
  const maxOutputTokens = integer(values['max-output-tokens'] ?? 4096, 'max-output-tokens', 64, 32768);
  const timeoutMs = integer(values['timeout-ms'] ?? 120000, 'timeout-ms', 1000, 600000);
  const endpoint = demo ? undefined : validateEndpoint(values.endpoint);
  console.log(`SkillDelta · ${demo ? 'SIMULATED DEMO' : 'live evaluation'}\n${suite.tasks.length} tasks × ${trials} trials × 2 conditions = ${suite.tasks.length * trials * 2} ${demo ? 'fixture checks' : 'provider requests'}\n`);
  if (values['dry-run']) { console.log(`Max output tokens per request: ${maxOutputTokens}\nSkill hash: ${skill.sha256}\nValidation passed. No provider requests or Docker commands executed.`); return; }
  if (demo) console.log('Simulated outputs · real tests · not evidence of model performance\n');
  else console.log('Preparing Docker test image. Model requests may incur provider charges.');
  const image = demo ? undefined : await prepareDocker(values.image ?? 'node:22-alpine');
  const demoSolutions = demo ? JSON.parse(await readFile(path.join(root, 'examples/demo-solutions.json'), 'utf8')) : undefined;
  const report = await runEvaluation({ suite, skill, model: values.model, endpoint, key: process.env.SKILLDELTA_API_KEY, trials, seed, image, maxOutputTokens, timeoutMs, demoSolutions, onProgress: row => { if (row.phase === 'start') console.log(`  ${row.taskId} / ${row.condition} / trial ${row.trial} …`); else console.log(`    ${row.status.toUpperCase()} (${row.durationMs} ms)`); } });
  await save(report, values.out ?? (demo ? '.skilldelta/demo' : '.skilldelta/run'));
  if (report.summary.errors) process.exitCode = 2;
  else if (values['fail-on-regression'] && report.summary.deltaPercentagePoints < 0) process.exitCode = 1;
}
main().catch(error => { console.error(`SkillDelta: ${error.message}`); process.exitCode = 2; });
