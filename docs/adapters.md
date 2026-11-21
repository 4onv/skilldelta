# Connect a coding-agent worker

SkillDelta prepares a fresh request for each baseline or skill attempt. The default `chat-completions` adapter asks for complete files in a single message. The optional `skilldelta-http-v1` adapter sends a structured task to an HTTP worker you operate. That worker can run your agent's native skill workflow and return the final files for SkillDelta's Docker verifier.

## Run the Codex CLI worker

Install and authenticate Codex CLI separately. This worker requires **Codex CLI 0.167.2 or newer** and uses its existing authentication. Starting the worker runs only `codex --version`; model requests begin when an evaluation reaches it. Model calls may incur charges. The executable contract was checked against installed CLI 0.167.2; tests use a visibly synthetic executable and real Docker verification. A paid model evaluation has not been performed for this release.

Start the installed worker in one terminal, choosing a model available to your Codex account:

```sh
skilldelta-codex --model YOUR_CODEX_MODEL
```

The worker listens at `http://127.0.0.1:8788/evaluate` and prints a model label such as `codex/0.167.2/YOUR_CODEX_MODEL`. Copy the actual printed label into the evaluation. In another terminal, with Docker running in Linux container mode:

```sh
skilldelta init codex-evaluation
cd codex-evaluation
skilldelta run --adapter skilldelta-http-v1 --endpoint http://127.0.0.1:8788/evaluate --model codex/0.167.2/YOUR_CODEX_MODEL --timeout-ms 150000 --dry-run
```

Remove `--dry-run` to make model requests. The starter evaluation uses three tasks, three trials and two conditions: **18 calls**. Use `--trials 1` for a six-call first run. Keep the adapter, endpoint and exact model label in your config to resume the same evaluation. The default worker timeout is 120 seconds per attempt; the client example allows 150 seconds for that attempt and cleanup.

Each attempt gets a fresh temporary directory containing only declared starter files and an output schema. The worker passes the task and optional skill through stdin to `codex exec --ignore-user-config --ephemeral --skip-git-repo-check --sandbox read-only`, requests structured final file contents, then sends those files to SkillDelta for held-out Docker tests. Codex does not receive the verifier through the worker. Cancellation or timeout terminates the subprocess tree; completed source is removed during cleanup. A cleanup warning names any directory that could not be removed.

This evaluates skill text supplied in the prompt. It does not install a native skill directory or test an agent's skill-discovery mechanism. Codex runs on the host with its own authentication, environment, sandbox behavior and applicable rules. The fresh directory is not a hermetic machine. Use trusted tasks and review your Codex setup. The model label records the executable version and model, but cannot detect remote model drift or every environment change.

The worker validates the HTTP limits but **does not map `maxOutputTokens` or temperature to native Codex generation controls**. Its native call is bounded by wall time and its returned JSON by 1 MiB. Token usage is reported as unknown. Use a stable worker setup for paired comparisons; this is not a token-budget comparison with the chat-completions adapter.

Options: `--port` changes the loopback port; `--timeout-ms` accepts 1000–600000; `--executable` selects a binary or `.js`/`.mjs` CLI entry point. On Windows, the worker looks for the standard npm Codex JavaScript entry before `codex.exe`, avoiding a shell wrapper. To require worker authentication, set `SKILLDELTA_WORKER_KEY` in the worker terminal and the same value as `SKILLDELTA_API_KEY` in the client terminal. These keys protect the local HTTP interface; Codex keeps its separate provider authentication. Keep the server on loopback and do not expose it publicly.

From source, substitute `node bin/skilldelta-codex.mjs` for `skilldelta-codex`. Run `skilldelta-codex --help` to inspect options without probing Codex or contacting a provider.

Ctrl+C stops accepting requests, cancels the active Codex subprocess if there is one, and waits for temporary workspace cleanup. An interrupted request may already have incurred provider charges. Resume from the evaluation checkpoint after starting the worker again.

## Run the synthetic worker locally

From the source checkout, start the bundled loopback server in one terminal.

```sh
node examples/mock-adapter.mjs
```

Run the evaluation in another terminal with Docker running in Linux container mode. This variant uses the live transport and real Docker checks with bundled synthetic files. The model label in the report is `synthetic-fixtures`. The worker makes zero model calls.

```sh
node bin/skilldelta.mjs run --suite examples/suite.json --skill examples/edge-cases/SKILL.md --adapter skilldelta-http-v1 --endpoint http://127.0.0.1:8787/evaluate --model synthetic-fixtures --trials 1 --out .skilldelta/mock-adapter
```

Open `.skilldelta/mock-adapter/report.html`. The expected synthetic result is one passing task without the skill and three with it. The baseline and skill fixtures were deliberately chosen to differ.

For your own project, set `adapter` to `skilldelta-http-v1` in `skilldelta.config.json` or pass `--adapter skilldelta-http-v1`. Set `model` to an identifier your worker understands and `endpoint` to its full URL. `doctor` checks configuration locally. A `--dry-run` shows the adapter and planned call count.

## HTTP v1 contract

The CLI sends an HTTPS POST with JSON, except that loopback endpoints can use HTTP. It rejects redirects. If `SKILLDELTA_API_KEY` is set, it becomes the request's bearer token. The worker receives a request of this form.

```json
{
  "schemaVersion": 1,
  "model": "agent-release-and-settings",
  "limits": { "maxOutputTokens": 4096, "temperature": 0 },
  "task": {
    "id": "answer",
    "prompt": "Export answer = 42.",
    "editableFiles": ["solution.mjs"],
    "starter": { "solution.mjs": "export const answer = 0;" }
  },
  "skill": { "text": "Check the implementation against the requested boundary." }
}
```

The baseline gets `"skill": null`. Both conditions receive the same task, starter files, model identifier, and limits. Held-out tests and their hashes stay in SkillDelta. Start each attempt in a fresh workspace or agent session and apply the supplied skill only when present. Choose a stable identifier for the actual agent and model setup, and change it when those inputs change. Apply the requested limits if your agent supports them. SkillDelta can enforce its HTTP timeout and does not control the worker's internal token budget or subprocess lifetime.

A successful response has HTTP 2xx status and the following JSON shape.

```json
{
  "schemaVersion": 1,
  "files": { "solution.mjs": "export const answer = 42;" },
  "usage": { "inputTokens": 73, "outputTokens": 18 }
}
```

Return exactly the editable files as UTF-8 text, each up to 256 KiB, within a 2 MiB response. The `usage` object is optional. Unknown token counts can be omitted or set to `null`. Return an HTTP error when the worker or provider fails. SkillDelta discards error bodies, keeps infrastructure errors inconclusive, and runs its own held-out verifier on valid files. Results retain only outcomes, timing, reported usage, and run metadata.

The adapter is part of the saved input fingerprint. Switching adapters requires a new output directory and a new comparison set. Existing saved chat-completions runs keep their identities. Verify your worker's implementation and trust boundary before sending private source. [CLI options and resume behavior](cli.md#interrupt-and-resume) · [Security](../SECURITY.md)
