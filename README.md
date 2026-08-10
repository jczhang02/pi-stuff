<div align="center">

# pi-stuff

A personal, local package for the native [Pi coding agent](https://github.com/earendil-works/pi).

[![CI](https://github.com/jczhang02/pi-stuff/actions/workflows/ci.yml/badge.svg)](https://github.com/jczhang02/pi-stuff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f2f2f.svg)](LICENSE)

</div>

## Shape

```text
Pi Host + one local @jczhang02/pi-stuff Package + user-owned settings
```

Pi remains the Host. Pi Stuff contributes one normal Pi Package and does not provide another CLI, runtime, session
layer, or TUI shell. The Package is private and maintained for local use; it is not published to npm.

## Internal modules

The Package keeps coherent behavior in named internal modules. These are maintenance boundaries, not separately
installable Packages:

| Module | Responsibility |
| --- | --- |
| `conversation-ui` | Welcome, Statusline, live Thought, input UI, `/ui`, and shared Command Dialogs |
| `tool-display` | Compact built-in and Suite Tool activity, detail views, and resume reconstruction |
| `context-management` | Lazy Magic Context integration and native Pi fail-open behavior |
| `rtk` | Fail-open command rewriting and model-only Tool-output projection |
| `codex` | Codex Fast/usage controls plus patch and image Tools |
| `goal` | Persistent, evidence-gated work toward one session objective |
| `web` | Bounded Web search and public page/PDF reading |
| `mcp` | Lazy proxy-only MCP gateway and status UI |
| `background-work` | Current-session Background Shell, Monitor, and `/tasks` management |
| `subagents` | Current-session foreground and background Agents |
| `todo` | Recoverable session Todo state and compact checklist UI |
| `btw` | One-shot side questions outside the main transcript |

The adapted Web and MCP implementations live inside their owning modules. Their pinned origins, licenses, and local
changes remain recorded next to the source; they have no independent Package lifecycle.

## Installation

Install the Package from this checkout through Pi:

```bash
pi install ./packages/pi-stuff
```

Pi owns the resulting settings entry. Pi Stuff never installs itself or edits `settings.json`.

## Development

Requirements:

- Bun 1.3.14
- Node.js 24.16.0 and npm 11.13.0 for the certified Host build
- Git, Bash, tar, gzip, Expect, tmux, and standard Unix utilities
- Linux x64 for the certified Host build
- Pi `0.84.1` at upstream `53fa77ccd8a279eb87e92294ef3687b03ff80112`
- Optional RTK `0.42.4` for Bash rewriting
- Beads 1.1.0 for issue maintenance

Install dependencies and run the complete repository check:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
```

`bun run host:build` creates the pinned Pi Host under ignored `.artifacts/` and prints the `PI_BIN`,
`PI_HOST_ATTESTATION`, and `PI_HOST_SOURCE_CHECKOUT` variables used by full acceptance. See
[`docs/compatibility.md`](docs/compatibility.md) for the exact Host contract.

Engineering work is tracked in Beads and mirrored to [GitHub Issues](https://github.com/jczhang02/pi-stuff/issues).
Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing behavior.

## Security

Pi Extensions execute with the user's operating-system permissions. Pi Stuff does not add a permission or
command-interception layer. Review source before installation and report vulnerabilities according to
[`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © 2026 JC Zhang. Absorbed third-party source retains its own adjacent license and provenance records.
