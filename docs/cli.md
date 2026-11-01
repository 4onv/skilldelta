# CLI reference

Run commands from the repository root with Node.js 22 or newer. The CLI uses only Node's built-in modules.

## `demo`

```sh
node bin/skilldelta.mjs demo
```

Runs the bundled deterministic solutions against real executable tests and writes `.skilldelta/demo/results.json`, `report.html`, and `badge.svg`.

This command does not call a model. It needs neither Docker nor credentials. It executes only the bundled demo code locally. The deliberately different solutions illustrate success and failure; they are not a benchmark of a real model.

## `run`

```sh
node bin/skilldelta.mjs run --suite examples/suite.json --skill examples/edge-cases/SKILL.md --model YOUR_MODEL --endpoint https://YOUR_PROVIDER/v1/chat/completions
```

Live runs require Docker with Linux containers. The selected Docker image must contain Node.js and be able to execute the suite's tests. Docker may need to download the image before verification can start.

| Option | Meaning |
| --- | --- |
| `--suite PATH` | JSON task-suite file |
| `--skill PATH` | Skill Markdown file to include in the skill condition |
| `--model NAME` | Model identifier accepted by the provider |
| `--endpoint URL` | Full chat-completions endpoint; HTTPS is required except for loopback HTTP |
| `--trials N` | Number of repetitions of each task in each condition; default `3`, range `1–100` |
| `--out PATH` | Output directory; live runs default to `.skilldelta/run` |
| `--dry-run` | Validate inputs and show the planned call count without contacting the model or requiring Docker |
| `--max-output-tokens N` | Maximum requested output tokens per generation; default `4096` |
| `--timeout-ms N` | Model request timeout in milliseconds; default `120000` |
| `--seed N` | Controls the parity of alternating condition order; default `42` |
| `--image NAME` | Verification image; default `node:22-alpine`, resolved to an immutable image ID for the run |
| `--fail-on-regression` | Exit with a failure when the skill's task pass rate is lower than the baseline |

The API key comes from `SKILLDELTA_API_KEY`. The key is used for the provider request and is not passed into verification containers. Configure it using your shell or CI secret store, not a checked-in file.

The provider must accept chat-completions requests with `messages`, `temperature: 0`, and `max_tokens`, and return text in `choices[0].message.content` containing a JSON object of this shape:

```json
{
  "files": {
    "solution.mjs": "export function example() { return 42; }\n"
  }
}
```

The answer must include every editable file and no other files or top-level properties. File paths must match the task's declared editable files. A syntactically valid answer can still fail its tests. Malformed responses and provider/runner errors are surfaced separately from ordinary test failures. Endpoints that require a different token-limit parameter, reject temperature zero, or use another response format need an adapter change; compatibility is not universal.

The seed changes whether a pair starts with the baseline or skill condition; the order alternates across tasks and trials. It is not sent as a model random seed and is not a promise of deterministic output. Model versions, provider behavior, and machine load can affect repeated runs.

## `report`

```sh
node bin/skilldelta.mjs report .skilldelta/run/results.json --out .skilldelta/rebuilt
```

Recalculates the summary and writes `results.json`, `report.html`, and `badge.svg` from an existing result file without model calls or test execution. Without `--out`, it writes beside the input file. Existing output files at the destination are replaced. Review task titles and metadata before sharing any report.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Command completed; ordinary test failures alone do not make a comparison command fail |
| `1` | The optional regression gate failed |
| `2` | Invalid input, provider failure, or execution error |

The JSON report retains individual outcomes so CI can implement a stricter project-specific policy.
