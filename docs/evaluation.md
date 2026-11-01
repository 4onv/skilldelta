# Building a useful evaluation

SkillDelta asks a narrow question: does adding this skill's text help this model produce code that passes these tests?

Version 0.1 evaluates single-turn file generation. It does not measure whether an agent discovers the right skill, follows linked references, invokes tools correctly, or recovers from failures across a conversation.

## A run, step by step

1. Load the suite and skill file, and validate their inputs.
2. For each task and trial, generate a baseline answer and a skill-conditioned answer, alternating which condition runs first. The seed controls that alternation's starting parity; it is not a model random seed.
3. Accept only file outputs allowed by the task. Each answer begins from the same starter files.
4. Add the held-out test file after generation and execute it in a fresh verification container.
5. Record the complete task outcome, timing, and token counts when the provider supplies them.
6. Produce a task pass-rate comparison and count paired wins, losses, and ties.

The report records hashes of the skill, suite, and test sources, plus the resolved verification image ID. Keep the source files and model identifier under version control too. A model name alone does not guarantee that a hosted provider will preserve the same model forever.

## Write a task suite

The suite is JSON. Test-file paths are relative to the suite file:

```json
{
  "name": "My JavaScript evaluation",
  "tasks": [
    {
      "id": "example",
      "title": "Implement example",
      "prompt": "Export example(value) from solution.mjs. Return value unchanged.",
      "starter": {
        "solution.mjs": "export function example(value) { throw new Error('TODO'); }\n"
      },
      "editableFiles": ["solution.mjs"],
      "testFile": "tasks/example.checks.mjs",
      "timeoutMs": 10000
    }
  ]
}
```

Tests use the Node.js test runner. The verifier copies the test to `__skilldelta.test.mjs` beside the generated files, so import the solution relative to that location:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { example } from './solution.mjs';

test('returns the original value', () => {
  const value = { answer: 42 };
  assert.equal(example(value), value);
});
```

For the default image, use self-contained JavaScript and Node built-ins. Dependencies are not installed automatically, and verification has no network access. The initial release is deliberately a JavaScript code-generation harness rather than a general polyglot agent runner.

Write a complete public task contract. Hidden tests should enforce stated behavior, not surprise the model with undocumented requirements. Include ordinary examples and edge cases. A task counts as passed only if the full test command succeeds; adding more assertions to one task does not give that task more weight in the report.

## Write the skill

Pass a Markdown file with `--skill`. The full text is included only in the skill condition. Referenced files, scripts, and links are not automatically loaded or executed.

A useful skill describes a general method. Avoid copying task answers or giving it hidden evaluation data. Otherwise, the experiment measures answer leakage rather than a reusable instruction's benefit.

## Interpret the comparison

Each condition's pass rate is:

```text
complete task trials that passed / all task trials in that condition
```

The delta is the skill pass rate minus the baseline pass rate, expressed in percentage points. A paired win means the skill answer passed where the matching baseline answer did not; a loss is the reverse. Pairs containing a provider or runtime error are excluded from wins, losses, and ties. Errors remain in the pass-rate denominator as non-passing outcomes, and any error makes the aggregate verdict **inconclusive**. Do not interpret such a delta as a model-quality difference without resolving the errors.

These are descriptive results. The report does not assert statistical significance, calculate a confidence interval, or establish causality beyond the controlled inputs of this run. Repetitions of the same task are not independent coverage of new tasks. A tiny suite can easily reward a skill tailored to its examples.

Use several representative tasks, repeat runs, and keep a separate suite for checking generalization. Preserve negative results. When publishing, state the model, skill hash, suite revision, trial count, and any provider or runner errors.

## Costs and reproducibility

The planned call count is tasks × trials × two conditions. `--dry-run` lets you inspect it before executing. Output-token limits constrain a request, but are not a dollar budget. Provider billing, cached tokens, hidden reasoning tokens, and model-specific limits vary.

Token counts are reported only when returned by the provider. SkillDelta does not invent missing usage or infer a monetary cost. Wall-clock timings include generation and verification and can be affected by provider load and container startup.

## Isolation boundaries

The host makes the model API request. Only allowlisted generated files and the test fixture reach the verifier; provider credentials are not forwarded. Verification containers disable networking, make the root filesystem read-only, drop capabilities, and set resource limits.

Held-out means the tests are not sent in the generation prompt. It is not an anti-cheating guarantee: generated code running beside test files may inspect those files. Treat the suite as trusted code, use an up-to-date Docker installation, and run hostile-code research on a disposable machine. See [SECURITY.md](../SECURITY.md).

The demo is a separate, local path for known bundled code. Its deterministic solutions prove that the test/report pipeline works; they say nothing about model performance.
