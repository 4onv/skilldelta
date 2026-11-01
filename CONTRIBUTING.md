# Contributing to SkillDelta

Keep the project easy to run and the results easy to inspect. Small, focused contributions are welcome.

## Local checks

Use Node.js 22 or newer. No dependency installation is needed.

```sh
node --test
node bin/skilldelta.mjs demo
```

Open the generated report and check narrow and wide layouts when changing presentation code. To exercise live verification, install Docker with Linux containers and run the Docker integration test:

```sh
SKILLDELTA_DOCKER_TEST=1 node --test test/docker.test.mjs
```

In PowerShell, set the environment variable first:

```powershell
$env:SKILLDELTA_DOCKER_TEST = '1'
node --test test/docker.test.mjs
```

The integration test uses fixtures, not a paid model endpoint.

## Useful contributions

- Tasks with clear contracts and meaningful edge cases.
- Endpoint compatibility fixes supported by a reproducible, secret-free fixture.
- Tests for result parsing, path validation, isolation, and error reporting.
- Accessible reports and clearer explanations of what the results do and do not establish.

Open an issue before proposing a new runtime dependency, language runner, or complete agent integration. Version 0.1 intentionally evaluates single-turn JavaScript code generation.

## Pull requests

Explain the problem, the resulting behavior, and how you checked it. Add tests for behavior that could regress. Do not include API keys, private prompts, customer code, local paths, or provider responses containing sensitive information.

Keep simulated examples visibly labeled. Never replace a demonstration with an invented model result. Changes to evaluation methodology should explain how they affect comparisons with older results.
