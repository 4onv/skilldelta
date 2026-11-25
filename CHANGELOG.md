# Changelog

## 0.10.0 — 2026-11-25

- Report each task's change in measured skill effect. Add an optional task-level tolerance to the saved comparison CLI and GitHub Action so aggregate totals cannot hide an individual task's decline.

## 0.9.1 — 2026-11-21

- Stop accepting requests when the Codex worker receives Ctrl+C or SIGTERM. Cancel the active subprocess and wait for temporary workspace cleanup before exiting.

## 0.9.0 — 2026-11-19

- Export completed attempts from saved results or checkpoints as CSV, including simulation and completion flags and blank cells for unknown token counts.

## 0.8.0 — 2026-11-19

- Add the installable `skilldelta-codex` worker for Codex CLI 0.167.2+, with fresh workspaces, structured final files, version-qualified model labels and subprocess cancellation.
- Verify the executable contract with a synthetic subprocess, HTTP evaluations and Docker tests. Native startup checks use only `--version`; paid model behavior remains unverified.
- Reject invalid UTF-8 and nonregular suite, skill, verifier and configuration inputs through a bounded shared reader. Preserve valid existing text fingerprints.
- Extend bounded Windows package-smoke cleanup retries after a transient directory lock caused CI to fail after its assertions passed.

## 0.7.0 — 2026-11-17

- Add the versioned `skilldelta-http-v1` adapter for user-run coding-agent workers, alongside the default chat-completions adapter.
- Bind the adapter to resume and comparison identities while preserving existing chat-completions fingerprints.
- Ship a synthetic loopback worker and verify its evaluation through the CLI and Docker without model calls.

## 0.6.0

- Add an installable `http-boundaries` benchmark preset covering Retry-After delays, byte-range handling, and incremental NDJSON parsing.
- Verify each benchmark with a reference and a deliberately flawed implementation. Keep those implementations out of the release tarball.
- Exercise scaffolding and dry-run validation for the new preset from a clean offline install.

## 0.5.0 — 2026-11-11

- Add a reusable GitHub Action for saved-run regressions with an inclusive percentage-point tolerance, explicit failure statuses, step outputs, and a job summary.
- Compute changes from integer pass counts to avoid false regression failures when the measured effect is unchanged.
- Verify the action through the GitHub runner on Ubuntu and Windows using synthetic evaluations.

## 0.4.0 — 2026-11-09

- List saved results and checkpoints with read-only `history`, explicit scan bounds and invalid-file warnings.
- Compare distinct evaluations across skill revisions using a fingerprint of all non-skill evaluation inputs; keep incomplete, errored and incompatible samples inconclusive.
- Recompute outcomes instead of trusting saved summaries; expose baseline, skill and measured-effect changes separately, with an optional gate on effect regression.
- Verify the installed history/compare workflow offline in the package smoke test. No provider calls or package-registry publication.

## 0.3.0 — 2026-11-07

- Save every completed live attempt in an atomic checkpoint and resume only pending attempts with validated evaluation inputs.
- Cancel provider requests and verifiers on SIGINT/SIGTERM, preserve partial results and mark incomplete reports/badges inconclusive.
- Lock output directories and prevent live artifacts from accidental overwrite by fresh runs, demos or report rebuilds.
- Exercise interruption and resume through the CLI with a local mock provider and real Docker; document hard-kill recovery and in-flight billing limits.

## 0.2.0 — 2026-11-01

- Package the CLI as `@4onv/skilldelta`, distributed as a GitHub release tarball with the `skilldelta` executable. No npm registry publication.
- Add `init [DIRECTORY]` to create an editable configuration and starter suite without overwriting existing project files.
- Add read-only `doctor` diagnostics for configuration, Node.js, Docker, local image availability, and API-key presence, including JSON output. Diagnostics make no model requests or image pulls.
- Load project configuration automatically from the current directory or explicitly with `--config`. CLI flags override config values, and config paths resolve relative to the config file.
- Include documentation and security guidance in the package, with a clean offline installation smoke test in the Windows/Ubuntu and Node.js 22/24 CI matrix.

Checkpoint/resume, history/comparison, and the reusable GitHub Action arrived in later releases. The evaluation protocol remains single-turn code generation.

## 0.1.0 — 2026-11-01

- Introduce paired baseline/skill evaluations with held-out executable tests, Docker isolation for live generated code, and a compatible chat-completions provider interface.
- Add JSON results, standalone HTML reports, SVG badges, and an optional regression gate.
- Include three starter tasks and a visibly simulated demo with real tests, plus unit and Docker integration CI.
