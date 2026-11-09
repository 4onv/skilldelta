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
| `--resume` | Continue `checkpoint.json` in the selected output directory with matching evaluation inputs |
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

### Interrupt and resume

Live evaluations atomically replace `checkpoint.json` after every completed attempt. The checkpoint retains outcomes, timing, reported usage and hashed input identity. It contains no API key, raw response, generated code, test source or skill text. It is a trusted local progress file, not a signed proof of execution. Review task titles and other metadata before sharing it.

Ctrl+C (`SIGINT`) or `SIGTERM` cancels the active provider request or test process. Docker verification performs container cleanup. Completed work is retained and a partial report is saved with an inconclusive verdict. Interrupted attempts are left pending. Resume with the same options/configuration and output directory:

```sh
skilldelta run --resume --out .skilldelta/run
```

Resume checks a fingerprint of the complete suite, skill, test contents, model, endpoint, seed, trial count, generation limits and resolved Docker image. A changed input is rejected before provider calls. The API key may rotate without invalidating progress. If an image tag now resolves differently, select the original image ID recorded in the saved `runtime` field or start a fresh run.

Completed successes, test failures and provider errors are all skipped on resume. There is no automatic retry of recorded errors. A fully completed checkpoint makes no additional model calls. Start a fresh run in a new output directory to measure changed settings or retry all outcomes. `--resume --dry-run` validates configuration and prints the full planned count; it does not check checkpoint compatibility because image resolution requires Docker.

This is attempt-level recovery, not exactly-once provider billing. A hard interruption after a request starts but before its outcome is saved may require that attempt again. The provider may continue or bill a cancelled request. Generated source is intentionally not checkpointed. A failure to save progress stops further requests.

Every writer holds `run.lock` in its output directory. A live run refuses existing result artifacts unless `--resume` is supplied. Demo/report commands refuse to overwrite a directory containing a live checkpoint. Ordinary report-only or demo outputs may be regenerated. For a live report rebuild, choose a separate `--out` directory.

After a hard kill or machine crash, `run.lock` can remain. Inspect its `host` and `pid`; only after confirming that process has stopped, remove that single lock file and run with `--resume`. If interruption happened during Docker preparation and no checkpoint exists yet, remove the verified-stale lock and start normally. Forced termination may also require manual removal of a leftover `skilldelta-*` Docker container. Automatic lock stealing is deliberately unsupported.

## `report`

```sh
skilldelta report .skilldelta/run/results.json --out .skilldelta/rebuilt
```

Recalculates the summary and writes `results.json`, `report.html`, and `badge.svg` from an existing result or checkpoint file without model calls or test execution. Without `--out`, it writes beside the input file, provided that directory has no live checkpoint. Use a separate `--out` to rebuild a live run. Existing ordinary report outputs are replaced under a directory lock. Incomplete checkpoints remain inconclusive. Review task titles and metadata before sharing any report.

## History and compare

```sh
skilldelta history [DIRECTORY] [--json]
skilldelta compare PREVIOUS.json CURRENT.json [--json] [--fail-on-regression]
```

The history directory defaults to `.skilldelta`. The command reads that directory and its immediate child directories, looking for `checkpoint.json` first, then `results.json`. It does not recurse into further descendants or follow symlinked files/folders. Up to 100 child folders and 1000 root entries are accepted. Invalid candidates produce warnings rather than disappearing silently; an invalid preferred checkpoint does not fall back to an older result. History performs no writes. JSON output includes local filenames, run metadata and recomputed summaries, so review it before sharing.

Comparisons require two distinct evaluation IDs and comparison identity version 1, written by SkillDelta 0.4 or newer. The hashed identity covers the full loaded suite and hidden tests, provider endpoint, model identifier, seed, trial count, resolved Docker image, generation limits and demo fixtures where relevant. Only the skill is excluded. The endpoint and hidden source remain undisclosed. Disclosed metadata is checked too. Demo/live mixtures are incompatible; demo comparisons are explicitly labeled simulated. Old reports can be listed but missing inputs cannot be reconstructed reliably, so comparison refuses them. Resuming an old checkpoint with unchanged inputs records the new identity from the validated current plan.

Both runs must contain all expected unique task/trial/condition outcomes and no provider/runtime errors before changes are calculated. Stored summaries are ignored. The JSON comparison reports previous/current summaries, per-task pass counts, and three changes in percentage points:

- Baseline pass rate: current minus previous.
- Skill pass rate: current minus previous.
- Measured skill effect: current `(skill - baseline)` minus previous `(skill - baseline)`.

For example, a baseline change from 40% to 60% and a skill change from 60% to 80% leave the measured skill effect unchanged at +20 percentage points. The comparison gate uses the change in that effect. It does not gate the current skill's absolute pass rate. Comparisons emit JSON to stdout with `--json`; shell redirection can save it. They never update input files or output directories.

To try the workflow without a model or Docker:

```sh
skilldelta demo --out .skilldelta/demo-before
skilldelta demo --out .skilldelta/demo-after
skilldelta history .skilldelta
skilldelta compare .skilldelta/demo-before/results.json .skilldelta/demo-after/results.json --json
```

These two deterministic fixture runs should show zero change and are not model evidence. Matching fingerprints do not prove the model/provider stayed unchanged behind an identifier, equal hardware performance, matched model random seeds, statistical significance, or file authenticity. Hashes are reproducible local identifiers; edited reports can be fabricated. Inspect representative failures and repeat live evaluations before drawing a conclusion. Run these commands against a stable local directory; history is not a transaction across concurrently changing folders.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Command completed; ordinary test failures alone do not make a comparison command fail |
| `1` | The optional regression gate failed |
| `2` | Invalid input, incompatible/inconclusive saved comparison, provider failure, execution error, or a failing `doctor` check |
| `130` / `143` | Interrupted by SIGINT / SIGTERM; saved progress can be resumed once an evaluation has started |

The JSON report retains individual outcomes so CI can implement a stricter project-specific policy. Use `skilldelta --help` for command help and `skilldelta --version` for the package version.
