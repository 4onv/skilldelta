import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initialize, loadProjectConfig, diagnose } from '../src/onboarding.mjs';
import { loadSuite, loadSkill } from '../src/config.mjs';

async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'skilldelta-onboarding-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  return directory;
}
const digest = `sha256:${'a'.repeat(64)}`;
function mockDocker({ available = true, linux = true, image = true } = {}) {
  const calls = [];
  const fn = async (executable, args, options) => {
    calls.push({ executable, args, options });
    assert.equal(executable, 'docker');
    assert.equal(options.timeoutMs, 10000);
    if (args[0] === '--version') return { code: available ? 0 : -1, output: 'Docker version fake' };
    if (args[0] === 'info') return { code: linux ? 0 : 1, output: linux ? 'linux\n' : 'FAKE_SECRET_DOCKER_ERROR' };
    if (args[0] === 'image' && args[1] === 'inspect') return { code: image ? 0 : 1, output: image ? digest : 'FAKE_SECRET_IMAGE_ERROR' };
    assert.fail('Doctor tried a non-read-only Docker command.');
  };
  return { calls, fn };
}

test('init creates a portable editable project with valid bundled fixtures and no credentials', async t => {
  const directory = await temporary(t);
  const project = path.join(directory, 'nested', 'project');
  const initialized = await initialize(project);
  assert.equal(initialized.directory, project);
  assert.equal(initialized.created.length, 6);
  assert.equal(new Set(initialized.created).size, 6);
  const raw = JSON.parse(await readFile(initialized.configPath, 'utf8'));
  assert.equal(raw.schemaVersion, 1); assert.equal(raw.model, null); assert.equal(raw.endpoint, null);
  assert.equal(raw.suite, 'skilldelta/suite.json'); assert.equal(raw.out, '.skilldelta/run');
  assert.deepEqual(Object.keys(raw).sort(), ['schemaVersion','suite','skill','model','endpoint','trials','seed','maxOutputTokens','timeoutMs','image','out'].sort());
  const config = await loadProjectConfig(initialized.configPath);
  assert.equal(config.suite, path.join(project, 'skilldelta', 'suite.json'));
  assert.equal(config.out, path.join(project, '.skilldelta', 'run'));
  assert.equal((await loadSuite(config.suite)).tasks.length, 3);
  assert.ok((await loadSkill(config.skill)).text.length > 0);
  assert.deepEqual((await readdir(project)).sort(), ['skilldelta','skilldelta.config.json']);
});

test('init rejects existing config or workspace without overwriting or partially writing', async t => {
  const directory = await temporary(t);
  const configTarget = path.join(directory, 'config-existing');
  await mkdir(configTarget);
  await writeFile(path.join(configTarget, 'skilldelta.config.json'), 'preserve this exact content');
  await assert.rejects(initialize(configTarget), /overwrite/);
  assert.equal(await readFile(path.join(configTarget, 'skilldelta.config.json'), 'utf8'), 'preserve this exact content');
  assert.deepEqual(await readdir(configTarget), ['skilldelta.config.json']);
  const workspaceTarget = path.join(directory, 'workspace-existing');
  await mkdir(path.join(workspaceTarget, 'skilldelta'), { recursive: true });
  await writeFile(path.join(workspaceTarget, 'skilldelta', 'mine.txt'), 'mine');
  await assert.rejects(initialize(workspaceTarget), /overwrite/);
  assert.equal(await readFile(path.join(workspaceTarget, 'skilldelta', 'mine.txt'), 'utf8'), 'mine');
  assert.deepEqual(await readdir(workspaceTarget), ['skilldelta']);
});

