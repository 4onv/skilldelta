import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeFile } from '../src/config.mjs';

const bin = fileURLToPath(new URL('../bin/skilldelta.mjs', import.meta.url));
function cli(args, cwd) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS;
  const output = spawnSync(process.execPath,[bin,...args],{cwd,env,encoding:'utf8',windowsHide:true,timeout:40000});
  assert.ifError(output.error); return output;
}
test('initialized project uses config-relative files and explicit CLI overrides from another directory', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'skilldelta-cli-'));
  try {
    const project = path.join(directory,'project');
    const init = cli(['init',project],directory); assert.equal(init.status,0,init.stderr);
    const configPath = path.join(project,'skilldelta.config.json');
    const config = JSON.parse(await readFile(configPath,'utf8'));
    config.model='fixture-model'; config.endpoint='https://example.com/v1/chat/completions'; config.trials=5;
    await writeFile(configPath,JSON.stringify(config));
    const auto = cli(['run','--dry-run'],project); assert.equal(auto.status,0,auto.stderr); assert.match(auto.stdout,/30 provider requests/);
    const elsewhere = cli(['run','--config',configPath,'--trials','2','--dry-run'],directory);
    assert.equal(elsewhere.status,0,elsewhere.stderr); assert.match(elsewhere.stdout,/12 provider requests/);
    for (const overrides of [['--image=--privileged'], ['--model',' ']]) {
      const invalid = cli(['run','--config',configPath,'--dry-run',...overrides],directory);
      assert.equal(invalid.status,2); assert.doesNotMatch(invalid.stdout,/Validation passed/);
    }
    const diagnosis = cli(['doctor','--config',configPath,'--trials','2','--json'],directory);
    assert.ok([0,2].includes(diagnosis.status),diagnosis.stderr);
    const readiness = JSON.parse(diagnosis.stdout);
    assert.ok(!readiness.checks.some(check => check.name === 'settings' && check.status === 'fail'));
    for(const name of ['config','suite','skill','model','endpoint']) assert.equal(readiness.checks.find(check=>check.name===name)?.status,'pass');
    const original = await readFile(configPath,'utf8');
    assert.equal(cli(['init',project],directory).status,2);
    assert.equal(await readFile(configPath,'utf8'),original);
  } finally { await rm(directory,{recursive:true,force:true,maxRetries:3}); }
});
test('config validation fails safely before any live execution', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'skilldelta-config-cli-'));
  try {
    await writeFile(path.join(directory,'skilldelta.config.json'),JSON.stringify({schemaVersion:1,apiKey:'DO_NOT_PRINT_THIS_SECRET'}));
    const result=cli(['run','--dry-run'],directory);
    assert.equal(result.status,2); assert.ok(!result.stderr.includes('DO_NOT_PRINT_THIS_SECRET')); assert.match(result.stderr,/Unknown project config/);
    const absent=path.join(directory,'absent'); await mkdir(absent);
    assert.equal(cli(['run','--config','missing.json','--dry-run'],absent).status,2);
    assert.equal(cli(['demo','--config','missing.json'],absent).status,2);
  } finally { await rm(directory,{recursive:true,force:true,maxRetries:3}); }
});
test('generated paths reject Windows aliases and reserved verifier case variants', () => {
  for(const name of ['solution.mjs.','dir./solution.mjs','__SKILLDELTA.test.mjs','CON.txt','a/../solution.mjs']) assert.equal(safeFile(name),false,name);
  assert.equal(safeFile('src/solution.mjs'),true);
});
