# Single-Package migration record

> Historical architecture record for the completed `ps-7lq` migration. It is not a compatibility statement; current
> versions live in the [compatibility guide](../compatibility.md).

The migration kept Pi as the Host and moved the former workspace Packages into one local Pi Stuff Package. The durable
Host and Package boundary is recorded in [ADR 0001](../adr/0001-keep-pi-as-the-host.md).

## Source-to-Module map

| Frozen source | Destination in `packages/pi-stuff` |
| --- | --- |
| `packages/pi-stuff-ui` | `src/conversation-ui` |
| `packages/pi-stuff-tools` | `src/tool-display` |
| `packages/pi-stuff-context` | `src/context-management` |
| `packages/pi-stuff-rtk` | `src/rtk` |
| `packages/pi-stuff-codex` | `src/codex` |
| `packages/pi-stuff-goal` | `src/goal` |
| `packages/pi-stuff-web` | `src/web` |
| `packages/pi-web-access` | `src/web/runtime` |
| `packages/pi-stuff-mcp` | `src/mcp` |
| `packages/pi-mcp-adapter` | `src/mcp/runtime` |
| `packages/pi-stuff-work` | `src/background-work` |
| `packages/pi-stuff-agents` | `src/subagents` |
| `packages/pi-stuff-todo` | `src/todo` |
| `packages/pi-stuff-btw` | `src/btw` |
| concurrent `feat/code-mode` work | `src/code-mode` |

Later Capabilities enter through the same Package boundary. The current ordered Capability list belongs to
[`suite.json`](../../packages/pi-stuff/suite.json), not this historical inventory.

## Runtime Resources retained by the migration

- `src/btw/prompts/btw-system.txt`
- `src/codex/native/{apply-patch,imagegen,view-image}/linux-x64/*`
- `src/codex/LICENSES/Apache-2.0.txt` and `src/codex/THIRD_PARTY_NOTICES.md`
- `src/rtk/upstream/techniques/*.ts`
- `src/background-work/src/process-supervisor.mjs`
- `src/mcp/runtime/mcp-keyring-helper.cjs` and `src/mcp/runtime/UPSTREAM.md`
- `src/code-mode/LICENSES/*`, `src/code-mode/THIRD_PARTY_NOTICES.md`, and `src/code-mode/UPSTREAM.md`
- Module-owned `UPSTREAM.md`, `SECURITY.md`, and third-party license files

The formerly bundled `subagents/agents/general-purpose.md` resource was removed.

## Result

The repository ended with one Package manifest and one default Extension factory. Web and MCP adapted source stayed
private to their owning Modules. Dependency truth moved to the Package manifest and lockfile; composition truth moved
to `suite.json`. Pi continued to own the CLI, TUI, Sessions, Settings, Package loading, and model interaction.
