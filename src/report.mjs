const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const count = (value) => Math.max(0, Math.floor(finite(value)));
const percent = (value) => `${Math.min(100, Math.max(0, finite(value))).toFixed(1).replace(/\.0$/, '')}%`;
const points = (value) => `${finite(value) > 0 ? '+' : ''}${finite(value).toFixed(1).replace(/\.0$/, '')}`;
const rate = (group) => count(group?.total) ? count(group?.passed) / count(group.total) * 100 : 0;
const state = (result) => !result ? 'missing' : result.status === 'error' ? 'error' : result.passed === true ? 'passed' : 'failed';
const formatNumber = (number) => new Intl.NumberFormat('en-US').format(number);
const duration = (ms) => ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

function hasIncompletePairs(results) {
  if (!Array.isArray(results) || !results.length) return true;
  const pairs = new Map();
  for (const result of results) {
    if (result.status === 'error' || !['baseline', 'skill'].includes(result.condition)) return true;
    const key = JSON.stringify([result.taskId, result.trial]);
    if (!pairs.has(key)) pairs.set(key, { baseline: 0, skill: 0 });
    pairs.get(key)[result.condition]++;
  }
  return [...pairs.values()].some((pair) => pair.baseline !== 1 || pair.skill !== 1);
}

function usage(results) {
  if (!results.length || results.some((run) => !Number.isFinite(run.inputTokens) || !Number.isFinite(run.outputTokens))) return 'Not reported';
  return formatNumber(results.reduce((total, run) => total + Math.max(0, run.inputTokens) + Math.max(0, run.outputTokens), 0));
}

function statusMarkup(result) {
  const value = state(result);
  const labels = { passed: 'Pass', failed: 'Fail', error: 'Error', missing: 'Missing' };
  return `<span class="status ${value}"><span aria-hidden="true">${value === 'passed' ? '✓' : value === 'failed' ? '×' : '–'}</span> ${labels[value]}</span>`;
}

function pairedRows(results) {
  const grouped = new Map();
  for (const result of results) {
    const key = JSON.stringify([result.taskId, result.trial]);
    if (!grouped.has(key)) grouped.set(key, { taskId: result.taskId, title: result.taskTitle || result.taskId, trial: result.trial });
    if (result.condition === 'baseline' || result.condition === 'skill') grouped.get(key)[result.condition] = result;
  }
  return [...grouped.values()].map((row, index) => {
    const before = state(row.baseline);
    const after = state(row.skill);
    const incomplete = [before, after].some((value) => value === 'error' || value === 'missing');
    const change = incomplete ? 'Incomplete' : before === after ? 'Unchanged' : after === 'passed' ? 'Improved' : 'Regressed';
    const detail = incomplete ? 'Run could not complete' : after === 'passed' && before !== 'passed' ? 'Skill only passed' : before === 'passed' && after !== 'passed' ? 'Baseline only passed' : after === 'passed' ? 'Both passed' : 'Both failed';
    return `<tr data-change="${change.toLowerCase()}" data-failed="${before === 'failed' || after === 'failed'}" data-error="${incomplete}">
      <td class="row-number">${String(index + 1).padStart(2, '0')}</td>
      <th scope="row"><span class="task-title">${esc(row.title)}</span><span class="task-detail">${esc(row.taskId)} · trial ${esc(row.trial)}</span></th>
      <td>${statusMarkup(row.baseline)}</td><td>${statusMarkup(row.skill)}</td>
      <td><span class="change ${change.toLowerCase()}">${change}</span><span class="task-detail">${detail}</span></td>
      <td class="numeric">${row.baseline ? duration(finite(row.baseline.durationMs)) : '—'}<span class="time-separator"> / </span>${row.skill ? duration(finite(row.skill.durationMs)) : '—'}</td>
    </tr>`;
  }).join('');
}

