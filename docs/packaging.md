# Installation and packaging

SkillDelta uses Node.js built-in modules and requires Node.js 22 or newer. The package name is `@4onv/skilldelta`; the installed executable is `skilldelta`.

## Install a GitHub release

Download `4onv-skilldelta-0.2.0.tgz` from the [v0.2.0 release](https://github.com/4onv/skilldelta/releases/tag/v0.2.0), then run this from the download directory:

```sh
npm install -g ./4onv-skilldelta-0.2.0.tgz
skilldelta --version
skilldelta demo
```

For an explicitly offline installation of the downloaded artifact:

```sh
npm install -g ./4onv-skilldelta-0.2.0.tgz --offline --ignore-scripts --no-audit --no-fund
```

This package has **not been published to npm or another package registry**. The installation commands use a local GitHub release tarball, not a registry package. Do not substitute a similarly named package from a registry.

The tarball contains the CLI, implementation, bundled examples, report assets, documentation, license, and security guidance. Demo fixtures and initialization templates are read from the installed package, so commands work outside a source checkout. The package has no runtime dependencies or installation scripts.

If your shell cannot find `skilldelta`, make sure npm's global executable location is on your `PATH`, then reopen the shell. No Docker or API key is needed for `demo` or `init`. Live evaluations require Docker and a compatible provider; see [the CLI reference](cli.md).

## Run from source

```sh
git clone https://github.com/4onv/skilldelta.git
cd skilldelta
node bin/skilldelta.mjs demo
node bin/skilldelta.mjs init my-evaluation
```

No dependency installation is needed. Use the installed executable for convenient invocation from any project directory, or invoke the source CLI by its path.

## Verify an artifact

From a source checkout:

```sh
node --test
npm run test:package
npm pack
```

`test:package` packs the source, installs the resulting artifact offline into a clean temporary prefix, and exercises the installed executable, demo, project initialization, readiness diagnostics, and dry-run validation. It verifies packaged files rather than relying on a working source checkout. These checks make no provider requests and do not publish a package. CI runs this check on Windows and Ubuntu with Node.js 22 and 24.

`npm pack` creates `4onv-skilldelta-0.2.0.tgz` for this version. Upload that tested artifact to the corresponding GitHub release. Creating or installing a tarball does not publish anything to npm.

## Current scope

Version 0.2 provides an installable developer tool for single-turn paired code-generation evaluations, setup, readiness checks, executable verification, and portable reports. It does not include a complete agent runtime, resumable checkpoints, run history/comparison, or graceful interruption handling. Saved demo data is simulated and must not be presented as evidence of model performance.
