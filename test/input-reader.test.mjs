import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSmall, loadSkill, loadSuite, sha256 } from '../src/config.mjs';
import { loadProjectConfig } from '../src/onboarding.mjs';

async function project(t) {
  const directory = await mkdtemp(path.join(tmpdir(),'skilldelta-reader-'));
  t.after(() => rm(directory,{ recursive:true,force:true,maxRetries:4,retryDelay:100 }));
  const suite = { name:'Reader contract',tasks:[{id:'answer',title:'Answer',prompt:'Export answer=42',
    editableFiles:['solution.mjs'],starter:{'solution.mjs':''},testFile:'checks.mjs'}] };
  await writeFile(path.join(directory,'suite.json'),JSON.stringify(suite));
  await writeFile(path.join(directory,'checks.mjs'),'// held-out verifier');
  await writeFile(path.join(directory,'SKILL.md'),'Use all cases.\r\n');
  await writeFile(path.join(directory,'config.json'),JSON.stringify({schemaVersion:1,suite:'suite.json',
    skill:'SKILL.md',model:'local-test',endpoint:'https://example.invalid/v1/chat/completions'}));
  return directory;
}

test('valid Unicode, CRLF and existing BOM-bearing skill fingerprints remain byte-compatible',async t=>{
  const directory=await project(t);
  const file=path.join(directory,'SKILL.md');
  const text='\uFEFFCheck café and 雪.\r\n';
  await writeFile(file,text);
  assert.equal(await readSmall(file),text);
  const skill=await loadSkill(file);
  assert.equal(skill.text,text);
  assert.equal(skill.sha256,sha256(text));
  await writeFile(file,'x'.repeat(128*1024));
  assert.equal((await loadSkill(file)).text.length,128*1024);
  await writeFile(file,'x'.repeat(128*1024+1));
  await assert.rejects(loadSkill(file),/too large/);
});

test('invalid UTF-8 is rejected in suite, skill, verifier and configuration inputs',async t=>{
  for(const [name,load] of [
    ['suite.json',directory=>loadSuite(path.join(directory,'suite.json'))],
    ['SKILL.md',directory=>loadSkill(path.join(directory,'SKILL.md'))],
    ['checks.mjs',directory=>loadSuite(path.join(directory,'suite.json'))],
    ['config.json',directory=>loadProjectConfig(path.join(directory,'config.json'))],
  ]){
    const directory=await project(t);
    await writeFile(path.join(directory,name),Buffer.from([65,255]));
    await assert.rejects(load(directory),/valid UTF-8/);
  }
});

test('directories fail through the shared reader without attempting a text read',async t=>{
  const directory=await project(t);
  await assert.rejects(readSmall(directory),/regular file/);
});

test('CLI dry run rejects bad skill bytes before Docker or provider requests',async t=>{
  const directory=await project(t);
  await writeFile(path.join(directory,'SKILL.md'),Buffer.from([255]));
  const bin=fileURLToPath(new URL('../bin/skilldelta.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[bin,'run','--config',path.join(directory,'config.json'),'--dry-run'],{
    encoding:'utf8',timeout:10000,windowsHide:true,
  });
  assert.equal(result.status,2,result.stdout);
  assert.match(result.stderr,/valid UTF-8/);
  assert.doesNotMatch(result.stdout,/Preparing Docker|Validation passed/);
});

test('suite, skill, verifier and config pipes are rejected promptly through their normal entry points',
  {skip:process.platform==='win32'},async t=>{
  const bin=fileURLToPath(new URL('../bin/skilldelta.mjs',import.meta.url));
  for(const name of ['suite.json','SKILL.md','checks.mjs','config.json']){
    const directory=await project(t);
    const file=path.join(directory,name);
    await rm(file);
    execFileSync('mkfifo',[file]);
    const result=spawnSync(process.execPath,[bin,'run','--config',path.join(directory,'config.json'),'--dry-run'],{
      encoding:'utf8',timeout:5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status,2);
    assert.match(result.stderr,/regular file/);
  }
});
