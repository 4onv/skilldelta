import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { command } from './execute.mjs';
import { readSmall, safeFile } from './config.mjs';
import { makeMessages, parseFiles } from './provider.mjs';

async function defaultExecutable() {
  if (process.platform !== 'win32') return 'codex';
  const javascript = path.join(process.env.APPDATA ?? '', 'npm/node_modules/@openai/codex/bin/codex.js');
  try { if ((await stat(javascript)).isFile()) return javascript; } catch {}
  return 'codex.exe';
}

function validateRequest(input, label) {
  const task = input?.task;
  if (input?.schemaVersion !== 1 || input.model !== label ||
      !Number.isInteger(input.limits?.maxOutputTokens) || input.limits.maxOutputTokens < 64 ||
      input.limits.maxOutputTokens > 32768 || input.limits.temperature !== 0 ||
      !task || typeof task.prompt !== 'string' || !task.prompt.trim() ||
      !Array.isArray(task.editableFiles) || !task.editableFiles.length || task.editableFiles.length > 20 ||
      task.editableFiles.some(name => !safeFile(name)) ||
      new Set(task.editableFiles.map(name => name.toLowerCase())).size !== task.editableFiles.length ||
      task.editableFiles.some(name => task.editableFiles.some(other =>
        other !== name && other.toLowerCase().startsWith(name.toLowerCase() + '/'))) ||
      !task.starter || typeof task.starter !== 'object' || Array.isArray(task.starter) ||
      Object.entries(task.starter).some(([name,text]) => !task.editableFiles.includes(name) || typeof text !== 'string') ||
      !(input.skill === null || (typeof input.skill?.text === 'string' && input.skill.text.length > 0))) {
    throw new Error('Invalid SkillDelta HTTP v1 task or model label.');
  }
  return { task: { prompt: task.prompt, editableFiles: task.editableFiles, starter: task.starter },
    skillText: input.skill?.text ?? '' };
}

async function collect(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Request exceeds 1 MiB.');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

/** Start a loopback worker. Only --version runs during setup. Model calls start on POST /evaluate. */
export async function createCodexWorker({ model, executable, key, timeoutMs = 120000, commandFn = command } = {}) {
  if (typeof model !== 'string' || !model.trim() || model.length > 200 || model.includes('\0')) {
    throw new Error('Configure the actual Codex model with --model.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) {
    throw new Error('Worker timeout must be 1000 to 600000 ms.');
  }
  if (key !== undefined && (typeof key !== 'string' || !key || /[\r\n]/u.test(key))) {
    throw new Error('The worker key must be nonempty text without line breaks.');
  }
  const selected = executable ?? await defaultExecutable();
  if (typeof selected !== 'string' || !selected || selected.includes('\0')) throw new Error('Invalid Codex executable.');
  const javascript = selected.endsWith('.js') || selected.endsWith('.mjs');
  const program = javascript ? process.execPath : selected;
  const prefix = javascript ? [path.resolve(selected)] : [];
  const versionCheck = await commandFn(program, [...prefix, '--version'], { timeoutMs: 10000 });
  const version = /^codex-cli (\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?\s*$/u.exec(versionCheck.output.trim());
  if (versionCheck.code !== 0 || !version || (Number(version[1]) === 0 &&
      (Number(version[2]) < 167 || (Number(version[2]) === 167 && Number(version[3]) < 2)))) {
    throw new Error('Codex CLI 0.167.2 or newer is required. Check the executable or JavaScript entry point.');
  }
  const label = 'codex/' + versionCheck.output.trim().slice('codex-cli '.length) + '/' + model;
  let busy = false;

  const server = createServer({ requestTimeout: 30000, headersTimeout: 10000 }, async (request,response) => {
    const send = (status, payload) => {
      if (!response.destroyed) response.writeHead(status, { 'content-type':'application/json' }).end(JSON.stringify(payload));
    };
    if (request.method !== 'POST' || request.url !== '/evaluate') { send(404,{ error:'Not found.' }); return; }
    if (key && request.headers.authorization !== 'Bearer ' + key) { request.resume(); send(401,{ error:'Unauthorized.' }); return; }
    if (request.headers.origin || request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      request.resume(); send(415,{ error:'Send application/json from the evaluation client.' }); return;
    }
    if (busy) { request.resume(); send(409,{ error:'Worker is already handling an attempt.' }); return; }
    busy = true;
    const controller = new AbortController();
    const disconnected = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close',disconnected);
    let directory;
    let finalResponse;
    const finish = (status, payload) => { finalResponse = { status, payload }; };
    try {
      let input;
      try { input = validateRequest(await collect(request),label); }
      catch { finish(400,{ error:'Expected a valid HTTP v1 task and the printed model label.' }); return; }
      directory = await mkdtemp(path.join(tmpdir(),'skilldelta-codex-'));
      for (const name of input.task.editableFiles) {
        const target = path.join(directory,name);
        await mkdir(path.dirname(target),{ recursive:true });
        await writeFile(target,input.task.starter[name] ?? '');
      }
      const output = path.join(directory,'__skilldelta.output.json');
      const schema = path.join(directory,'__skilldelta.schema.json');
      await writeFile(schema,JSON.stringify({ type:'object',additionalProperties:false,required:['files'],
        properties:{ files:{ type:'object',additionalProperties:false,required:input.task.editableFiles,
          properties:Object.fromEntries(input.task.editableFiles.map(name=>[name,{ type:'string' }])) } } }));
      const prompt = makeMessages(input.task,input.skillText).map(message =>
        message.role.toUpperCase() + '\n' + message.content).join('\n\n');
      const result = await commandFn(program,[...prefix,'exec','--ignore-user-config',
        '--ephemeral','--skip-git-repo-check','--sandbox','read-only','--model',model,
        '--color','never','--output-schema',schema,'--output-last-message',output,'-'],{
        cwd:directory,input:prompt,timeoutMs,signal:controller.signal,
      });
      if (result.code !== 0 || result.timedOut || result.aborted) {
        finish(502,{ error:'Codex did not complete this attempt.' }); return;
      }
      const text = await readSmall(output,1024*1024);
      const files = parseFiles(text,input.task.editableFiles);
      finish(200,{ schemaVersion:1,files,usage:{ inputTokens:null,outputTokens:null } });
    } catch {
      finish(502,{ error:'Codex did not return a valid declared-file response.' });
    } finally {
      response.removeListener('close',disconnected);
      try {
        if (directory) await rm(directory,{ recursive:true,force:true,maxRetries:10,retryDelay:250 });
      } catch {
        server.emit('workerWarning', 'Could not remove the temporary workspace. Inspect ' + directory);
      } finally {
        busy = false;
        if (finalResponse) send(finalResponse.status, finalResponse.payload);
      }
    }
  });
  return { server, label };
}
