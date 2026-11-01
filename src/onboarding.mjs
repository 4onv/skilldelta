import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { integer, loadSkill, loadSuite, readSmall, validateEndpoint } from './config.mjs';
import { command } from './execute.mjs';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const templateFiles = ['suite.json', 'edge-cases/SKILL.md', 'tasks/slugify.checks.mjs', 'tasks/chunk.checks.mjs', 'tasks/uniqueBy.checks.mjs'];
const allowed = new Set(['schemaVersion', 'suite', 'skill', 'model', 'endpoint', 'trials', 'seed', 'maxOutputTokens', 'timeoutMs', 'image', 'out']);
const numeric = { trials: [1, 100], seed: [0, 2147483647], maxOutputTokens: [64, 32768], timeoutMs: [1000, 600000] };
const imagePattern = /^[a-zA-Z0-9][a-zA-Z0-9_./:@-]+$/;

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.schemaVersion !== 1) throw new Error('Project config must be an object with schemaVersion 1.');
  if (Object.keys(config).some(key => !allowed.has(key))) throw new Error('Unknown project config setting. Keep API credentials in SKILLDELTA_API_KEY, never in the config.');
  for (const key of ['suite', 'skill', 'out', 'image', 'model', 'endpoint']) {
    if (!(key in config)) continue;
    if (['model', 'endpoint'].includes(key) && config[key] === null) continue;
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`Project config ${key} must be a nonempty string.`);
  }
  if (config.image && (config.image.length > 512 || !imagePattern.test(config.image))) throw new Error('Invalid Docker image reference in project config.');
  if (config.endpoint !== undefined && config.endpoint !== null) validateEndpoint(config.endpoint);
  for (const [key, [min, max]] of Object.entries(numeric)) {
    if (!(key in config)) continue;
    if (typeof config[key] !== 'number') throw new Error(`Project config ${key} must be a number.`);
    integer(config[key], key, min, max);
  }
}

/** Apply the same constraints to resolved settings and explicit CLI overrides. */
export function validateRunOptions(options) {
  validateConfig({ ...options, schemaVersion: 1 });
}

/** Read configuration only; relative file paths are relative to the config file. */
export async function loadProjectConfig(file) {
  let config;
  try { config = JSON.parse(await readSmall(file, 64 * 1024)); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('Project config must contain valid JSON.'); throw error; }
  validateConfig(config);
  const result = {};
  const directory = path.dirname(path.resolve(file));
  for (const [key, value] of Object.entries(config)) {
    if (key === 'schemaVersion') continue;
    result[key] = ['suite', 'skill', 'out'].includes(key) ? path.resolve(directory, value) : value;
  }
  return result;
}

async function existing(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Check every existing directory component before creating project files. */
async function safeDirectory(directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  const segments = path.relative(current, absolute).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    const info = await existing(current);
    if (info?.isSymbolicLink()) throw new Error('Initialization refuses symbolic-link directory components. Choose a real directory.');
    if (info && !info.isDirectory()) throw new Error('Initialization target contains a non-directory component.');
  }
  return absolute;
}

