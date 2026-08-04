<div align="center">

# pi-stuff

A personal suite of extensions and resources for the native [Pi coding agent](https://github.com/earendil-works/pi).

[![CI](https://github.com/jczhang02/pi-stuff/actions/workflows/ci.yml/badge.svg)](https://github.com/jczhang02/pi-stuff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f2f2f.svg)](LICENSE)

</div>

> [!IMPORTANT]
> The current Package version is `0.1.0`. Registry publication remains a separate, explicitly approved maintainer action.

See the [0.1.0 release notes](docs/releases/0.1.0.md) for the shipped scope, compatibility boundary, and known limitations.

## Shape

```text
Pi host + @jczhang02/pi-stuff + user-owned settings
```

Pi remains the host. The Suite is a normal Pi Package: it exports an ordered aggregate Extension and uses Pi's existing runtime, package loader, settings, sessions, tools, and TUI. It does not provide another CLI or mutate host configuration.

## Packages

| Package | Purpose | Version |
| --- | --- | --- |
| `@jczhang02/pi-stuff` | Aggregate entry point for the full Suite | `0.1.0` |
| `@jczhang02/pi-stuff-ui` | Responsive Statusline, input presentation, and shared non-floating Command Dialog coordinator | `0.1.0` |
| `@jczhang02/pi-stuff-tools` | Compact built-in and Suite-owned Tool presentation with focused details | `0.1.0` |
| `@jczhang02/pi-stuff-agents` | Current-session foreground and background Agents | `0.1.0` |
| `@jczhang02/pi-stuff-todo` | Recoverable per-session task tracking with a compact editor widget | `0.1.0` |
| `@jczhang02/pi-stuff-btw` | One-shot side questions isolated from the main transcript | `0.1.0` |

Capability Packages remain independently versioned. Certified versions are bundled into the Aggregate Package as required by Pi's package contract.

## Installation

From a source checkout, install the local Aggregate Package explicitly through Pi:

```bash
pi install ./packages/pi-stuff
```

Published releases install from the registry:

```bash
pi install npm:@jczhang02/pi-stuff
```

The Package itself never edits `settings.json`. Both commands ask the Pi host to manage the selected Package.

## Development

Requirements:

- Bun 1.3.14
- Node.js 24.16.0 and npm 11.13.0 for the certified Host build
- Git, Bash, tar, gzip, and standard Unix utilities (`cp`, `mkdir`, `mv`, and `rm`)
- Expect and tmux for real-terminal verification; CI uses the Ubuntu 24.04 packages
- Linux x64 for the certified Host build; CI uses Ubuntu 24.04 as its system-utility baseline
- Pi upstream `bf4a90d81985bd45052eeeae59d84fe13e0bd2c8` (reports 0.83.0) for Host certification
- Beads 1.1.0 for issue maintenance

Build a certified Host instance on Linux x64. The command checks out the pinned source into ignored `.artifacts/`,
restores the repository-owned content-addressed model snapshot, checks the exact Node/npm/Bun versions, and writes a
hash-bound local source-build record. The default build never reads the live model catalog:

```bash
bun run host:build
```

The command prints the exact `PI_BIN`, `PI_HOST_ATTESTATION`, and `PI_HOST_SOURCE_CHECKOUT` environment needed below.
The profile certifies source, model-data, and compiler inputs; it does not claim that different system utilities produce
the same Host bytes. Each accepted build record separately binds the binary it produced. The record is an operational
guard against accidental Host mismatch, not a cryptographic attestation of a potentially hostile local machine.

Refreshing model data is a separate maintainer workflow. It hydrates the live catalog, normalizes its non-input
timestamp, and writes a new immutable candidate under `vendor/pi-host-model-data/<sha256>` without changing the
certified profile:

```bash
bun run host:model-data:refresh
```

Review the resulting file diff, then update `CERTIFIED_PI_MODEL_DATA_SHA256` explicitly in the same change if the
candidate should become certified.

```bash
bun install --frozen-lockfile --ignore-scripts
PI_BIN="$PWD/.artifacts/pi-host/linux-x64/pi" \
PI_HOST_ATTESTATION="$PWD/.artifacts/pi-host-attestation.json" \
PI_HOST_SOURCE_CHECKOUT="$PWD/.artifacts/pi-source" \
  bun run check
```

Engineering work is tracked in Beads and mirrored to [GitHub Issues](https://github.com/jczhang02/pi-stuff/issues). See [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing publishable behavior.

## Security

Pi Extensions execute with the user's operating-system permissions. Pi Stuff does not add a permission or command-interception layer. Review source before installation and report vulnerabilities according to [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © 2026 JC Zhang
