# Connect a coding-agent worker

SkillDelta prepares a fresh request for each baseline or skill attempt. The default `chat-completions` adapter asks for complete files in a single message. The optional `skilldelta-http-v1` adapter sends a structured task to an HTTP worker you operate. That worker can run your agent's native skill workflow and return the final files for SkillDelta's Docker verifier.

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
