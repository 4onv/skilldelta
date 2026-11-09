import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { readCheckpoint } from './checkpoint.mjs';
import { summarize } from './runner.mjs';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.length <= 4096;
const token = value => value === null || Number.isSafeInteger(value) && value >= 0;
function invalid() { throw new Error('Invalid saved evaluation: check identity, task/trial pairs and progress metadata.'); }

/** Project only reviewed metadata; never trust a stored summary or arbitrary keys. */
export function inspectEvaluation(report) {
  if (!report || report.schemaVersion !== 1 || !text(report.id) || !report.id || !text(report.createdAt) || !Number.isFinite(Date.parse(report.createdAt)) ||
      !['demo','live'].includes(report.mode) || !text(report.skill?.name) || !hash(report.skill?.sha256) || !text(report.suite?.name) || !hash(report.suite?.sha256) ||
      !text(report.model) || !text(report.runtime) || !Number.isSafeInteger(report.seed) || report.seed < 0 || report.seed > 2147483647 ||
      !Number.isSafeInteger(report.trials) || report.trials < 1 || report.trials > 100 || !Array.isArray(report.suite.tests) ||
      !report.suite.tests.length || report.suite.tests.length > 50 || !Array.isArray(report.results) || report.results.length > 10000) invalid();
  const tasks=new Map();
  for (const task of report.suite.tests) {
    if(!task || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(task.id) || !hash(task.sha256) || tasks.has(task.id)) invalid();
    tasks.set(task.id,task.sha256);
  }
  const expected=tasks.size*report.trials*2, seen=new Set(), rows=[];
  for(const row of report.results) {
    if(!row || !tasks.has(row.taskId) || !text(row.taskTitle) || !Number.isSafeInteger(row.trial) || row.trial<1 || row.trial>report.trials ||
      !['baseline','skill'].includes(row.condition) || !['passed','failed','error'].includes(row.status) || row.passed!==(row.status==='passed') ||
      !token(row.inputTokens) || !token(row.outputTokens) || !Number.isSafeInteger(row.durationMs) || row.durationMs<0) invalid();
    const key=row.taskId+':'+row.trial+':'+row.condition;
    if(seen.has(key)) invalid(); seen.add(key);
    rows.push({taskId:row.taskId,taskTitle:row.taskTitle,trial:row.trial,condition:row.condition,status:row.status,passed:row.passed});
  }
  const cp=report.checkpoint;
  if(cp && (cp.version!==1 || !hash(cp.planSha256) || cp.expectedResults!==expected || cp.complete!==(rows.length===expected))) invalid();
  if(!cp && !rows.length) invalid();
  if(report.comparison && (report.comparison.version!==1 || !hash(report.comparison.inputsSha256))) invalid();
  if(report.settings && (!Number.isSafeInteger(report.settings.maxOutputTokens) || report.settings.maxOutputTokens<64 || report.settings.maxOutputTokens>32768 ||
      !Number.isSafeInteger(report.settings.timeoutMs) || report.settings.timeoutMs<1000 || report.settings.timeoutMs>600000 ||
      report.settings.temperature!==0 || !text(report.settings.ordering))) invalid();
  const summary=summarize(rows,expected);
  return {
    id:report.id,createdAt:report.createdAt,mode:report.mode,skill:{name:report.skill.name,sha256:report.skill.sha256},
    suite:{name:report.suite.name,sha256:report.suite.sha256,tests:report.suite.tests.map(t=>({id:t.id,sha256:t.sha256}))},
    model:report.model,runtime:report.runtime,seed:report.seed,trials:report.trials,
    settings:report.settings ? {maxOutputTokens:report.settings.maxOutputTokens,timeoutMs:report.settings.timeoutMs,temperature:report.settings.temperature,ordering:report.settings.ordering} : null,
    comparison:report.comparison ? {version:1,inputsSha256:report.comparison.inputsSha256} : null,
    completedResults:rows.length,expectedResults:expected,complete:rows.length===expected,summary,rows
  };
}

