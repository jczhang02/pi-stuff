# Settings reference

[Simplified Chinese](../i18n/zh-CN/docs/reference/settings.md)

Pi Stuff stores its settings in one plain JSON document at `<agentDir>/pi-stuff.json`. Each capability owns one
top-level namespace and preserves the other namespaces when it writes.

Use `/ui`, `/notifications`, `/autoname settings`, `/goal`, `/ponytail`, `/rtk`, `/codex`, or `/codemode` for
settings exposed in Pi. Manual JSON editing is intended for advanced values and requires valid JSON without comments.

## Files

| Location | Purpose |
| --- | --- |
| `<agentDir>/pi-stuff.json` | Pi Stuff's merged settings |
| `<agentDir>/settings.json` | Pi Host settings, including the selected theme |
| `<project>/.pi/code-mode.json` | Code Mode override for the current trusted project |
| User MCP configuration | Server declarations, connection policy, and authentication |
| External Context configuration | Context engine and worker configuration |

`<agentDir>` is the Pi Agent directory resolved by the Host.

## Defaults by namespace

### `ui`

| Field | Type | Default | Control |
| --- | --- | --- | --- |
| `schemaVersion` | `3` | `3` | Managed |
| `inlineSlashAutocomplete` | boolean | `true` | `/ui` |
| `inputHighlighting` | boolean | `true` | `/ui` |
| `statusline` | boolean | `true` | `/ui` |
| `statuslineDensity` | `auto`, `full`, or `compact` | `auto` | `/ui` |
| `statuslineLatestPrompt` | boolean | `true` | `/ui` |
| `welcomeHeader` | boolean | `true` | `/ui` |

### `tools`

| Field | Type | Default | Control |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | `1` | Managed |
| `liveElapsed` | boolean | `true` | `/ui` |

### `rtk`

| Field | Type | Default | Control |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | `1` | Managed |
| `outputProjection` | boolean | `true` | `/rtk` |
| `rewriteCommands` | boolean | `true` | `/rtk` |

`rewriteCommands` allows eligible shell commands to use RTK. `outputProjection` enables RTK's compact projected
output when rewriting is active.

### `codex`

| Field | Type | Default | Control |
| --- | --- | --- | --- |
| `fast` | boolean | `false` | `/codex` |

The setting applies when the active model supports the Codex control surface.

### `goal`

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `toolVisibility` | `always` or `after-first-goal` | `always` | When Goal terminal Tools become visible |
| `experimental.goals` | boolean | `false` | Enables the multi-goal queue commands |
| `rpc.enabled` | boolean | `false` | Enables the Goal RPC surface |
| `continuationLimits.automaticTurns` | positive integer or `null` | `null` | Automatic-turn limit; `null` is unlimited |
| `continuationLimits.noProgressTurns` | positive integer or `null` | `null` | No-progress limit; `null` disables the limit |

The interactive Goal settings screen owns the common continuation and Tool-visibility choices.

### `sessionNaming`

| Field | Type | Default | Control |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | `1` | Managed |
| `enabled` | boolean | `true` | `/autoname settings` |
| `cooldownMinutes` | integer from `1` to `1440` | `10` | `/autoname settings` |
| `respectManualName` | boolean | `false` | `/autoname settings` |
| `model` | `provider/model` string, optional | active Session model | `/autoname settings` |
| `fallbackModels` | ordered `provider/model` strings | `[]` | JSON |

Removing `model` restores the active Session model as the primary route.

### `notification`

| Field | Type | Default | Control |
| --- | --- | --- | --- |
| `schemaVersion` | `3` | `3` | Managed |
| `enabled` | boolean | `true` | `/notifications` |
| `completionAlerts` | boolean | `true` | `/notifications` |
| `failureAlerts` | boolean | `true` | `/notifications` |
| `minimumDurationMs` | non-negative number | `10000` | `/notifications` |
| `gracePeriodMs` | non-negative number | `2000` | `/notifications` |
| `delivery` | `auto`, `bell`, `kitty`, `osc9`, or `osc777` | `auto` | `/notifications` |
| `responsePreview` | boolean | `false` | `/notifications` |
| `terminalBell` | boolean | `false` | `/notifications` |
| `tmuxNotification` | boolean | `true` | `/notifications` |

`responsePreview` is off by default because desktop notification history may remain visible outside Pi.

### `ponytail`

| Field | Type | Default | Control |
| --- | --- | --- | --- |
| `defaultMode` | `lite`, `full`, or `ultra` | `full` | `/ponytail` |
| `hideStatus` | boolean | `false` | `/ponytail` |
| `quietStartup` | boolean | `false` | `/ponytail` |

`PONYTAIL_*` environment values, when present, override saved Ponytail settings for the current process.

### `codeMode`

| Field | Type | Default | Control |
| --- | --- | --- | --- |
| `enabled` | boolean | process default, otherwise `false` | `/codemode global on|off` |

For a trusted project, `<project>/.pi/code-mode.json` may contain an `enabled` boolean. The effective choice is resolved
from the frozen child-process value, project override, global default, process default, then `false`.

### `web`

`web` is a JSON object consumed by the configured Web providers. Its fields depend on those providers; Pi Stuff
preserves the object and does not impose a shared provider schema.

## Invalid settings

An invalid namespace is reported through `/diagnostics`. Interactive settings screens do not replace malformed user
JSON automatically. Correct the reported namespace or move it aside, restart Pi, and apply the desired values through
the owning command.

## See also

- [Command reference](commands.md)
- [Themes](themes.md)
- [Troubleshooting](../troubleshooting.md)

