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
  if (!parsed || Object.keys(parsed).length !== 1 || !parsed.files || Array.isArray(parsed.files) || typeof parsed.files !== 'object') throw new Error('Model must return exactly {"files":{...}}.');
  const entries = Object.entries(parsed.files);
  if (entries.length !== allowed.length || entries.some(([name, text]) => !allowed.includes(name) || typeof text !== 'string' || Buffer.byteLength(text) > 256 * 1024)) throw new Error('Model must return exactly the editable files, each under 256 KiB.');
  return parsed.files;
}
export async function generate({ endpoint, key, model, maxOutputTokens, timeoutMs, task, skillText, signal, fetchImpl = fetch }) {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', signal: requestSignal,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, messages: makeMessages(task, skillText), temperature: 0, max_tokens: maxOutputTokens })
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Provider returned HTTP ${response.status}. Response body omitted to avoid leaking credentials.`); }
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
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Provider returned invalid JSON.'); }
  const files = parseFiles(data.choices?.[0]?.message?.content, task.editableFiles);
  const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { files, inputTokens: token(data.usage?.prompt_tokens), outputTokens: token(data.usage?.completion_tokens) };
}
