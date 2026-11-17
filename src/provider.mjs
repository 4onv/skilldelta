export const defaultAdapter = 'chat-completions';
export const bridgeAdapter = 'skilldelta-http-v1';
export const adapterChoices = `${defaultAdapter} or ${bridgeAdapter}`;
export const invalidBridgeResponse = 'Adapter returned an invalid SkillDelta HTTP v1 response.';

export function validateAdapter(value = defaultAdapter) {
  if (value !== defaultAdapter && value !== bridgeAdapter) throw new Error(`Choose adapter ${adapterChoices}.`);
  return value;
}

export function makeMessages(task, skillText = '') {
  return [
    { role: 'system', content: 'Implement the coding task. Return ONLY a JSON object {"files":{"relative/path":"complete file contents"}}. Return every editable file, no other files. Do not include Markdown fences. Use only Node.js built-ins. No dependencies.\n' + (skillText ? `\nAdditional skill instructions:\n${skillText}` : '') },
    { role: 'user', content: JSON.stringify({ task: task.prompt, editableFiles: task.editableFiles, starter: task.starter }) }
  ];
}
export function parseFiles(content, allowed) {
  if (typeof content !== 'string' || content.length > 1024 * 1024) throw new Error('Model output missing or too large.');
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('Model did not return valid JSON.'); }
  if (!parsed || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'files')) throw new Error('Model must return exactly {"files":{...}}.');
  return validateFiles(parsed.files, allowed);
}

function validateFiles(files, allowed) {
  if (!files || Array.isArray(files) || typeof files !== 'object') throw new Error('Model must return exactly {"files":{...}}.');
  const entries = Object.entries(files);
  if (entries.length !== allowed.length || entries.some(([name, text]) => !allowed.includes(name) || typeof text !== 'string' || Buffer.byteLength(text) > 256 * 1024)) throw new Error('Model must return exactly the editable files, each under 256 KiB.');
  return files;
}

function adapterPayload(adapter, { task, skillText, model, maxOutputTokens }) {
  if (adapter === defaultAdapter) {
    return { model, messages: makeMessages(task, skillText), temperature: 0, max_tokens: maxOutputTokens };
  }
  const { id, prompt, editableFiles, starter } = task;
  return { schemaVersion: 1, model, limits: { maxOutputTokens, temperature: 0 },
    task: { id, prompt, editableFiles, starter }, skill: skillText ? { text: skillText } : null };
}

export async function generate({ adapter = defaultAdapter, endpoint, key, model, maxOutputTokens, timeoutMs, task, skillText, signal, fetchImpl = fetch }) {
  const payload = adapterPayload(validateAdapter(adapter), { task, skillText, model, maxOutputTokens });
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', signal: requestSignal,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(payload)
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Provider returned HTTP ${response.status}. Response body omitted to avoid leaking credentials.`); }
  if (!response.body) throw new Error('Provider returned invalid JSON.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Provider response exceeded 2 MiB.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw new Error('Provider returned invalid JSON.'); }
  const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (adapter === bridgeAdapter) {
    if (data?.schemaVersion !== 1 || !Object.hasOwn(data, 'files') ||
        Object.keys(data).some(key => !['schemaVersion', 'files', 'usage'].includes(key))) {
      throw new Error(invalidBridgeResponse);
    }
    return { files: validateFiles(data.files, task.editableFiles),
      inputTokens: token(data.usage?.inputTokens), outputTokens: token(data.usage?.outputTokens) };
  }
  const files = parseFiles(data?.choices?.[0]?.message?.content, task.editableFiles);
  return { files, inputTokens: token(data.usage?.prompt_tokens), outputTokens: token(data.usage?.completion_tokens) };
}
