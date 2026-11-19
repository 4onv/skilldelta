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

A custom adapter operates outside SkillDelta's verification container. Run it with credentials and filesystem access appropriate for your agent. The adapter can see any bearer key you send and is responsible for the agent's own subprocesses, isolation, and cancellation. [Adapter protocol](docs/adapters.md)

The bundled Codex worker also runs on the host. It uses a fresh temporary directory, read-only Codex sandbox mode, ephemeral sessions and a structured output schema. Those settings do not isolate the agent from all host context or replace Codex's own security boundary. Keep it on loopback, use trusted inputs, and consider `SKILLDELTA_WORKER_KEY` when sharing a machine. It intentionally does not include native logs in HTTP errors or saved reports. Cleanup warnings can leave temporary generated source on disk for manual inspection.

Reports include task titles and run metadata. Review them before sharing. Keep credentials in `SKILLDELTA_API_KEY` or your CI secret store; do not paste them into a suite, skill, model identifier, endpoint URL, issue, or report.

Live checkpoints contain the same outcome metadata and a fingerprint of evaluation inputs. They omit generated source, raw responses, keys, skill text and test source. Checkpoints are editable local progress records; resume validation establishes input compatibility and structural consistency, not independent proof that tests ran. Protect the output directory from untrusted writers. A cancelled provider request may still be processed or billed; interrupted attempts can be retried on resume.

The bundled demo executes known fixture code locally. That convenience is not a supported path for executing untrusted model output on the host.

## Reporting a vulnerability

If GitHub private vulnerability reporting is enabled for this repository, use its **Security → Report a vulnerability** flow. Otherwise, open an issue asking for a private reporting channel without including exploit details, secrets, or private data. Do not publish a working escape or credential disclosure in a public issue.

Include the affected commit, Node.js and Docker versions, operating system, a minimal reproduction using dummy data, and the expected security boundary.
