#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createCodexWorker } from '../src/codex-worker.mjs';

async function main() {
  const { values } = parseArgs({ options:{
    model:{ type:'string' }, executable:{ type:'string' }, port:{ type:'string',default:'8788' },
    'timeout-ms':{ type:'string',default:'120000' }, help:{ type:'boolean',short:'h' },
  } });
  if (values.help) {
    console.log('Usage: skilldelta-codex --model MODEL [--executable FILE] [--port 8788] [--timeout-ms 120000]\nWorker key comes from SKILLDELTA_WORKER_KEY. Model requests begin when a client submits an evaluation task.');
    return;
  }
  const port = Number(values.port);
  if (!/^\d+$/u.test(values.port) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer from 1 to 65535.');
  }
  const { server,label,close } = await createCodexWorker({ model:values.model, executable:values.executable,
    key:process.env.SKILLDELTA_WORKER_KEY, timeoutMs:Number(values['timeout-ms']) });
  let stopping = false;
  const stop = status => {
    if (stopping) return;
    stopping = true;
    process.exitCode = status;
    void close();
  };
  process.on('SIGINT', () => stop(130));
  process.on('SIGTERM', () => stop(143));
  server.on('workerWarning',message => console.error(message));
  server.on('error',() => { console.error('Cannot listen on the loopback worker port.'); process.exitCode=2; });
  server.listen(port,'127.0.0.1',() => {
    console.log('Codex worker listening at http://127.0.0.1:' + port + '/evaluate');
    console.log('Use --adapter skilldelta-http-v1 --model ' + JSON.stringify(label));
    console.log('Requests use your Codex authentication and may incur provider charges.');
  });
}
main().catch(error => { console.error(error.message); process.exitCode=2; });