test('init refuses symbolic-link ancestors and preserves the external destination', async t => {
  const directory = await temporary(t);
  const outside = path.join(directory, 'outside');
  const link = path.join(directory, 'link');
  await mkdir(outside);
  try { await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM','EACCES'].includes(error.code)) { t.skip('Host does not allow directory links.'); return; } throw error; }
  await assert.rejects(initialize(path.join(link, 'child')), /symbolic-link/);
  assert.deepEqual(await readdir(outside), []);
});

test('config validates schema, unknown settings, numeric types, and credential-bearing endpoints', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'skilldelta.config.json');
  for (const config of [
    [], { schemaVersion: 2 }, { schemaVersion: 1, apiKey: 'DO_NOT_PRINT' },
    { schemaVersion: 1, trials: '3' }, { schemaVersion: 1, trials: 0 },
    { schemaVersion: 1, seed: 1.5 }, { schemaVersion: 1, timeoutMs: 999 },
    { schemaVersion: 1, maxOutputTokens: Infinity }, { schemaVersion: 1, suite: null },
    { schemaVersion: 1, skill: [] }, { schemaVersion: 1, out: '' },
    { schemaVersion: 1, model: 123 }, { schemaVersion: 1, image: '--privileged' },
    { schemaVersion: 1, endpoint: 'https://user:DO_NOT_PRINT@example.com/v1' },
    { schemaVersion: 1, endpoint: 'https://example.com/v1?key=DO_NOT_PRINT' }
  ]) {
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(loadProjectConfig(file), error => { assert.ok(!error.message.includes('DO_NOT_PRINT')); return true; });
  }
  await writeFile(file, '{DO_NOT_PRINT');
  await assert.rejects(loadProjectConfig(file), error => !error.message.includes('DO_NOT_PRINT'));
  await writeFile(file, JSON.stringify({ schemaVersion: 1, endpoint: null, model: null }));
  assert.deepEqual(await loadProjectConfig(file), { endpoint: null, model: null });
});

test('doctor checks valid local setup read-only and never leaks credentials or invokes provider', async t => {
  const directory = await temporary(t);
  const { configPath } = await initialize(directory);
  const docker = mockDocker();
  const result = await diagnose({ configPath, cwd: directory, options: { model: 'test-model', endpoint: 'https://example.com/v1/chat/completions' }, env: { SKILLDELTA_API_KEY: 'SUPER_SECRET_SENTINEL' }, nodeVersion: '22.0.0', commandFn: docker.fn });
  assert.equal(result.ok, true);
  assert.ok(result.checks.every(check => check.status === 'pass'));
  assert.deepEqual(docker.calls.map(call => call.args[0]), ['--version','info','image']);
  assert.deepEqual(docker.calls[2].args, ['image','inspect','node:22-alpine','--format','{{.Id}}']);
  assert.ok(!JSON.stringify(result).includes('SUPER_SECRET_SENTINEL'));
  assert.ok(!JSON.stringify(docker.calls).includes('SUPER_SECRET_SENTINEL'));
});

test('doctor reports starter readiness gaps and missing Docker with actionable fixed messages', async t => {
  const directory = await temporary(t);
  const { configPath } = await initialize(directory);
  const docker = mockDocker({ available: false });
  const result = await diagnose({ configPath, env: {}, nodeVersion: '20.0.0', commandFn: docker.fn });
  assert.equal(result.ok, false);
  const statuses = Object.fromEntries(result.checks.map(check => [check.name, check.status]));
  assert.equal(statuses.node, 'fail'); assert.equal(statuses.model, 'fail'); assert.equal(statuses.endpoint, 'fail');
  assert.equal(statuses.docker, 'fail'); assert.equal(statuses.credentials, 'warn'); assert.equal(statuses.image, 'warn');
  assert.equal(statuses.suite, 'pass'); assert.equal(statuses.skill, 'pass');
  assert.equal(docker.calls.length, 1);
});

test('doctor distinguishes uncached images from a stopped daemon without pulling or leaking logs', async t => {
  const directory = await temporary(t);
  const { configPath } = await initialize(directory);
  const options = { model: 'test', endpoint: 'http://127.0.0.1:1234/v1/chat/completions' };
  const image = mockDocker({ image: false });
  const result = await diagnose({ configPath, options, env: {}, commandFn: image.fn });
  assert.equal(result.ok, true);
  assert.equal(result.checks.find(check => check.name === 'image').status, 'warn');
  const stopped = mockDocker({ linux: false });
  const stoppedResult = await diagnose({ configPath, options, env: {}, commandFn: stopped.fn });
  assert.equal(stoppedResult.ok, false); assert.equal(stopped.calls.length, 2);
  assert.ok(!JSON.stringify([result, stoppedResult]).includes('FAKE_SECRET'));
});

test('doctor catches invalid overrides and config errors while retaining other diagnostics', async t => {
  const directory = await temporary(t);
  const badConfig = path.join(directory, 'bad.json');
  await writeFile(badConfig, JSON.stringify({ schemaVersion: 1, SECRET_IN_UNKNOWN_KEY: 'SECRET_IN_VALUE' }));
  const result = await diagnose({ configPath: badConfig, options: { trials: -1 }, env: {}, commandFn: mockDocker().fn });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(check => check.name === 'config').status, 'fail');
  assert.equal(result.checks.find(check => check.name === 'settings').status, 'fail');
  assert.ok(result.checks.some(check => check.name === 'docker'));
  assert.ok(!JSON.stringify(result).includes('SECRET_IN_'));
});