/** Build a portable report with no external scripts, assets, or network requests. */
export function renderReport(report) {
  const results = Array.isArray(report.results) ? report.results : [];
  const baseline = report.summary?.baseline ?? {};
  const skill = report.summary?.skill ?? {};
  const paired = report.summary?.paired ?? {};
  const delta = finite(report.summary?.deltaPercentagePoints);
  const isDemo = report.mode === 'demo';
  const baselineRuns = results.filter((run) => run.condition === 'baseline');
  const skillRuns = results.filter((run) => run.condition === 'skill');
  const baselineTime = baselineRuns.reduce((sum, run) => sum + Math.max(0, finite(run.durationMs)), 0);
  const skillTime = skillRuns.reduce((sum, run) => sum + Math.max(0, finite(run.durationMs)), 0);
  const taskCount = new Set(results.map((run) => run.taskId)).size;
  const complete = count(paired.wins) + count(paired.losses) + count(paired.ties);
  const inconclusive = report.checkpoint?.complete === false || report.checkpoint?.expectedResults > results.length || hasIncompletePairs(results);
  const deltaTone = inconclusive ? 'inconclusive' : delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>SkillDelta · ${esc(report.skill?.name || 'Skill comparison')}${isDemo ? ' · Demo' : ''}</title>
<style>
.inconclusive{color:var(--amber)!important}
:root{color-scheme:dark;--bg:#101211;--surface:#191c19;--raised:#20241f;--ink:#f1f2e8;--muted:#a2aa9e;--line:#32382e;--accent:#d0f586;--accent-ink:#192400;--purple:#aaa0ff;--red:#ffa19b;--amber:#e7c78d;--shadow:0 18px 50px #0002}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,select{font:inherit}button{cursor:pointer}a{color:inherit}button:focus-visible,a:focus-visible{outline:3px solid var(--purple);outline-offset:4px}main,.topbar,.footer{max-width:1160px;margin:auto;padding-left:36px;padding-right:36px}.topbar{min-height:102px;display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:1px solid var(--line)}.brand{font-size:23px;font-weight:750;letter-spacing:-1px;display:flex;gap:10px;align-items:center}.brand-mark{width:29px;height:31px;color:var(--accent)}.brand small{font:10px/1.1 monospace;letter-spacing:1px;color:var(--muted);border:1px solid var(--line);padding:5px 7px;margin-left:4px}.header-actions{display:flex;gap:9px}.small-button{background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:7px;padding:7px 11px;font-size:12px}.small-button:hover{color:var(--ink);background:var(--raised)}.demo-notice{margin-top:30px;border:1px solid #8b7040;background:#e8bc5b0c;color:var(--amber);border-radius:8px;display:flex;align-items:center;gap:14px;padding:13px 17px;font-size:13px}.demo-label{font:700 10px/1 monospace;letter-spacing:1.7px;border:1px solid currentColor;border-radius:4px;padding:5px 6px;white-space:nowrap}.eyebrow{text-transform:uppercase;letter-spacing:2px;font:11px/1.5 monospace;color:var(--muted)}.hero{padding-top:48px;padding-bottom:35px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:40px;align-items:end}.hero h1{font-weight:580;font-size:clamp(32px,5vw,54px);line-height:1.1;letter-spacing:-2px;margin:14px 0 18px;overflow-wrap:anywhere}.hero p{max-width:640px;color:var(--muted);margin:0;font-size:15px}.mode-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border:1px solid var(--line);border-radius:100px;font:11px monospace;white-space:nowrap}.mode-dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}.demo-dot{background:var(--amber)}.metadata{display:flex;gap:24px;flex-wrap:wrap;padding:17px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font:12px/1.6 monospace;color:var(--muted)}.metadata strong{font-weight:500;color:var(--ink);overflow-wrap:anywhere}.comparison{display:grid;grid-template-columns:1fr 1fr 1fr;margin-top:32px;border:1px solid var(--line);border-radius:13px;overflow:hidden;background:var(--surface);box-shadow:var(--shadow)}.comparison-card{padding:26px 27px;min-width:0}.comparison-card+.comparison-card{border-left:1px solid var(--line)}.card-label{font:11px monospace;color:var(--muted);letter-spacing:1.8px;text-transform:uppercase;display:flex;gap:9px;align-items:center}.swatch{width:8px;height:8px;background:var(--purple);border-radius:2px}.swatch.skill{background:var(--accent)}.score{font-size:clamp(35px,5vw,61px);font-weight:600;letter-spacing:-3px;line-height:1.3;margin:12px 0 1px}.score-unit{font:15px monospace;letter-spacing:0;color:var(--muted);margin-left:5px}.score-sub{font-size:12px;color:var(--muted)}.track{height:5px;background:var(--line);margin-top:22px;border-radius:5px;overflow:hidden}.fill{height:100%;background:var(--purple);border-radius:5px}.fill.skill{background:var(--accent)}.effect-card{background:linear-gradient(135deg,#d0f5860d,transparent)}.positive{color:var(--accent)}.negative{color:var(--red)}.neutral{color:var(--ink)}.effect-note{font:12px monospace;margin-top:17px;color:var(--muted)}.outcome{display:flex;justify-content:space-between;gap:24px;padding:25px 0 27px;border-bottom:1px solid var(--line)}.outcome-main{max-width:600px}.outcome-label{font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase}.outcome p{margin:6px 0 0;font-size:15px}.pair-counts{display:flex;gap:21px;flex-shrink:0}.pair-count{text-align:center;min-width:45px}.pair-count strong{font:23px monospace}.pair-count span{font-size:10px;text-transform:uppercase;letter-spacing:1px;display:block;color:var(--muted)}.pair-note{font-size:12px;color:var(--muted);margin:12px 0 0}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:37px 0 16px}.section-heading h2{font-size:18px;letter-spacing:-.4px;font-weight:600;margin:0}.section-heading p{font-size:12px;color:var(--muted);margin:4px 0 0}.filters{display:flex;gap:4px;background:var(--surface);padding:4px;border:1px solid var(--line);border-radius:8px}.filter{border:0;border-radius:5px;color:var(--muted);background:transparent;padding:5px 10px;font-size:11px}.filter[aria-pressed="true"]{color:var(--ink);background:var(--line)}.table-wrap{border:1px solid var(--line);border-radius:10px;overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px;text-align:left;white-space:nowrap}thead{background:var(--surface);color:var(--muted);font-size:10px;letter-spacing:.8px;text-transform:uppercase}th,td{padding:17px 17px;border-bottom:1px solid var(--line)}thead th{font-weight:500}tbody th{font-weight:500;max-width:320px;white-space:normal;min-width:180px}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:var(--surface)}.row-number{font:11px monospace;color:var(--muted);width:40px;padding-right:0}.task-title{font-size:13px;display:block;overflow-wrap:anywhere}.task-detail{display:block;font:10px/1.5 monospace;color:var(--muted);margin-top:4px;overflow-wrap:anywhere}.status{display:inline-flex;gap:5px;align-items:center;font:11px monospace;border-radius:5px;padding:5px 8px;border:1px solid var(--line)}.status.passed{color:var(--accent);background:#d0f5860b}.status.failed{color:var(--red);background:#ffa19b08}.status.error,.status.missing{color:var(--amber)}.change{font-size:11px}.change.improved{color:var(--accent)}.change.regressed{color:var(--red)}.change.incomplete{color:var(--amber)}.change.unchanged{color:var(--muted)}.numeric{font:11px monospace;text-align:right}.time-separator{color:var(--muted)}.empty{padding:28px;text-align:center;color:var(--muted);font-size:13px}.resources{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:30px 0}.resource-card{padding:20px 23px;border:1px solid var(--line);border-radius:9px}.resource-heading{font-size:12px;font-weight:600;margin-bottom:16px}.resource-values{display:grid;grid-template-columns:1fr 1fr;gap:15px}.resource-values span{display:block;font:10px monospace;color:var(--muted);margin-bottom:5px}.resource-values strong{font:18px monospace;font-weight:400}.resource-card p{font-size:11px;color:var(--muted);margin:15px 0 0}.method{padding:24px 26px;border:1px solid var(--line);border-radius:10px;margin:0 0 40px;background:var(--surface)}.method h2{font-size:13px;margin:0 0 10px}.method p{font-size:12px;color:var(--muted);max-width:950px;margin:8px 0}.method code{font:11px monospace;color:var(--ink);overflow-wrap:anywhere}.footer{border-top:1px solid var(--line);padding-top:23px;padding-bottom:32px;color:var(--muted);font:10px/1.7 monospace;display:flex;justify-content:space-between;gap:20px;overflow-wrap:anywhere}.footer span:last-child{text-align:right}[hidden]{display:none!important}
body.light{color-scheme:light;--bg:#f7f8f1;--surface:#fff;--raised:#eef1e7;--ink:#1e281b;--muted:#65705f;--line:#d9dfd1;--accent:#436b06;--accent-ink:#f6ffe4;--purple:#7160bd;--red:#ac302b;--amber:#866014;--shadow:0 18px 50px #18250005}
@media(max-width:760px){main,.topbar,.footer{padding-left:20px;padding-right:20px}.topbar{min-height:78px}.brand{font-size:20px}.brand small{display:none}.hero{grid-template-columns:1fr;gap:18px;padding-top:32px}.hero h1{letter-spacing:-1.4px}.hero .mode-chip{justify-self:start}.comparison{grid-template-columns:1fr 1fr}.comparison-card{padding:21px}.effect-card{grid-column:1/-1;display:grid;grid-template-columns:1fr auto;align-items:center;column-gap:10px}.effect-card.comparison-card{border-left:0;border-top:1px solid var(--line)}.effect-card .score{grid-column:2;grid-row:1/4;margin:0}.effect-note{margin-top:8px}.outcome{flex-direction:column}.pair-counts{justify-content:flex-start}.pair-count{text-align:left}.section-heading{align-items:flex-start;flex-direction:column}.filters{flex-wrap:wrap}.resources{grid-template-columns:1fr}.metadata{gap:10px 20px}.demo-notice{align-items:flex-start;font-size:12px}.footer{flex-direction:column;gap:8px}.footer span:last-child{text-align:left}}
@media print{body,body.light{--bg:#fff;--surface:#fff;--raised:#fff;--ink:#172013;--muted:#596252;--line:#d4dacd;--accent:#3c6900;--purple:#624fa0;--red:#a32222;--amber:#796018;--shadow:none;color-scheme:light}.header-actions,.filters{display:none}.topbar{min-height:60px}.hero{padding-top:25px;padding-bottom:20px}.hero h1{font-size:34px}.comparison,.method,.resources,.outcome{break-inside:avoid}.score{font-size:42px}.table-wrap{overflow:visible}th,td{padding:10px 8px}tr{break-inside:avoid}main,.topbar,.footer{max-width:none;padding-left:0;padding-right:0}.footer{font-size:9px}.demo-notice{margin-top:20px}.section-heading{margin-top:24px}}
</style></head><body>
<header class="topbar"><div class="brand"><svg class="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 3 30 28H2L16 3Z" stroke="currentColor" stroke-width="2.5"/><path d="m10 23 6-11 6 11" stroke="currentColor" stroke-width="2.5"/></svg>SkillDelta <small>REPORT / 01</small></div><div class="header-actions"><button type="button" id="theme" class="small-button" aria-label="Switch to light theme">Light theme</button><button type="button" id="print" class="small-button">Print / PDF</button></div></header>
<main>
${isDemo ? '<aside class="demo-notice" role="note"><span class="demo-label">DEMO</span><span><strong>Simulated outputs · real tests · not evidence of model performance</strong><br>This example demonstrates the report format. No model was evaluated.</span></aside>' : ''}
<section class="hero"><div><div class="eyebrow">A skill is a hypothesis. Test it.</div><h1>${esc(report.skill?.name || 'Skill comparison')}</h1><p>The same tasks. With and without the skill. Compare executable test outcomes, usage, and time in one place.</p></div><span class="mode-chip"><span class="mode-dot${isDemo ? ' demo-dot' : ''}"></span>${isDemo ? 'SIMULATED DEMONSTRATION' : 'LIVE EVALUATION'}</span></section>
<div class="metadata"><span>MODEL <strong>${esc(report.model || 'Not specified')}</strong></span><span>TASKS <strong>${taskCount}</strong></span><span>TRIALS / TASK <strong>${count(report.trials)}</strong></span><span>SEED <strong>${esc(report.seed)}</strong></span></div>
<section class="comparison" aria-label="Pass rate comparison">
<div class="comparison-card"><div class="card-label"><span class="swatch"></span>Without skill</div><div class="score">${percent(rate(baseline))}</div><div class="score-sub">${count(baseline.passed)} / ${count(baseline.total)} complete task runs passed</div><div class="track" role="img" aria-label="Baseline pass rate ${percent(rate(baseline))}"><div class="fill" style="width:${percent(rate(baseline))}"></div></div></div>
<div class="comparison-card"><div class="card-label"><span class="swatch skill"></span>With skill</div><div class="score">${percent(rate(skill))}</div><div class="score-sub">${count(skill.passed)} / ${count(skill.total)} complete task runs passed</div><div class="track" role="img" aria-label="Skill pass rate ${percent(rate(skill))}"><div class="fill skill" style="width:${percent(rate(skill))}"></div></div></div>
<div class="comparison-card effect-card"><div class="card-label">Observed difference</div><div class="score ${deltaTone}">${points(delta)}<span class="score-unit">pp</span></div><div class="score-sub">Percentage points, skill minus baseline</div><div class="effect-note${inconclusive ? ' inconclusive' : ''}">${inconclusive ? 'Inconclusive: resolve errors before comparing pass rates' : isDemo ? 'Illustrative result only' : 'Descriptive result · not a significance test'}</div></div>
</section>
<section class="outcome" aria-label="Comparison outcome"><div class="outcome-main"><span class="outcome-label">${isDemo ? 'Example outcome' : 'Observed outcome'}</span><p>${esc(report.summary?.verdict || 'Compare the task-level results before drawing conclusions.')}</p><div class="pair-note">${complete} completed pairs. Errors and missing runs are not wins, losses, or ties.</div></div><div class="pair-counts"><div class="pair-count"><strong class="positive">${count(paired.wins)}</strong><span>Skill wins</span></div><div class="pair-count"><strong class="negative">${count(paired.losses)}</strong><span>Skill losses</span></div><div class="pair-count"><strong>${count(paired.ties)}</strong><span>Ties</span></div></div></section>
<section id="results"><div class="section-heading"><div><h2>Every task, both conditions.</h2><p>One row per paired trial. A pass means the entire verification command succeeded.</p></div><div class="filters" role="group" aria-label="Filter task results"><button class="filter" type="button" data-filter="all" aria-pressed="true">All</button><button class="filter" type="button" data-filter="changed" aria-pressed="false">Changed</button><button class="filter" type="button" data-filter="failed" aria-pressed="false">Failures</button><button class="filter" type="button" data-filter="error" aria-pressed="false">Errors</button></div></div>
<div class="table-wrap"><table><thead><tr><th scope="col"><span aria-label="Row">#</span></th><th scope="col">Task / trial</th><th scope="col">Without skill</th><th scope="col">With skill</th><th scope="col">Outcome</th><th scope="col" class="numeric">Time · without / with</th></tr></thead><tbody>${pairedRows(results)}</tbody></table><div class="empty" id="empty"${results.length ? ' hidden' : ''}>No matching task runs.</div></div><p id="filter-count" class="pair-note" aria-live="polite"></p></section>
<section class="resources" aria-label="Resource usage"><div class="resource-card"><div class="resource-heading">Token usage</div><div class="resource-values"><div><span>WITHOUT SKILL</span><strong>${usage(baselineRuns)}</strong></div><div><span>WITH SKILL</span><strong>${usage(skillRuns)}</strong></div></div><p>Input + output tokens reported by the adapter. Missing usage is not treated as zero.${isDemo ? ' No model tokens were used in this demo.' : ''}</p></div><div class="resource-card"><div class="resource-heading">Total measured time</div><div class="resource-values"><div><span>WITHOUT SKILL</span><strong>${duration(baselineTime)}</strong></div><div><span>WITH SKILL</span><strong>${duration(skillTime)}</strong></div></div><p>Sum of recorded run durations. Environment and network conditions can affect timing.</p></div></section>
<section class="method"><h2>Read the result in context.</h2><p>Pass rates count complete task runs, not individual assertions. The percentage-point difference describes this suite and these trials; it is not a confidence interval or proof that the skill generalizes. Review errors, task coverage, and repeated runs before changing a workflow.</p><p>A paired win means only the skill condition passed. A loss means only the baseline passed. A tie means both completed with the same outcome. Inspect the JSON report for machine-readable run status; sensitive provider messages and execution logs are intentionally omitted here.</p><p>Skill content SHA-256 <code>${esc(report.skill?.sha256 || 'Unavailable')}</code></p></section>
</main><footer class="footer"><span>SkillDelta · evidence over intuition<br>Self-contained report · no external assets or telemetry</span><span>${esc(report.createdAt)}<br>RUN ${esc(report.id || 'unavailable')}</span></footer>
<script>
const rows = [...document.querySelectorAll('tbody tr')];
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  const filter = button.dataset.filter;
  let shown = 0;
  rows.forEach(row => {
    const visible = filter === 'all' || filter === 'changed' && ['improved', 'regressed'].includes(row.dataset.change) || filter === 'failed' && row.dataset.failed === 'true' || filter === 'error' && row.dataset.error === 'true';
    row.hidden = !visible;
    if (visible) shown++;
  });
  document.querySelectorAll('[data-filter]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  document.getElementById('empty').hidden = shown > 0;
  document.getElementById('filter-count').textContent = shown + ' of ' + rows.length + ' paired trials shown';
}));
document.getElementById('theme').addEventListener('click', event => {
  const light = document.body.classList.toggle('light');
  event.currentTarget.textContent = light ? 'Dark theme' : 'Light theme';
  event.currentTarget.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
});
document.getElementById('print').addEventListener('click', () => window.print());
</script></body></html>`;
}

/** An honest README badge: demo results are always visibly labeled. */
export function renderBadge(report) {
  const isDemo = report.mode === 'demo';
  const delta = finite(report.summary?.deltaPercentagePoints);
  const results = Array.isArray(report.results) ? report.results : [];
  const inconclusive = report.checkpoint?.complete === false || report.checkpoint?.expectedResults > results.length || hasIncompletePairs(results);
  const value = `${isDemo ? 'DEMO ' : ''}${inconclusive ? 'INCONCLUSIVE' : `${points(delta)} pp`}`;
  const width = inconclusive ? (isDemo ? 290 : 250) : isDemo ? 248 : 210;
  const rightWidth = width - 108;
  const fill = isDemo || inconclusive ? '#e7c78d' : delta < 0 ? '#ffa19b' : '#d0f586';
  const explanation = isDemo ? ' — simulated, not model evidence' : inconclusive ? ' — resolve errors or missing pairs before comparing pass rates' : ' observed pass-rate difference';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="32" role="img" aria-label="${esc(`SkillDelta: ${value}${explanation}`)}"><title>${esc(`SkillDelta: ${value}${explanation}`)}</title><rect width="${width}" height="32" rx="6" fill="#20241f"/><path d="M108 0h${rightWidth - 6}q6 0 6 6v20q0 6-6 6H108Z" fill="${fill}"/><g font-family="Verdana,Arial,sans-serif" font-size="11" text-anchor="middle"><text x="54" y="21" fill="#f1f2e8">SkillDelta</text><text x="${108 + rightWidth / 2}" y="21" fill="#192400">${esc(value)}</text></g></svg>\n`;
}
