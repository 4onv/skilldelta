import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport, renderBadge } from '../src/report.mjs';

const fixture = () => ({
  schemaVersion: 1, id: 'test-run', createdAt: '2026-11-01T00:00:00.000Z', mode: 'demo',
  skill: { name: 'Boundary-first implementation', sha256: 'a'.repeat(64) }, model: 'deterministic-demo', seed: 42, trials: 1,
  results: [
    { taskId: 'normalize', taskTitle: 'Normalize whitespace', trial: 1, condition: 'baseline', passed: false, status: 'failed', durationMs: 15, inputTokens: null, outputTokens: null },
    { taskId: 'normalize', taskTitle: 'Normalize whitespace', trial: 1, condition: 'skill', passed: true, status: 'passed', durationMs: 21, inputTokens: null, outputTokens: null },
  ], summary: { baseline: { passed: 0, total: 1, passRate: 0 }, skill: { passed: 1, total: 1, passRate: 1 }, deltaPercentagePoints: 100, paired: { wins: 1, losses: 0, ties: 0 }, verdict: 'Skill passed one additional task.' },
});

test('demo cannot be mistaken for measured model performance', () => {
  const html = renderReport(fixture());
  assert.match(html, /Simulated outputs · real tests · not evidence of model performance/);
  assert.match(html, /No model was evaluated/);
  assert.match(html, /SIMULATED DEMONSTRATION/);
  assert.match(renderBadge(fixture()), /DEMO \+100 pp/);
  assert.match(renderBadge(fixture()), /simulated, not model evidence/);
});

test('live reports describe observation without a significance claim', () => {
  const report = fixture(); report.mode = 'live';
  const html = renderReport(report);
  assert.match(html, /LIVE EVALUATION/);
  assert.match(html, /not a significance test/);
  assert.doesNotMatch(html, /SIMULATED DEMONSTRATION/);
  assert.doesNotMatch(renderBadge(report), /DEMO/);
});

test('all interpolated report text is escaped and cannot close the script element', () => {
  const report = fixture();
  const attack = '</script><script>alert("xss")</script><img src=x onerror=alert(1)>&\'';
  report.skill = { name: attack, sha256: attack }; report.model = attack; report.id = attack;
  report.createdAt = attack; report.seed = attack; report.summary.verdict = attack;
  report.results[0].taskId = attack; report.results[0].taskTitle = attack; report.results[0].trial = attack;
  const html = renderReport(report);
  assert.doesNotMatch(html, /<script>alert|<img src=x|<\/script><script>/);
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;alert\(&quot;xss&quot;\)/);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
});

test('provider errors and arbitrary extra properties are never embedded', () => {
  const report = fixture();
  report.results[0].status = 'error'; report.results[0].error = 'SECRET_PROVIDER_TOKEN_123';
  report.providerKey = 'OTHER_SECRET_456';
  const html = renderReport(report);
  assert.doesNotMatch(html, /SECRET_PROVIDER_TOKEN|OTHER_SECRET/);
  assert.match(html, /Run could not complete/);
  assert.match(html, /data-error="true"/);
});

test('pairs are matched by task ID and trial, never by position', () => {
  const report = fixture(); report.results.reverse();
  const html = renderReport(report);
  assert.equal((html.match(/<tr data-change=/g) || []).length, 1);
  assert.match(html, /data-change="improved"/);
  assert.match(html, /Skill only passed/);
});

test('missing counterparts show incomplete, not wins', () => {
  const report = fixture(); report.results = [report.results[1]];
  const html = renderReport(report);
  assert.match(html, /data-change="incomplete"/);
  assert.match(html, /> Missing<\/span>/);
  assert.doesNotMatch(html, /Skill only passed/);
});

test('unknown token usage is not presented as zero', () => {
  const html = renderReport(fixture());
  assert.equal((html.match(/<strong>Not reported<\/strong>/g) || []).length, 2);
});

test('numeric injection and non-finite values never reach CSS or SVG', () => {
  const report = fixture();
  report.summary.deltaPercentagePoints = '<script>bad</script>';
  report.summary.baseline.passed = Infinity; report.summary.baseline.total = 0;
  const html = renderReport(report); const badge = renderBadge(report);
  assert.doesNotMatch(html, /NaN|Infinity|<script>bad/);
  assert.doesNotMatch(badge, /NaN|Infinity|<script>bad/);
  assert.match(html, /style="width:0%"/);
  assert.match(badge, /DEMO 0 pp/);
});

test('report is portable and provides accessible local controls', () => {
  const html = renderReport(fixture());
  assert.doesNotMatch(html, /<(?:script|link|img)[^>]+(?:src|href)="https?:/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="Filter task results"/);
  assert.match(html, /@media print/);
  assert.match(html, /default-src 'none'/);
});

test('infrastructure errors make live badges inconclusive with no delta', () => {
  const report = fixture(); report.mode = 'live'; report.results[0].status = 'error';
  const badge = renderBadge(report);
  assert.match(badge, /INCONCLUSIVE/);
  assert.match(badge, /fill="#e7c78d"/);
  assert.doesNotMatch(badge, /\+100 pp|fill="#d0f586"/);
  const html = renderReport(report);
  assert.match(html, /Inconclusive: resolve errors before comparing pass rates/);
  assert.match(html, /class="score inconclusive"/);
  assert.doesNotMatch(html, /class="score positive"/);
});

test('missing pairs cannot earn a positive badge', () => {
  const report = fixture(); report.mode = 'live'; report.results = [report.results[1]];
  assert.match(renderBadge(report), /INCONCLUSIVE/);
  assert.doesNotMatch(renderBadge(report), /\+100 pp/);
  assert.match(renderReport(report), /class="score inconclusive"/);
});

test('empty and duplicate pairs are inconclusive', () => {
  const report = fixture(); report.mode = 'live';
  report.results.push({ ...report.results[0] });
  assert.match(renderBadge(report), /INCONCLUSIVE/);
  report.results = [];
  assert.match(renderBadge(report), /INCONCLUSIVE/);
});

test('demo makes no simulated token usage claim', () => {
  const html = renderReport(fixture());
  assert.match(html, /No model tokens were used in this demo/);
  assert.doesNotMatch(html, /Demo usage is simulated/);
});
