import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const fixtureModel = 'synthetic-fixtures';
const fixtureURL = new URL('./demo-solutions.json', import.meta.url);

export async function createMockAdapter() {
  const fixtures = JSON.parse(await readFile(fixtureURL, 'utf8'));
  return createServer({ requestTimeout: 10_000 }, async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/evaluate') {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (input?.schemaVersion !== 1 || input.model !== fixtureModel || typeof input.task?.id !== 'string' ||
          !Object.hasOwn(fixtures, input.task.id) ||
          !(input.skill === null || (typeof input.skill?.text === 'string' && input.skill.text.length > 0))) {
        response.writeHead(400).end();
        return;
      }
      const condition = input.skill === null ? 'baseline' : 'skill';
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        schemaVersion: 1, files: fixtures[input.task.id][condition], usage: { inputTokens: 0, outputTokens: 0 },
      }));
    } catch {
      if (!response.destroyed) response.writeHead(400).end();
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.argv[2] ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  const server = await createMockAdapter();
  server.listen(port, '127.0.0.1', () => {
    console.log('Synthetic SkillDelta adapter listening at http://127.0.0.1:' + port + '/evaluate');
    console.log('This example returns bundled fixtures and makes no model calls.');
  });
}
