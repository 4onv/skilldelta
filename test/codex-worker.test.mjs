import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodexWorker } from '../src/codex-worker.mjs';
import { generate } from '../src/provider.mjs';
import { command } from '../src/execute.mjs';

async function fixture(t,{timeoutMs=10000,key}={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'skilldelta-fake-codex-'));
  const executable=path.join(directory,'fake-codex.mjs');
  await writeFile(executable, String.raw`
    import assert from 'node:assert/strict';
    import {readFileSync,writeFileSync,existsSync} from 'node:fs';
    const args=process.argv.slice(2);
    if(args[0]==='--version'){console.log('codex-cli 0.167.2');process.exit(0);}
    assert.equal(args[0],'exec');
    assert.ok(args.includes('--ephemeral'));
    assert.ok(args.includes('--ignore-user-config'));
    assert.equal(args[args.indexOf('--sandbox')+1],'read-only');
    assert.equal(args[args.indexOf('--model')+1],'fake-model');
    assert.equal(args.at(-1),'-');
    const schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));
    assert.deepEqual(schema.properties.files.required,['solution.mjs']);
    const prompt=readFileSync(0,'utf8');
    assert.ok(prompt.startsWith('SYSTEM\n'));
    assert.ok(!prompt.includes('HIDDEN_VERIFIER_SENTINEL'));
    assert.ok(!prompt.includes('EXTRA_PRIVATE_FIELD'));
    assert.equal(readFileSync('solution.mjs','utf8'),'// starter');
    assert.equal(existsSync('__skilldelta.test.mjs'),false);
    if(prompt.includes('HANG_FOR_TEST')) await new Promise(()=>setInterval(()=>{},1000));
    if(prompt.includes('FAIL_FOR_TEST')){console.error('PRIVATE_NATIVE_LOG');process.exit(7);}
    const answer=prompt.includes('SKILL_ONLY')?42:0;
    const file=args[args.indexOf('--output-last-message')+1];
    writeFileSync(file,JSON.stringify({files:{'solution.mjs':'export const answer='+answer+';'}}));
    console.log('PRIVATE_NATIVE_LOG');
  `);
  const worker=await createCodexWorker({model:'fake-model',executable,key,timeoutMs});
  await new Promise(resolve=>worker.server.listen(0,'127.0.0.1',resolve));
  const endpoint='http://127.0.0.1:'+worker.server.address().port+'/evaluate';
  t.after(async()=>{
    worker.server.closeAllConnections();
    await new Promise(resolve=>worker.server.close(resolve));
    await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  });
  const task={id:'answer',prompt:'Export answer.',editableFiles:['solution.mjs'],starter:{'solution.mjs':'// starter'},
    testSource:'HIDDEN_VERIFIER_SENTINEL',extra:'EXTRA_PRIVATE_FIELD'};
  const request={adapter:'skilldelta-http-v1',endpoint,model:worker.label,task,timeoutMs:10000,maxOutputTokens:100};
  return {worker,endpoint,request};
}

test('Codex worker runs a real subprocess through the HTTP v1 adapter with fresh public inputs',async t=>{
  const {request,worker}=await fixture(t);
  assert.equal(worker.label,'codex/0.167.2/fake-model');
  const baseline=await generate(request);
  const skill=await generate({...request,skillText:'SKILL_ONLY'});
  assert.equal(baseline.files['solution.mjs'],'export const answer=0;');
  assert.equal(skill.files['solution.mjs'],'export const answer=42;');
  assert.equal(skill.inputTokens,null);
  assert.equal(skill.outputTokens,null);
  assert.doesNotMatch(JSON.stringify(skill),/PRIVATE_NATIVE_LOG/);
});

test('worker rejects the wrong model, invalid paths, cross-origin requests and missing authentication',async t=>{
  const {request,endpoint}=await fixture(t,{key:'TEST_KEY'});
  await assert.rejects(generate(request),/HTTP 401/);
  await assert.rejects(generate({...request,key:'TEST_KEY',model:'wrong'}),/HTTP 400/);
  await assert.rejects(generate({...request,key:'TEST_KEY',task:{...request.task,editableFiles:['../escape.mjs']}}),/HTTP 400/);
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer TEST_KEY',origin:'https://example.invalid'},body:'{}'});
  assert.equal(response.status,415);
  const passed=await generate({...request,key:'TEST_KEY'});
  assert.equal(passed.files['solution.mjs'],'export const answer=0;');
});

test('native errors and worker timeouts return fixed HTTP errors without leaking native logs',async t=>{
  const {request}=await fixture(t,{timeoutMs:1000});
  for(const prompt of ['FAIL_FOR_TEST','HANG_FOR_TEST']){
    await assert.rejects(generate({...request,task:{...request.task,prompt}}),error=>{
      assert.match(error.message,/HTTP 502/);
      assert.doesNotMatch(error.message,/PRIVATE_NATIVE_LOG/);
      return true;
    });
  }
});

test('worker startup checks the CLI version without issuing an exec request',async()=>{
  const seen=[];
  const {label,server}=await createCodexWorker({model:'fake-model',executable:'codex',
    commandFn:async(executable,args)=>{seen.push({executable,args});return {code:0,output:'codex-cli 0.167.2'};}});
  assert.equal(label,'codex/0.167.2/fake-model');
  assert.deepEqual(seen,[{executable:'codex',args:['--version']}]);
  assert.equal(server.listening,false);
  await assert.rejects(createCodexWorker({model:'fake-model',commandFn:async()=>({code:0,output:'codex-cli 0.166.0'})}),/0.167.2/);
});

test('a disconnected evaluation cancels its subprocess and releases the worker for the next attempt',async t=>{
  const {request}=await fixture(t);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),300);
  try {
    await assert.rejects(generate({...request,task:{...request.task,prompt:'HANG_FOR_TEST'},signal:controller.signal}),/abort/i);
  } finally { clearTimeout(timer); }
  let recovered=false;
  for(let attempt=0;attempt<30;attempt++){
    try {
      const result=await generate(request);
      assert.equal(result.files['solution.mjs'],'export const answer=0;');
      recovered=true;
      break;
    } catch(error){
      if(!/HTTP 409/u.test(error.message)) throw error;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  assert.equal(recovered,true,'The worker stayed busy after cancellation.');
});

test('subprocess stdin preserves large prompts without command-line arguments or startup hooks',async()=>{
  const input='input '.repeat(20000);
  const result=await command(process.execPath,['--input-type=module','-e',
    "import {readFileSync} from 'node:fs'; console.log(readFileSync(0,'utf8').length);"],{
      input,timeoutMs:10000,env:{...process.env,NODE_OPTIONS:'--require=missing-hook',NODE_TEST_CONTEXT:'child-v8'},
    });
  assert.equal(result.code,0,result.output);
  assert.equal(result.output.trim(),String(input.length));
});
