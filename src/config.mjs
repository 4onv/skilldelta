import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = text => createHash('sha256').update(text).digest('hex');
export function integer(value, name, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return n;
}
export function safeFile(name) {
  return typeof name === 'string' && name.length < 200 && /^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(name)
    && !name.split('/').some(p => p === '..' || p === '.' || !p)
    && !name.startsWith('__skilldelta') && !name.split('/').some(p => /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p));
}
export async function readSmall(file, limit = 256 * 1024) {
  if ((await stat(file)).size > limit) throw new Error(`File is too large: ${path.basename(file)}`);
  return readFile(file, 'utf8');
}
export async function loadSuite(file) {
  const root = await realpath(path.dirname(path.resolve(file)));
  const text = await readSmall(file);
  let suite;
  try { suite = JSON.parse(text); } catch { throw new Error('Suite must be valid JSON.'); }
  if (!suite || typeof suite.name !== 'string' || !Array.isArray(suite.tasks) || !suite.tasks.length || suite.tasks.length > 50) throw new Error('Suite needs a name and 1–50 tasks.');
  const ids = new Set();
  for (const task of suite.tasks) {
    if (!task || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(task.id) || ids.has(task.id)) throw new Error('Task IDs must be unique lowercase slugs.');
    ids.add(task.id);
    if (typeof task.title !== 'string' || typeof task.prompt !== 'string' || !task.prompt.trim()) throw new Error(`Task ${task.id} needs a title and prompt.`);
    if (!Array.isArray(task.editableFiles) || !task.editableFiles.length || task.editableFiles.length > 20 || task.editableFiles.some(f => !safeFile(f)) || new Set(task.editableFiles).size !== task.editableFiles.length) throw new Error(`Invalid editableFiles for ${task.id}.`);
    const folded = task.editableFiles.map(f => f.toLowerCase());
    if (new Set(folded).size !== folded.length || folded.some(f => folded.some(other => other !== f && other.startsWith(f + '/')))) throw new Error(`Conflicting editableFiles for ${task.id}.`);
    if (!task.starter || Array.isArray(task.starter) || typeof task.starter !== 'object' || Object.entries(task.starter).some(([k,v]) => !task.editableFiles.includes(k) || typeof v !== 'string')) throw new Error(`Invalid starter files for ${task.id}.`);
    if (!safeFile(task.testFile)) throw new Error(`Invalid testFile for ${task.id}.`);
    const testPath = await realpath(path.resolve(root, task.testFile));
    const relative = path.relative(root, testPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Test file escapes suite directory: ${task.id}.`);
    task.testSource = await readSmall(testPath);
    task.testSha256 = sha256(task.testSource);
    task.timeoutMs = integer(task.timeoutMs ?? 10000, 'task timeoutMs', 100, 120000);
  }
  return { ...suite, sha256: sha256(text) };
}
export async function loadSkill(file) {
  const text = await readSmall(file, 128 * 1024);
  if (!text.trim()) throw new Error('Skill file is empty.');
  return { text, name: path.basename(path.dirname(path.resolve(file))) + '/' + path.basename(file), sha256: sha256(text) };
}
export function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Provide a valid --endpoint URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) throw new Error('Endpoint must use HTTPS (HTTP is allowed only on loopback), without credentials, query, or fragment.');
  return url.href;
}
