# CLI reference

Use Node.js 22 or newer. These examples use the installed `skilldelta` executable; from a source checkout, replace `skilldelta` with `node bin/skilldelta.mjs`. The CLI uses only Node's built-in modules. See [installation and packaging](packaging.md).

## `init`

```sh
skilldelta init my-evaluation
cd my-evaluation
```

Creates `skilldelta.config.json` and a `skilldelta/` directory containing the starter suite, skill, and executable task checks. Omit the directory to use the current directory. Initialization refuses to overwrite an existing config or `skilldelta/` directory, and refuses symbolic-link directory components.

The generated configuration is:

```json
{
  "schemaVersion": 1,
  "suite": "skilldelta/suite.json",
  "skill": "skilldelta/edge-cases/SKILL.md",
  "model": null,
  "endpoint": null,
  "trials": 3,
  "seed": 42,
  "maxOutputTokens": 4096,
  "timeoutMs": 120000,
  "image": "node:22-alpine",
  "out": ".skilldelta/run"
}
```

Set `model` and `endpoint` before running an evaluation, or supply them as CLI flags. Initialization makes no provider requests and does not require Docker.

## Configuration

`run` and `doctor` automatically load `skilldelta.config.json` from the current working directory if it exists. Discovery does not search parent directories. Use `--config FILE` to select another file.

Configuration values override built-in defaults; CLI options override configuration values. The `suite`, `skill`, and `out` paths in a config are resolved relative to the config file. Paths passed on the command line are relative to the current working directory.

Use the keys shown above, with numeric JSON values for numeric settings. The config uses `maxOutputTokens` and `timeoutMs`; their CLI flags are `--max-output-tokens` and `--timeout-ms`. Unknown config keys are rejected. Credentials belong in `SKILLDELTA_API_KEY`, never in this file.

## `doctor`

```sh
skilldelta doctor
skilldelta doctor --config path/to/skilldelta.config.json --json
```

Checks Node.js, config validity, suite and test-file readability, skill contents, model and endpoint settings, API-key presence, Docker with Linux containers, and local image availability. It accepts the run settings below except `--out`, `--dry-run`, and `--fail-on-regression`, so you can check CLI overrides too.

This is a read-only readiness check: it does not execute tests, call a model, pull an image, or validate API credentials. Docker checks use version, daemon information, and local image inspection. A passing check does not establish provider connectivity or compatibility.

Missing `SKILLDELTA_API_KEY` is a warning because some local providers accept unauthenticated requests. A missing local verification image is a warning because a live run may pull it. Missing required settings, invalid inputs, or unavailable Linux Docker produce failing checks and exit code `2`. Warnings alone do not fail the command.

`--json` emits an object with `ok` and a `checks` array. Each check contains `name`, `status` (`pass`, `warn`, or `fail`), and a diagnostic `message`. Key values are not printed.

## `demo`

```sh
skilldelta demo
skilldelta demo --out .skilldelta/another-demo
```

Runs the bundled deterministic solutions against real executable tests and writes `.skilldelta/demo/results.json`, `report.html`, and `badge.svg` by default. It uses fixtures from the installed package and does not load project configuration.

This command does not call a model. It needs neither Docker nor credentials. It executes only the bundled demo code locally. The deliberately different solutions illustrate success and failure; they are not a benchmark of a real model.

## `run`

After initializing a project and setting its model and endpoint:

```sh
skilldelta run --dry-run
skilldelta run
```

With an explicit configuration file and CLI override:

```sh
skilldelta run --config my-evaluation/skilldelta.config.json --trials 5 --dry-run
```

All required inputs can also be supplied without a config. For example, from a source checkout:

```sh
node bin/skilldelta.mjs run --suite examples/suite.json --skill examples/edge-cases/SKILL.md --model YOUR_MODEL --endpoint https://YOUR_PROVIDER/v1/chat/completions --dry-run
```

Live runs require Docker with Linux containers. The selected Docker image must contain Node.js and be able to execute the suite's tests. Docker may need to download the image before verification can start. Model calls may incur provider charges.

| Option | Meaning |
| --- | --- |
| `--config PATH` | Project config; otherwise discover `skilldelta.config.json` in the current directory |
| `--suite PATH` | JSON task-suite file |
| `--skill PATH` | Skill Markdown file to include in the skill condition |
| `--model NAME` | Model identifier accepted by the provider |
| `--endpoint URL` | Full chat-completions endpoint; HTTPS is required except for loopback HTTP |
| `--trials N` | Number of repetitions of each task in each condition; default `3`, range `1–100` |
| `--out PATH` | Output directory; live runs default to `.skilldelta/run` |
| `--dry-run` | Validate inputs and show the planned call count without contacting the model or running Docker commands |
| `--max-output-tokens N` | Maximum requested output tokens per generation; default `4096`, range `64–32768` |
| `--timeout-ms N` | Model request timeout in milliseconds; default `120000`, range `1000–600000` |
| `--seed N` | Controls the parity of alternating condition order; default `42`, range `0–2147483647` |
| `--image NAME` | Verification image; default `node:22-alpine`, resolved to an immutable image ID for the run |
| `--fail-on-regression` | Exit with a failure when the skill's task pass rate is lower than the baseline |

The API key comes from `SKILLDELTA_API_KEY`. The key is used for the provider request and is not passed into verification containers. Configure it using your shell or CI secret store, not a checked-in file. Providers that accept unauthenticated requests can run without it.

The planned request count is `tasks × trials × 2`. The token limit caps requested output per call; it is not a dollar budget or a cap on billed input tokens.

The provider must accept chat-completions requests with `messages`, `temperature: 0`, and `max_tokens`, and return text in `choices[0].message.content` containing a JSON object of this shape:

```json
{
  "files": {
    "solution.mjs": "export function example() { return 42; }\n"
  }
}
```

The answer must include every editable file and no other files or top-level properties. File paths must match the task's declared editable files. A syntactically valid answer can still fail its tests. Malformed model answers count as failed attempts; provider and runner errors make the aggregate verdict inconclusive. Endpoints that require a different token-limit parameter, reject temperature zero, or use another response format need an adapter change; compatibility is not universal.

The seed changes whether a pair starts with the baseline or skill condition; the order alternates across tasks and trials. It is not sent as a model random seed and is not a promise of deterministic output. Model versions, provider behavior, and machine load can affect repeated runs.

Results are saved at the end of the evaluation. Checkpoint/resume and graceful interruption handling are not implemented; an interrupted run can lose progress and may require manual Docker cleanup.

## `report`

```sh
skilldelta report .skilldelta/run/results.json --out .skilldelta/rebuilt
```

Recalculates the summary and writes `results.json`, `report.html`, and `badge.svg` from an existing result file without model calls or test execution. Without `--out`, it writes beside the input file. Existing output files at the destination are replaced. Review task titles and metadata before sharing any report.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Command completed; ordinary test failures alone do not make a comparison command fail |
| `1` | The optional regression gate failed |
| `2` | Invalid input, provider failure, execution error, or a failing `doctor` check |

The JSON report retains individual outcomes so CI can implement a stricter project-specific policy. Use `skilldelta --help` for command help and `skilldelta --version` for the package version.
