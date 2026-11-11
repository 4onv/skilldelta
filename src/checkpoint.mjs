import { open, mkdir, readFile, rename, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';

const MAX_BYTES = 16 * 1024 * 1024;
export async function readCheckpoint(file) {
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);
  const handle = await open(file, flags);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Checkpoint must be a regular file smaller than 16 MiB.');
    const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_BYTES + 1));
    let size = 0;
    while (size < buffer.length) {
      const part = await handle.read(buffer, size, buffer.length - size, null);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    if (size > info.size || size > MAX_BYTES) throw new Error('Checkpoint changed while reading.');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))); }
    catch { throw new Error('Checkpoint must be valid UTF-8 JSON.'); }
  } finally { await handle.close(); }
}

export async function atomicJson(file, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Checkpoint exceeded 16 MiB.');
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(text);
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temporary, file);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** A lock is never removed automatically after an ungraceful process termination. */
export async function openRunDirectory(directory, { resume = false, artifacts = false } = {}) {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'checkpoint.json');
  const lock = path.join(directory, 'run.lock');
  const token = randomUUID();
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Output directory is locked. If its recorded process has stopped, remove run.lock and retry with --resume.');
    throw error;
  }
  const close = async () => {
    const saved = JSON.parse(await readFile(lock, 'utf8'));
    if (saved.token === token) await unlink(lock);
  };
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), token, createdAt: new Date().toISOString() }) + '\n');
    await handle.close(); handle = undefined;
    let checkpoint;
    if (artifacts) {
      try { await lstat(file); }
      catch (error) { if (error.code === 'ENOENT') return { close }; throw error; }
      throw new Error('Output directory contains a live checkpoint. Choose a different --out directory for demo or report.');
    }
    else if (resume) checkpoint = await readCheckpoint(file);
    else {
      for (const name of ['checkpoint.json', 'results.json', 'report.html', 'badge.svg']) {
        try { await lstat(path.join(directory, name)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw new Error('Output directory already contains run artifacts. Use --resume or choose a new --out directory.');
      }
    }
    return { checkpoint, write: value => atomicJson(file, value), close };
  } catch (error) {
    await handle?.close();
    await close().catch(() => {});
    throw error;
  }
}
