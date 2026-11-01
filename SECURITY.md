# Security

SkillDelta generates and executes code. Isolation reduces exposure; it does not make arbitrary code trustworthy.

## What the live runner does

- Calls the configured provider from the host; HTTPS is required except for a loopback HTTP endpoint.
- Accepts generated files only at task-declared editable paths.
- Runs verification in Docker with networking disabled, a read-only root filesystem, dropped capabilities, and resource limits.
- Keeps the provider API key outside the verification container.
- Withholds test source from the model request.

Only run suites and container images you trust. A custom image is executable software. Keep Docker and the host current, and use a disposable machine for adversarial workloads.

Tests being held out from a prompt does not prevent generated code from inspecting test files during execution. The verifier is not a tamper-proof benchmark appliance. Treat claims of performance accordingly.

## Data sent and saved

The configured provider receives the task prompt, starter files, and, for the skill condition, the skill text. Choose an endpoint appropriate for that data. Referenced skill files are not automatically read.

Reports include task titles and run metadata. Review them before sharing. Keep credentials in `SKILLDELTA_API_KEY` or your CI secret store; do not paste them into a suite, skill, model identifier, endpoint URL, issue, or report.

The bundled demo executes known fixture code locally. That convenience is not a supported path for executing untrusted model output on the host.

## Reporting a vulnerability

If GitHub private vulnerability reporting is enabled for this repository, use its **Security → Report a vulnerability** flow. Otherwise, open an issue asking for a private reporting channel without including exploit details, secrets, or private data. Do not publish a working escape or credential disclosure in a public issue.

Include the affected commit, Node.js and Docker versions, operating system, a minimal reproduction using dummy data, and the expected security boundary.