function publicRun(run) {
  const {rows,...metadata}=run;return metadata;
}

/** A conservative comparison of saved observations, never a significance test. */
export function compareEvaluations(previousInput,currentInput) {
  const previous=inspectEvaluation(previousInput),current=inspectEvaluation(currentInput),reasons=[];
  if(previous.id===current.id) reasons.push('Both files identify the same evaluation; use distinct runs.');
  if(previous.mode!==current.mode) reasons.push('Demo and live evaluations cannot be compared.');
  if(!previous.comparison || !current.comparison) reasons.push('Comparison identity is missing. Create new runs with SkillDelta 0.4 or newer.');
  else if(previous.comparison.inputsSha256!==current.comparison.inputsSha256) reasons.push('Evaluation inputs differ: keep suite, tests, provider, model, settings and runtime unchanged.');
  // Check disclosed fields too, so accidentally edited metadata cannot silently pass.
  if(JSON.stringify(previous.suite)!==JSON.stringify(current.suite) || previous.model!==current.model || previous.runtime!==current.runtime ||
      previous.seed!==current.seed || previous.trials!==current.trials || JSON.stringify(previous.settings)!==JSON.stringify(current.settings)) reasons.push('Recorded suite, model, runtime, seed, trial or settings metadata differs.');
  const result={schemaVersion:1,status:'incompatible',simulated:previous.mode==='demo'&&current.mode==='demo',previous:publicRun(previous),current:publicRun(current),reasons,changes:null,tasks:[]};
  if(reasons.length)return result;
  if(!previous.complete||!current.complete||previous.summary.errors||current.summary.errors){
    result.status='inconclusive';reasons.push('Both runs must be complete and free of provider/runtime errors.');return result;
  }
  result.status='comparable';
  result.changes={
    baselinePercentagePoints:(current.summary.baseline.passRate-previous.summary.baseline.passRate)*100,
    skillPercentagePoints:(current.summary.skill.passRate-previous.summary.skill.passRate)*100,
    skillEffectPercentagePoints:current.summary.deltaPercentagePoints-previous.summary.deltaPercentagePoints,
    skillChanged:previous.skill.sha256!==current.skill.sha256
  };
  result.tasks=previous.suite.tests.map(({id})=>{
    const before=summarize(previous.rows.filter(r=>r.taskId===id));
    const after=summarize(current.rows.filter(r=>r.taskId===id));
    return {id,previousBaseline:before.baseline.passed,currentBaseline:after.baseline.passed,previousSkill:before.skill.passed,currentSkill:after.skill.passed,trials:current.trials};
  });
  return result;
}

/** Read a root and its immediate run folders only. Never follow symlinks. */
export async function listHistory(directory) {
  const root=path.resolve(directory),info=await lstat(root);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('History root must be a regular directory, not a symlink.');
  const entries=await readdir(root,{withFileTypes:true});
  if(entries.length>1000)throw new Error('History root exceeds 1000 entries; choose a smaller directory.');
  const folders=entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>e.name).sort();
  if(folders.length>100)throw new Error('History supports at most 100 immediate run folders.');
  const runs=[],warnings=[];
  for(const folder of ['',...folders]) {
    const base=path.join(root,folder);let selected;
    for(const name of ['checkpoint.json','results.json']) {
      const file=path.join(base,name);
      try{
        const candidate=await lstat(file);
        if(!candidate.isFile()||candidate.isSymbolicLink()){warnings.push({file,message:'Skipped nonregular or symlinked evaluation.'});selected=null;break;}
        selected=file;break;
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    if(!selected)continue;
    try{runs.push({file:selected,...publicRun(inspectEvaluation(await readCheckpoint(selected)))});}
    catch{warnings.push({file:selected,message:'Skipped unreadable or invalid evaluation; inspect it explicitly.'});}
  }
  runs.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.file.localeCompare(b.file));
  return {schemaVersion:1,scope:'Root and immediate run folders; checkpoint preferred over results; no symlinks followed.',runs,warnings};
}
