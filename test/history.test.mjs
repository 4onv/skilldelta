import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runEvaluation } from '../src/runner.mjs';
import { sha256 } from '../src/config.mjs';
import { inspectEvaluation,compareEvaluations,listHistory } from '../src/history.mjs';

const suite={name:'Mock suite',sha256:sha256('suite'),tasks:[{id:'a',title:'Task A',prompt:'PRIVATE_PROMPT',editableFiles:['a.mjs'],starter:{},testSource:'PRIVATE_TEST',testSha256:sha256('test'),timeoutMs:1000}]};
const base={suite,skill:{name:'skill',text:'PRIVATE_SKILL',sha256:sha256('skill')},model:'mock',endpoint:'https://private.example/v1',image:'sha256:runtime',trials:2,
  generateFn:async()=>({files:{'a.mjs':'PRIVATE_SOURCE'},inputTokens:1,outputTokens:2}),checkFn:async()=>({passed:true,status:'passed'})};
const run=changes=>runEvaluation({...base,...changes});
const bin=fileURLToPath(new URL('../bin/skilldelta.mjs',import.meta.url));
function cli(args){const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;return spawnSync(process.execPath,[bin,...args],{encoding:'utf8',env,windowsHide:true,timeout:20000});}

test('changed skills are comparable while baseline, skill and effect changes remain separate',async()=>{
  const before=await run();let index=0;
  const after=await run({skill:{...base.skill,text:'revised',sha256:sha256('revised')},checkFn:async()=>{const passed=++index!==2;return {passed,status:passed?'passed':'failed'};}});
  const result=compareEvaluations(before,after);
  assert.equal(result.status,'comparable');assert.deepEqual(result.changes,{baselinePercentagePoints:0,skillPercentagePoints:-50,skillEffectPercentagePoints:-50,skillChanged:true});
  assert.equal(result.tasks[0].previousSkill,2);assert.equal(result.tasks[0].currentSkill,1);
  const reverse=compareEvaluations(after,before);assert.equal(reverse.changes.skillEffectPercentagePoints,50);
});
test('each non-skill input change invalidates comparisons including undisclosed endpoint and test source',async()=>{
  const before=await run();
  for(const change of [{endpoint:'https://other.example/v1'},{image:'sha256:other'},{model:'other'},{seed:43},{trials:3},{timeoutMs:3000},{maxOutputTokens:5000},{suite:{...suite,tasks:[{...suite.tasks[0],testSource:'other'}]}}]){
    const result=compareEvaluations(before,await run(change));assert.equal(result.status,'incompatible');assert.equal(result.changes,null);
  }
  const edited=structuredClone(await run());edited.settings.maxOutputTokens=6000;assert.equal(compareEvaluations(before,edited).status,'incompatible');
});
test('partial or errored runs never produce a trend even when complete pairs exist',async()=>{
  const before=await run(),controller=new AbortController();let completed=0;
  const partial=await run({signal:controller.signal,onProgress:r=>{if(r.phase==='complete'&&++completed===2)controller.abort();}});
  const error=await run({generateFn:async()=>{throw Error('private failure');}});
  for(const other of [partial,error]){const comparison=compareEvaluations(before,other);assert.equal(comparison.status,'inconclusive');assert.equal(comparison.changes,null);}
});
test('legacy files list but lack comparison identity; snapshots of one run cannot be compared',async()=>{
  const current=await run(),legacy=structuredClone(current);delete legacy.comparison;legacy.id='legacy';
  assert.equal(inspectEvaluation(legacy).complete,true);
  assert.equal(compareEvaluations(legacy,current).status,'incompatible');
  assert.equal(compareEvaluations(current,structuredClone(current)).status,'incompatible');
  const demo=structuredClone(await run());demo.mode='demo';assert.equal(compareEvaluations(current,demo).status,'incompatible');
  const demo2=structuredClone(await run());demo2.mode='demo';assert.equal(compareEvaluations(demo,demo2).simulated,true);
});
test('malformed, duplicate, missing and contradictory task progress cannot earn complete status',async()=>{
  const saved=await run();
  for(const change of [r=>r.results[1]=r.results[0],r=>r.results[0].trial=0,r=>r.results[0].taskId='missing',r=>r.results[0].passed=false,r=>r.results[0].durationMs=-1,r=>r.checkpoint.expectedResults=2,r=>r.checkpoint.complete=false,r=>r.suite.tests.push(r.suite.tests[0]),r=>r.comparison.inputsSha256='invalid']){
    const invalid=structuredClone(saved);change(invalid);assert.throws(()=>inspectEvaluation(invalid),/Invalid saved/);
  }
});
test('stored summaries and unexpected payloads cannot influence or leak into comparison',async()=>{
  const before=await run(),after=await run();after.summary={skill:{passRate:9999}};after.secret='PRIVATE_EXTRA';after.results[0].raw='PRIVATE_RAW';
  const result=compareEvaluations(before,after);assert.equal(result.changes.skillEffectPercentagePoints,0);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|private\.example|9999/);
});
test('history reads immediate folders, prefers checkpoints, keeps distinct paths and warns on bad files without writing',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'skilldelta-history-'));
  try{
    const saved=await run();await mkdir(path.join(dir,'run-a'));await mkdir(path.join(dir,'run-a','nested'));await mkdir(path.join(dir,'bad'));
    await writeFile(path.join(dir,'run-a','checkpoint.json'),JSON.stringify(saved));await writeFile(path.join(dir,'run-a','results.json'),'invalid stale result');
    await writeFile(path.join(dir,'run-a','nested','results.json'),JSON.stringify(await run()));await writeFile(path.join(dir,'bad','results.json'),'bad');
    const original=await readFile(path.join(dir,'run-a','checkpoint.json'),'utf8');const listing=await listHistory(dir);
    assert.equal(listing.runs.length,1);assert.match(listing.runs[0].file,/checkpoint\.json$/);assert.equal(listing.warnings.length,1);
    assert.equal(await readFile(path.join(dir,'run-a','checkpoint.json'),'utf8'),original);assert.deepEqual((await readdir(dir)).sort(),['bad','run-a']);
    const output=cli(['history',dir,'--json']);assert.equal(output.status,0,output.stderr);assert.equal(JSON.parse(output.stdout).runs.length,1);
    await assert.rejects(listHistory(path.join(dir,'missing')),/ENOENT/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('history skips symlinked evaluation files',{skip:process.platform==='win32'},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'skilldelta-history-links-'));
  try{
    const real=path.join(dir,'real');await mkdir(real);await writeFile(path.join(dir,'data.json'),JSON.stringify(await run()));
    await symlink(path.join(dir,'data.json'),path.join(real,'results.json'));
    assert.equal((await listHistory(real)).warnings.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('history rejects symlinked or junction roots',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'skilldelta-history-roots-'));
  try{const real=path.join(dir,'real'),alias=path.join(dir,'alias');await mkdir(real);await symlink(real,alias,process.platform==='win32'?'junction':'dir');await assert.rejects(listHistory(alias),/symlink/);}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI regression gate uses change in skill effect and rejects incomplete or mismatched runs',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'skilldelta-compare-'));
  try{
    const before=await run(),after=await run({checkFn:async()=>({passed:false,status:'failed'})});
    // Both conditions dropping equally leaves the measured skill effect unchanged.
    const a=path.join(dir,'a.json'),b=path.join(dir,'b.json');await writeFile(a,JSON.stringify(before));await writeFile(b,JSON.stringify(after));
    assert.equal(cli(['compare',a,b,'--fail-on-regression']).status,0);
    for(const row of after.results)if(row.condition==='baseline'){row.passed=true;row.status='passed';}
    await writeFile(b,JSON.stringify(after));const result=cli(['compare',a,b,'--json','--fail-on-regression']);assert.equal(result.status,1,result.stderr);assert.equal(JSON.parse(result.stdout).changes.skillEffectPercentagePoints,-100);
    delete after.comparison;await writeFile(b,JSON.stringify(after));assert.equal(cli(['compare',a,b]).status,2);
    assert.equal(cli(['compare',a]).status,2);assert.equal(cli(['history',dir,'--out','ignored']).status,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
