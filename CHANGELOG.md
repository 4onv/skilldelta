# Changelog

## 0.2.0 — 2026-11-01

- Package the CLI as `@4onv/skilldelta`, distributed as a GitHub release tarball with the `skilldelta` executable. No npm registry publication.
- Add `init [DIRECTORY]` to create an editable configuration and starter suite without overwriting existing project files.
- Add read-only `doctor` diagnostics for configuration, Node.js, Docker, local image availability, and API-key presence, including JSON output. Diagnostics make no model requests or image pulls.
- Load project configuration automatically from the current directory or explicitly with `--config`. CLI flags override config values, and config paths resolve relative to the config file.
- Include documentation and security guidance in the package, with a clean offline installation smoke test in the Windows/Ubuntu and Node.js 22/24 CI matrix.

Checkpoint/resume, graceful interruption, run history/comparison, a reusable GitHub Action, and real agent adapters remain future work. The evaluation protocol remains single-turn code generation.

## 0.1.0 — 2026-11-01

- Introduce paired baseline/skill evaluations with held-out executable tests, Docker isolation for live generated code, and a compatible chat-completions provider interface.
- Add JSON results, standalone HTML reports, SVG badges, and an optional regression gate.
- Include three starter tasks and a visibly simulated demo with real tests, plus unit and Docker integration CI.
