# Code Mode

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/code-mode.md)

Code Mode lets the model compose active Pi Stuff Tools with JavaScript inside an isolated V8 host.

## Enable Code Mode

Code Mode is off by default. In a trusted project, run:

```text
/codemode on
```

`/codemode` opens the interactive control surface. `/codemode off` disables the current project choice, while
`/codemode global on|off` changes the global default.

The effective setting is resolved in this order:

1. the value frozen into a child Agent at launch;
2. trusted-project `.pi/code-mode.json`;
3. global `codeMode.enabled` in `<agentDir>/pi-stuff.json`;
4. `PI_STUFF_CODE_MODE_DEFAULT`;
5. `off`.

An untrusted project cannot persist a project setting.

## Quick start

The model can discover and call the local catalog:

```js
await codemode.search("read file");
const pkg = await tools.read({ path: "package.json" });
text(pkg);
```

Every `tools.*` call must be awaited. An explicit Tool error rejects the call; ordinary JavaScript `try/catch` can
handle it.

## Catalog and output

When Code Mode is on, active Package-owned Tools move behind `codemode({ code })`. Separately installed Tools remain
top-level.

`codemode.search(query)` and `codemode.describe(path)` inspect the local catalog without placing the whole catalog in
model history. The top-level `tool_search` Tool reads the same ranked catalog. Its response stays within 4,000
characters: when complete definitions do not fit, it keeps the top Tool description once with a compact structural
type; when that does not fit, it requires `codemode.describe(path)` instead of presenting an incomplete callable
contract. If no result path fits, it asks the model to refine the search. If exact input fields are no
longer visible after context compaction, describe the method again rather than guessing field names.

Available output helpers include `text`, `image`, `generatedImage`, `audio`, `store`, `load`, and `notify`. Returning a
complete image-producing Tool result directly preserves its native image path.

For one observable command, file, log, or HTTP condition with a deadline, call `tools.monitor(...)` once and continue
useful work. Do not poll with Bash, sleep, status calls, or repeated turns.

## Sandbox

JavaScript has no direct Node, Bun, filesystem, process, network, module, credential, or `console` access. I/O is
available only through the Tool catalog and Host output helpers.

The child Agent's existing Tool allowlist and capability ceiling still bound its catalog. A later parent toggle does
not change an already running child.

One execution may issue at most 768 nested Tool calls. Crossing the bound fails explicitly.

## Tool behavior and UI

Nested Tools retain their original argument preparation, validation, permissions, lifecycle hooks, cancellation,
streaming, renderer, media behavior, and Tool Activity identity.

Code Mode adds no outer row when nested Tools or media already represent the outcome. A pure JavaScript text-only
success without nested activity stays out of the visible transcript. An unrepresented outer failure receives one
fallback row.

Session JSONL stores the outer result, nested calls, media presentation data, and ledger entries needed to reproduce the
same view after reload.

## Replay and recovery

Each execution and nested call receives a stable ID in the current Session's append-only ledger.

| Replay policy | Recovery behavior |
| --- | --- |
| `never` | Refuse to repeat an ambiguous unfinished effect; default |
| `record` | Reuse only a settled recorded result |
| `reexecute` | Deliberately perform the operation again |

An unfinished `never` or `record` call becomes `incomplete`. Recovery commands fail when the active Session branch
cannot be identified rather than treating history as empty.

The ledger retains up to 50 terminal executions, caps one source program at 1,000,000 bytes, and caps all Code Mode
ledger entries in one Session at 16 MiB.

## Durable approval

A Tool marked `requiresApproval` pauses before its effect. Use:

```text
/codemode pending
/codemode approve <execution-id>
/codemode reject <execution-id> <sequence>
```

Approval resumes once with the original working directory and active Tool definition. Rejection is idempotent and
performs no Tool effect. Approval cannot be combined with `reexecute`.

## History, rollback, and snippets

| Command | Action |
| --- | --- |
| `/codemode history` | Show retained execution history |
| `/codemode abandon <id>` | Abandon unfinished execution |
| `/codemode rollback <id>` | Run declared inverse operations in reverse order |
| `/codemode expire` | Expire stale unfinished state |
| `/codemode save <id> <name> [description]` | Save a successful program |
| `/codemode snippets` | List saved programs |
| `/codemode delete <name>` | Delete a saved program |

`/codemode compensate <id>` is an alias for rollback. Partial rollback remains retryable and never erases ledger
history.

Programs can use `codemode.step(name, fn)` for durable named checkpoints and `codemode.run(name, input)` to run a saved
snippet.

## Native host

The V8 helper is prepared only on the first explicit execution. Pi Stuff downloads the pinned OpenAI Codex
`rust-v0.145.0` asset for the current platform, honors standard proxy environment variables, verifies SHA-256, and
installs through a lock and atomic staging under the Pi Agent cache.

Download is bounded to 120 seconds; startup and handshake are bounded to 10 seconds. Set
`PI_STUFF_CODE_MODE_HOST` to an existing absolute helper path to use a preinstalled binary.

Supported host assets cover Linux and macOS x64/arm64 plus Windows x64/arm64. Non-Windows archive installation requires
`tar`.

## See also

- [Code Mode Module README](../../packages/pi-stuff/src/code-mode/README.md)
- [Command reference](../reference/commands.md#code-mode)
- [Settings reference](../reference/settings.md#codemode)
- [Troubleshooting](../troubleshooting.md#codex-and-code-mode)
- [Upstream references](../../packages/pi-stuff/src/code-mode/UPSTREAM.md)

