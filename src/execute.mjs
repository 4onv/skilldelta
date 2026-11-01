import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeFile } from './config.mjs';

export function command(executable, args, { timeoutMs = 30000, cwd, env = process.env } = {}) {
  return new Promise(resolve => {
    const childEnv = { ...env };
    delete childEnv.NODE_TEST_CONTEXT;
    delete childEnv.NODE_OPTIONS;
    const child = spawn(executable, args, { cwd, env: childEnv, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, settled = false;
    const append = data => { if (output.length < 64000) output += data.toString().slice(0, 64000 - output.length); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    child.on('error', error => finish({ code: -1, output: '', timedOut, missing: error.code === 'ENOENT' }));
    child.on('close', code => finish({ code: code ?? -1, output, timedOut, missing: false }));
  });
}
export async function prepareDocker(image) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]+$/.test(image)) throw new Error('Invalid Docker image reference.');
  const info = await command('docker', ['info', '--format', '{{.OSType}}']);
  if (info.code !== 0 || !info.output.includes('linux')) throw new Error('Live runs need Docker with Linux containers. Start Docker and retry; `demo` works without Docker.');
  let inspect = await command('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  if (inspect.code !== 0) {
    const pulled = await command('docker', ['pull', image], { timeoutMs: 300000 });
    if (pulled.code !== 0) throw new Error('Could not pull the test image. Pull it manually and retry.');
    inspect = await command('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  }
  const id = inspect.output.trim();
  if (inspect.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('Could not resolve Docker image digest.');
  return id;
}
export function dockerArgs({ directory, image, name }) {
  if (directory.includes(',')) throw new Error('Temporary directory path cannot contain commas (Docker mount syntax).');
  return ['run', '--rm', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '64', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--mount', `type=bind,source=${directory},target=/workspace,readonly`, '--workdir', '/workspace', '--entrypoint', 'node', image, '--test', '--test-reporter=tap', '__skilldelta.test.mjs'];
}
export async function checkFiles({ files, testSource, timeoutMs, image, demo = false }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'skilldelta-'));
  const name = `skilldelta-${randomUUID()}`;
  let launched = false;
  try {
    await chmod(directory, 0o755);
    for (const [file, text] of Object.entries(files)) {
      if (!safeFile(file) || typeof text !== 'string') throw new Error('Invalid generated file.');
      const target = path.join(directory, file);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, text, { mode: 0o644 });
    }
    await writeFile(path.join(directory, '__skilldelta.test.mjs'), testSource + '\n;import { test as __skilldeltaCompletionTest } from "node:test";\n__skilldeltaCompletionTest("__skilldelta_verifier_completed__", () => {});\n', { mode: 0o644 });
    let result;
    if (demo) {
      // Only the CLI's bundled, deterministic fixtures may use this path.
      result = await command(process.execPath, ['--test', '--test-reporter=tap', '__skilldelta.test.mjs'], { cwd: directory, timeoutMs });
    } else {
      launched = true;
      result = await command('docker', dockerArgs({ directory, image, name }), { timeoutMs });
    }
    if (result.timedOut) return { passed: false, status: 'failed', error: 'Test timeout exceeded.' };
    if (result.missing || result.code === 125 || result.code === 126 || result.code === 127) return { passed: false, status: 'error', error: 'Test runtime could not start.' };
    const completed = /^ok \d+ - __skilldelta_verifier_completed__\r?$/m.test(result.output);
    const passed = result.code === 0 && completed;
    return { passed, status: passed ? 'passed' : 'failed', ...(!completed && result.code === 0 ? { error: 'Test process exited before the completion check.' } : {}) };
  } finally {
    if (launched) await command('docker', ['rm', '--force', name], { timeoutMs: 10000 });
    await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
