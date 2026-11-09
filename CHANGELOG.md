# Changelog

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

Checkpoint/resume and history/comparison arrived in later releases. A reusable GitHub Action and real agent adapters remain future work. The evaluation protocol remains single-turn code generation.

## 0.1.0 — 2026-11-01

- Introduce paired baseline/skill evaluations with held-out executable tests, Docker isolation for live generated code, and a compatible chat-completions provider interface.
- Add JSON results, standalone HTML reports, SVG badges, and an optional regression gate.
- Include three starter tasks and a visibly simulated demo with real tests, plus unit and Docker integration CI.
