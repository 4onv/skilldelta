import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli)) throw new Error('Run this check with npm run test:package.');
const directory = await mkdtemp(path.join(tmpdir(), 'skilldelta-package-'));
const env = { ...process.env, npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS; delete env.SKILLDELTA_API_KEY;
function run(file, args, cwd = directory, allowedCodes = [0]) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.ok(allowedCodes.includes(result.status), `Command failed: ${args[0]}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
try {
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const packResult = JSON.parse(run(npmCli, ['pack', '--json', '--ignore-scripts', '--pack-destination', directory], root));
  // npm 12 keys results by package name; older releases return an array.
  const packed = Array.isArray(packResult) ? packResult[0] : packResult[metadata.name];
  assert.equal(packed?.name, metadata.name);
  assert.equal(path.basename(packed.filename), packed.filename);
  const artifact = path.join(directory, packed.filename);
  for (const file of ['docs/cli.md','docs/packaging.md','SECURITY.md','CONTRIBUTING.md','src/onboarding.mjs','src/checkpoint.mjs','examples/tasks/chunk.checks.mjs']) assert.ok(packed.files.some(entry => entry.path === file), `Packed file missing: ${file}`);
  const prefix = path.join(directory, 'installed');
  run(npmCli, ['install','--prefix',prefix,'--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',artifact]);
  const installedRoot = path.join(prefix, 'node_modules', ...metadata.name.split('/'));
  const bin = path.join(installedRoot, 'bin/skilldelta.mjs');
  assert.equal(run(bin, ['--version']).trim(), metadata.version);
  assert.ok((await stat(path.join(prefix, 'node_modules/.bin', process.platform === 'win32' ? 'skilldelta.cmd' : 'skilldelta'))).isFile());
  const project = path.join(directory, 'project');
  run(bin, ['init', project]);
  assert.match(run(bin, ['run','--model','package-test','--endpoint','https://example.com/v1/chat/completions','--dry-run'], project), /Validation passed/);
  const readiness = JSON.parse(run(bin, ['doctor','--json'], project, [0,2]));
  for (const name of ['node','config','suite','skill']) assert.equal(readiness.checks.find(check => check.name === name)?.status, 'pass', `Installed doctor failed: ${name}`);
  run(bin, ['demo','--out',path.join(directory,'demo')]);
  const report = JSON.parse(await readFile(path.join(directory,'demo/results.json'),'utf8'));
  assert.equal(report.mode,'demo'); assert.equal(report.summary.baseline.passed,1); assert.equal(report.summary.skill.passed,3);
  assert.equal(report.checkpoint.complete,true); assert.equal(report.checkpoint.expectedResults,6);
  assert.match(run(bin,['--help']),/--resume/);
  assert.equal(run(bin,['--version']).trim(),metadata.version);
  console.log(`Package smoke passed: ${metadata.name}@${metadata.version}; clean offline install, bin, init, config dry-run, doctor, and real-test demo.`);
} finally {
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('skilldelta-package-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
