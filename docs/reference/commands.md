# Command reference

[Simplified Chinese](../i18n/zh-CN/docs/reference/commands.md)

Pi Stuff commands run from Pi's editor. A bare command usually opens its interactive view; arguments provide the
scriptable form.

## Interface and inspection

| Command | Action |
| --- | --- |
| `/ui` | Configure the Welcome card, Statusline, inline slash completion, input highlighting, density, and Tool timer |
| `/diagnostics` | Show bounded, redacted Suite diagnostics from the current process |
| `/tools` | List Retrieval Group members and independent Tool Activities |
| `/tools <id>` | Inspect one Tool Activity |
| `/notifications` | Configure notification policy and send a test notification |

Pi's own `/settings` command controls Host settings such as the active theme.

## Sessions and side questions

| Command | Action |
| --- | --- |
| `/resume` | Open Pi's native selector with bounded Fast Resume loaders; fall back to Pi's complete-history loader when interception is unavailable |
| `/fast-resume` | Open the native selector with bounded loaders when `/resume` interception is disabled or unavailable |
| `/autoname` | Generate a new name for the current Session |
| `/autoname settings` | Configure automatic naming, cooldown, manual-name policy, and primary model |
| `/btw <question>` | Ask a no-Tool side question without adding it to the main transcript |

## Work control

| Command | Action |
| --- | --- |
| `/goal [--tokens 100k] <objective>` | Start a Goal, optionally with an explicit token budget |
| `/goal status` | Show the active Goal and its progress |
| `/goal edit [--tokens 100k] <objective>` | Change the active Goal objective or token budget |
| `/goal pause` | Pause automatic Goal continuation |
| `/goal resume` | Resume a paused Goal |
| `/goal clear` or `/goal stop` | Clear the current Goal state from the Session |
| `/tasks` | Open controls for Background Shells and Monitors |
| `/agents` | Open controls for current-session delegated Agents |

When `goal.experimental.goals` is enabled, Goal also accepts queue controls:

| Command | Action |
| --- | --- |
| `/goal add <objective>` or `/goal push <objective>` | Add an objective to the queue |
| `/goal prioritize <objective>` or `/goal unshift <objective>` | Activate a new objective and move the current Goal to the front of the queue |
| `/goal drop-last` or `/goal pop` | Remove the last queued Goal, or the current Goal when the queue is empty |
| `/goal skip` or `/goal shift` | Clear the current Goal and activate the queue head |

## Context

| Command | Action |
| --- | --- |
| `/ctx` or `/ctx status` | Show current Context status and available maintenance actions |
| `/ctx flush` | Flush pending Context persistence work |
| `/ctx wrapup [N]` | Wrap up recent history, optionally using the last `N` messages |
| `/ctx recomp [range]` | Recompress the selected history range |
| `/ctx upgrade` | Run the supported Context data upgrade |

Context retrieval operations are Tools and appear only when the configured Context engine exposes them.

## Codex and RTK

| Command | Action |
| --- | --- |
| `/codex` | Show Codex usage and Fast mode controls for the active supported model |
| `/codex fast` | Toggle Codex Fast mode |
| `/codex usage` | Refresh Codex usage |
| `/rtk` | Inspect RTK availability and command-rewriting policy |

## Ponytail

| Command | Action |
| --- | --- |
| `/ponytail` | Show current mode and controls |
| `/ponytail on` | Enable the configured default mode |
| `/ponytail off` | Disable Ponytail |
| `/ponytail lite` | Use light anti-overengineering guidance |
| `/ponytail full` | Use the standard anti-overengineering guidance |
| `/ponytail ultra` | Use the strictest anti-overengineering guidance |
| `/ponytail default <lite|full|ultra>` | Set the mode used by `/ponytail on` |
| `/ponytail status <show|hide>` | Show or hide Ponytail status |
| `/ponytail startup <show|quiet>` | Show or suppress the startup notice |
| `/ponytail-review` | Review current changes for overengineering |
| `/ponytail-audit` | Audit the repository for avoidable complexity |
| `/ponytail-debt` | List tracked Ponytail deferrals |
| `/ponytail-gain` | Show the Ponytail impact card |
| `/ponytail-help` | Show the Ponytail command card |

## MCP

| Command | Action |
| --- | --- |
| `/mcp` or `/mcp status` | Show configured servers and connection state |
| `/mcp setup` | Open MCP setup |
| `/mcp auth <server>` | Authenticate a server |
| `/mcp reconnect <server>` | Reconnect a server |
| `/mcp logout <server>` | Remove the server's authentication |
| `/mcp disable <server>` | Disable a server |
| `/mcp enable <server>` | Enable a server |
| `/mcp auto-connect <server>` | Connect the server automatically |
| `/mcp on-demand <server>` | Connect the server only when used |

## Code Mode

`/codemode` opens the interactive control surface. Direct forms are useful for repeatable project setup and ledger
maintenance:

| Command | Action |
| --- | --- |
| `/codemode on` | Enable Code Mode for the current trusted project |
| `/codemode off` | Disable Code Mode for the current trusted project |
| `/codemode global on` | Enable the global default |
| `/codemode global off` | Disable the global default |
| `/codemode history` | Show the execution ledger |
| `/codemode pending` | Show operations waiting for approval |
| `/codemode approve <id>` | Approve a pending operation |
| `/codemode reject <id> <sequence>` | Reject a pending operation at its current sequence |
| `/codemode snippets` | List saved snippets |
| `/codemode save <id> <name> [description]` | Save a ledger operation as a snippet |
| `/codemode delete <name>` | Delete a saved snippet |
| `/codemode abandon <id>` | Abandon an unfinished operation |
| `/codemode rollback <id>` | Roll back a completed reversible operation |
| `/codemode compensate <id>` | Alias for `rollback` |
| `/codemode expire` | Expire stale ledger state |

## Tools without slash commands

Web access and Todo are exposed through Tools rather than user slash commands. Their availability depends on the
active Suite configuration and Host Tool policy.

## See also

- [Getting started](../getting-started.md)
- [Settings reference](settings.md)
- [Troubleshooting](../troubleshooting.md)
