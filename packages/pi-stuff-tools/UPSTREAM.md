# Upstream provenance

This Capability Package is an owned fork of `@mobrienv/pi-tidy-tools` 0.4.1.

| Field | Value |
| --- | --- |
| Repository | `https://github.com/mikeyobrien/pi-tidy-tools` |
| Package directory | `packages/pi-tidy-tools` |
| Release tag | `pi-tidy-tools-v0.4.1` |
| Source commit | `4b251377f1b64f904704e7f760e8947688d12a9a` |
| License | MIT |
| npm archive SHA-1 | `3412d29d584f9226b02a13279d88a3ea03a1422e` |
| npm archive SHA-256 | `59bf767e047a0799257af3c510a92f0841db2791e8e11aceca14fc2f7221f71a` |

## Pi Stuff delta

- Keeps the upstream result-first, same-name built-in override and semantic summary ideas.
- Uses Pi 0.83.0 tool definitions directly so all seven built-in parameter schemas, prompt metadata, execution, result
  shapes, events, and permission interception remain Host-owned and unchanged.
- Removes the injected `reasoning` argument and every non-result presentation mode.
- Removes fixed ANSI colors, emoji, full-row success backgrounds, `/diff`, global expansion as the detail path,
  `pi-fff`, command-driven configuration, and upstream file-writing startup/configuration behavior.
- Uses Pi semantic theme tokens, a bounded width cache, hard-capped focused details, and the shared non-floating Pi
  Stuff Command Dialog.
- Adds a renderer contract for Suite-owned tools. Todo success remains visually silent, while Agent work uses the
  same compact grammar.
- Does not contain or derive from code in `jczhang02/pi-agent`.

The upstream license is preserved in `LICENSE`. Future rebases must update this record and keep local changes
auditable.