/** Scaffold an editable project without changing existing files or reading secrets. */
export async function initialize(target = '.') {
  const directory = await safeDirectory(target);
  const configPath = path.join(directory, 'skilldelta.config.json');
  const workspace = path.join(directory, 'skilldelta');
  if (await existing(configPath) || await existing(workspace)) throw new Error('Initialization would overwrite an existing config or skilldelta directory. Choose an empty target or move the existing project.');

  // Read the fixed bundled assets before making any destination changes.
  const contents = await Promise.all(templateFiles.map(async file => [file, await readFile(path.join(examples, file), 'utf8')]));
  const config = { schemaVersion: 1, suite: 'skilldelta/suite.json', skill: 'skilldelta/edge-cases/SKILL.md', model: null, endpoint: null, trials: 3, seed: 42, maxOutputTokens: 4096, timeoutMs: 120000, image: 'node:22-alpine', out: '.skilldelta/run' };
  await mkdir(directory, { recursive: true });
  await safeDirectory(directory);
  const stage = path.join(directory, `.skilldelta-init-${randomUUID()}`);
  let published = false;
  try {
    await mkdir(path.join(stage, 'skilldelta'), { recursive: true });
    for (const [file, content] of contents) {
      const destination = path.join(stage, 'skilldelta', file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, { flag: 'wx' });
    }
    await writeFile(path.join(stage, 'skilldelta.config.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
    // Recheck immediately before publication; config uses an exclusive copy.
    await safeDirectory(directory);
    if (await existing(configPath) || await existing(workspace)) throw new Error('Initialization target changed; no existing files were overwritten.');
    await rename(path.join(stage, 'skilldelta'), workspace);
    published = true;
    await copyFile(path.join(stage, 'skilldelta.config.json'), configPath, constants.COPYFILE_EXCL);
    return { directory, configPath, created: ['skilldelta.config.json', ...templateFiles.map(file => `skilldelta/${file}`)] };
  } catch (error) {
    // Both paths are fixed children of the already checked target, never config input.
    if (published) await rm(workspace, { recursive: true, force: true });
    throw error;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

/** Check local readiness; never contact a model endpoint, execute tests, or pull images. */
export async function diagnose({ configPath, cwd = process.cwd(), options = {}, env = process.env, nodeVersion = process.versions.node, commandFn = command } = {}) {
  const checks = [];
  const add = (name, status, message) => checks.push({ name, status, message });
  const nodeMatch = typeof nodeVersion === 'string' && /^(\d+)\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.exec(nodeVersion);
  add('node', nodeMatch && Number(nodeMatch[1]) >= 22 ? 'pass' : 'fail', nodeMatch && Number(nodeMatch[1]) >= 22 ? 'Node.js 22 or newer is available.' : 'Install Node.js 22 or newer.');

  let settings = {};
  if (configPath) {
    try { settings = await loadProjectConfig(path.resolve(cwd, configPath)); add('config', 'pass', 'Project configuration is valid.'); }
    catch { add('config', 'fail', 'Cannot load a valid project config. Check the file, schemaVersion, supported settings, and value types.'); }
  } else add('config', 'warn', 'No project config selected. Run init or provide explicit run options.');
  settings = { ...settings, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  try { validateRunOptions(settings); }
  catch { add('settings', 'fail', 'Effective settings are invalid. Check supported options, numeric limits, and value types.'); }
  for (const key of ['suite', 'skill']) {
    if (typeof settings[key] !== 'string' || !settings[key].trim()) { add(key, 'fail', `Configure a ${key} file or provide --${key}.`); continue; }
    try {
      await (key === 'suite' ? loadSuite : loadSkill)(path.resolve(cwd, settings[key]));
      add(key, 'pass', key === 'suite' ? 'Suite and all declared test files are valid.' : 'Skill file can be read and is nonempty.');
    } catch { add(key, 'fail', key === 'suite' ? 'Suite validation failed. Check its JSON, file paths, and declared test files.' : 'Skill validation failed. Check the file path, size, and contents.'); }
  }
  add('model', typeof settings.model === 'string' && settings.model.trim() ? 'pass' : 'fail', typeof settings.model === 'string' && settings.model.trim() ? 'A model name is configured; provider support is not checked.' : 'Set model in the config or pass --model.');
  try { validateEndpoint(settings.endpoint); add('endpoint', 'pass', 'Endpoint URL is valid. Connectivity and provider compatibility are not checked.'); }
  catch { add('endpoint', 'fail', 'Set a valid HTTPS endpoint; plaintext HTTP is allowed only for loopback providers.'); }
  add('credentials', typeof env.SKILLDELTA_API_KEY === 'string' && env.SKILLDELTA_API_KEY.trim() ? 'pass' : 'warn', typeof env.SKILLDELTA_API_KEY === 'string' && env.SKILLDELTA_API_KEY.trim() ? 'SKILLDELTA_API_KEY is set. Its value and validity are not inspected.' : 'SKILLDELTA_API_KEY is not set. Only providers that accept unauthenticated requests can run.');

  const image = settings.image ?? 'node:22-alpine';
  const imageValid = typeof image === 'string' && image.length <= 512 && imagePattern.test(image);
  const invoke = async args => { try { return await commandFn('docker', args, { timeoutMs: 10000 }); } catch { return { code: -1, output: '' }; } };
  const version = await invoke(['--version']);
  let linux = false;
  if (version.code !== 0) add('docker', 'fail', 'Docker CLI is unavailable. Install Docker with Linux containers; demo does not require Docker.');
  else {
    const info = await invoke(['info', '--format', '{{.OSType}}']);
    linux = info.code === 0 && info.output?.trim() === 'linux';
    add('docker', linux ? 'pass' : 'fail', linux ? 'Docker daemon is available with Linux containers.' : 'Start Docker and enable Linux containers before a live run.');
  }
  if (!imageValid) add('image', 'fail', 'Configure a valid Docker image reference.');
  else if (!linux) add('image', 'warn', 'Image availability was not checked because Linux Docker is unavailable.');
  else {
    const inspect = await invoke(['image', 'inspect', image, '--format', '{{.Id}}']);
    const present = inspect.code === 0 && /^sha256:[a-f0-9]{64}$/.test(inspect.output?.trim() ?? '');
    add('image', present ? 'pass' : 'warn', present ? 'The verification image is already available locally.' : 'The verification image is not available locally. A live run will try to pull it; doctor never pulls images.');
  }
  return { ok: !checks.some(check => check.status === 'fail'), checks };
}
