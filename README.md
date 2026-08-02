<div align="center">

# pi-stuff

A personal suite of extensions and resources for the native [Pi coding agent](https://github.com/earendil-works/pi).

[![CI](https://github.com/jczhang02/pi-stuff/actions/workflows/ci.yml/badge.svg)](https://github.com/jczhang02/pi-stuff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f2f2f.svg)](LICENSE)

</div>

> [!IMPORTANT]
> `@jczhang02/pi-stuff` is still unreleased. Its initial capability set is under active development and host certification.

## Shape

```text
Pi host + @jczhang02/pi-stuff + user-owned settings
```

Pi remains the host. The Suite is a normal Pi Package: it exports an ordered aggregate Extension and uses Pi's existing runtime, package loader, settings, sessions, tools, and TUI. It does not provide another CLI or mutate host configuration.

## Packages

| Package | Purpose | Status |
| --- | --- | --- |
| `@jczhang02/pi-stuff` | Aggregate entry point for the full Suite | Unreleased |
| `@jczhang02/pi-stuff-ui` | Shared non-floating Command Dialog coordinator | In development |
| `@jczhang02/pi-stuff-todo` | Recoverable per-session task tracking with a compact editor widget | In development |
| `@jczhang02/pi-stuff-btw` | One-shot side questions isolated from the main transcript | In development |

Capability Packages remain independently versioned. Certified versions are bundled into the Aggregate Package as required by Pi's package contract.

## Installation

During repository development, install the local Aggregate Package explicitly through Pi:

```bash
pi install ./packages/pi-stuff
```

After the first npm release:

```bash
pi install npm:@jczhang02/pi-stuff
```

The Package itself never edits `settings.json`. Both commands ask the Pi host to manage the selected Package.

## Development

Requirements:

- Bun 1.3.14
- Pi 0.83.0 for host certification
- Beads 1.1.0 for issue maintenance

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Engineering work is tracked in Beads and mirrored to [GitHub Issues](https://github.com/jczhang02/pi-stuff/issues). See [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing publishable behavior.

## Security

Pi Extensions execute with the user's operating-system permissions. Review source before installation and report vulnerabilities according to [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © 2026 JC Zhang
