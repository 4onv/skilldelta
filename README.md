<p align="center">
  <img src="assets/banner.svg" alt="SkillDelta — Does your skill actually help?" width="100%">
</p>

# SkillDelta

**Measure what a skill changes. Generate code with and without it, run the same held-out tests, and share the results.**

SkillDelta is a small, dependency-free CLI for paired evaluations of coding instructions. It produces an inspectable JSON result, a standalone HTML report, and an SVG badge.

- **Executable checks:** a task passes only when its complete test suite passes.
- **Paired comparisons:** every task runs both with and without the skill.
- **Isolated verification:** live generated code is tested in a resource-limited Docker container without network access or API credentials.
- **Portable reports:** one HTML file, no server, account, analytics, or external assets.

Version 0.4 adds saved-run history and comparisons between skill revisions. Completed attempts are saved as a run proceeds, and interrupted evaluations can resume. It evaluates **single-turn code generation** through a compatible chat-completions endpoint. It does not run a complete coding agent, install a skill into an agent, or measure multi-turn tool use.

## Try it in a minute

Install [Node.js 22 or newer](https://nodejs.org/) and download `4onv-skilldelta-0.4.0.tgz` from the [v0.4.0 GitHub release](https://github.com/4onv/skilldelta/releases/tag/v0.4.0). From the download directory:

```sh
npm install -g ./4onv-skilldelta-0.4.0.tgz
skilldelta demo
```

The package is named `@4onv/skilldelta` and is distributed as a GitHub release artifact; it has **not been published to npm**. You can also run directly from source without installing dependencies:

```sh
git clone https://github.com/4onv/skilldelta.git
cd skilldelta
node bin/skilldelta.mjs demo
```

Open `.skilldelta/demo/report.html` in your browser. The demo needs neither an API key nor Docker.

**The demo uses simulated model outputs and real tests.** Its bundled examples deliberately produce **1/3 passing tasks without the skill and 3/3 with it**. Those numbers demonstrate the reporting workflow; they are not evidence that this skill improves any model.

You can also download and open the [sample report](examples/sample-report.html).

## Evaluate your own skill

You need a running Docker installation with Linux containers and a provider exposing a compatible `/v1/chat/completions` endpoint. Live runs may incur provider charges.

Create an editable evaluation project:

```sh
skilldelta init my-evaluation
cd my-evaluation
```

This creates `skilldelta.config.json` and a `skilldelta/` directory containing a starter skill and three executable tasks. Existing files are not overwritten. Set `model` and `endpoint` in the config; both start as `null` so you choose the provider explicitly. If your provider needs authentication, set `SKILLDELTA_API_KEY` in your shell. Keep credentials out of config files and command-line arguments.

```sh
skilldelta doctor
skilldelta run --dry-run
```

`doctor` checks local configuration, Node.js, Docker, image availability, and key presence. It does not contact a provider or pull an image. `run --dry-run` validates the evaluation and planned call count without using Docker or a provider. You can also supply the model and endpoint as overrides:

```sh
skilldelta run --model YOUR_MODEL --endpoint https://YOUR_PROVIDER/v1/chat/completions --trials 3 --dry-run
```

Once configured, execute the evaluation:

```sh
skilldelta run
```

Each completed attempt is saved atomically to `checkpoint.json`. Ctrl+C cancels the active request or verifier, preserves completed work, and writes an explicitly inconclusive partial report. Resume with the same configuration and output directory:

```sh
skilldelta run --resume
```

Resume validates the suite, skill, tests, model, endpoint, generation settings and resolved Docker image. Completed failures and provider errors are retained too. An interrupted in-flight attempt is retried and may have already incurred a provider charge. Use a new `--out` directory for a fresh evaluation. [Recovery details](docs/cli.md#interrupt-and-resume)

Three tasks × three trials × two conditions means **18 model calls**. Both conditions use the same task prompt, starter files, and test suite. Only the skill condition receives the skill text. Test source is withheld from the model request.

`run` and `doctor` discover `skilldelta.config.json` in the current directory, or accept `--config FILE`. Paths in the config are relative to that file. Command-line flags override config values; command-line paths are relative to your current directory.

See [the evaluation guide](docs/evaluation.md) for suite authoring, methodology, and limitations, [the CLI reference](docs/cli.md) for options, or [the packaging guide](docs/packaging.md) for installation and artifact verification.

## Read the result

| Output | Purpose |
| --- | --- |
| `results.json` | Machine-readable results, task outcomes, timing, and reported token usage |
| `checkpoint.json` | Live-run progress used by `run --resume`; updated after every completed attempt |
| `report.html` | A standalone comparison with task filters and paired wins/losses/ties |
| `badge.svg` | A small result badge suitable for a README |

A positive delta means more complete task trials passed with the skill. It does **not** establish statistical significance or guarantee better performance on other tasks. Provider or runtime errors make the aggregate verdict **inconclusive**. Start with representative tasks, repeat the experiment, and inspect failures.

Rebuild a report from saved results:

```sh
skilldelta report .skilldelta/demo/results.json --out .skilldelta/rebuilt
```

Add `--fail-on-regression` to a live run when you want a negative pass-rate delta to fail your automation. Treat that as your chosen gate, not a statistical test.

## Compare saved evaluations

Keep each evaluation in its own output folder. List saved runs, then compare two runs that used the same evaluation inputs:

```sh
skilldelta history .skilldelta
skilldelta compare .skilldelta/before/results.json .skilldelta/after/results.json
skilldelta compare .skilldelta/before/results.json .skilldelta/after/results.json --json --fail-on-regression
```

These commands read saved files without executing tests or contacting a model. History inspects the root and its immediate run folders, preferring the latest atomic checkpoint to a possibly older results file. Comparisons require fingerprints recorded by version 0.4 or newer. The skill can change; the suite, tests, endpoint, model, seed, trials, generation settings and resolved runtime must agree. Earlier results still appear in history but cannot establish input compatibility.

The comparison separates baseline pass-rate change, skill pass-rate change and the change in the measured skill effect. `compare --fail-on-regression` exits 1 only when that last quantity decreases. Partial runs and provider/runtime errors stay inconclusive; incompatible inputs exit 2. Model randomness and provider drift remain possible even with matching fingerprints. Results are editable local observations, not signatures or statistical evidence. [Limits and examples](docs/cli.md#history-and-compare)

## Development

```sh
node --test
npm run test:package
node bin/skilldelta.mjs demo
```

CI runs the unit tests, demo, and a packed-package installation smoke test on Windows and Ubuntu with Node.js 22 and 24. The artifact check installs into a clean temporary prefix and exercises the installed commands. A separate Ubuntu job exercises Docker verification without calling a paid model.

CI also interrupts and resumes the CLI using a local mock provider and real Docker verification, without paid model calls. A reusable GitHub Action, stronger benchmarks and real agent adapters remain future work.

Useful contributions include representative task suites, endpoint compatibility fixes, and clearer failure diagnostics. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before adding a runner or publishing reports.

MIT licensed. Built for people who want evidence before adding more instructions.
